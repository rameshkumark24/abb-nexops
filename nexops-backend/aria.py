"""
ARIA AI Assistant logic: scoping, linear trends, API integration, and template fallbacks.
"""

import json
import re
from datetime import datetime
import httpx

# Models and DB access
from db import Assignment, Engineer

def is_out_of_domain(query: str) -> bool:
    """Detect if query is asking for general knowledge, sports, celebrities, or definitions unrelated to NexOps."""
    q = query.lower().strip()
    if not q:
        return False
        
    ood_keywords = [
        "who is", "who was", "what is a", "definition of", "how do i cook",
        "dhoni", "sachin", "kohli", "cricket", "football", "sports", "movie",
        "weather", "capital of", "president", "tell me about yourself", "how are you",
        "joke", "story", "song", "lyrics", "sing", "dance", "actor", "actress",
        "celebrity", "history of"
    ]
    
    plant_terms = [
        "compressor", "pump", "boiler", "reactor", "hx", "heat exchanger", "zone",
        "early", "warning", "task", "assignment", "assigned", "assign", "engineer",
        "ravi", "sam", "lena", "diego", "fault", "vibration", "temp", "pressure", "flow",
        "level", "telemetry", "alarm", "alert", "mcc panel", "work", "workload", "roster"
    ]
    
    for k in ood_keywords:
        if k in q:
            if any(term in q for term in plant_terms):
                return False
            return True
            
    return False

# Primary Gemini & Secondary Groq API Keys (as provided)
GEMINI_API_KEY = "AQ.Ab8RN6Jhp5dl6_iw1CCBKxqnyOIuDggN8BvRRcy-n8VlhxMWOw"
GROQ_API_KEY = "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"

class AriaLLMUnavailable(Exception):
    """Raised when all LLM services fail or time out."""
    pass

# Operating bands and threshold limits matching simulator.py
THRESHOLDS = {
    "furnace_temp": (None, 400.0),
    "gen_temp": (None, 100.0),
    "bearing_temp": (None, 95.0),
    "boiler_temp": (None, 240.0),
    "hx_inlet_temp": (None, 195.0),
    "hx_outlet_temp": (None, 120.0),
    "column_pressure": (None, 3.0),
    "comp_pressure": (None, 12.0),
    "pump_pressure": (None, 7.5),
    "boiler_pressure": (None, 17.0),
    "hx_pressure": (None, 6.5),
    "valve_pressure": (None, 7.0),
    "oil_level": (10.0, 90.0),
    "column_level": (15.0, 90.0),
    "boiler_water_level": (20.0, 92.0),
    "feed_flow": (60.0, 120.0),
    "vibration": (None, 7.1),
    "current": (None, 65.0),
    "panel_current": (None, 220.0),
    "voltage": (360.0, 450.0),
    "rpm": (None, 1750.0),
    "frequency": (47.0, 52.0),
    "valve_position": (None, 99.0),
    "tube_skin_temp": (None, 770.0),
    "draft_pressure": (-6.0, 1.0),
    "fuel_flow": (None, 80.0),
    "cw_temp": (None, 48.0),
    "basin_level": (15.0, 92.0),
    "flare_flow": (None, 60.0),
    "diff_pressure": (0.05, 2.2),
    "bed_temp": (None, 440.0),
    "reactor_pressure": (None, 90.0),
    "h2_flow": (400.0, None),
    "dew_point": (None, -5.0),
    "air_pressure": (3.5, None),
}

def zone_for_machine(machine_name: str) -> str:
    """Return the plant zone (A-D) for a machine based on its name."""
    # Attempt to extract the zone letter (A, B, C, or D) followed by a digit
    # from the machine name (e.g., "Compressor C1" -> "C").
    match = re.search(r'\b([A-D])[0-9]+\b', machine_name, re.IGNORECASE)
    if match:
        return match.group(1).upper()

    mach = machine_name.lower()
    if any(k in mach for k in ("compressor", "pump", "motor")):
        return "A"
    elif any(k in mach for k in ("distillation", "heat exchanger", "storage tank", "separator")):
        return "B"
    elif any(k in mach for k in ("boiler", "generator", "control valve", "mcc panel")):
        return "C"
    elif any(k in mach for k in ("reactor", "fired heater", "cooling tower", "flare")):
        return "D"
    else:
        h = sum(ord(c) for c in machine_name) % 4
        return ["A", "B", "C", "D"][h]

