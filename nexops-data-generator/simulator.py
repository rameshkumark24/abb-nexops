"""
ABB 800xA Style LIVE Refinery / Warehouse Monitoring & Alert Simulator  (v2)
============================================================================
v2 adds the three things that turn this from a "labelled scenario printer"
into something that can actually demonstrate PREDICTIVE detection (the
NexOps "Golden Path"):

  (1) CASCADING / PROGRESSIVE DEGRADATION
      A fault now SEEDS quietly and GROWS over many readings. As the root
      cause worsens it DRAGS correlated sensors with it (e.g. a bearing
      fault slowly raises bearing_temp -> vibration -> current). Crucially,
      while it is still in the "incubating" phase the value stays BELOW the
      static alarm threshold -> this is exactly the window where an
      anomaly-detector (Isolation Forest) can flag a problem BEFORE the
      gateway's static limit trips. That is the demo centrepiece.

  (2) SENSOR NOISE FLOOR
      Every reading now gets small Gaussian jitter, so the data looks like
      a real noisy DAQ feed instead of a perfectly smooth curve.

  (3) PERSISTENT ALARM LIFECYCLE
      An alarm now LIVES across readings: ACT -> ACK -> RTN. It is raised
      once when a condition starts, stays active until the condition
      clears, then returns-to-normal. This lets you honestly count
      "active alarms per 10 min" for the EEMUA 191 metric.

Everything from v1 (named machines, per-machine features, bands, the 4
common dashboard columns, 800xA historian fields, JSONL output) is kept.

Only standard library modules are used: json, random, time, datetime.
"""

import json
import random
import time
from datetime import datetime

# ----------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------

OUTPUT_FILE = "refinery_live_data.jsonl"
INTERVAL_SECONDS = 2
TOTAL_RECORDS = None          # None = run forever, or set an integer limit

# --- v2 knobs ---
NOISE_ENABLED = True          # add Gaussian sensor noise to every reading
DEGRADATION_ENABLED = True    # enable slow cascading faults
# Chance per machine per tick that a NEW slow degradation begins (if none active)
DEGRADATION_SEED_CHANCE = 0.12
# How many ticks a degradation incubates BELOW threshold before crossing it.
# Larger = longer "early-warning" window for the anomaly detector to shine.
INCUBATION_TICKS = (15, 30)

# ----------------------------------------------------------------------
# v3.1 DEMO ESCALATION PHASES
# The demo starts CALM (rare, slow-developing faults) and then ESCALATES
# (faults arrive more often AND develop faster), so you can show normal
# monitoring first, then an "alarm flood" stress scenario.
#
# Each phase is defined by elapsed seconds since start:
#   until        : phase lasts until this many seconds have elapsed
#                  (use None for the final, open-ended phase)
#   seed_mult    : multiplies DEGRADATION_SEED_CHANCE (how OFTEN faults start)
#   sudden_mult  : multiplies SUDDEN_EVENT_CHANCE (how OFTEN sudden alarms fire)
#   speed_mult   : >1 makes faults develop FASTER (shorter incubation)
#   label        : shown in the console banner when the phase begins
# ----------------------------------------------------------------------

ESCALATION_ENABLED = True

DEMO_PHASES = [
    {"until": 30,   "seed_mult": 1.0, "sudden_mult": 1.0, "speed_mult": 1.2,
     "label": "calm"},
    {"until": 70,   "seed_mult": 2.0, "sudden_mult": 2.0, "speed_mult": 1.8,
     "label": "building"},
    {"until": None, "seed_mult": 4.0, "sudden_mult": 3.5, "speed_mult": 2.6,
     "label": "flood"},
]

# Track which phase we're in so we only announce a change once
_demo_start_time = None
_current_phase_index = -1


def get_phase(elapsed_seconds):
    """Return the active phase dict for the given elapsed time."""
    if not ESCALATION_ENABLED:
        return {"seed_mult": 1.0, "sudden_mult": 1.0, "speed_mult": 1.0, "label": ""}
    for phase in DEMO_PHASES:
        if phase["until"] is None or elapsed_seconds < phase["until"]:
            return phase
    return DEMO_PHASES[-1]

MACHINES = [
    "Compressor", "Pump", "Storage Tank", "Distillation Column",
    "Heat Exchanger", "Boiler", "Motor", "Control Valve",
    "MCC Panel", "Generator",
    # --- v3 additional refinery assets ---
    "Fired Heater", "Cooling Tower", "Flare System",
    "Separator", "Reactor", "Instrument Air Compressor",
]

# ----------------------------------------------------------------------
# Per-feature operating bands  (Normal / Low / High / Critical)
# ----------------------------------------------------------------------

