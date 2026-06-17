"""
Prove NUISANCE SEGREGATION in should_assign() (main.py).

Bug 2 (fixed): a nuisance record carries gateway Status="Warning", so the old
should_assign() returned True on the `Status in ("Warning","Critical")` branch
and routed the noise to an engineer + persisted a task. The new nuisance guard
at the TOP of should_assign() returns False for any is_nuisance record,
regardless of Status (and even if its anomaly-driven nexops_risk is elevated),
while leaving real faults untouched.

These are PURE checks on should_assign() - no DB writes, no broker, no network.

Run:  python test_segregation.py      (or: pytest test_segregation.py)
"""

from main import should_assign

# (1) NUISANCE "Warning" - must NOT be assigned (Bug 2 fix). Mirrors the shape
# the simulator's maybe_nuisance() emits: Status="Warning", alarm_priority="Low",
# is_predictive=False, is_nuisance=True, no safety keyword.
NUISANCE_WARNING = {
    "Machine": "Compressor A1",
    "Status": "Warning",
    "alarm_priority": "Low",
    "alarm_type": "Process",
    "is_predictive": False,
    "is_nuisance": True,
    "nuisance_type": "chatter",
    "Alert": "Threshold Chatter",
    "message": "Comp Pressure momentarily crossed limit then settled "
               "(nuisance/chatter - no developing trend)",
}

# (1b) NUISANCE whose one-shot spike happened to push the anomaly view up to
# CRITICAL. The guard sits ABOVE is_safety_critical, so this is STILL not
# assigned - proving the guard is first, "regardless of Status"/risk.
NUISANCE_WITH_HOT_ANOMALY = {
    **NUISANCE_WARNING,
    "nexops_risk": "CRITICAL",
}

# (2) REAL developing fault (incubating predictive) - unchanged, must assign.
# Mirrors step_degradation()'s pre-threshold branch: Status="Warning",
# alarm_priority="Medium", is_predictive=True, is_nuisance=False.
REAL_WARNING_FAULT = {
    "Machine": "Motor B1",
    "Status": "Warning",
    "alarm_priority": "Medium",
    "alarm_type": "Predictive",
    "is_predictive": True,
    "is_nuisance": False,
    "Alert": "Bearing Wear Trend",
    "message": "Bearing Degradation developing - Bearing Temp trending up = 78.0 C "
               "(static limit 80.0 C not yet reached)",
}

# (3) CRITICAL fault - unchanged, must assign.
CRITICAL_FAULT = {
    "Machine": "Boiler B1",
    "Status": "Critical",
    "alarm_priority": "Critical",
    "alarm_type": "Process",
    "nexops_risk": "CRITICAL",
    "is_predictive": False,
    "is_nuisance": False,
    "Alert": "BOILER OVERPRESSURE",
    "message": "Boiler Scaling - Boiler Pressure = 18.0 bar (static limit exceeded)",
}

# (bonus) plain Normal - unchanged baseline, must NOT assign.
NORMAL_RECORD = {
    "Machine": "Pump A1",
    "Status": "Normal",
    "alarm_priority": "Low",
    "alarm_type": "Process",
    "is_predictive": False,
    "is_nuisance": False,
    "Alert": "None",
    "message": "All parameters within normal operating range",
}


def test_nuisance_warning_is_not_assigned():
    # Bug 2 fix: nuisance "Warning" must NOT route to an engineer.
    assert should_assign(NUISANCE_WARNING) is False


def test_nuisance_with_hot_anomaly_is_not_assigned():
    # Guard precedes is_safety_critical: even a CRITICAL-risk nuisance is excluded.
    assert should_assign(NUISANCE_WITH_HOT_ANOMALY) is False


def test_real_warning_fault_is_assigned():
    # Unchanged: a real incubating fault still routes for assignment.
    assert should_assign(REAL_WARNING_FAULT) is True


def test_critical_fault_is_assigned():
    # Unchanged: critical faults always route for assignment.
    assert should_assign(CRITICAL_FAULT) is True


def test_normal_record_is_not_assigned():
    # Unchanged baseline: a plain Normal record is never assigned.
    assert should_assign(NORMAL_RECORD) is False


if __name__ == "__main__":
    cases = [
        ("nuisance Warning            -> NOT assigned", NUISANCE_WARNING, False),
        ("nuisance + hot anomaly      -> NOT assigned", NUISANCE_WITH_HOT_ANOMALY, False),
        ("real incubating Warning     -> assigned",     REAL_WARNING_FAULT, True),
        ("critical fault              -> assigned",     CRITICAL_FAULT, True),
        ("plain Normal                -> NOT assigned", NORMAL_RECORD, False),
    ]
    ok = True
    for label, rec, expected in cases:
        got = should_assign(rec)
        if got is not expected:
            ok = False
        print(f"  [{'PASS' if got is expected else 'FAIL'}] {label}   "
              f"(should_assign={got}, expected={expected})")
    print("\nALL PASS" if ok else "\nSOME FAILED")
