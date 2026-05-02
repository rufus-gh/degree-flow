"""
DegreeFlow API — FastAPI Backend
Provides endpoints for course data, degree validation, plan generation,
graduation audits, and what-if analysis for ANU students.
"""

import json
import os
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from models.schemas import StudentProfile, PlanRequest
from services.ai_service import optimise_plan, suggest_electives, suggest_interests
from services.rules_engine import RulesEngine

app = FastAPI(
    title="DegreeFlow API",
    description="ANU Degree Navigation and Planning Platform",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "data")

engine = RulesEngine()


def _load_json(name: str) -> dict:
    path = os.path.join(DATA_DIR, f"{name}.json")

    if not os.path.exists(path):
        return {}

    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


# ── Data endpoints ───────────────────────────────────────────────────

@app.get("/api/programs")
def list_programs(career: Optional[str] = None):
    """List all degree programs."""
    programs = _load_json("programs")

    if career:
        programs = {
            k: v
            for k, v in programs.items()
            if v.get("career", "").lower() == career.lower()
        }

    return {"programs": list(programs.values()), "count": len(programs)}


@app.get("/api/programs/{code}")
def get_program(code: str):
    """Get a specific program by code."""
    programs = _load_json("programs")
    program = programs.get(code.upper())

    if not program:
        raise HTTPException(status_code=404, detail=f"Program {code} not found")

    return program


@app.get("/api/courses")
def list_courses(
    subject: Optional[str] = None,
    level: Optional[int] = None,
    semester: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(default=50, le=500),
    offset: int = 0,
):
    """List courses with optional filters."""
    courses = _load_json("courses")
    results = list(courses.values())

    if subject:
        results = [
            c for c in results
            if c.get("subject_area", "").upper() == subject.upper()
        ]

    if level:
        results = [
            c for c in results
            if c.get("level") == level
        ]

    if semester:
        results = [
            c for c in results
            if semester in c.get("terms_offered", [])
        ]

    if search:
        q = search.lower()
        results = [
            c for c in results
            if q in c.get("name", "").lower()
            or q in c.get("code", "").lower()
            or q in c.get("description", "").lower()
        ]

    total = len(results)
    results = results[offset:offset + limit]

    return {
        "courses": results,
        "total": total,
        "offset": offset,
        "limit": limit,
    }


@app.get("/api/courses/{code}")
def get_course(code: str):
    """Get a specific course by code."""
    courses = _load_json("courses")
    course = courses.get(code.upper())

    if not course:
        raise HTTPException(status_code=404, detail=f"Course {code} not found")

    return course


@app.get("/api/majors")
def list_majors():
    """List all majors."""
    majors = _load_json("majors")
    return {"majors": list(majors.values()), "count": len(majors)}


@app.get("/api/majors/{code}")
def get_major(code: str):
    """Get a specific major by code."""
    majors = _load_json("majors")
    major = majors.get(code.upper())

    if not major:
        raise HTTPException(status_code=404, detail=f"Major {code} not found")

    return major


@app.get("/api/minors")
def list_minors():
    """List all minors."""
    minors = _load_json("minors")
    return {"minors": list(minors.values()), "count": len(minors)}


@app.get("/api/minors/{code}")
def get_minor(code: str):
    """Get a specific minor by code."""
    minors = _load_json("minors")
    minor = minors.get(code.upper())

    if not minor:
        raise HTTPException(status_code=404, detail=f"Minor {code} not found")

    return minor


# ── Eligibility & validation endpoints ────────────────────────────────

@app.post("/api/eligibility/{course_code}")
def check_eligibility(course_code: str, student: StudentProfile):
    """Check if a student is eligible to take a course."""
    result = engine.check_course_eligibility(
        course_code,
        student.completed_courses,
        student.current_courses,
    )
    return result


@app.post("/api/validate-plan")
def validate_plan(request: PlanRequest):
    """Validate a student's plan against degree rules."""
    planned = request.student.completed_courses

    result = engine.validate_plan(
        request.student.degree_code,
        request.student.completed_courses,
        planned,
        request.student.major_code,
        request.student.minor_code,
    )

    return result


# ── Plan generation ──────────────────────────────────────────────────

@app.post("/api/generate-plan")
def generate_plan(request: PlanRequest):
    """Generate a semester-by-semester study plan."""
    result = engine.generate_plan(
        request.student.degree_code,
        request.student.completed_courses,
        request.student.major_code,
        request.student.minor_code,
        request.courses_per_semester,
        request.num_semesters,
    )

    return result


# ── Graduation audit ─────────────────────────────────────────────────

@app.post("/api/graduation-audit")
def graduation_audit(student: StudentProfile):
    """Check graduation readiness."""
    result = engine.graduation_audit(
        student.degree_code,
        student.completed_courses,
        student.major_code,
        student.minor_code,
    )

    return result


# ── Recommendations ──────────────────────────────────────────────────

@app.post("/api/recommend")
def recommend_courses(student: StudentProfile, limit: int = 10):
    """Recommend courses based on student profile."""
    result = engine.recommend_courses(
        student.completed_courses,
        student.interests,
        student.degree_code,
        student.major_code,
        limit,
    )

    return {"recommendations": result}


# ── Gemini AI planning helpers ───────────────────────────────────────

@app.post("/api/ai/interests")
def ai_suggest_interests(payload: dict):
    """Suggest interest tags after the student chooses a degree."""
    return suggest_interests(payload, engine)


@app.post("/api/ai/electives")
def ai_suggest_electives(payload: dict):
    """Suggest electives that fit interests and prerequisite chains."""
    return suggest_electives(payload, engine)


@app.post("/api/ai/optimise-plan")
def ai_optimise_plan(payload: dict):
    """Return smart plan repair actions and course recommendations."""
    return optimise_plan(payload, engine)


# ── What-if analysis ─────────────────────────────────────────────────

@app.post("/api/what-if/change-major")
def what_if_major(student: StudentProfile, new_major: str = Query(...)):
    """Simulate changing major."""
    if not student.major_code:
        raise HTTPException(status_code=400, detail="Current major_code is required")

    result = engine.what_if_change_major(
        student.degree_code,
        student.completed_courses,
        student.major_code,
        new_major,
    )

    return result


# ── Risk assessment ──────────────────────────────────────────────────

@app.post("/api/assess-risks")
def assess_risks(request: PlanRequest):
    """Assess risks in a study plan."""
    plan = engine.generate_plan(
        request.student.degree_code,
        request.student.completed_courses,
        request.student.major_code,
        request.student.minor_code,
        request.courses_per_semester,
        request.num_semesters,
    )

    risks = engine.assess_risks(
        plan.get("semesters", []),
        request.student.completed_courses,
    )

    return {"risks": risks}


# ── Metadata ─────────────────────────────────────────────────────────

@app.get("/api/metadata")
def get_metadata():
    """Get system metadata."""
    return {
        "university": "Australian National University",
        "year": 2026,
        "courses_count": len(_load_json("courses")),
        "programs_count": len(_load_json("programs")),
        "majors_count": len(_load_json("majors")),
        "minors_count": len(_load_json("minors")),
    }


@app.get("/api/subject-areas")
def get_subject_areas():
    """Get list of subject area prefixes."""
    courses = _load_json("courses")
    areas = set()

    for course in courses.values():
        subject_area = course.get("subject_area", "")
        if subject_area:
            areas.add(subject_area)

    return {"subject_areas": sorted(list(areas))}


# ── Health check ─────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "DegreeFlow API"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