BANDS = {
    "furnace_temp": {"Normal": (350.0, 370.0), "Low": (320.0, 349.9), "High": (386.0, 400.0),
                     "Critical_High": (400.1, 430.0), "Critical_Low": (290.0, 319.9)},
    "gen_temp": {"Normal": (45.0, 70.0), "Low": (20.0, 44.9), "High": (85.0, 100.0),
                 "Critical_High": (100.1, 130.0), "Critical_Low": (5.0, 19.9)},
    "bearing_temp": {"Normal": (40.0, 65.0), "Low": (15.0, 39.9), "High": (80.0, 95.0),
                     "Critical_High": (95.1, 120.0), "Critical_Low": (5.0, 14.9)},
    "boiler_temp": {"Normal": (150.0, 200.0), "Low": (110.0, 149.9), "High": (215.0, 240.0),
                    "Critical_High": (240.1, 280.0), "Critical_Low": (80.0, 109.9)},
    "hx_inlet_temp": {"Normal": (120.0, 160.0), "Low": (90.0, 119.9), "High": (175.0, 195.0),
                      "Critical_High": (195.1, 230.0), "Critical_Low": (60.0, 89.9)},
    "hx_outlet_temp": {"Normal": (60.0, 90.0), "Low": (35.0, 59.9), "High": (105.0, 120.0),
                       "Critical_High": (120.1, 150.0), "Critical_Low": (15.0, 34.9)},

    "column_pressure": {"Normal": (1.2, 2.0), "Low": (0.5, 1.19), "High": (2.1, 3.0),
                        "Critical_High": (3.01, 3.8), "Critical_Low": (0.1, 0.49)},
    "comp_pressure": {"Normal": (6.0, 9.0), "Low": (3.0, 5.9), "High": (10.0, 12.0),
                      "Critical_High": (12.1, 16.0), "Critical_Low": (1.0, 2.9)},
    "pump_pressure": {"Normal": (3.0, 5.0), "Low": (1.0, 2.9), "High": (6.0, 7.5),
                      "Critical_High": (7.6, 10.0), "Critical_Low": (0.2, 0.9)},
    "boiler_pressure": {"Normal": (8.0, 12.0), "Low": (4.0, 7.9), "High": (14.0, 17.0),
                        "Critical_High": (17.1, 22.0), "Critical_Low": (1.0, 3.9)},
    "hx_pressure": {"Normal": (2.0, 4.0), "Low": (0.8, 1.9), "High": (5.0, 6.5),
                    "Critical_High": (6.6, 9.0), "Critical_Low": (0.2, 0.7)},
    "valve_pressure": {"Normal": (2.0, 4.5), "Low": (0.8, 1.9), "High": (5.5, 7.0),
                       "Critical_High": (7.1, 9.0), "Critical_Low": (0.2, 0.7)},

    "oil_level": {"Normal": (40.0, 80.0), "Low": (10.0, 19.9), "High": (81.0, 90.0),
                  "Critical_High": (90.1, 99.0), "Critical_Low": (0.0, 9.9)},
    "column_level": {"Normal": (45.0, 75.0), "Low": (15.0, 24.9), "High": (82.0, 90.0),
                     "Critical_High": (90.1, 98.0), "Critical_Low": (0.0, 14.9)},
    "boiler_water_level": {"Normal": (50.0, 75.0), "Low": (20.0, 34.9), "High": (85.0, 92.0),
                           "Critical_High": (92.1, 99.0), "Critical_Low": (0.0, 19.9)},

    "feed_flow": {"Normal": (90.0, 110.0), "Low": (60.0, 89.9), "High": (111.0, 120.0),
                  "Critical_High": (120.1, 140.0), "Critical_Low": (0.0, 59.9)},
    "vibration": {"Normal": (0.5, 2.8), "Low": (0.0, 0.49), "High": (4.5, 7.1),
                  "Critical_High": (7.2, 12.0), "Critical_Low": (0.0, 0.1)},
    "current": {"Normal": (10.0, 40.0), "Low": (2.0, 9.9), "High": (50.0, 65.0),
                "Critical_High": (65.1, 90.0), "Critical_Low": (0.0, 1.9)},
    "panel_current": {"Normal": (50.0, 150.0), "Low": (10.0, 49.9), "High": (180.0, 220.0),
                      "Critical_High": (220.1, 300.0), "Critical_Low": (0.0, 9.9)},
    "voltage": {"Normal": (400.0, 420.0), "Low": (360.0, 399.9), "High": (430.0, 450.0),
                "Critical_High": (450.1, 500.0), "Critical_Low": (300.0, 359.9)},
    "rpm": {"Normal": (1450.0, 1550.0), "Low": (1000.0, 1449.9), "High": (1600.0, 1750.0),
            "Critical_High": (1750.1, 2200.0), "Critical_Low": (200.0, 999.9)},
    "frequency": {"Normal": (49.5, 50.5), "Low": (47.0, 49.4), "High": (50.6, 52.0),
                  "Critical_High": (52.1, 55.0), "Critical_Low": (40.0, 46.9)},
    "valve_position": {"Normal": (20.0, 85.0), "Low": (1.0, 9.9), "High": (95.0, 99.0),
                       "Critical_High": (99.1, 100.0), "Critical_Low": (0.0, 0.9)},

    # ---------------- v3 new features ----------------
    # Fired Heater tube skin / outlet temp (deg C) - runs very hot
    "tube_skin_temp": {"Normal": (600.0, 680.0), "Low": (520.0, 599.9), "High": (720.0, 770.0),
                       "Critical_High": (770.1, 850.0), "Critical_Low": (450.0, 519.9)},
    # Fired Heater draft pressure (mbar, slightly negative is normal)
    "draft_pressure": {"Normal": (-3.0, -1.0), "Low": (-6.0, -3.01), "High": (-0.99, 1.0),
                       "Critical_High": (1.01, 4.0), "Critical_Low": (-10.0, -6.01)},
    # Fuel gas flow to burners (kg/h)
    "fuel_flow": {"Normal": (40.0, 60.0), "Low": (20.0, 39.9), "High": (65.0, 80.0),
                  "Critical_High": (80.1, 100.0), "Critical_Low": (0.0, 19.9)},
    # Cooling tower water return temp (deg C)
    "cw_temp": {"Normal": (28.0, 38.0), "Low": (15.0, 27.9), "High": (42.0, 48.0),
                "Critical_High": (48.1, 60.0), "Critical_Low": (5.0, 14.9)},
    # Cooling tower basin level (%)
    "basin_level": {"Normal": (45.0, 80.0), "Low": (15.0, 24.9), "High": (85.0, 92.0),
                    "Critical_High": (92.1, 99.0), "Critical_Low": (0.0, 14.9)},
    # Flare header gas flow (kg/h) - normally near zero, spikes on relief
    "flare_flow": {"Normal": (0.0, 5.0), "Low": (0.0, 0.0), "High": (20.0, 60.0),
                   "Critical_High": (60.1, 200.0), "Critical_Low": (0.0, 0.0)},
    # Separator interface / differential pressure (bar)
    "diff_pressure": {"Normal": (0.3, 1.0), "Low": (0.05, 0.29), "High": (1.5, 2.2),
                      "Critical_High": (2.21, 3.5), "Critical_Low": (0.0, 0.04)},
    # Reactor catalyst bed temp (deg C) - exothermic, runaway risk
    "bed_temp": {"Normal": (320.0, 380.0), "Low": (260.0, 319.9), "High": (400.0, 440.0),
                 "Critical_High": (440.1, 520.0), "Critical_Low": (200.0, 259.9)},
    # Reactor pressure (bar) - high pressure hydroprocessing
    "reactor_pressure": {"Normal": (50.0, 70.0), "Low": (30.0, 49.9), "High": (78.0, 90.0),
                         "Critical_High": (90.1, 110.0), "Critical_Low": (10.0, 29.9)},
    # Hydrogen feed flow (Nm3/h)
    "h2_flow": {"Normal": (800.0, 1200.0), "Low": (400.0, 799.9), "High": (1300.0, 1500.0),
                "Critical_High": (1500.1, 1800.0), "Critical_Low": (0.0, 399.9)},
    # Instrument air dew point (deg C) - should be very dry/negative
    "dew_point": {"Normal": (-50.0, -30.0), "Low": (-70.0, -50.01), "High": (-20.0, -5.0),
                  "Critical_High": (-4.99, 15.0), "Critical_Low": (-90.0, -70.01)},
    # Instrument air header pressure (bar)
    "air_pressure": {"Normal": (6.0, 8.0), "Low": (3.5, 5.9), "High": (8.5, 9.5),
                     "Critical_High": (9.51, 12.0), "Critical_Low": (1.0, 3.49)},
}