def resolve_focus_machine(query: str, machines: list[str]) -> str | None:
    """Resolve which machine name the user is asking about using deterministic keyword rules."""
    query_lower = query.lower()
    # Match longest machine names first
    for m in sorted(machines, key=len, reverse=True):
        if m.lower() in query_lower:
            return m
    
    # Match shortened machine codes/suffixes
    for m in machines:
        parts = m.split()
        if len(parts) > 1:
            short = parts[-1].lower() # e.g. "a1"
            if f" {short}" in f" {query_lower} ":
                return m
    return None

def run_extrapolation(trend_20: list[dict], sensor: str, threshold: float, direction: str) -> dict | None:
    """Fits a linear slope over timestamps (units per minute) and projects ETA to threshold."""
    X = []
    Y = []
    timestamps = []
    
    for r in trend_20:
        val = r.get("features", {}).get(sensor)
        ts = r.get("Timestamp")
        if val is not None and ts:
            Y.append(val)
            timestamps.append(ts)
            
    if len(Y) < 5:
        return None
        
    times = []
    first_dt = None
    for ts in timestamps:
        try:
            dt = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
            if first_dt is None:
                first_dt = dt
            times.append((dt - first_dt).total_seconds() / 60.0)
        except Exception:
            return None
            
    N = len(Y)
    sum_x = sum(times)
    sum_y = sum(Y)
    sum_xx = sum(x*x for x in times)
    sum_xy = sum(times[i]*Y[i] for i in range(N))
    
    denom = N * sum_xx - sum_x * sum_x
    if denom == 0:
        return None
        
    slope = (N * sum_xy - sum_x * sum_y) / denom
    if abs(slope) < 1e-4:
        return None
        
    curr = Y[-1]
    
    if direction == "high":
        if slope <= 0:
            return None
        if curr >= threshold:
            return None
        eta = (threshold - curr) / slope
    else: # direction == "low"
        if slope >= 0:
            return None
        if curr <= threshold:
            return None
        eta = (threshold - curr) / slope
        
    return {
        "sensor": sensor,
        "current": curr,
        "threshold": threshold,
        "slope_per_min": slope,
        "eta_minutes_low": eta * 0.85,
        "eta_minutes_high": eta * 1.15
    }

def find_worst_moving_sensor(trend: list[dict], features: list[str]) -> dict | None:
    """Evaluates trend slopes for all features and returns the one with the soonest projected threshold failure."""
    trend_20 = trend[-20:]
    if len(trend_20) < 5:
        return None
        
    projections = []
    for f in features:
        thresh_low, thresh_high = THRESHOLDS.get(f, (None, None))
        if thresh_high is not None:
            proj = run_extrapolation(trend_20, f, thresh_high, "high")
            if proj:
                projections.append(proj)
        if thresh_low is not None:
            proj = run_extrapolation(trend_20, f, thresh_low, "low")
            if proj:
                projections.append(proj)
                
    if not projections:
        return None
        
    projections.sort(key=lambda p: p["eta_minutes_low"])
    return projections[0]

