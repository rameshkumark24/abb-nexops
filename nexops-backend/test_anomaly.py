"""
Verify the per-machine score CALIBRATION in anomaly.py.

Steady-normal readings for one machine must score LOW (mean < 0.30, ideally
~0.1) with < 10% above the 0.45 MEDIUM cutoff; an injected rising trend must
climb past the 0.65 HIGH cutoff. Pure check on AnomalyEngine - no broker, no DB,
no MQTT.

Run:  python test_anomaly.py      (or: pytest test_anomaly.py)
"""

import random

from anomaly import AnomalyEngine, MIN_TRAIN, CALIB_MIN_SAMPLES

# Heterogeneous-scale normal baselines (Motor-like): temp/current/vibration/rpm.
# Mixing wildly different magnitudes on purpose - the calibration must still make
# steady normal read LOW.
_MEANS = {"gen_temp": 60.0, "current": 30.0, "vibration": 2.0, "rpm": 1500.0, "bearing_temp": 55.0}
_STDS = {"gen_temp": 0.5, "current": 0.6, "vibration": 0.06, "rpm": 4.0, "bearing_temp": 0.4}


def _normal_features(rng):
    return {k: round(rng.gauss(_MEANS[k], _STDS[k]), 3) for k in _MEANS}


def _steady_normal_scores(n=160, seed=0):
    """Scores over a steady-normal stream, measured in the CALIBRATED regime only
    (window >= CALIB_MIN_SAMPLES clean rows). The early legacy-fallback band is
    transient by design and intentionally not asserted on here."""
    rng = random.Random(seed)
    eng = AnomalyEngine()
    scores = []
    for i in range(n):
        out = eng.update_and_score({"Machine": "Motor B1", "features": _normal_features(rng)})
        if (out["status"] == "scored" and out["anomaly_score"] is not None
                and (i + 1) >= CALIB_MIN_SAMPLES):
            scores.append(out["anomaly_score"])
    return scores


def _rising_trend_peak(seed=1):
    rng = random.Random(seed)
    eng = AnomalyEngine()
    # 1) warm up + calibrate on steady normal.
    for _ in range(MIN_TRAIN + 30):
        eng.update_and_score({"Machine": "Motor B1", "features": _normal_features(rng)})
    # 2) inject a developing fault: bearing_temp climbs far beyond this machine's
    # own ~55 normal, dragging vibration with it.
    peak = 0.0
    for step in range(1, 40):
        feats = _normal_features(rng)
        feats["bearing_temp"] = 55.0 + step * 2.0
        feats["vibration"] = 2.0 + step * 0.15
        out = eng.update_and_score({"Machine": "Motor B1", "features": feats})
        if out["status"] == "scored" and out["anomaly_score"] is not None:
            peak = max(peak, out["anomaly_score"])
    return peak


def test_steady_normal_scores_low():
    scores = _steady_normal_scores()
    assert scores, "expected some scored readings after warm-up"
    above = sum(1 for s in scores if s >= 0.45)
    mean = sum(scores) / len(scores)
    # Calibrated normal sits well below the MEDIUM cutoff.
    assert above / len(scores) < 0.10, f"too many normal readings >=0.45: {above}/{len(scores)}"
    assert mean < 0.30, f"normal mean too high: {mean:.3f}"


def test_rising_trend_climbs_past_high():
    peak = _rising_trend_peak()
    assert peak >= 0.65, f"rising trend failed to reach HIGH: peak={peak:.3f}"


def _fault_phases():
    """Replicate the contamination diagnostic A->B->C->D, but now GATE training:
    fault phases (B rising, C sustained) are fed is_training_eligible=False, so
    they are scored but never enter the training window. Returns (A, B, C, D)
    score lists."""
    rng = random.Random(7)
    eng = AnomalyEngine()
    m = "Motor B1"

    def feed(feats, eligible):
        return eng.update_and_score(
            {"Machine": m, "features": feats}, is_training_eligible=eligible
        )["anomaly_score"]

    # Phase A: steady normal (training-eligible) -> warm PAST the sample floor and
    # build a clean (recomputed) calibrated baseline. Measured in the calibrated
    # regime only (window >= CALIB_MIN_SAMPLES).
    a = []
    for i in range(100):
        s = feed(_normal_features(rng), True)
        if s is not None and (i + 1) >= CALIB_MIN_SAMPLES:
            a.append(s)
    # Phase B: rising fault (NOT eligible - live Status would be Warning/predictive).
    b = []
    for i in range(40):
        feats = _normal_features(rng)
        feats["bearing_temp"] = 55.0 + 1.5 * (i + 1)
        feats["vibration"] = 2.0 + 0.08 * (i + 1)
        feats["current"] = 30.0 + 0.4 * (i + 1)
        b.append(feed(feats, False))
    # Phase C: SUSTAINED high fault (NOT eligible). Long enough that, WITHOUT the
    # gate, the 200-window would fully turn over to fault (the old inversion).
    c = []
    for _ in range(240):
        feats = _normal_features(rng)
        feats["bearing_temp"] = 118.0
        feats["vibration"] = 5.4
        feats["current"] = 46.0
        c.append(feed(feats, False))
    # Phase D: return to NORMAL (eligible). Must read LOW again, NOT ~0.99.
    d = [feed(_normal_features(rng), True) for _ in range(20)]
    return a, b, c, d