STEP_RANGES = {
    "furnace_temp": 1.5, "gen_temp": 1.2, "bearing_temp": 1.0, "boiler_temp": 2.0,
    "hx_inlet_temp": 1.5, "hx_outlet_temp": 1.2,
    "column_pressure": 0.05, "comp_pressure": 0.2, "pump_pressure": 0.15,
    "boiler_pressure": 0.3, "hx_pressure": 0.1, "valve_pressure": 0.1,
    "oil_level": 0.8, "column_level": 0.8, "boiler_water_level": 0.8,
    "feed_flow": 1.0, "vibration": 0.15, "current": 1.5, "panel_current": 5.0,
    "voltage": 1.5, "rpm": 10.0, "frequency": 0.1, "valve_position": 2.0,
    "tube_skin_temp": 4.0, "draft_pressure": 0.2, "fuel_flow": 1.5,
    "cw_temp": 0.6, "basin_level": 0.8, "flare_flow": 3.0, "diff_pressure": 0.05,
    "bed_temp": 3.0, "reactor_pressure": 1.0, "h2_flow": 25.0,
    "dew_point": 1.5, "air_pressure": 0.1,
}

HARD_LIMITS = {
    "furnace_temp": (280.0, 435.0), "gen_temp": (0.0, 140.0),
    "bearing_temp": (0.0, 130.0), "boiler_temp": (70.0, 290.0),
    "hx_inlet_temp": (50.0, 240.0), "hx_outlet_temp": (10.0, 160.0),
    "column_pressure": (0.05, 3.9), "comp_pressure": (0.5, 17.0),
    "pump_pressure": (0.1, 11.0), "boiler_pressure": (0.5, 23.0),
    "hx_pressure": (0.1, 9.5), "valve_pressure": (0.1, 9.5),
    "oil_level": (0.0, 100.0), "column_level": (0.0, 100.0),
    "boiler_water_level": (0.0, 100.0), "feed_flow": (0.0, 145.0),
    "vibration": (0.0, 12.0), "current": (0.0, 95.0), "panel_current": (0.0, 320.0),
    "voltage": (280.0, 520.0), "rpm": (0.0, 2300.0), "frequency": (38.0, 56.0),
    "valve_position": (0.0, 100.0),
    "tube_skin_temp": (400.0, 900.0), "draft_pressure": (-12.0, 5.0),
    "fuel_flow": (0.0, 110.0), "cw_temp": (5.0, 65.0), "basin_level": (0.0, 100.0),
    "flare_flow": (0.0, 220.0), "diff_pressure": (0.0, 4.0),
    "bed_temp": (180.0, 560.0), "reactor_pressure": (5.0, 120.0),
    "h2_flow": (0.0, 1900.0), "dew_point": (-95.0, 20.0), "air_pressure": (0.5, 13.0),
}

DECIMALS = {
    "column_pressure": 2, "comp_pressure": 2, "pump_pressure": 2,
    "boiler_pressure": 2, "hx_pressure": 2, "valve_pressure": 2,
    "vibration": 2, "frequency": 2,
    "draft_pressure": 2, "diff_pressure": 2, "air_pressure": 2,
}

# Per-feature noise standard deviation (small fraction of the normal range).
# Tweak to taste; this is what makes the feed look like real DAQ data.
NOISE_STD = {
    "furnace_temp": 0.6, "gen_temp": 0.5, "bearing_temp": 0.4, "boiler_temp": 0.8,
    "hx_inlet_temp": 0.6, "hx_outlet_temp": 0.5,
    "column_pressure": 0.02, "comp_pressure": 0.08, "pump_pressure": 0.05,
    "boiler_pressure": 0.12, "hx_pressure": 0.04, "valve_pressure": 0.04,
    "oil_level": 0.3, "column_level": 0.3, "boiler_water_level": 0.3,
    "feed_flow": 0.5, "vibration": 0.06, "current": 0.6, "panel_current": 2.0,
    "voltage": 0.8, "rpm": 4.0, "frequency": 0.03, "valve_position": 0.6,
    "tube_skin_temp": 2.0, "draft_pressure": 0.08, "fuel_flow": 0.6,
    "cw_temp": 0.3, "basin_level": 0.3, "flare_flow": 0.4, "diff_pressure": 0.02,
    "bed_temp": 1.5, "reactor_pressure": 0.5, "h2_flow": 12.0,
    "dew_point": 0.6, "air_pressure": 0.04,
}

# ----------------------------------------------------------------------
# Machine feature map  (unchanged from v1)
# ----------------------------------------------------------------------

MACHINE_FEATURES = {
    "Compressor": {"features": ["gen_temp", "comp_pressure", "vibration", "current", "rpm"],
                   "dash": {"Temp": "gen_temp", "Pressure": "comp_pressure", "Level": None, "Flow": None},
                   "tag": "PIC-CMP01", "desc": "Process Gas Compressor Discharge"},
    "Pump": {"features": ["gen_temp", "pump_pressure", "feed_flow", "vibration", "current"],
             "dash": {"Temp": "gen_temp", "Pressure": "pump_pressure", "Level": None, "Flow": "feed_flow"},
             "tag": "FIC-PMP01", "desc": "Crude Charge Pump"},
    "Storage Tank": {"features": ["oil_level", "gen_temp", "leak"],
                     "dash": {"Temp": "gen_temp", "Pressure": None, "Level": "oil_level", "Flow": None},
                     "tag": "LIC-TNK01", "desc": "Crude Storage Tank"},
    "Distillation Column": {"features": ["furnace_temp", "column_pressure", "feed_flow", "column_level"],
                            "dash": {"Temp": "furnace_temp", "Pressure": "column_pressure",
                                     "Level": "column_level", "Flow": "feed_flow"},
                            "tag": "TIC-COL01", "desc": "Atmospheric Distillation Column"},
    "Heat Exchanger": {"features": ["hx_inlet_temp", "hx_outlet_temp", "feed_flow", "hx_pressure"],
                       "dash": {"Temp": "hx_inlet_temp", "Pressure": "hx_pressure", "Level": None, "Flow": "feed_flow"},
                       "tag": "TIC-HEX01", "desc": "Crude Preheat Heat Exchanger"},
    "Boiler": {"features": ["boiler_temp", "boiler_pressure", "boiler_water_level"],
               "dash": {"Temp": "boiler_temp", "Pressure": "boiler_pressure",
                        "Level": "boiler_water_level", "Flow": None},
               "tag": "PIC-BLR01", "desc": "Steam Generation Boiler"},
    "Motor": {"features": ["gen_temp", "current", "vibration", "rpm", "bearing_temp"],
              "dash": {"Temp": "gen_temp", "Pressure": None, "Level": None, "Flow": None},
              "tag": "JIC-MTR01", "desc": "Main Drive Induction Motor"},
    "Control Valve": {"features": ["valve_position", "feed_flow", "valve_pressure"],
                      "dash": {"Temp": None, "Pressure": "valve_pressure", "Level": None, "Flow": "feed_flow"},
                      "tag": "ZIC-VLV01", "desc": "Process Control Valve"},
    "MCC Panel": {"features": ["panel_current", "voltage", "gen_temp"],
                  "dash": {"Temp": "gen_temp", "Pressure": None, "Level": None, "Flow": None},
                  "tag": "EIC-MCC01", "desc": "Motor Control Centre Panel"},
    "Generator": {"features": ["voltage", "panel_current", "frequency", "gen_temp", "rpm"],
                  "dash": {"Temp": "gen_temp", "Pressure": None, "Level": None, "Flow": None},
                  "tag": "EIC-GEN01", "desc": "Standby Diesel Generator"},

    # ---------------- v3 new assets ----------------
    "Fired Heater": {"features": ["tube_skin_temp", "draft_pressure", "fuel_flow", "feed_flow"],
                     "dash": {"Temp": "tube_skin_temp", "Pressure": "draft_pressure",
                              "Level": None, "Flow": "feed_flow"},
                     "tag": "TIC-FH01", "desc": "Crude Charge Fired Heater"},
    "Cooling Tower": {"features": ["cw_temp", "basin_level", "vibration", "feed_flow"],
                      "dash": {"Temp": "cw_temp", "Pressure": None,
                               "Level": "basin_level", "Flow": "feed_flow"},
                      "tag": "TIC-CT01", "desc": "Circulating Water Cooling Tower"},
    "Flare System": {"features": ["flare_flow", "tube_skin_temp", "pilot"],
                     "dash": {"Temp": "tube_skin_temp", "Pressure": None,
                              "Level": None, "Flow": "flare_flow"},
                     "tag": "FIC-FLR01", "desc": "Elevated Flare Stack"},
    "Separator": {"features": ["diff_pressure", "column_level", "feed_flow", "vibration"],
                  "dash": {"Temp": None, "Pressure": "diff_pressure",
                           "Level": "column_level", "Flow": "feed_flow"},
                  "tag": "PIC-SEP01", "desc": "3-Phase Production Separator"},
    "Reactor": {"features": ["bed_temp", "reactor_pressure", "h2_flow", "feed_flow"],
                "dash": {"Temp": "bed_temp", "Pressure": "reactor_pressure",
                         "Level": None, "Flow": "feed_flow"},
                "tag": "TIC-RX01", "desc": "Hydrotreater Reactor Bed"},
    "Instrument Air Compressor": {"features": ["air_pressure", "dew_point", "gen_temp", "current"],
                                  "dash": {"Temp": "gen_temp", "Pressure": "air_pressure",
                                           "Level": None, "Flow": None},
                                  "tag": "PIC-IAC01", "desc": "Instrument Air Compressor"},
}