def build_context(query: str, role: str, scope_zone: str | None, latest: dict[str, dict], history: dict[str, list[dict]], session, username: str | None = None, engineer_id: int | None = None) -> dict:
    """Builds the structured AriaContext object containing scoped live states, trends, database metrics, and team rosters."""
    machines = list(latest.keys())
    focus_machine = resolve_focus_machine(query, machines)
    
    scope_violation = False
    if focus_machine:
        rec = latest.get(focus_machine)
        m_zone = (rec.get("zone") if rec else None) or zone_for_machine(focus_machine)
        if role in ("field_manager", "technician") and scope_zone:
            # Scoped check: focus machine zone must match scope zone
            if m_zone != scope_zone:
                scope_violation = True
                focus_machine = None # drop focus
                
    # Personal tasks query if technician
    personal_tasks = []
    if role == "technician" and engineer_id is not None:
        try:
            tasks = session.query(Assignment).filter(
                Assignment.engineer_id == engineer_id,
                Assignment.status.in_(("assigned", "in_progress"))
            ).all()
            personal_tasks = [
                {
                    "id": t.id,
                    "machine": t.machine,
                    "zone": t.zone,
                    "fault_category": t.fault_category,
                    "status": t.status,
                    "assigned_at": t.assigned_at.isoformat() if t.assigned_at else None
                }
                for t in tasks
            ]
        except Exception as e:
            print(f"[aria-context] failed to load personal tasks: {e}")

    context = {
        "query": query,
        "role": role,
        "scope_zone": scope_zone,
        "username": username,
        "engineer_id": engineer_id,
        "scope_violation": scope_violation,
        "focus_machine": focus_machine,
        "time_to_threshold": None,
        "current_assignment": None,
        "incident_history": None,
        "scoped_engineers": [],
        "top_machines": [],
        "open_task_count": 0,
        "trend_len": 0,
        "personal_tasks": personal_tasks
    }
    
    # Always-on attachment: scoped engineers
    try:
        eng_query = session.query(Engineer).filter(Engineer.active == True)
        if role in ("field_manager", "technician") and scope_zone:
            eng_query = eng_query.filter(Engineer.zone == scope_zone)
        engineers = eng_query.all()
        context["scoped_engineers"] = [
            {
                "id": e.id,
                "name": e.name,
                "zone": e.zone,
                "skills": e.skills or [],
                "active_tasks": e.active_tasks,
                "available": e.available,
                "experience_years": e.experience_years
            }
            for e in engineers
        ]
    except Exception as e:
        print(f"[aria-context] failed to load engineers: {e}")
        
    if focus_machine:
        snapshot = latest.get(focus_machine)
        context["machine_snapshot"] = snapshot
        
        # Trend length
        m_trend = history.get(focus_machine, [])
        context["trend_len"] = len(m_trend)
        
        # Failure window math
        try:
            feat_list = list(snapshot.get("features", {}).keys()) if snapshot else []
            worst = find_worst_moving_sensor(list(m_trend), feat_list)
            context["time_to_threshold"] = worst
        except Exception as e:
            print(f"[aria-context] failed to compute failure window: {e}")
            
        # Current assignment
        try:
            current_task = session.query(Assignment).filter(
                Assignment.machine == focus_machine,
                Assignment.status.in_(("assigned", "in_progress"))
            ).order_by(Assignment.assigned_at.desc()).first()
            
            if current_task:
                context["current_assignment"] = {
                    "id": current_task.id,
                    "engineer_name": current_task.engineer_name,
                    "fault_category": current_task.fault_category,
                    "status": current_task.status,
                    "assigned_at": current_task.assigned_at.isoformat() if current_task.assigned_at else None,
                    "score": current_task.score
                }
        except Exception as e:
            print(f"[aria-context] failed to load current assignment: {e}")
            
        # Incident history
        try:
            category = snapshot.get("fault_category") or "general"
            past_resolutions = session.query(Assignment).filter(
                Assignment.fault_category == category,
                Assignment.status == "resolved"
            ).all()
            
            if past_resolutions:
                resolution_minutes_list = [r.resolution_minutes for r in past_resolutions if r.resolution_minutes is not None]
                avg_minutes = sum(resolution_minutes_list) / len(resolution_minutes_list) if resolution_minutes_list else None
                fastest = None
                fastest_eng = None
                for r in past_resolutions:
                    if r.resolution_minutes is not None:
                        if fastest is None or r.resolution_minutes < fastest:
                            fastest = r.resolution_minutes
                            fastest_eng = r.engineer_name
                            
                context["incident_history"] = {
                    "times_resolved": len(past_resolutions),
                    "avg_resolution_min": round(avg_minutes, 1) if avg_minutes else None,
                    "fastest_minutes": fastest,
                    "fastest_engineer": fastest_eng
                }
        except Exception as e:
            print(f"[aria-context] failed to load incident history: {e}")
            
    else:
        # Scope summary path: top 3-5 machines by risk
        try:
            scoped_records = []
            for name, rec in latest.items():
                m_zone = rec.get("zone") or zone_for_machine(name)
                if role in ("field_manager", "technician") and scope_zone:
                    if m_zone == scope_zone:
                        scoped_records.append(rec)
                else:
                    scoped_records.append(rec)
                    
            RISK_INDEX = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}
            def sort_key(r):
                risk = r.get("nexops_risk", "LOW").upper()
                p_level = r.get("priority_level", 4)
                return (-RISK_INDEX.get(risk, 0), p_level, r.get("Machine", ""))
                
            scoped_records.sort(key=sort_key)
            top_machines = scoped_records[:30]
            
            context["top_machines"] = [
                {
                    "name": r.get("Machine"),
                    "zone": r.get("zone") or zone_for_machine(r.get("Machine")),
                    "nexops_risk": r.get("nexops_risk", "LOW"),
                    "status": r.get("Status", "Normal"),
                    "alert": r.get("Alert", "None")
                }
                for r in top_machines
            ]
        except Exception as e:
            print(f"[aria-context] failed to compile top machines: {e}")
            
        # Open task count
        try:
            task_query = session.query(Assignment).filter(Assignment.status.in_(("assigned", "in_progress")))
            if role in ("field_manager", "technician") and scope_zone:
                task_query = task_query.filter(Assignment.zone == scope_zone)
            context["open_task_count"] = task_query.count()
        except Exception as e:
            print(f"[aria-context] failed to load open task count: {e}")
            
    # Compute live metrics from history
    early_catches = 0
    corroborated_early = 0
    nuisance_filtered = 0
    nuisance_machines = set()
    
    for m_name, m_history in history.items():
        m_zone = latest.get(m_name, {}).get("zone") or zone_for_machine(m_name)
        if role in ("field_manager", "technician") and scope_zone:
            if m_zone != scope_zone:
                continue
        
        has_early = False
        has_corroborated = False
        for r in m_history:
            if r.get("is_nuisance") is True:
                nuisance_filtered += 1
                nuisance_machines.add(m_name)
            if r.get("is_early") is True:
                has_early = True
                anom_score = r.get("anomaly_score")
                if r.get("anomaly_status") == "scored" and anom_score is not None and anom_score >= 0.45:
                    has_corroborated = True
                    
        if has_early:
            early_catches += 1
            if has_corroborated:
                corroborated_early += 1
                
    corroboration_rate = None
    if early_catches > 0:
        corroboration_rate = round((corroborated_early / early_catches) * 100)
        
    context["live_metrics"] = {
        "early_warning_catches": early_catches,
        "nuisance_alarms_filtered": nuisance_filtered,
        "nuisance_machines": list(nuisance_machines),
        "ml_corroboration_rate": f"{corroboration_rate}%" if corroboration_rate is not None else "0% (no early warning alerts recorded yet)"
    }
            
    return context

