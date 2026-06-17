"""
Verify the SINGLE SOURCE OF TRUTH EARLY flag in main.is_early_record.

EARLY used to be re-derived in three drifting places (should_assign,
the frontend isEarlyWarning, and an inline check in test_ws.html). The backend
now computes it ONCE via is_early_record() and stamps record["is_early"] on the
wire; the React app and test_ws.html both READ that boolean. This file pins the
canonical behavior — a faithful port of the frontend isEarlyWarning, evaluated
on the CAPPED nexops_risk already on the record.

Pure function test — no DB, no broker (importing main constructs the app/engine
but does NOT connect to MQTT; startup only runs under uvicorn).

Run:  pytest test_is_early.py      (or: python test_is_early.py)
"""

from main import is_early_record, should_assign

# (a) predictive divergence: warming-up/predictive, gateway Medium, NexOps HIGH.
#     The case test_ws's old priority-only formula MISSED.
PREDICTIVE_HIGH = {
    "Status": "Warning", "alarm_priority": "Medium",
    "is_predictive": True, "nexops_risk": "HIGH",
}
# (b) anomaly-only on a calm gateway, capped to MEDIUM.
ANOMALY_ONLY_MEDIUM = {
    "Status": "Normal", "alarm_priority": "Low",
    "is_predictive": False, "nexops_risk": "MEDIUM",
}
# (c) anomaly-only on a calm gateway, risk LOW -> nothing to flag.
ANOMALY_ONLY_LOW = {
    "Status": "Normal", "alarm_priority": "Low",
    "is_predictive": False, "nexops_risk": "LOW",
}
# (d) nuisance noise -> never EARLY, whatever the risk.
NUISANCE_HIGH = {
    "Status": "Normal", "alarm_priority": "Low",
    "is_predictive": False, "nexops_risk": "HIGH", "is_nuisance": True,
}
# (e) real gateway Critical (NOT calm, not predictive) -> a real event, not early.
GATEWAY_CRITICAL = {
    "Status": "Critical", "alarm_priority": "Critical",
    "is_predictive": False, "nexops_risk": "CRITICAL",
}
# (f) latent edge: alarm_priority literal 'Normal' (idx 0), predictive, risk MEDIUM
#     (> gateway idx 0) -> now correctly EARLY ('normal' priority treated as calm).
PREDICTIVE_NORMAL_PRIO = {
    "Status": "Normal", "alarm_priority": "Normal",
    "is_predictive": True, "nexops_risk": "MEDIUM",
}


def test_a_predictive_divergence_high_is_early():
    # is_predictive: RISK_INDEX[HIGH]=2 > gateway(Medium)=1 -> TRUE
    assert is_early_record(PREDICTIVE_HIGH) is True


def test_b_anomaly_only_medium_is_early():
    # anomaly-only, gateway_calm, RISK_INDEX[MEDIUM]=1 >= MEDIUM -> TRUE
    assert is_early_record(ANOMALY_ONLY_MEDIUM) is True


def test_c_anomaly_only_low_not_early():
    # anomaly-only, gateway_calm, RISK_INDEX[LOW]=0 < MEDIUM -> FALSE
    assert is_early_record(ANOMALY_ONLY_LOW) is False


def test_d_nuisance_never_early():
    # is_nuisance short-circuits before any risk check -> FALSE
    assert is_early_record(NUISANCE_HIGH) is False


def test_e_gateway_critical_not_early():
    # not predictive, not gateway_calm (Status Critical / priority Critical) -> FALSE
    assert is_early_record(GATEWAY_CRITICAL) is False


def test_f_normal_priority_predictive_is_early():
    # predictive: RISK_INDEX[MEDIUM]=1 > gateway('Normal')=0 -> TRUE (latent edge fixed)
    assert is_early_record(PREDICTIVE_NORMAL_PRIO) is True


def test_failsafe_missing_fields_not_early():
    # Empty record: not nuisance, not predictive, gateway_calm (all absent),
    # but risk absent -> LOW -> not >= MEDIUM -> FALSE (safe direction).
    assert is_early_record({}) is False


def test_badge_implies_assign():
    # Every record badged EARLY must also be assignable: should_assign shares the
    # SAME helper, so badge => assign can never disagree. (Nuisance/LOW are not
    # early, so they're correctly excluded from this invariant.)
    for rec in (PREDICTIVE_HIGH, ANOMALY_ONLY_MEDIUM, PREDICTIVE_NORMAL_PRIO):
        assert is_early_record(rec) is True
        assert should_assign(rec) is True


if __name__ == "__main__":
    cases = [
        ("(a) predictive, gw Medium, HIGH      ", PREDICTIVE_HIGH, True),
        ("(b) anomaly-only, gw Low, MEDIUM     ", ANOMALY_ONLY_MEDIUM, True),
        ("(c) anomaly-only, gw Low, LOW        ", ANOMALY_ONLY_LOW, False),
        ("(d) nuisance, HIGH                   ", NUISANCE_HIGH, False),
        ("(e) gateway Critical                 ", GATEWAY_CRITICAL, False),
        ("(f) priority 'Normal', predictive    ", PREDICTIVE_NORMAL_PRIO, True),
        ("    fail-safe {}                     ", {}, False),
    ]
    ok = True
    for label, rec, exp in cases:
        got = is_early_record(rec)
        if got != exp:
            ok = False
        print(f"  [{'PASS' if got == exp else 'FAIL'}] {label} -> {got!s:<5} (expect {exp})")
    print("\nALL PASS" if ok else "\nSOME FAILED")