DASH_COLUMNS = ["Temp", "Pressure", "Level", "Flow"]

# ----------------------------------------------------------------------
# DEGRADATION MODES  (the v2 centrepiece)
# Each mode describes a slow root-cause fault that grows over time and
# drags correlated sensors with it. Only modes whose root feature the
# machine actually owns can be chosen for that machine.
#
#   root      : the feature that drives the fault
#   coupled   : {feature: gain} other sensors pulled along with the root,
#               proportional to how far the root has progressed
#   final     : which band the root ends up in once fully developed
#   name/alert: labels used once the alarm trips
# ----------------------------------------------------------------------

DEGRADATION_MODES = [
    {"id": "bearing_wear", "root": "bearing_temp", "final": "Critical_High",
     "coupled": {"vibration": 0.7, "current": 0.4, "gen_temp": 0.3},
     "name": "Bearing Degradation", "warn": "Bearing Wear Trend",
     "crit": "BEARING FAILURE - OVERHEAT"},
    {"id": "motor_overload", "root": "current", "final": "Critical_High",
     "coupled": {"gen_temp": 0.5, "vibration": 0.3},
     "name": "Motor Overload Trend", "warn": "Rising Load Trend",
     "crit": "MOTOR OVERHEAT - OVERLOAD"},
    {"id": "imbalance", "root": "vibration", "final": "Critical_High",
     "coupled": {"bearing_temp": 0.4, "current": 0.2},
     "name": "Rotating Imbalance", "warn": "Vibration Trend",
     "crit": "SEVERE VIBRATION - MECHANICAL FAULT"},
    {"id": "comp_fouling", "root": "comp_pressure", "final": "Critical_High",
     "coupled": {"gen_temp": 0.4, "current": 0.4},
     "name": "Compressor Fouling", "warn": "Discharge Pressure Trend",
     "crit": "COMPRESSOR OVERPRESSURE"},
    {"id": "hx_fouling", "root": "hx_outlet_temp", "final": "Critical_High",
     "coupled": {"hx_pressure": 0.3},
     "name": "Heat Exchanger Fouling", "warn": "Cooling Efficiency Trend",
     "crit": "COOLING FAILURE - HX FOULED"},
    {"id": "boiler_scaling", "root": "boiler_temp", "final": "Critical_High",
     "coupled": {"boiler_pressure": 0.6},
     "name": "Boiler Scaling", "warn": "Boiler Temp Trend",
     "crit": "BOILER OVERHEAT"},
    {"id": "column_fouling", "root": "furnace_temp", "final": "Critical_High",
     "coupled": {"column_pressure": 0.5},
     "name": "Column Heat Trend", "warn": "Column Temp Trend",
     "crit": "DISTILLATION COLUMN OVERHEAT"},
    {"id": "tank_drain", "root": "oil_level", "final": "Critical_Low",
     "coupled": {},
     "name": "Tank Draining Trend", "warn": "Falling Level Trend",
     "crit": "TANK NEAR EMPTY"},
    # ---- v3 modes for new assets ----
    {"id": "heater_tube", "root": "tube_skin_temp", "final": "Critical_High",
     "coupled": {"fuel_flow": 0.3},
     "name": "Fired Heater Tube Hotspot", "warn": "Tube Skin Temp Trend",
     "crit": "TUBE RUPTURE RISK - OVERHEAT"},
    {"id": "cw_fouling", "root": "cw_temp", "final": "Critical_High",
     "coupled": {"vibration": 0.3},
     "name": "Cooling Tower Fouling", "warn": "CW Return Temp Trend",
     "crit": "COOLING TOWER FAILURE"},
    {"id": "sep_emulsion", "root": "diff_pressure", "final": "Critical_High",
     "coupled": {"column_level": 0.4},
     "name": "Separator Emulsion Buildup", "warn": "Differential Pressure Trend",
     "crit": "SEPARATOR DP HIGH - CARRYOVER"},
    {"id": "reactor_runaway", "root": "bed_temp", "final": "Critical_High",
     "coupled": {"reactor_pressure": 0.6},
     "name": "Reactor Temperature Excursion", "warn": "Catalyst Bed Temp Trend",
     "crit": "REACTOR RUNAWAY RISK"},
    {"id": "air_dryer", "root": "dew_point", "final": "Critical_High",
     "coupled": {},
     "name": "Air Dryer Degradation", "warn": "Dew Point Rising Trend",
     "crit": "INSTRUMENT AIR WET - DRYER FAILURE"},
]