def render_fallback_answer(ctx: dict, key_failed: bool = False) -> str:
    """Formats a deterministic templated response if external APIs are offline or have key failures."""
    focus = ctx.get("focus_machine")
    prefix = "(Offline Fallback Mode — please check API key configuration)\n\n" if key_failed else ""
    
    query = (ctx.get("query") or "").lower()
    
    # 1. OUT-OF-DOMAIN CHECK
    if is_out_of_domain(query):
        return "I am ARIA, an AI assistant trained only for NexOps refinery telemetry and dispatch. I cannot assist with out-of-domain topics."
        
    if not focus:
        zone = ctx.get("scope_zone") or "ALL"
        role = ctx.get("role")
        
        # Intent D: ML_CORROBORATION
        if any(k in query for k in ("corroboration rate", "corroboration")):
            rate = ctx.get("live_metrics", {}).get("ml_corroboration_rate", "0%")
            return prefix + f"The current ML Corroboration Rate for Zone {zone} is {rate}."

        # Intent E: NUISANCE_ALARMS
        if any(k in query for k in ("nuisance alarm", "nuisance")):
            metrics = ctx.get("live_metrics", {})
            count = metrics.get("nuisance_alarms_filtered", 0)
            machines = metrics.get("nuisance_machines", [])
            mach_str = ", ".join(machines) if machines else "none"
            return prefix + f"In the recent telemetry window for Zone {zone}, we filtered {count} transient/nuisance alarm ticks. Affected machines: {mach_str}."

        # Intent F: EARLY_WARNINGS
        if "early" in query:
            metrics = ctx.get("live_metrics", {})
            catches = metrics.get("early_warning_catches", 0)
            return prefix + f"There are currently {catches} distinct early warning prediction catches in Zone {zone}."

        # Intent A: MY_TASKS
        if any(k in query for k in ("my task", "tasks for me", "my assignment", "my work")):
            personal = ctx.get("personal_tasks") or []
            if role != "technician":
                return prefix + "Only technicians have personal task queues. As a manager, you can query overall zone dispatches."
            if not personal:
                return prefix + "You currently have no active tasks assigned to you in the queue."
            
            lines = [f"You have {len(personal)} active task(s) assigned to you in Zone {zone}:"]
            for t in personal:
                lines.append(f"- Task #{t['id']}: {t['machine']} ({t['fault_category']}, status: {t['status']})")
            return prefix + "\n".join(lines)
            
        # Intent B: ROSTER_LOAD / WORKLOAD
        if any(k in query for k in ("workload", "assigned more", "most busy", "who is assigned", "staff", "roster")):
            engineers = ctx.get("scoped_engineers") or []
            if not engineers:
                return prefix + f"No engineers registered in Zone {zone}."
                
            lines = [f"Engineer workload summary for Zone {zone}:"]
            sorted_engs = sorted(engineers, key=lambda e: e.get("active_tasks") or 0, reverse=True)
            for e in sorted_engs:
                lines.append(f"- {e['name']}: {e.get('active_tasks', 0)} / {e.get('max_capacity', 6)} active task(s) (avail: {e['available']})")
                
            busy_eng = sorted_engs[0]
            if busy_eng.get("active_tasks", 0) > 0:
                lines.append(f"\n{busy_eng['name']} is currently assigned the most work ({busy_eng['active_tasks']} active task(s)).")
            else:
                lines.append("\nAll engineers are currently free.")
            return prefix + "\n".join(lines)
            
        # Intent C: ALERTS_RISK
        if any(k in query for k in ("alert", "alarm", "risk", "highest risk", "warning", "critical")):
            top = ctx.get("top_machines") or []
            tasks_count = ctx.get("open_task_count", 0)
            
            lines = [
                f"Zone {zone} Telemetry & Alert Summary:",
                f"- Open lifecycle dispatches: {tasks_count}"
            ]
            at_risk = [m for m in top if m.get("nexops_risk") in ("HIGH", "CRITICAL") or m.get("status") != "Normal"]
            if at_risk:
                lines.append("- Active warnings and alerts:")
                for m in at_risk:
                    lines.append(f"  * {m['name']}: risk {m['nexops_risk']} (status {m['status']}, alert {m['alert']})")
            else:
                lines.append("- No warning or critical machines detected in this zone.")
            return prefix + "\n".join(lines)
            
        # Default General Summary
        top = ctx.get("top_machines", [])
        tasks_count = ctx.get("open_task_count", 0)
        
        lines = [
            f"ARIA Context Summary for Zone {zone}:",
            f"- Open lifecycle tasks: {tasks_count}"
        ]
        if top:
            lines.append("- Top at-risk machines:")
            for m in top:
                lines.append(f"  * {m['name']} (zone {m['zone']}): risk {m['nexops_risk']} (status {m['status']}, alert {m['alert']})")
        return prefix + "\n".join(lines)
        
    snapshot = ctx.get("machine_snapshot") or {}
    m_zone = snapshot.get("zone") or zone_for_machine(focus)
    risk = snapshot.get("nexops_risk", "LOW")
    
    parts = []
    parts.append(f"Machine {focus} (zone {m_zone}): risk {risk}.")
    
    time_proj = ctx.get("time_to_threshold")
    if time_proj:
        sensor = time_proj["sensor"]
        slope = time_proj["slope_per_min"]
        sign = "+" if slope > 0 else ""
        low = int(time_proj["eta_minutes_low"])
        high = int(time_proj["eta_minutes_high"])
        trend_len = ctx.get("trend_len", 20)
        duration_min = int(trend_len * 26.0 / 60.0)
        delta = slope * duration_min
        parts.append(f"{sensor} trending {sign}{delta:.1f} over {duration_min} minutes. Projected window: {low}-{high} minutes (linear projection, not a guarantee).")
        
    current = ctx.get("current_assignment")
    if current and current.get("engineer_name"):
        name = current["engineer_name"]
        reason = current.get("assignment_reason") or "top skill match"
        parts.append(f"Assigned to {name} — {reason}.")
    else:
        parts.append("Currently Unassigned.")
        
    past = ctx.get("incident_history")
    if past:
        count = past["times_resolved"]
        fastest_eng = past.get("fastest_engineer") or "technician"
        fastest_min = past.get("fastest_minutes")
        avg_min = past.get("avg_resolution_min")
        
        history_str = f"This fault category was resolved {count} time(s) previously;"
        if fastest_min is not None:
            history_str += f" fastest by {fastest_eng} in {int(fastest_min)} min"
        if avg_min is not None:
            history_str += f", average {int(avg_min)} min"
        parts.append(history_str)
        
    category = snapshot.get("fault_category") or "general"
    if category == "mechanical":
        parts.append("Inspect alignment, bearings, mechanical seals, and lubrication on the affected component.")
    elif category == "electrical":
        parts.append("Inspect electrical windings, supply voltage, overcurrent breakers, and cable insulation.")
    elif category == "thermal":
        parts.append("Check coolant flow rate, heat exchanger efficiency, fan speeds, and clean any fouling.")
    elif category == "hydraulic":
        parts.append("Check hydraulic actuator fluid level, pressure seals, and valve alignment.")
    else:
        parts.append("Perform a general diagnostic sweep of the unit, checking mechanical and electrical connections.")
        
    return prefix + " ".join(parts)

