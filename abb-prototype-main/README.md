# NexOps — AI-Powered Industrial Control Room Platform

> **Penguins · ABB Accelerator 2026**  
> AI-powered alarm intelligence, automated engineer dispatch, and institutional memory for industrial control rooms.


---

## What is NexOps?

NexOps is the intelligence layer between machine data and human action. Industrial control rooms today are overwhelmed — averaging **3,500 alarms per shift**, running **10× over EEMUA 191** standards. NexOps cuts through the noise with AI-prioritized alarms, automated engineer dispatch, and institutional memory that never retires.

Built with a **gray-first interface** where color only signals criticality — no distractions, just decisions.

---

## 🗺️ Version Roadmap

| Version | Status | Description |
|---------|--------|-------------|
| **v1.0** | ✅ Completed | UI for all three roles — Landing page, Admin, Engineer, Technician |
| **v2.0** | 🔄 In Progress | Backend integration, live data, authentication |
| **v3.0** | 🔄 In Progress | Final release — Full edge deployment, ARIA AI model, production ready |

---

## ✅ Version 1.0 — Completed

### 🏠 Landing Page
- Hero section with live control room metrics (alarm count, response time stats, EEMUA 191 benchmark)
- Live feed ticker showing real-time machine alerts (M-07, M-12, M-03) with ARIA AI insight tags
- Role selection cards — Admin, Engineer, Technician — each routing to role-based login
- Raspberry Pi / MQTT / WebSocket edge-ready badge display

---

### 👥 Three Role UIs

---

#### 🔴 Admin — Plant Manager

**1. Employee Analytics**
| Field | Details |
|-------|---------|
| Name | Employee full name |
| No. of Assigned Tasks | Total tasks currently assigned |
| Avg Task Time | Average time taken to complete a task |

**2. Machine Analytics**
| Field | Details |
|-------|---------|
| No. of Machines | Total machines under monitoring |
| Machine Live Observation | Real-time status feed per machine |
| Machine Performance | Performance score / uptime metrics |

**3. Employee Data Update Panel**
- Manager enters a **User ID** to search for an employee
- Options to **Search**, **Add**, or **Delete** employee records

---

#### 🔵 Engineer — Field Engineer

**1. High Risk Buzz**
- Prominent alert panel highlighting machines or zones that have crossed critical thresholds
- Color-coded by severity — Critical / High / Medium

**2. Technician Task View**
- View all active technician tasks across the team
- If a technician is **unavailable**, the Field Engineer can **reassign** the task to another available employee directly from this view

**3. ARIA Chatbot**
- Conversational AI assistant for diagnosing machine issues, suggesting fixes, and querying historical alarm data

---

#### 🟡 Technician

**1. Task Assigned Notification + Start Button**
- Technician receives a notification when a new task is assigned
- **Start** button begins the task and logs the start timestamp

**2. Problem Input Form**
- Technician describes the on-site problem observed
- Input is stored against the task record for institutional memory

**3. Task Completed Button**
- Logs completion timestamp, calculates time taken, and updates task status to resolved

---

## 🔄 Version 2.0 — In Progress

- Backend integration with database (task records, employee data, machine logs)
- Live MQTT data feed from Raspberry Pi hardware
- Authentication with role-based access control
- Real-time WebSocket push notifications for alerts and task assignments
- Photo capture on task resolve (camera API)

---

## 🔄 Version 3.0 — Final (In Progress)

- ARIA AI backend — real alarm classification and predictive diagnostics model
- Full edge deployment (Raspberry Pi + MQTT + WebSocket)
- Mobile-optimized technician view (PWA)
- Alarm escalation engine with auto-dispatch
- Historical trend charts and report export (PDF / CSV)
- Production hardening, performance optimization, and security audit

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| UI Components | shadcn/ui |
| Prototype Host | Lovable.app |
| Edge Protocol | MQTT · WebSocket |
| Hardware Target | Raspberry Pi |

---

## 📊 Key Metrics (Targets)

| Metric | Value |
|--------|-------|
| Alarms per shift (current industry avg) | 3,500 |
| EEMUA 191 overrun | 10× |
| Target response time reduction | 60% |
| Roles supported | 3 (Admin, Engineer, Technician) |
| Deployment target | Edge (Raspberry Pi + MQTT) |

---

## 👨‍💻 Team

**Penguins** — KPR Institute of Engineering and Technology  
Built for the **ABB Accelerator 2026** program.

---

## 📄 License

This project is a prototype built for the ABB Accelerator 2026. All rights reserved © Penguins 2026.