# ----------------------------------------------------------------------
# Sudden-event scenarios (kept from v1 for variety / safety alarms).
# These are INSTANT alarms, in contrast to slow degradation above.
# ----------------------------------------------------------------------

NORMAL = {"name": "Normal Operation", "kind": "normal"}

SUDDEN_SCENARIOS = {
    "Compressor": [
        {"name": "Gas Leak Detected", "kind": "safety", "alert": "GAS LEAK DETECTED", "weight": 3},
        {"name": "Emergency Stop Activated", "kind": "safety", "alert": "EMERGENCY STOP ACTIVATED", "weight": 2},
        {"name": "Overspeed", "kind": "band", "feature": "rpm", "dir": "High",
         "alert": "Overspeed", "crit_alert": "Critical Overspeed", "weight": 3},
    ],
    "Pump": [
        {"name": "Pump Failure", "kind": "band", "feature": "feed_flow", "dir": "Low",
         "alert": "Low Flow", "crit_alert": "PUMP FAILURE - NO FLOW", "always_critical": True, "weight": 5},
        {"name": "Emergency Stop Activated", "kind": "safety", "alert": "EMERGENCY STOP ACTIVATED", "weight": 2},
    ],
    "Storage Tank": [
        {"name": "Tank Overflow Risk", "kind": "band", "feature": "oil_level", "dir": "High",
         "alert": "High Level", "crit_alert": "TANK OVERFLOW IMMINENT", "weight": 5},
        {"name": "Tank Leak", "kind": "safety", "alert": "TANK LEAK DETECTED", "weight": 5},
        {"name": "Gas Leak Detected", "kind": "safety", "alert": "GAS LEAK DETECTED", "weight": 4},
        {"name": "Fire Detected", "kind": "safety", "alert": "FIRE DETECTED", "weight": 3},
    ],
    "Distillation Column": [
        {"name": "High Column Level", "kind": "band", "feature": "column_level", "dir": "High",
         "alert": "High Level", "crit_alert": "Column Flooding", "weight": 4},
        {"name": "Low Feed Flow", "kind": "band", "feature": "feed_flow", "dir": "Low",
         "alert": "Low Flow", "crit_alert": "Feed Starvation", "weight": 4},
        {"name": "Fire Detected", "kind": "safety", "alert": "FIRE DETECTED", "weight": 2},
    ],
    "Heat Exchanger": [
        {"name": "High Inlet Temperature", "kind": "band", "feature": "hx_inlet_temp", "dir": "High",
         "alert": "High Inlet Temp", "crit_alert": "HX Inlet Overheat", "weight": 5},
    ],
    "Boiler": [
        {"name": "Boiler Overpressure", "kind": "band", "feature": "boiler_pressure", "dir": "High",
         "alert": "High Pressure", "crit_alert": "BOILER OVERPRESSURE", "always_critical": True, "weight": 6},
        {"name": "Low Water Level", "kind": "band", "feature": "boiler_water_level", "dir": "Low",
         "alert": "Low Level", "crit_alert": "LOW WATER - DRY FIRING RISK", "always_critical": True, "weight": 5},
        {"name": "Fire Detected", "kind": "safety", "alert": "FIRE DETECTED", "weight": 3},
    ],
    "Motor": [
        {"name": "Overspeed", "kind": "band", "feature": "rpm", "dir": "High",
         "alert": "Overspeed", "crit_alert": "Critical Overspeed", "weight": 4},
        {"name": "Emergency Stop Activated", "kind": "safety", "alert": "EMERGENCY STOP ACTIVATED", "weight": 2},
    ],
    "Control Valve": [
        {"name": "Valve Stuck Closed", "kind": "band", "feature": "valve_position", "dir": "Low",
         "alert": "Valve Stuck Closed", "crit_alert": "VALVE FAILURE - STUCK CLOSED", "always_critical": True, "weight": 5},
        {"name": "Valve Stuck Open", "kind": "band", "feature": "valve_position", "dir": "High",
         "alert": "Valve Stuck Open", "crit_alert": "Valve Failure - Stuck Open", "weight": 5},
        {"name": "No Flow", "kind": "band", "feature": "feed_flow", "dir": "Low",
         "alert": "No Flow", "crit_alert": "Blocked Line", "weight": 4},
    ],
    "MCC Panel": [
        {"name": "Electrical Panel Overcurrent", "kind": "band", "feature": "panel_current", "dir": "High",
         "alert": "Overcurrent", "crit_alert": "PANEL OVERCURRENT", "always_critical": True, "weight": 6},
        {"name": "Overvoltage", "kind": "band", "feature": "voltage", "dir": "High",
         "alert": "Overvoltage", "crit_alert": "Critical Overvoltage", "weight": 5},
        {"name": "Undervoltage", "kind": "band", "feature": "voltage", "dir": "Low",
         "alert": "Undervoltage", "crit_alert": "Critical Undervoltage", "weight": 5},
        {"name": "Fire Detected", "kind": "safety", "alert": "FIRE DETECTED", "weight": 3},
    ],
    "Generator": [
        {"name": "Overvoltage", "kind": "band", "feature": "voltage", "dir": "High",
         "alert": "Overvoltage", "crit_alert": "Critical Overvoltage", "weight": 5},
        {"name": "Undervoltage", "kind": "band", "feature": "voltage", "dir": "Low",
         "alert": "Undervoltage", "crit_alert": "Critical Undervoltage", "weight": 5},
        {"name": "Overfrequency", "kind": "band", "feature": "frequency", "dir": "High",
         "alert": "Overfrequency", "crit_alert": "Overfrequency Trip", "weight": 4},
        {"name": "Underfrequency", "kind": "band", "feature": "frequency", "dir": "Low",
         "alert": "Underfrequency", "crit_alert": "Underfrequency Trip", "weight": 4},
    ],
    "Fired Heater": [
        {"name": "High Draft Pressure", "kind": "band", "feature": "draft_pressure", "dir": "High",
         "alert": "Positive Draft", "crit_alert": "POSITIVE DRAFT - FLAME ROLLOUT", "weight": 5},
        {"name": "Low Fuel Flow", "kind": "band", "feature": "fuel_flow", "dir": "Low",
         "alert": "Low Fuel", "crit_alert": "FLAME-OUT RISK", "always_critical": True, "weight": 4},
        {"name": "Fire Detected", "kind": "safety", "alert": "FIRE DETECTED", "weight": 3},
        {"name": "Emergency Stop Activated", "kind": "safety", "alert": "EMERGENCY STOP ACTIVATED", "weight": 2},
    ],
    "Cooling Tower": [
        {"name": "Low Basin Level", "kind": "band", "feature": "basin_level", "dir": "Low",
         "alert": "Low Basin Level", "crit_alert": "PUMP CAVITATION RISK", "weight": 5},
        {"name": "Fan Vibration", "kind": "band", "feature": "vibration", "dir": "High",
         "alert": "High Vibration", "crit_alert": "Fan Imbalance", "weight": 4},
    ],
    "Flare System": [
        {"name": "Pilot Flame Failure", "kind": "pilot", "alert": "PILOT FLAME-OUT", "weight": 5},
        {"name": "High Flare Load", "kind": "band", "feature": "flare_flow", "dir": "High",
         "alert": "High Flare Flow", "crit_alert": "MAJOR RELIEF EVENT", "weight": 4},
        {"name": "Fire Detected", "kind": "safety", "alert": "FIRE DETECTED", "weight": 2},
    ],
    "Separator": [
        {"name": "High Liquid Level", "kind": "band", "feature": "column_level", "dir": "High",
         "alert": "High Level", "crit_alert": "LIQUID CARRYOVER", "weight": 5},
        {"name": "Low Liquid Level", "kind": "band", "feature": "column_level", "dir": "Low",
         "alert": "Low Level", "crit_alert": "GAS BLOWBY RISK", "always_critical": True, "weight": 4},
    ],
    "Reactor": [
        {"name": "High Reactor Pressure", "kind": "band", "feature": "reactor_pressure", "dir": "High",
         "alert": "High Pressure", "crit_alert": "REACTOR OVERPRESSURE", "always_critical": True, "weight": 5},
        {"name": "Low Hydrogen Flow", "kind": "band", "feature": "h2_flow", "dir": "Low",
         "alert": "Low H2 Flow", "crit_alert": "H2 STARVATION - COKING RISK", "weight": 4},
        {"name": "Emergency Stop Activated", "kind": "safety", "alert": "EMERGENCY STOP ACTIVATED", "weight": 2},
    ],
    "Instrument Air Compressor": [
        {"name": "Low Air Pressure", "kind": "band", "feature": "air_pressure", "dir": "Low",
         "alert": "Low Air Pressure", "crit_alert": "INSTRUMENT AIR LOSS - PLANT TRIP RISK",
         "always_critical": True, "weight": 6},
        {"name": "Compressor Overheat", "kind": "band", "feature": "gen_temp", "dir": "High",
         "alert": "High Temp", "crit_alert": "Air Compressor Overheat", "weight": 4},
    ],
}

