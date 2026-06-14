"""
Field-name normalization - the SINGLE rename choke point.

Right now our simulator already emits the keys the frontend expects, so
FIELD_MAP is (almost) an identity map. But when we wire up a REAL ABB 800xA
gateway, its field names will differ. This is the ONE place that mapping
happens: add `"ABB_RealName": "nexops_name"` entries to FIELD_MAP and nothing
else in the codebase needs to change.

Keep this module PURE: no I/O, no globals mutated, no side effects.
"""

# { live_key (as received) : nexops_key (as we expose it) }
# Near-identity today; the real ABB field names get mapped here later.
FIELD_MAP = {
    "Machine": "Machine",
    "Timestamp": "Timestamp",
    "Temp": "Temp",
    "Pressure": "Pressure",
    "Level": "Level",
    "Flow": "Flow",
    "Status": "Status",
    "Alert": "Alert",
    "features": "features",
    "alarm_id": "alarm_id",
    "alarm_type": "alarm_type",
    "alarm_priority": "alarm_priority",
    "priority_level": "priority_level",
    "alarm_state": "alarm_state",
    "ack_state": "ack_state",
    "is_predictive": "is_predictive",
    "object_name": "object_name",
    "object_description": "object_description",
    "message": "message",
}


def normalize(raw: dict) -> dict:
    """Return a new record with keys renamed per FIELD_MAP.

    - Keys present in FIELD_MAP are renamed to their nexops_key.
    - Keys NOT in FIELD_MAP are passed through unchanged, so we never silently
      drop data while the schema is still settling.
    Pure function: `raw` is not mutated.
    """
    out = {}
    for key, value in raw.items():
        out[FIELD_MAP.get(key, key)] = value
    return out