def _low_variance_then_typical(seed=1):
    """First MIN_TRAIN TIGHT (low-variance, scale 0.25) readings, then 100
    typical-normal readings - the residual false-CRITICAL scenario. Returns the
    100 typical scores. All readings are normal (training-eligible)."""
    rng = random.Random(seed)
    eng = AnomalyEngine()
    m = "LowVar A1"
    for _ in range(MIN_TRAIN):
        tight = {k: round(rng.gauss(_MEANS[k], _STDS[k] * 0.25), 3) for k in _MEANS}
        eng.update_and_score({"Machine": m, "features": tight}, is_training_eligible=True)
    scores = []
    for _ in range(100):
        s = eng.update_and_score(
            {"Machine": m, "features": _normal_features(rng)}, is_training_eligible=True
        )["anomaly_score"]
        if s is not None:
            scores.append(s)
    return scores


def test_low_variance_warmup_no_false_critical():
    # (a) KEY FIX: a tight/low-variance warm-up window must NOT make later typical
    # normal readings read CRITICAL. OLD frozen calib was ~32% >=0.65 (mean ~0.40);
    # EMA-scale version dropped to ~21%. Diagnostic proved fixed 0.07 floor gives
    # ~1-3% (target <5%), no EMA instability.
    scores = _low_variance_then_typical()
    mean = sum(scores) / len(scores)
    crit = sum(1 for s in scores if s >= 0.65)
    assert mean < 0.30, f"low-var warm-up normal mean too high: {mean:.3f}"
    # Fixed 0.07 floor without EMA: expect ~1-3% false CRITICAL (was 21% with EMA).
    assert crit / len(scores) < 0.05, f"too many false CRITICAL (expect ~1-3%): {crit}/{len(scores)}"


def test_representative_normal_calibrated_very_low():
    # (b) representative steady-normal, calibrated regime -> mean<0.20, keep <5%
    # HIGH. (OLD frozen baseline: occasional 5/100 >=0.65 / max ~0.92; fixed 0.07
    # floor with Z0=2.5 sits well under MEDIUM cutoff ~0-1% >=0.65).
    scores = _steady_normal_scores()
    mean = sum(scores) / len(scores)
    crit = sum(1 for s in scores if s >= 0.65)
    assert mean < 0.20, f"representative calibrated-normal mean too high: {mean:.3f}"
    assert crit / len(scores) < 0.05, f"too many CRITICAL on representative normal: {crit}/{len(scores)}"


def test_gated_training_prevents_inversion():
    a, b, c, d = _fault_phases()
    mean = lambda xs: sum(xs) / len(xs)
    assert mean(a) < 0.30, f"A normal mean too high: {mean(a):.3f}"
    assert max(b) >= 0.65, f"B rising fault failed to detect: peak={max(b):.3f}"
    # The fix: a SUSTAINED fault stays HIGH instead of collapsing toward ~0.02.
    # Data-proven expectation after the retune: C mean ~0.692.
    assert mean(c) > 0.5, f"C sustained fault collapsed (inversion not fixed): mean={mean(c):.3f}"
    # And return-to-normal reads LOW again, not the ~0.99 false-CRITICAL inversion.
    # Data-proven expectation after the retune: D mean ~0.049.
    assert mean(d) < 0.30, f"D return-to-normal inverted high: mean={mean(d):.3f}"


def test_steady_normal_medium_rate_under_5pct():
    # Tighter than test_steady_normal_scores_low (<10%): after the floor=0.07 /
    # Z0=2.5 retune (no EMA), steady representative normal sits far under MEDIUM
    # that >=0.45 should be < 5% (fixed floor proven stable ~0-1% at >=0.65).
    scores = _steady_normal_scores()
    above = sum(1 for s in scores if s >= 0.45)
    assert above / len(scores) < 0.05, f"too many normal readings >=0.45: {above}/{len(scores)}"


if __name__ == "__main__":
    scores = _steady_normal_scores()
    above = sum(1 for s in scores if s >= 0.45)
    print(f"steady-normal : n={len(scores)} mean={sum(scores)/len(scores):.3f} "
          f"min={min(scores):.3f} max={max(scores):.3f} "
          f">=0.45: {above}/{len(scores)} ({100*above/len(scores):.0f}%)")
    print(f"rising-trend  : peak={_rising_trend_peak():.3f}  (expect >=0.65)")
    lv = _low_variance_then_typical()
    lv_crit = sum(1 for s in lv if s >= 0.65)
    print(f"low-var warmup: mean={sum(lv)/len(lv):.3f}(<0.30)  "
          f">=0.65: {lv_crit}/{len(lv)} ({100*lv_crit/len(lv):.0f}%, expect ~1-3%)")
    a, b, c, d = _fault_phases()
    mean = lambda xs: sum(xs) / len(xs)
    print(f"gated phases  : A={mean(a):.3f}(<0.30)  B_peak={max(b):.3f}(>=0.65)  "
          f"C={mean(c):.3f}(>0.5, no collapse)  D={mean(d):.3f}(<0.30, no inversion)")