# Chance per tick of a sudden event firing (kept rare; degradation is the star)
SUDDEN_EVENT_CHANCE = 0.04

PRIORITY_LEVELS = {"Critical": 1, "High": 2, "Medium": 3, "Low": 4}

# ----------------------------------------------------------------------
# Live process state.  v2 stores not just sensor values but also a small
# amount of MACHINE STATE: any active degradation, and any active alarm.
# ----------------------------------------------------------------------

def new_machine_state(machine_name):
    state = {"_values": {}, "_degradation": None, "_alarm": None}
    for feat in MACHINE_FEATURES[machine_name]["features"]:
        if feat in ("leak", "pilot"):
            state["_values"][feat] = "Normal" if feat == "leak" else "Lit"
            continue
        low, high = BANDS[feat]["Normal"]
        state["_values"][feat] = round(random.uniform(low, high), DECIMALS.get(feat, 1))
    return state


machine_states = {m: new_machine_state(m) for m in MACHINES}

# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------

def weighted_choice(items, weights):
    return random.choices(items, weights=weights, k=1)[0]


def _round(feat, value):
    return round(value, DECIMALS.get(feat, 1))


def _clamp_hard(feat, value):
    lo, hi = HARD_LIMITS[feat]
    return max(lo, min(hi, value))


def add_noise(feat, value):
    """Add small Gaussian sensor noise to a clean value."""
    if not NOISE_ENABLED:
        return value
    std = NOISE_STD.get(feat, 0.0)
    if std <= 0:
        return value
    return _clamp_hard(feat, value + random.gauss(0, std))


def smooth_walk(values, feat, band):
    """Drift a value toward a target band (clean, before noise)."""
    current = values[feat]
    step = STEP_RANGES[feat]
    low, high = band
    nv = current + random.uniform(-step, step)
    if nv < low:
        nv = low + random.uniform(0, step)
    elif nv > high:
        nv = high - random.uniform(0, step)
    nv = _clamp_hard(feat, nv)
    values[feat] = _round(feat, nv)
    return values[feat]


def relax_toward_normal(values, machine_name, exclude=()):
    for feat in MACHINE_FEATURES[machine_name]["features"]:
        if feat in ("leak", "pilot") or feat in exclude:
            continue
        smooth_walk(values, feat, BANDS[feat]["Normal"])


def ack_state_for(priority_level):
    if priority_level in (1, 2):
        return random.choices(["Unacknowledged", "Acknowledged"], weights=[70, 30])[0]
    return random.choices(["Unacknowledged", "Acknowledged"], weights=[20, 80])[0]


def _unit_for(feat):
    if "temp" in feat: return "C"
    if "pressure" in feat: return "bar"
    if "level" in feat: return "%"
    if feat == "feed_flow": return "kg/h"
    if feat == "vibration": return "mm/s"
    if feat in ("current", "panel_current"): return "A"
    if feat == "voltage": return "V"
    if feat == "rpm": return "rpm"
    if feat == "frequency": return "Hz"
    if feat == "valve_position": return "%"
    if feat == "tube_skin_temp" or feat == "bed_temp": return "C"
    if feat == "cw_temp": return "C"
    if feat == "draft_pressure": return "mbar"
    if feat in ("diff_pressure", "reactor_pressure", "air_pressure"): return "bar"
    if feat == "fuel_flow": return "kg/h"
    if feat == "flare_flow": return "kg/h"
    if feat == "basin_level": return "%"
    if feat == "h2_flow": return "Nm3/h"
    if feat == "dew_point": return "C"
    return ""


def threshold_for(feat, final_band):
    """The static-alarm threshold the degradation will eventually cross.
    For a High fault it's the bottom of the High band; for Low, the top
    of the Low band. While the value is on the 'safe' side of this, the
    static gateway alarm has NOT tripped -> early-warning window."""
    if final_band.endswith("Low"):
        return BANDS[feat]["Low"][1]    # top of Low band
    return BANDS[feat]["High"][0]       # bottom of High band


# ----------------------------------------------------------------------
# Degradation engine
# ----------------------------------------------------------------------