def format_system_prompt(query: str, ctx: dict) -> str:
    """Formats the three-part system prompt enforcing the Role, Grounding, and Structure clauses."""
    scope_zone = ctx.get("scope_zone")
    role = ctx.get("role")
    
    if scope_zone:
        role_clause = f"ROLE: zone_manager for zone {scope_zone}. You see only this scope's machines, engineers, and incidents. If asked about other zones, say it's outside your scope and do not invent details."
    else:
        role_clause = "ROLE: plant_manager. You have a plant-wide view across all zones (A, B, C, D) and oversee all machines, engineers, and incidents."
        
    grounding_clause = (
        "Answer ONLY from the SYSTEM STATE block below. Never invent sensor values, engineer names, risk levels, fault categories, or timings. "
        "If the context lacks the answer, say so plainly. Distinguish the gateway's static threshold from NexOps's predictive risk. "
        "Do not call yourself the anomaly model or the assignment engine — you report what they produced. "
        "If the query is completely unrelated to the NexOps plant, telemetry, engineers, or tasks (e.g. asking about celebrities, sports, general knowledge, movies, etc.), "
        "do NOT use the system state. Instead, refuse to answer by stating: 'I am ARIA, an AI assistant trained only for NexOps telemetry and dispatch. I cannot assist with out-of-domain topics.'"
    )
    
    focus = ctx.get("focus_machine")
    if focus:
        structure_clause = "Structure your response as exactly 5 short sections, separated by double newlines:\n1. What's Happening\n2. Likely Cause\n3. Failure Window (only if a time projection is present in SYSTEM STATE, explicitly labeled as a linear projection)\n4. Who's Responding\n5. One Recommended Action.\nKeep it highly concise."
    else:
        structure_clause = "Summarize the at-risk units in the scope. If the user asks general questions, answer them purely based on the scoped machine states in SYSTEM STATE. Keep it concise."
        
    # Serialize context state compactly (excluding heavy structures)
    compact_ctx = {
        "focus_machine": ctx.get("focus_machine"),
        "machine_snapshot": ctx.get("machine_snapshot"),
        "time_to_threshold": ctx.get("time_to_threshold"),
        "current_assignment": ctx.get("current_assignment"),
        "incident_history": ctx.get("incident_history"),
        "scoped_engineers": ctx.get("scoped_engineers"),
        "top_machines": ctx.get("top_machines"),
        "open_task_count": ctx.get("open_task_count"),
        "scope_violation": ctx.get("scope_violation"),
        "personal_tasks": ctx.get("personal_tasks"),
        "live_metrics": ctx.get("live_metrics")
    }
    
    return f"""{role_clause}
    
{grounding_clause}

{structure_clause}

SYSTEM STATE:
{json.dumps(compact_ctx, indent=2)}

USER QUERY:
{query}
"""

