import os
import unittest
from datetime import datetime
from collections import deque

# MUST precede project imports: db.py reads DATABASE_URL at import time.
os.environ["DATABASE_URL"] = "sqlite:///./test_aria_tmp.db"

import aria
import main
from db import Assignment, Engineer, User, get_session, init_db
from seed import seed
from fastapi.testclient import TestClient

client = TestClient(main.app)

class TestAriaChatbot(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        seed()
        
    def test_entity_resolution(self):
        machines = ["Compressor A1", "Pump A2", "Boiler B1", "Reactor D1"]
        # Exact casing
        self.assertEqual(aria.resolve_focus_machine("Why is Compressor A1 running hot?", machines), "Compressor A1")
        # Lowercasing
        self.assertEqual(aria.resolve_focus_machine("tell me about pump a2 please", machines), "Pump A2")
        # Shortened name / suffix matching
        self.assertEqual(aria.resolve_focus_machine("What's up with a2?", machines), "Pump A2")
        # No match
        self.assertIsNone(aria.resolve_focus_machine("Is everything okay?", machines))

    def test_zone_for_machine(self):
        self.assertEqual(aria.zone_for_machine("Compressor A1"), "A")
        self.assertEqual(aria.zone_for_machine("Distillation Column B1"), "B")
        self.assertEqual(aria.zone_for_machine("Boiler C1"), "C")
        self.assertEqual(aria.zone_for_machine("Reactor D1"), "D")
        self.assertEqual(aria.zone_for_machine("Compressor C1"), "C")
        self.assertEqual(aria.zone_for_machine("Pump B1"), "B")

    def test_zone_scoping(self):
        # Setup mock states
        latest = {
            "Compressor A1": {
                "Machine": "Compressor A1",
                "nexops_risk": "HIGH",
                "Status": "Warning",
                "features": {"current": 60.0, "vibration": 5.0}
            },
            "Reactor D1": {
                "Machine": "Reactor D1",
                "nexops_risk": "CRITICAL",
                "Status": "Critical",
                "features": {"bed_temp": 430.0}
            }
        }
        history = {
            "Compressor A1": [],
            "Reactor D1": []
        }
        
        session = get_session()
        try:
            # Scoped technician from zone A queries Reactor D1 (Zone D)
            ctx = aria.build_context("Status of Reactor D1", "technician", "A", latest, history, session)
            self.assertTrue(ctx["scope_violation"])
            self.assertIsNone(ctx["focus_machine"])
            
            # Scoped technician from zone A queries Compressor A1 (Zone A)
            ctx2 = aria.build_context("Status of Compressor A1", "technician", "A", latest, history, session)
            self.assertFalse(ctx2["scope_violation"])
            self.assertEqual(ctx2["focus_machine"], "Compressor A1")
            
            # Unscoped plant manager queries Reactor D1 (Zone D)
            ctx3 = aria.build_context("Status of Reactor D1", "plant_manager", None, latest, history, session)
            self.assertFalse(ctx3["scope_violation"])
            self.assertEqual(ctx3["focus_machine"], "Reactor D1")
        finally:
            session.close()

    def test_linear_regression_extrapolation(self):
        # Construct linear trend data for 20 ticks
        # Temp rises from 300 to 395 over 19 minutes (slope = 5 units/min)
        trend = []
        start_time = datetime(2026, 6, 18, 12, 0, 0)
        for i in range(20):
            ts = start_time.replace(minute=i).strftime("%Y-%m-%d %H:%M:%S")
            trend.append({
                "Timestamp": ts,
                "features": {
                    "furnace_temp": 300.0 + 5.0 * i
                }
            })
            
        # furnace_temp threshold is 400.0 (high)
        proj = aria.run_extrapolation(trend, "furnace_temp", 400.0, "high")
        self.assertIsNotNone(proj)
        self.assertEqual(proj["sensor"], "furnace_temp")
        self.assertAlmostEqual(proj["slope_per_min"], 5.0)
        # At tick 19 (minute 19), current is 395. Next 5 units to 400 will take 1 minute.
        self.assertAlmostEqual(proj["current"], 395.0)
        self.assertAlmostEqual(proj["eta_minutes_low"], 0.85)
        self.assertAlmostEqual(proj["eta_minutes_high"], 1.15)

    def test_fallback_rendering(self):
        ctx = {
            "focus_machine": "Compressor A1",
            "machine_snapshot": {
                "Machine": "Compressor A1",
                "nexops_risk": "HIGH",
                "Status": "Warning",
                "fault_category": "mechanical"
            },
            "time_to_threshold": {
                "sensor": "vibration",
                "slope_per_min": 0.5,
                "eta_minutes_low": 8.5,
                "eta_minutes_high": 11.5,
                "current": 6.0,
                "threshold": 7.1
            },
            "current_assignment": {
                "engineer_name": "John Doe",
                "assignment_reason": "Vibration skill match"
            },
            "incident_history": {
                "times_resolved": 3,
                "avg_resolution_min": 15.0,
                "fastest_minutes": 10.0,
                "fastest_engineer": "Alice"
            },
            "trend_len": 20
        }
        
        answer = aria.render_fallback_answer(ctx, key_failed=True)
        self.assertIn("Offline Fallback Mode", answer)
        self.assertIn("Compressor A1", answer)
        self.assertIn("vibration", answer)
        self.assertIn("John Doe", answer)
        self.assertIn("mechanical", answer)
        self.assertIn("Inspect alignment, bearings", answer)

    def test_out_of_domain_detection(self):
        # General OOD queries
        self.assertTrue(aria.is_out_of_domain("who is ms dhoni"))
        self.assertTrue(aria.is_out_of_domain("What is the capital of France?"))
        self.assertTrue(aria.is_out_of_domain("tell me a joke"))
        
        # In-domain queries containing words that look OOD but contain plant terms
        self.assertFalse(aria.is_out_of_domain("who is assigned to Compressor A1?"))
        self.assertFalse(aria.is_out_of_domain("what is the vibration level of Pump A2?"))

    def test_targeted_fallback_templates(self):
        # Setup mock context
        ctx = {
            "query": "Highest risk in my zone?",
            "role": "technician",
            "scope_zone": "A",
            "top_machines": [
                {"name": "Compressor A1", "zone": "A", "nexops_risk": "HIGH", "status": "Warning", "alert": "High vibration"},
                {"name": "Pump A2", "zone": "A", "nexops_risk": "LOW", "status": "Normal", "alert": "None"}
            ],
            "open_task_count": 1,
            "personal_tasks": [
                {"id": 4, "machine": "Compressor A1", "zone": "A", "fault_category": "mechanical", "status": "assigned"}
            ],
            "scoped_engineers": [
                {"name": "Ravi Kumar", "active_tasks": 0, "max_capacity": 6, "available": True},
                {"name": "Lena Vogel", "active_tasks": 3, "max_capacity": 6, "available": True}
            ]
        }
        
        # Test ALERTS_RISK template
        res_risk = aria.render_fallback_answer(ctx, key_failed=True)
        self.assertIn("Active warnings and alerts:", res_risk)
        self.assertIn("Compressor A1", res_risk)
        
        # Test MY_TASKS template
        ctx["query"] = "how many tasks for me?"
        res_my = aria.render_fallback_answer(ctx, key_failed=True)
        self.assertIn("You have 1 active task(s) assigned to you in Zone A:", res_my)
        self.assertIn("Task #4", res_my)
        
        # Test ROSTER_LOAD template
        ctx["query"] = "who is assigned more?"
        res_roster = aria.render_fallback_answer(ctx, key_failed=True)
        self.assertIn("Lena Vogel: 3 / 6 active task(s)", res_roster)
        self.assertIn("Lena Vogel is currently assigned the most work", res_roster)
        
        # Test OOD template within fallback
        ctx["query"] = "who is MS Dhoni?"
        res_ood = aria.render_fallback_answer(ctx, key_failed=True)
        self.assertIn("out-of-domain topics", res_ood)

        # Test ML_CORROBORATION template
        ctx["query"] = "what is the ml corroboration rate?"
        ctx["live_metrics"] = {
            "early_warning_catches": 2,
            "nuisance_alarms_filtered": 5,
            "nuisance_machines": ["Pump A1"],
            "ml_corroboration_rate": "85%"
        }
        res_corrob = aria.render_fallback_answer(ctx, key_failed=True)
        self.assertIn("ML Corroboration Rate for Zone A is 85%", res_corrob)

        # Test NUISANCE_ALARMS template
        ctx["query"] = "which machine cause nuisance alarm?"
        res_nuisance = aria.render_fallback_answer(ctx, key_failed=True)
        self.assertIn("filtered 5 transient/nuisance alarm ticks", res_nuisance)
        self.assertIn("Pump A1", res_nuisance)

        # Test EARLY_WARNINGS template
        ctx["query"] = "early prediction how much"
        res_early = aria.render_fallback_answer(ctx, key_failed=True)
        self.assertIn("currently 2 distinct early warning prediction catches", res_early)


class TestAriaEndpoint(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        seed()
        
    def _login(self, username):
        r = client.post("/auth/login", json={"username": username, "password": "nexops123"})
        assert r.status_code == 200, r.text
        return r.json()["token"]
        
    def _auth(self, token):
        return {"Authorization": f"Bearer {token}"}
        
    def test_aria_ask_endpoint_scoping(self):
        # Setup history for "Compressor A1"
        main.latest_machine_states["Compressor A1"] = {
            "Machine": "Compressor A1",
            "nexops_risk": "HIGH",
            "Status": "Warning",
            "features": {"vibration": 5.0}
        }
        main.history_machine_states["Compressor A1"] = deque([
            {"Timestamp": "2026-06-18 12:00:00", "features": {"vibration": 4.0}},
            {"Timestamp": "2026-06-18 12:01:00", "features": {"vibration": 4.5}},
            {"Timestamp": "2026-06-18 12:02:00", "features": {"vibration": 5.0}},
        ], maxlen=50)

        # Login as a technician in Zone C (fieldC or a technician in C)
        tok_c = self._login("fieldC")
        
        # Ask about a zone A machine (Compressor A1) -> should result in a scope violation
        r = client.post("/aria/ask", json={"query": "status of Compressor A1?"}, headers=self._auth(tok_c))
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("evidence", data)
        self.assertIsNone(data["evidence"]["focus_machine"]) # Dropped due to scope check!
        
        # Login as plant manager
        tok_plant = self._login("plant")
        r_plant = client.post("/aria/ask", json={"query": "status of Compressor A1?"}, headers=self._auth(tok_plant))
        self.assertEqual(r_plant.status_code, 200)
        data_plant = r_plant.json()
        self.assertEqual(data_plant["evidence"]["focus_machine"], "Compressor A1") # Allowed for plant manager!

    def test_aria_ask_endpoint_out_of_domain(self):
        tok = self._login("plant")
        r = client.post("/aria/ask", json={"query": "who is ms dhoni?"}, headers=self._auth(tok))
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("out-of-domain topics", data["answer"])
        self.assertEqual(data["source"], "unavailable")

    def test_aria_ask_endpoint_personal_tasks(self):
        # Login as ravi (technician from Zone A)
        tok_ravi = self._login("ravi")
        
        # Query: "how many tasks for me"
        r = client.post("/aria/ask", json={"query": "how many tasks for me?"}, headers=self._auth(tok_ravi))
        self.assertEqual(r.status_code, 200)
        data = r.json()
        
        if data["source"] == "fallback_template":
            self.assertTrue(
                "no active tasks" in data["answer"].lower() or "active task(s) assigned to you" in data["answer"].lower()
            )
        else:
            self.assertTrue(len(data["answer"]) > 0)


if __name__ == "__main__":
    unittest.main()