def maybe_seed_degradation(machine_name, state, phase=None):
    """Possibly start a new slow fault if none is active.
    `phase` scales how often faults start (seed_mult) and how fast they
    develop (speed_mult -> shorter incubation)."""
    if not DEGRADATION_ENABLED or state["_degradation"] is not None:
        return
    seed_mult = phase["seed_mult"] if phase else 1.0
    speed_mult = phase["speed_mult"] if phase else 1.0
    if random.random() > DEGRADATION_SEED_CHANCE * seed_mult:
        return
    owned = set(MACHINE_FEATURES[machine_name]["features"])
    candidates = [m for m in DEGRADATION_MODES if m["root"] in owned]
    if not candidates:
        return
    mode = random.choice(candidates)
    feat = mode["root"]
    normal_lo, normal_hi = BANDS[feat]["Normal"]
    start = state["_values"][feat]
    fb = mode["final"]
    target = sum(BANDS[feat][fb]) / 2.0          # mid of the final band
    threshold = threshold_for(feat, fb)
    # Faster phase -> shorter incubation (faults cross the threshold sooner)
    base_inc = random.randint(*INCUBATION_TICKS)
    incubation = max(3, int(round(base_inc / max(0.1, speed_mult))))
    state["_degradation"] = {
        "mode": mode, "feat": feat, "start": start, "target": target,
        "threshold": threshold, "incubation": incubation, "tick": 0,
        "normal_ref": normal_hi if not fb.endswith("Low") else normal_lo,
        "tripped": False,
    }


def step_degradation(machine_name, state):
    """Advance an active fault one tick. Returns an alarm dict or None.
    The root feature is moved a small fraction toward its target each
    tick; coupled features are dragged proportionally to progress."""
    deg = state["_degradation"]
    if deg is None:
        return None

    values = state["_values"]
    mode, feat = deg["mode"], deg["feat"]
    deg["tick"] += 1
    progress = min(1.0, deg["tick"] / float(deg["incubation"] + 8))  # 0..1

    # Move root feature from start toward target along the progress curve
    new_root = deg["start"] + (deg["target"] - deg["start"]) * progress
    values[feat] = _round(feat, _clamp_hard(feat, new_root))

    # Drag coupled sensors proportionally to progress * gain
    for cfeat, gain in mode["coupled"].items():
        if cfeat not in values:
            continue
        c_lo, c_hi = BANDS[cfeat]["Normal"]
        c_crit_mid = sum(BANDS[cfeat]["Critical_High"]) / 2.0
        base = c_hi
        dragged = base + (c_crit_mid - base) * progress * gain
        values[cfeat] = _round(cfeat, _clamp_hard(cfeat, dragged))

    # Has the root crossed the static threshold yet?
    fb = mode["final"]
    if fb.endswith("Low"):
        crossed = values[feat] <= deg["threshold"]
    else:
        crossed = values[feat] >= deg["threshold"]

    tag = MACHINE_FEATURES[machine_name]["tag"]
    desc = MACHINE_FEATURES[machine_name]["desc"]
    unit = _unit_for(feat)

    if not crossed:
        # INCUBATING: below the static threshold. The static gateway alarm
        # is silent here, but an anomaly detector can already see the drift.
        # We surface this as a low-priority predictive WARNING.
        return {
            "status": "Warning", "alert": mode["warn"], "alarm_type": "Predictive",
            "severity": "Medium", "object_name": tag, "object_description": desc,
            "message": (f"{mode['name']} developing - {feat.replace('_',' ').title()} "
                        f"trending up = {values[feat]} {unit} "
                        f"(static limit {deg['threshold']} {unit} not yet reached)"),
            "predictive": True, "tripped": False,
        }

    # CROSSED: now it's a real static alarm too.
    deg["tripped"] = True
    fully = deg["tick"] >= deg["incubation"]
    severity = "Critical" if fully else "High"
    status = "Critical" if fully else "Warning"
    alert = mode["crit"] if fully else mode["warn"]
    return {
        "status": status, "alert": alert, "alarm_type": "Process",
        "severity": severity, "object_name": tag, "object_description": desc,
        "message": (f"{mode['name']} - {feat.replace('_',' ').title()} = "
                    f"{values[feat]} {unit} (static limit exceeded)"),
        "predictive": False, "tripped": True,
    }


def clear_degradation_if_done(state):
    """Once a fault has fully developed and a few extra ticks pass, the
    operator 'fixes' it: clear the fault so the machine returns to normal."""
    deg = state["_degradation"]
    if deg and deg["tripped"] and deg["tick"] >= deg["incubation"] + 6:
        state["_degradation"] = None
        return True
    return False


# ----------------------------------------------------------------------
# Sudden events (instant alarms)
# ----------------------------------------------------------------------

def maybe_sudden_event(machine_name, state, phase=None):
    sudden_mult = phase["sudden_mult"] if phase else 1.0
    if random.random() > SUDDEN_EVENT_CHANCE * sudden_mult:
        return None
    scns = SUDDEN_SCENARIOS.get(machine_name, [])
    if not scns:
        return None
    scenario = weighted_choice(scns, [s.get("weight", 5) for s in scns])
    values = state["_values"]
    tag = MACHINE_FEATURES[machine_name]["tag"]
    desc = MACHINE_FEATURES[machine_name]["desc"]

    if scenario["kind"] == "safety":
        if "leak" in values:
            values["leak"] = "LEAK"
        atype = "System" if "EMERGENCY" in scenario["alert"] else "Safety"
        return {"status": "Critical", "alert": scenario["alert"], "alarm_type": atype,
                "severity": "Critical", "object_name": tag, "object_description": desc,
                "message": f"{scenario['name']} on {machine_name} ({tag})",
                "predictive": False, "tripped": True}

    if scenario["kind"] == "pilot":
        if "pilot" in values:
            values["pilot"] = "OUT"
        return {"status": "Critical", "alert": scenario["alert"], "alarm_type": "Safety",
                "severity": "Critical", "object_name": tag, "object_description": desc,
                "message": f"{scenario['name']} on {machine_name} ({tag}) - unburned gas release risk",
                "predictive": False, "tripped": True}

    feat = scenario["feature"]
    direction = scenario["dir"]
    severity = "Critical" if scenario.get("always_critical") else random.choice(["High", "Critical"])
    if direction == "High":
        band = BANDS[feat]["Critical_High"] if severity == "Critical" else BANDS[feat]["High"]
    else:
        band = BANDS[feat]["Critical_Low"] if severity == "Critical" else BANDS[feat]["Low"]
    value = smooth_walk(values, feat, band)
    atype = "Electrical" if feat in ("voltage", "panel_current", "current", "frequency") else "Process"
    alert = scenario["crit_alert"] if severity == "Critical" else scenario["alert"]
    status = "Critical" if severity == "Critical" else "Warning"
    return {"status": status, "alert": alert, "alarm_type": atype, "severity": severity,
            "object_name": tag, "object_description": desc,
            "message": f"{scenario['name']} - {feat.replace('_',' ').title()} = {value} {_unit_for(feat)}",
            "predictive": False, "tripped": True}


# ----------------------------------------------------------------------
# Record generation (per tick, per machine)
# ----------------------------------------------------------------------

