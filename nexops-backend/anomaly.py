"""
NexOps anomaly engine — online, per-machine Isolation Forest.

This is NexOps's OWN risk view, computed independently of the gateway's static
alarm severity. The whole point: catch drift/anomalies that the static
thresholds miss, BEFORE the gateway escalates.

Design notes
------------
- ONLINE, NO PRETRAINING: we never train on synthetic/offline data. Each machine
  builds its own model from the live stream it actually produces. Until a machine
  has emitted enough readings, we honestly report "warming up" with no score —
  we do NOT fabricate a number.
- PER MACHINE: every machine gets its own rolling window, its own feature-key
  list, and its own fitted model. Machines may have different sensor sets, so we
  key everything by machine name and derive the feature-key order per machine.
- STABLE FEATURE ORDER: the feature vector is built from record["features"] in
  sorted-key order, so the vector layout is consistent for a given machine across
  readings. The key list is locked in the first time we see a machine.

State is held entirely inside the engine instance; main.py just calls
`update_and_score(record)` and reads the returned dict.
"""

from collections import deque

# sklearn / numpy are REQUIRED for the anomaly stage. Guard the import so the
# failure message is obvious instead of a bare ImportError deep in a callback.
try:
    import numpy as np
    from sklearn.ensemble import IsolationForest
    _SKLEARN_OK = True
    _IMPORT_ERROR = None
except Exception as exc:  # pragma: no cover - only hit when deps missing
    _SKLEARN_OK = False
    _IMPORT_ERROR = exc


# Tunables -------------------------------------------------------------------
WINDOW_SIZE = 200      # rolling window of recent feature vectors, per machine
MIN_TRAIN = 30         # need this many samples before we score at all
REFIT_EVERY = 20       # refit the forest every N readings (not every reading)

# Score-calibration tunables (the score->[0,1] mapping; see update_and_score).
# We map the CURRENT reading by its per-machine z-score: how many std it sits
# BELOW that machine's OWN normal score_samples baseline (z>0 = more anomalous
# than its normal). A logistic centered at Z0 std with steepness K turns that
# into 0..1. Chosen so steady-normal (z~0) reads LOW and a 3-std deviation reads
# HIGH:
#   z=0 -> 0.047,  z=1 -> 0.182,  z=2 -> 0.500,  z=3 -> 0.818
CALIB_K = 1.5          # logistic steepness on the z-score
CALIB_Z0 = 2.5         # z (robust-std below normal) that maps to 0.5.
                       # Raised 2.0 -> 2.5 to absorb the in-sample center bias
                       # (+0.75 median z on tight machines) so ordinary normal
                       # variation no longer crosses into false-CRITICAL.
CALIB_STD_EPS = 1e-9   # absolute epsilon so the baseline scale never /0
# Minimum baseline scale (robust-std units). On tight machines the MAD-based
# scale is UNSTABLE across refits (swings 0.029-0.104); small-scale refits make
# the z-denominator tiny and inflate ordinary normal variation to z>8 false-
# CRITICAL. The old 0.02 floor never engaged. Diagnostic sweep proved a fixed
# stable 0.07 floor clamps destabilizing low dips (0.029 refits) to ~1-3% false-
# CRITICAL on low-variance warmup, well below desensitizing threshold (0.08+).
CALIB_SCALE_FLOOR = 0.07
# Don't TRUST calibration until the (normal-only) window holds at least this many
# rows; below it we score via the legacy decision_function mapping so a small,
# unrepresentative early window can't emit false highs. (Warm-up n<MIN_TRAIN=30
# still returns warming_up; this floor governs the [MIN_TRAIN, CALIB_MIN_SAMPLES)
# band.)
CALIB_MIN_SAMPLES = 60


