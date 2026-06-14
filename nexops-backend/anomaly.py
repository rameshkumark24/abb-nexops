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

    def update_and_score(self, record):
        """Append this record's features to the machine's window and score it.

        Returns a dict:
          {"anomaly_score": float|None, "status": "warming_up"|"scored",
           "samples": int}

        - anomaly_score is in 0..1 where HIGHER = MORE anomalous, or None while
          warming up.
        - status is "warming_up" until min_train samples exist, then "scored".
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

        window = self._windows.setdefault(
            machine, deque(maxlen=self.window_size)
        )
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
            model.fit(np.array(window, dtype=float))
            self._models[machine] = model
            self._since_fit[machine] = 0
        else:
            self._since_fit[machine] = since + 1

        # score_samples: higher = MORE normal (less anomalous). It is roughly
        # the negative mean path length offset; typical values sit around
        # [-0.5, 0.0] for inliers and go more negative for outliers.
        #
        # Normalization to 0..1 where HIGHER = MORE anomalous:
        #   raw  = score_samples(current)          # higher = more normal
        #   anomaly_score = sigmoid(-k * raw)      # flips sign, squashes to 0..1
        # We center the sigmoid near the forest's own decision boundary by
        # using decision_function (which is score_samples minus the learned
        # offset, so 0 ≈ boundary, negative ≈ anomalous). This keeps the score
        # comparable across machines despite different feature scales.
        current = np.array([vec], dtype=float)
        decision = float(model.decision_function(current)[0])  # >0 inlier, <0 outlier

        # Sigmoid on the negated decision value: decision<<0 -> ~1 (anomalous),
        # decision>>0 -> ~0 (normal), decision==0 -> 0.5 (on the boundary).
        # k controls steepness; 8 gives a reasonably crisp transition.
        k = 8.0
        anomaly_score = 1.0 / (1.0 + np.exp(k * decision))
        anomaly_score = float(max(0.0, min(1.0, anomaly_score)))

        return {"anomaly_score": anomaly_score, "status": "scored", "samples": n}
