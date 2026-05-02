# DegreeFlow — ANU Degree Navigator

An interactive degree planning platform for ANU students. Visualise your degree as a flowchart, check prerequisites, track progress, get AI-powered elective suggestions, and optimise your study plan.

## Stack

- **Frontend**: React 18, React Router v6, single `App.js` (all pages in one file), `index.css` (all styles)
- **Backend**: Python FastAPI, port 8000, serves `/api/*` endpoints
- **AI**: Google Gemini API (`gemini-2.0-flash` or `gemini-1.5-flash`) — key in `.env` as `REACT_APP_GEMINI_API_KEY` (frontend) and `GEMINI_API_KEY` (backend)
- **Data**: JSON files in `/data/` — `courses.json`, `programs.json`, `majors.json`, `minors.json`, `specialisations.json`
- **DB**: `anu_degrees.db` (SQLite, not currently used by the app — data served from JSON)

## Running Locally

```bash
# Backend
cd backend && pip install -r requirements.txt && uvicorn main:app --reload --port 8000

# Frontend (proxies /api/* to :8000)
cd frontend && npm install && npm start
```

## Architecture

### Frontend (`frontend/src/App.js`)
All pages live in a single `App.js` file as named function components, exported via React Router. Global state lives in `AppContext` / `AppProvider`. The frontend also has a client-side rules engine (fallback when backend is unavailable) that mirrors the backend logic.

Pages: `HomePage`, `SetupPage`, `DashboardPage`, `CoursesPage`, `PlannerPage`, `AuditPage`

New pages should be added as function components in `App.js` with a corresponding `<Route>` in the `<Routes>` block and a `Nav` link.

### Backend (`backend/`)
- `main.py` — FastAPI routes, all `GET /api/*` and `POST /api/*` endpoints
- `models/schemas.py` — Pydantic models (`StudentProfile`, `PlanRequest`, etc.)
- `services/rules_engine.py` — `RulesEngine` class: eligibility, validation, plan generation, graduation audit, risk assessment, recommendations

### Data Schema

**Course** fields: `code`, `name`, `description`, `units`, `level` (1000/2000/3000/4000), `prerequisites` (list of codes), `corequisites`, `incompatible`, `terms_offered` (["S1","S2","Summer","Winter","Autumn"]), `assessment` (list of strings), `workload` (string), `areas_of_interest` (list), `learning_outcomes`, `is_stem`, `url`, `school`, `college`, `career`

**Program** fields: `code`, `name`, `total_units`, `career`, `rules` (list of rule objects), `available_majors`, `available_minors`

Rule types: `course_requirement` (core courses), `level_requirement` (min units at 3000+), `level_cap` (max units at 1000-level)

**Major/Minor** fields: `code`, `name`, `units`, `required_courses`, `elective_courses`

## Design System (`frontend/src/index.css`)

Dark theme. CSS custom properties on `:root`:
- Colors: `--bg`, `--bg-card`, `--bg-card-hover`, `--bg-input`, `--border`, `--border-hover`
- Text: `--text`, `--text-muted`, `--text-dim`
- Accents: `--accent` (blue `#4f9cf7`), `--green` (#34d399), `--red` (#f87171), `--amber` (#fbbf24), `--purple` (#a78bfa)
- Each color has a `-dim` variant (rgba at 12% opacity) for backgrounds
- Fonts: `--font-display` (DM Serif Display), `--font-body` (DM Sans)
- `--radius` (12px), `--radius-sm` (8px)

Utility classes: `.card`, `.btn`, `.btn-primary`, `.btn-outline`, `.btn-sm`, `.btn-danger`, `.btn-success`, `.badge`, `.badge-green/red/amber/blue/purple`, `.grid`, `.grid-2/3/4`, `.input`, `.select`, `.label`, `.form-group`, `.alert`, `.alert-info/success/warning/danger`, `.progress-bar`, `.progress-fill`, `.course-chip`, `.semester-grid`, `.semester-card`, `.check-item`

## AI Integration (Gemini)

Key stored in `.env`. In React, access via `process.env.REACT_APP_GEMINI_API_KEY`. In Python, via `os.environ["GEMINI_API_KEY"]`.

Planned AI features:
1. **Interest suggestions** — after degree selection, suggest interest tags based on the program
2. **Elective recommendations** — suggest electives from `data/courses.json` that match interests, accounting for prerequisites
3. **Smart optimiser button** — given current plan + user preferences (workload, target semesters), rearrange/replace courses to optimise completion

Use `@google/generative-ai` npm package in frontend, or `google-generativeai` pip package in backend.

Recommended model: `gemini-2.0-flash-exp` or `gemini-1.5-flash` for speed/cost.

## Planned New Features (from /batch spec)

- **Onboarding flow** — multi-step wizard replacing the Setup page: degree → major/minor → interests quiz → AI suggestions
- **Flowchart/diagram view** — top-to-bottom timeline of all courses, colour-coded by state (completed/in-progress/planned/invalid/locked), with drag-and-drop, zoom, legend, search overlay
- **Course states**: completed (green), in-progress (blue), planned (accent), invalid (red), locked/compulsory (amber)
- **Connector types in flowchart**: dotted = prerequisite, solid = corequisite, grey = future course
- **Workload tags** per course chip: exam-heavy vs assignment-heavy (from `assessment` field)
- **Progress overlay**: dual-indicator progress bar (where you should be vs where plan is at)
- **Issues panel**: red/green status box with AI "smart" button when problems detected
- **Intro/landing page redesign** with quiz component

## Conventions

- No TypeScript — plain JS/JSX
- No CSS modules — all styles in `index.css` using the existing design tokens
- New components go in `App.js` unless the file gets unmanageable, then extract to `frontend/src/components/`
- Prefer client-side logic (in `AppContext`) for speed; use backend API for heavy computation
- Data is immutable at runtime — no writes to JSON files from the app
- `programs.json` is currently empty (0 programs) — the data in `frontend/src/data/programs.json` is the source used by the frontend
- Student state persists in React context only (no localStorage yet)

## Key Files

| Path | Purpose |
|------|---------|
| `frontend/src/App.js` | All pages, routing, context, client-side logic |
| `frontend/src/index.css` | All styles + design system |
| `frontend/src/utils/api.js` | Backend API client |
| `backend/main.py` | FastAPI routes |
| `backend/services/rules_engine.py` | Core validation/planning logic |
| `backend/models/schemas.py` | Pydantic schemas |
| `data/courses.json` | Full ANU course catalogue |
| `data/majors.json` | Major definitions |
| `data/minors.json` | Minor definitions |
| `data/programs.json` | Degree programs (currently empty — use frontend copy) |
