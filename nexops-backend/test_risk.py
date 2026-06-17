"""
Verify the ANOMALY-ONLY risk CAP in risk.py.

An anomaly-only reading (is_predictive != True AND gateway calm: Status
Normal/absent AND alarm_priority Low/absent) must never escalate past MEDIUM, no
matter how high anomaly_score is. Predictive trends and real gateway
Warning/Critical events escalate normally (uncapped). Pure function test - no DB,
no broker.

Run:  python test_risk.py      (or: pytest test_risk.py)
"""

from risk import compute_nexops_risk

# (a) anomaly-only, gateway Low, high anomaly.
ANOMALY_ONLY_HIGH = {"Status": "Normal", "alarm_priority": "Low", "is_predictive": False}
# (b) predictive trend, gateway Medium.
PREDICTIVE_MEDIUM = {"Status": "Warning", "alarm_priority": "Medium", "is_predictive": True}
# (c) real gateway Critical.
GATEWAY_CRITICAL = {"Status": "Critical", "alarm_priority": "Critical", "is_predictive": False}
# (d) anomaly-only, gateway Low, MEDIUM-level anomaly (unchanged baseline).
ANOMALY_ONLY_MEDIUM = {"Status": "Normal", "alarm_priority": "Low", "is_predictive": False}


def test_a_anomaly_only_high_capped_to_medium():
    out = compute_nexops_risk(ANOMALY_ONLY_HIGH, 0.92)
    assert out["nexops_risk"] == "MEDIUM", out
    assert "capped at MEDIUM" in out["reasoning"], out


def test_b_predictive_uncapped_goes_high():
    out = compute_nexops_risk(PREDICTIVE_MEDIUM, 0.70)
    assert out["nexops_risk"] == "HIGH", out


def test_c_gateway_critical_uncapped():
    assert compute_nexops_risk(GATEWAY_CRITICAL, 0.10)["nexops_risk"] == "CRITICAL"
    assert compute_nexops_risk(GATEWAY_CRITICAL, 0.99)["nexops_risk"] == "CRITICAL"


def test_d_anomaly_only_medium_unchanged():
    out = compute_nexops_risk(ANOMALY_ONLY_MEDIUM, 0.50)
    assert out["nexops_risk"] == "MEDIUM", out
    assert "capped at MEDIUM" not in out["reasoning"], out


def test_failsafe_missing_fields_caps():
    # Missing is_predictive AND missing gateway fields -> treated as anomaly-only
    # on a calm gateway -> a high anomaly score is CAPPED to MEDIUM (safe direction).
    out = compute_nexops_risk({}, 0.95)
    assert out["nexops_risk"] == "MEDIUM", out


if __name__ == "__main__":
    cases = [
        ("(a) anomaly-only 0.92, gw Low   ", ANOMALY_ONLY_HIGH, 0.92, "MEDIUM"),
        ("(b) predictive 0.70, gw Medium  ", PREDICTIVE_MEDIUM, 0.70, "HIGH"),
        ("(c) gateway Critical, 0.99      ", GATEWAY_CRITICAL, 0.99, "CRITICAL"),
        ("(d) anomaly-only 0.50, gw Low   ", ANOMALY_ONLY_MEDIUM, 0.50, "MEDIUM"),
        ("    fail-safe {} + 0.95         ", {}, 0.95, "MEDIUM"),
    ]
    ok = True
    for label, rec, score, exp in cases:
        out = compute_nexops_risk(rec, score)
        got = out["nexops_risk"]
        if got != exp:
            ok = False
        print(f"  [{'PASS' if got == exp else 'FAIL'}] {label} -> {got:<8} (expect {exp})")
    print("\nALL PASS" if ok else "\nSOME FAILED")
