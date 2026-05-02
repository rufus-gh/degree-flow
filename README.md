# DegreeFlow — ANU Degree Navigator

A university degree planning and navigation platform for Australian National University (ANU) students. Plan your degree, explore courses, check prerequisites, generate valid study plans, and audit graduation readiness.

## Architecture

```
degreeflow/
├── scraper/              # Python scraper for ANU Programs & Courses
│   ├── scrape_anu.py     # Main scraper (BeautifulSoup)
│   └── requirements.txt
├── backend/              # FastAPI API server
│   ├── main.py           # API routes
│   ├── models/           # Pydantic schemas
│   ├── services/         # Rules engine, planner
│   └── requirements.txt
├── frontend/             # React frontend
│   ├── src/
│   │   ├── App.js        # Main app with routing + all pages
│   │   ├── data/         # JSON data files (courses, programs, majors)
│   │   └── utils/        # API client
│   └── package.json
├── data/                 # Scraped data (JSON)
├── docker-compose.yml
└── README.md
```

## Quick Start

### 1. Scrape ANU Data (optional — sample data included)

```bash
cd scraper
pip install -r requirements.txt
python scrape_anu.py --year 2026 --type all
```

This scrapes all programs, courses, majors, minors, and specialisations from
`programsandcourses.anu.edu.au` and saves them as JSON in `../data/`.

Flags:
- `--year 2026` — handbook year
- `--type courses|programs|majors|all` — what to scrape
- `--codes COMP1100 COMP1110` — scrape specific codes
- `--rate 1.5` — seconds between requests (be kind to ANU servers)

### 2. Run the Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

API docs at http://localhost:8000/docs

### 3. Run the Frontend

```bash
cd frontend
npm install
npm start
```

Opens at http://localhost:3000 (proxies API to :8000)

### 4. Production Build

```bash
cd frontend
npm run build
# Serve the build/ folder with any static server
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/programs` | List all degree programs |
| GET | `/api/programs/{code}` | Get program details |
| GET | `/api/courses` | List courses (filterable) |
| GET | `/api/courses/{code}` | Get course details |
| GET | `/api/majors` | List all majors |
| GET | `/api/minors` | List all minors |
| POST | `/api/eligibility/{code}` | Check course eligibility |
| POST | `/api/generate-plan` | Generate study plan |
| POST | `/api/graduation-audit` | Check graduation readiness |
| POST | `/api/recommend` | Get course recommendations |
| POST | `/api/what-if/change-major` | Simulate major change |
| POST | `/api/assess-risks` | Assess plan risks |

## Features

- **Degree Setup** — Select program, major, minor, enter completed courses
- **Dashboard** — Progress tracking, requirement status, available courses
- **Course Explorer** — Search, filter, check eligibility with explanations
- **Study Planner** — Auto-generate valid semester plans respecting prerequisites
- **Graduation Audit** — Check all requirements with course usage mapping
- **Risk Warnings** — Workload, prerequisite chains, availability warnings
- **What-If Simulator** — Compare major changes, minor additions

## Rules Engine

The rules engine validates plans against:
- Total unit requirements
- Core course requirements
- Major/minor requirements
- 1000-level unit caps
- 3000+ level minimums
- Prerequisite chains
- Incompatible course conflicts
- Semester availability

## Data Model

**Course**: code, name, description, units, level, prerequisites, corequisites,
incompatibles, terms_offered, assessment, workload, areas_of_interest

**Program**: code, name, total_units, rules (unit reqs, level reqs, core courses),
available majors/minors/specialisations

**Major/Minor**: code, name, units, required_courses, elective_courses, rules

## Extending

To add more data:
1. Run the scraper with additional codes or subject prefixes
2. Manually edit JSON files in `data/`
3. The frontend and backend automatically pick up new data

To add a new university:
1. Create a new scraper targeting that university's website
2. Output data in the same JSON schema
3. The rules engine and frontend work with any data in the correct format

## Tech Stack

- **Scraper**: Python, BeautifulSoup, requests
- **Backend**: Python, FastAPI, Pydantic
- **Frontend**: React, React Router
- **Data**: JSON files (can be migrated to PostgreSQL)

## License

MIT