def dash_value(machine_name, values, column):
    feat = MACHINE_FEATURES[machine_name]["dash"].get(column)
    if feat is None:
        return None
    return values.get(feat)


def generate_next_record(alarm_id, phase=None):
    """Produce ONE record for the given tick id and return it as a dict.

    This is the per-tick logic lifted out of the old main() loop so it can
    be IMPORTED by other programs (e.g. publisher.py). It selects the
    machine round-robin (exactly the same order main() used) and returns a
    single record dict. It does NO printing and NO file writing.

    If `phase` is None the demo-escalation phase is derived automatically
    from elapsed time, so a consumer can simply call
    generate_next_record(alarm_id) and still get the escalating demo arc.
    """
    global _demo_start_time
    if phase is None:
        if _demo_start_time is None:
            _demo_start_time = time.time()
        phase = get_phase(time.time() - _demo_start_time)
    machine_name = MACHINES[(alarm_id - 1) % len(MACHINES)]
    return generate_record(alarm_id, machine_name, phase)


def generate_record(alarm_id, machine_name, phase=None):
    state = machine_states[machine_name]
    values = state["_values"]
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    alarm = None

    # 1) progress any active slow fault, else maybe start one
    if state["_degradation"] is not None:
        alarm = step_degradation(machine_name, state)
        # keep non-faulted sensors near normal
        relax_toward_normal(values, machine_name,
                            exclude=(state["_degradation"]["feat"],
                                     *state["_degradation"]["mode"]["coupled"].keys()))
        clear_degradation_if_done(state)
    else:
        maybe_seed_degradation(machine_name, state, phase)
        if state["_degradation"] is not None:
            alarm = step_degradation(machine_name, state)
        else:
            # 2) no slow fault -> maybe a sudden event, else normal drift
            alarm = maybe_sudden_event(machine_name, state, phase)
            if alarm is None:
                relax_toward_normal(values, machine_name)
                if "leak" in values:
                    values["leak"] = "Normal"
                if "pilot" in values:
                    values["pilot"] = "Lit"

    # 3) default = normal if nothing fired
    if alarm is None:
        alarm = {"status": "Normal", "alert": "None", "alarm_type": "Process",
                 "severity": "Low", "object_name": MACHINE_FEATURES[machine_name]["tag"],
                 "object_description": MACHINE_FEATURES[machine_name]["desc"],
                 "message": "All parameters within normal operating range",
                 "predictive": False, "tripped": False}

    # 4) apply NOISE to everything just before reporting (real DAQ look)
    noisy = {}
    for feat, val in values.items():
        if feat in ("leak", "pilot"):
            noisy[feat] = val
        else:
            noisy[feat] = _round(feat, add_noise(feat, val))

    # 5) persistent alarm lifecycle: ACT -> ACK -> RTN
    severity = alarm["severity"]
    priority_level = PRIORITY_LEVELS[severity]
    if alarm["status"] == "Normal":
        state["_alarm"] = None
        alarm_state, ack = "RTN", "Acknowledged"
    else:
        existing = state["_alarm"]
        if existing is None or existing.get("alert") != alarm["alert"]:
            ack = "Unacknowledged"            # brand-new alarm -> ACT
            alarm_state = "ACT"
        else:
            # same alarm persisting: chance the operator acknowledges it
            ack = existing["ack"]
            if ack == "Unacknowledged" and random.random() < 0.4:
                ack = "Acknowledged"
            alarm_state = "ACT" if ack == "Unacknowledged" else "ACK"
        state["_alarm"] = {"alert": alarm["alert"], "ack": ack}

    record = {
        "Machine": machine_name,
        "Timestamp": timestamp,
        "Temp": dash_value(machine_name, noisy, "Temp"),
        "Pressure": dash_value(machine_name, noisy, "Pressure"),
        "Level": dash_value(machine_name, noisy, "Level"),
        "Flow": dash_value(machine_name, noisy, "Flow"),
        "Status": alarm["status"],
        "Alert": alarm["alert"],
        "features": {f: noisy[f] for f in MACHINE_FEATURES[machine_name]["features"]},
        "alarm_id": alarm_id,
        "scenario_name": alarm["alert"],
        "alarm_type": alarm["alarm_type"],
        "alarm_priority": severity,
        "priority_level": priority_level,
        "alarm_state": alarm_state,
        "ack_state": ack,
        "is_predictive": alarm.get("predictive", False),
        "object_name": alarm["object_name"],
        "object_description": alarm["object_description"],
        "message": alarm["message"],
    }
    return record


# ----------------------------------------------------------------------
# Live console output
# ----------------------------------------------------------------------

HEADER = (
    f"{'Machine':<20}{'Timestamp':<20}{'Temp':>8}{'Pressure':>10}{'Level':>8}{'Flow':>8}"
    f"  {'Status':<9}{'State':<5}{'P':<2}{'Alert'}"
)


def fmt(value, width, prec=1):
    if value is None:
        return f"{'--':>{width}}"
    return f"{value:>{width}.{prec}f}"


def print_live_row(record):
    pred = "*" if record["is_predictive"] else " "   # * = predictive early warning
    line = (
        f"{record['Machine']:<20}"
        f"{record['Timestamp']:<20}"
        f"{fmt(record['Temp'], 8, 1)}"
        f"{fmt(record['Pressure'], 10, 2)}"
        f"{fmt(record['Level'], 8, 1)}"
        f"{fmt(record['Flow'], 8, 1)}"
        f"  {record['Status']:<9}{record['alarm_state']:<5}{pred:<2}{record['Alert']}"
    )
    print(line)


# ----------------------------------------------------------------------
# Main loop
# ----------------------------------------------------------------------

def main():
    global _demo_start_time, _current_phase_index
    print("Starting LIVE Refinery / Warehouse Monitoring Feed (v3.1 - 16 assets, escalating demo)")
    print(f"Monitoring units: {', '.join(MACHINES)}")
    print("Legend:  State = ACT/ACK/RTN   '*' = predictive early-warning (below static limit)")
    if ESCALATION_ENABLED:
        print("Demo arc: starts CALM, then escalates to an ALARM FLOOD over time.")
    print("Press CTRL+C to stop.\n")
    print(HEADER)
    print("-" * len(HEADER))

    _demo_start_time = time.time()
    alarm_id = 1
    try:
        while TOTAL_RECORDS is None or alarm_id <= TOTAL_RECORDS:
            elapsed = time.time() - _demo_start_time
            phase = get_phase(elapsed)

            record = generate_next_record(alarm_id, phase)
            print_live_row(record)
            with open(OUTPUT_FILE, "a") as f:
                f.write(json.dumps(record) + "\n")
            alarm_id += 1
            time.sleep(INTERVAL_SECONDS)
    except KeyboardInterrupt:
        print("\nLive feed stopped by user.")
        print(f"Records written to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()