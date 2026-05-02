"""Pydantic models for the DegreeFlow API."""
from pydantic import BaseModel
from typing import Optional


class StudentProfile(BaseModel):
    degree_code: str
    major_code: Optional[str] = None
    minor_code: Optional[str] = None
    specialisation_code: Optional[str] = None
    handbook_year: int = 2026
    completed_courses: list[str] = []
    current_courses: list[str] = []
    failed_courses: list[str] = []
    transfer_credits: list[str] = []
    study_mode: str = "Full-time"  # Full-time or Part-time
    interests: list[str] = []
    preferred_workload: str = "balanced"  # light, balanced, challenging


class PlanRequest(BaseModel):
    student: StudentProfile
    num_semesters: int = 6
    courses_per_semester: int = 4
    avoid_courses: list[str] = []
    prefer_courses: list[str] = []


class CourseEligibility(BaseModel):
    course_code: str
    eligible: bool
    reasons: list[str]
    missing_prerequisites: list[str] = []
    incompatible_completed: list[str] = []


class GraduationAudit(BaseModel):
    can_graduate: bool
    total_units_completed: int
    total_units_required: int
    missing_requirements: list[dict]
    completed_requirements: list[dict]
    warnings: list[str]
    earliest_graduation: Optional[str] = None


class SemesterPlan(BaseModel):
    year: int
    semester: str
    courses: list[str]
    total_units: int
    warnings: list[str] = []


class DegreePlan(BaseModel):
    semesters: list[SemesterPlan]
    total_units: int
    graduation_semester: str
    warnings: list[str]
    risk_level: str  # Low, Medium, High, Critical
    explanations: list[str]


class WhatIfResult(BaseModel):
    scenario: str
    graduation_date: str
    extra_courses: int
    dropped_courses: int
    risk_level: str
    warnings: list[str]
    new_plan: Optional[DegreePlan] = None


class RiskWarning(BaseModel):
    type: str  # prerequisite, availability, workload, graduation, rule
    level: str  # Low, Medium, High, Critical
    message: str
    affected_courses: list[str] = []