async def call_llm(query: str, ctx: dict) -> tuple[str, str]:
    """Issues API calls. First attempts Gemini API. If failed/timed out, automatically falls back to Groq API."""
    prompt = format_system_prompt(query, ctx)
    
    # 1. Primary: Gemini API
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
        body = {
            "contents": [{
                "parts": [{"text": prompt}]
            }],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 600
            }
        }
        async with httpx.AsyncClient() as client:
            res = await client.post(url, json=body, timeout=6.0)
            if res.status_code == 200:
                data = res.json()
                text = data["candidates"][0]["content"]["parts"][0]["text"]
                return text.strip(), "llm"
    except Exception as e:
        print(f"[aria-llm] Gemini API failed or timed out: {e}")
        
    # 2. Secondary Fallback: Groq API
    try:
        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json"
        }
        body = {
            "model": "llama-3.3-70b-versatile",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2,
            "max_tokens": 600
        }
        async with httpx.AsyncClient() as client:
            res = await client.post(url, headers=headers, json=body, timeout=6.0)
            if res.status_code == 200:
                data = res.json()
                text = data["choices"][0]["message"]["content"]
                return text.strip(), "llm"
    except Exception as e:
        print(f"[aria-llm] Groq API failed or timed out: {e}")
        
    raise AriaLLMUnavailable("Both Gemini and Groq API pipelines failed.")