class AnomalyEngine:
    """Maintains a per-machine rolling window + Isolation Forest, and scores
    each incoming reading against that machine's own recent history."""

    def __init__(self, window_size=WINDOW_SIZE, min_train=MIN_TRAIN,
                 refit_every=REFIT_EVERY):
        self.window_size = window_size
        self.min_train = min_train
        self.refit_every = refit_every

        # All state is keyed by machine name.
        self._windows = {}        # machine -> deque[list[float]]
        self._keys = {}           # machine -> tuple[str]  (locked feature order)
        self._models = {}         # machine -> fitted IsolationForest | None
        self._since_fit = {}      # machine -> int (readings since last refit)
        self._calib = {}          # machine -> (baseline_median, baseline_std)

    # -- feature extraction --------------------------------------------------

    def _feature_keys(self, machine, features):
        """Return the locked, sorted feature-key order for this machine.

        The first time we see a machine we lock in the sorted keys of its
        `features` object. We keep that order even if later records add/drop a
        key, so the vector layout stays stable; missing keys are filled with the
        last-known behaviour via _vector()."""
        if machine not in self._keys:
            self._keys[machine] = tuple(sorted(features.keys()))
        return self._keys[machine]

    def _vector(self, machine, features):
        """Build a numeric vector for this machine in its locked key order.
        Non-numeric / missing values become 0.0 so the vector length is stable."""
        keys = self._feature_keys(machine, features)
        vec = []
        for k in keys:
            v = features.get(k, 0.0)
            try:
                vec.append(float(v))
            except (TypeError, ValueError):
                vec.append(0.0)
        return vec

    # -- main entry point ----------------------------------------------------

    def update_and_score(self, record, is_training_eligible=None):
        """Score this reading and (only if eligible) add it to the training window.

        Returns a dict:
          {"anomaly_score": float|None, "status": "warming_up"|"scored",
           "samples": int}

        - anomaly_score is in 0..1 where HIGHER = MORE anomalous, or None while
          warming up.
        - status is "warming_up" until min_train samples exist, then "scored".

        TRAINING-APPEND GATE (is_training_eligible): EVERY reading is still SCORED
        (faults can and should read HIGH), but only NORMAL readings may ENTER the
        training window, so a machine's own fault frames can never pollute its
        model of "normal". The caller passes `not is_fault` (gateway/sim flags
        only - never anomaly_score, which would be circular). Fail-safe default
        when the flag is missing/None: eligible ONLY if the record looks normal
        (Status normal/absent); when uncertain we EXCLUDE (prefer not training on
        a possibly-fault row) so contamination cannot sneak back in.
        """
        if not _SKLEARN_OK:
            raise RuntimeError(
                "anomaly engine requires scikit-learn and numpy. Install with: "
                "pip install scikit-learn numpy  (original error: "
                f"{_IMPORT_ERROR!r})"
            )

        machine = record.get("Machine", "__unknown__")
        features = record.get("features") or {}

        vec = self._vector(machine, features)

        # Resolve the fail-safe default for a missing/None flag: normal/absent
        # Status -> eligible; anything else -> EXCLUDE (uncertain == treat as fault).
        if is_training_eligible is None:
            status = str(record.get("Status", "") or "").strip().lower()
            is_training_eligible = status in ("", "normal")

        window = self._windows.setdefault(
            machine, deque(maxlen=self.window_size)
        )
        # Only NORMAL readings train the model; faults are scored below, not learned.
        if is_training_eligible:
            window.append(vec)

        n = len(window)
        if n < self.min_train:
            # Honest "not ready yet" — no fabricated score.
            return {"anomaly_score": None, "status": "warming_up", "samples": n}

        # Refit periodically rather than every reading (fitting is the costly
        # part). We (re)fit when there's no model yet or the cadence is hit.
        since = self._since_fit.get(machine, self.refit_every)
        model = self._models.get(machine)
        if model is None or since >= self.refit_every:
            model = IsolationForest(
                n_estimators=100,
                contamination="auto",
                random_state=42,
            )
            train = np.array(window, dtype=float)
            model.fit(train)
            self._models[machine] = model
            self._since_fit[machine] = 0
            # CALIBRATION CAPTURE - RECOMPUTED every refit (no freeze) from the
            # current window. The append gate keeps that window normal-only, so it
            # is already contamination-free; recomputing keeps the baseline MATCHED
            # to the live, continuously-refit model (the frozen baseline drifted out
            # of sync with later refits, the residual false-CRITICAL cause). Robust
            # stats resist a few outlier score_samples: median center + MAD-based
            # scale (1.4826*MAD ~= std for normal data), floored so a tight window
            # can't make the denominator tiny. score_samples is higher = more
            # normal. Fail-safe: if capture errors we drop calib and the score path
            # uses the legacy decision_function mapping; we never crash.
            try:
                raw_train = model.score_samples(train)
                base_center = float(np.median(raw_train))
                mad = float(np.median(np.abs(raw_train - base_center)))
                current_scale = 1.4826 * mad
                # Plain recompute: no EMA smoothing across refits. EMA carried
                # small early scales forward and preserved small-denominator bursts
                # (the 0.029 dips). Fixed stable 0.07 floor alone achieves the goal
                # (~1-3% false-CRITICAL on low-variance warmup) without the cross-
                # refit instability of the EMA blend. base_center stays fully
                # recomputed (tracked to live model); floor clamps destabilizing dips.
                base_scale = max(current_scale, CALIB_SCALE_FLOOR, CALIB_STD_EPS)
                self._calib[machine] = (base_center, base_scale)
            except Exception:
                self._calib.pop(machine, None)
        else:
            self._since_fit[machine] = since + 1

        # CALIBRATED mapping (per-machine): score by how far BELOW this machine's
        # OWN normal the current reading sits. score_samples is higher = more
        # normal, so a reading well under the baseline median is anomalous.
        #   z = (baseline_median - raw_cur) / baseline_std   # z>0 = anomalous
        #   anomaly_score = logistic(K * (z - Z0))           # see CALIB_* above
        # A steady-normal reading has z~0 -> ~0.05; a 3-std deviation -> ~0.82.
        current = np.array([vec], dtype=float)
        calib = self._calib.get(machine)
        if calib is not None and n >= CALIB_MIN_SAMPLES:
            base_center, base_scale = calib
            raw_cur = float(model.score_samples(current)[0])  # higher = more normal
            z = (base_center - raw_cur) / base_scale          # >0 = more anomalous
            anomaly_score = 1.0 / (1.0 + np.exp(-CALIB_K * (z - CALIB_Z0)))
        else:
            # SAMPLE-FLOOR / FAIL-SAFE: calibration absent (capture errored) OR the
            # window still holds < CALIB_MIN_SAMPLES clean rows -> use the legacy
            # decision_function mapping for this reading. A small/unrepresentative
            # early window can't emit false highs this way, and we never crash.
            decision = float(model.decision_function(current)[0])  # >0 inlier, <0 outlier
            anomaly_score = 1.0 / (1.0 + np.exp(8.0 * decision))
        anomaly_score = float(max(0.0, min(1.0, anomaly_score)))

        return {"anomaly_score": anomaly_score, "status": "scored", "samples": n}
