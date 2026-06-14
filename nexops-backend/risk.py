"""
NexOps risk fusion — blend the gateway's static severity with NexOps's own
online anomaly score (and the record's is_predictive flag) into a single
NexOps-owned risk verdict.

THE DEMO MOMENT
---------------
When the gateway still says Normal/Low but our anomaly engine sees the reading
drifting (high anomaly_score) — or the record is flagged predictive — NexOps
raises the risk ABOVE the gateway's level and says WHY. That's "we caught it
early." Conversely, if the gateway is already Critical, we never under-call it:
nexops_risk is at least Critical.

Pure function, no I/O, no state.
"""

# Ordered risk ladder; index = severity.
_LADDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]

# Gateway alarm_priority (Critical/High/Medium/Low) -> our ladder level.
# Anything unrecognized / Normal maps to LOW.
_GATEWAY_MAP = {
    "critical": "CRITICAL",
    "high": "HIGH",
    "medium": "MEDIUM",
    "low": "LOW",
    "normal": "LOW",
}

# Anomaly-score thresholds -> a risk level the anomaly view alone would assign.
#   >= 0.85  -> CRITICAL   (strongly anomalous vs this machine's own history)
#   >= 0.65  -> HIGH
#   >= 0.45  -> MEDIUM
#   else     -> LOW
_ANOM_CRITICAL = 0.85
_ANOM_HIGH = 0.65
_ANOM_MEDIUM = 0.45


def _gateway_level(record):
    prio = str(record.get("alarm_priority", "") or "").strip().lower()
    return _GATEWAY_MAP.get(prio, "LOW")


def _anomaly_level(anomaly_score):
    if anomaly_score is None:
        return None
    if anomaly_score >= _ANOM_CRITICAL:
        return "CRITICAL"
    if anomaly_score >= _ANOM_HIGH:
        return "HIGH"
    if anomaly_score >= _ANOM_MEDIUM:
        return "MEDIUM"
    return "LOW"


def _idx(level):
    return _LADDER.index(level)


def compute_nexops_risk(record, anomaly_score):
    """Return {"nexops_risk": <LOW|MEDIUM|HIGH|CRITICAL>, "reasoning": str}.

    Blend rules:
      1. Start from the gateway level (alarm_priority).
      2. Take the max of gateway level and the anomaly-implied level.
      3. If the record is flagged is_predictive, bump at least one rung above
         the gateway level.
      4. If the gateway is already CRITICAL, stay CRITICAL (never under-call).
    The reasoning string explains which factor drove the verdict — and calls out
    the "caught it early" case explicitly.
    """
    gw_level = _gateway_level(record)
    gw_idx = _idx(gw_level)

    anom_level = _anomaly_level(anomaly_score)
    is_predictive = bool(record.get("is_predictive"))

    # Start at the gateway level.
    final_idx = gw_idx
    drivers = []

    # Anomaly view can raise the level.
    if anom_level is not None:
        a_idx = _idx(anom_level)
        if a_idx > final_idx:
            final_idx = a_idx
        if anom_level in ("HIGH", "CRITICAL"):
            drivers.append(f"anomaly_score {anomaly_score:.2f} {anom_level.lower()}")

    # Predictive flag bumps at least one rung above the gateway.
    if is_predictive and final_idx <= gw_idx:
        final_idx = min(gw_idx + 1, len(_LADDER) - 1)
        drivers.append("is_predictive=true")

    # Never under-call a gateway-Critical record.
    if gw_level == "CRITICAL":
        final_idx = _idx("CRITICAL")

    nexops_risk = _LADDER[final_idx]

    # Build a short human reason.
    if anomaly_score is None:
        reasoning = (
            f"model warming up — no anomaly score yet; mirroring gateway "
            f"{gw_level}"
        )
    elif final_idx > gw_idx:
        # The headline "we caught it early" case.
        why = " and ".join(drivers) if drivers else "anomaly signal"
        reasoning = (
            f"{why} while gateway is {gw_level} — NexOps raised risk to "
            f"{nexops_risk} ahead of the static threshold"
        )
    elif drivers:
        reasoning = (
            f"gateway {gw_level}; anomaly_score {anomaly_score:.2f} agrees — "
            f"{nexops_risk}"
        )
    else:
        reasoning = (
            f"gateway {gw_level}; anomaly_score {anomaly_score:.2f} nominal — "
            f"{nexops_risk}"
        )

    return {"nexops_risk": nexops_risk, "reasoning": reasoning}


def fallback_risk(record):
    """Fail-safe verdict when the anomaly step errored: mirror the gateway
    priority, with no anomaly contribution. Keeps the feed honest about the
    fact that ML didn't run."""
    gw_level = _gateway_level(record)
    return {
        "nexops_risk": gw_level,
        "reasoning": f"anomaly layer unavailable — mirroring gateway {gw_level}",
    }