async def answer(query: str, role: str, scope_zone: str | None, latest: dict, history: dict, session, username: str | None = None, engineer_id: int | None = None) -> dict:
    """The central orchestrator driving the context assembly, LLM/fallback rendering, and evidence footer binding."""
    # Ensure zone is cleaned
    if scope_zone == "ALL" or not scope_zone:
        scope_zone = None
        
    if is_out_of_domain(query):
        return {
            "answer": "I am ARIA, an AI assistant trained only for NexOps refinery telemetry and dispatch. I cannot assist with out-of-domain topics.",
            "source": "unavailable",
            "evidence": {
                "focus_machine": None,
                "nexops_risk": "LOW",
                "anomaly_status": None,
                "time_to_threshold": None,
                "assigned_engineer": "Unassigned",
                "assignment_reason": None,
                "incident_matches": 0
            }
        }

    ctx = build_context(query, role, scope_zone, latest, history, session, username=username, engineer_id=engineer_id)
    
    try:
        text, source = await call_llm(query, ctx)
    except AriaLLMUnavailable:
        text = render_fallback_answer(ctx, key_failed=True)
        source = "fallback_template"
    except Exception as exc:
        print(f"[aria-orchestrator] unexpected exception during LLM pipeline: {exc}")
        text = render_fallback_answer(ctx, key_failed=False)
        source = "fallback_template"
        
    # Build deterministic evidence footprint for Layer 10 (Footer)
    time_proj = ctx.get("time_to_threshold")
    current = ctx.get("current_assignment")
    past = ctx.get("incident_history")
    
    evidence = {
        "focus_machine": ctx.get("focus_machine"),
        "nexops_risk": ctx.get("machine_snapshot", {}).get("nexops_risk", "LOW") if ctx.get("focus_machine") else "LOW",
        "anomaly_status": ctx.get("machine_snapshot", {}).get("anomaly_status") if ctx.get("focus_machine") else None,
        "time_to_threshold": {
            "sensor": time_proj["sensor"],
            "eta_minutes_low": time_proj["eta_minutes_low"],
            "eta_minutes_high": time_proj["eta_minutes_high"]
        } if time_proj else None,
        "assigned_engineer": current.get("engineer_name") if current else "Unassigned",
        "assignment_reason": current.get("assignment_reason") if current else None,
        "incident_matches": past.get("times_resolved", 0) if past else 0
    }
    
    return {
        "answer": text,
        "source": source,
        "evidence": evidence
    }
