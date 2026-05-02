"""Gemini-powered planning helpers with deterministic fallbacks."""

import json
import os
import urllib.error
import urllib.request
from collections import Counter


MODEL = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")


def _read_env_file() -> str | None:
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env_path = os.path.join(base_dir, ".env")

    if not os.path.exists(env_path):
        return None

    with open(env_path, "r", encoding="utf-8") as env_file:
        for line in env_file:
            if line.strip().startswith("GEMINI_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")

    return None


def _api_key() -> str | None:
    return os.getenv("GEMINI_API_KEY") or _read_env_file()


def _candidate_text(data: dict) -> str:
    try:
      return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError):
      return ""


def _call_gemini(prompt: str, schema: dict) -> dict | None:
    key = _api_key()
    if not key:
        return None

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.35,
            "responseMimeType": "application/json",
            "responseJsonSchema": schema,
        },
    }

    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": key,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=18) as response:
            data = json.loads(response.read().decode("utf-8"))
            text = _candidate_text(data)
            return json.loads(text) if text else None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError):
        return None


def _normalise(code: str) -> str:
    return str(code or "").strip().upper()


def _course_units(engine, codes: list[str]) -> int:
    return sum(engine.courses.get(_normalise(code), {}).get("units", 6) for code in codes)


def _course_matches(course: dict, interests: list[str]) -> list[str]:
    course_interests = {item.lower(): item for item in course.get("areas_of_interest", [])}
    return [
        course_interests[item.lower()]
        for item in interests
        if item.lower() in course_interests
    ]


def _fallback_interests(payload: dict, engine) -> list[dict]:
    student = payload.get("student", {})
    program = engine.programs.get(_normalise(student.get("degree_code")), {})
    major = engine.majors.get(_normalise(student.get("major_code")), {})

    relevant = set()
    for rule in program.get("rules", []):
        relevant.update(_normalise(code) for code in rule.get("courses", []))
    relevant.update(_normalise(code) for code in major.get("required_courses", []))
    relevant.update(_normalise(code) for code in major.get("elective_courses", []))

    counts = Counter()
    for code, course in engine.courses.items():
        if relevant and code not in relevant and course.get("subject_area") != "COMP":
            continue
        counts.update(course.get("areas_of_interest", []))

    return [
        {
            "label": label,
            "reason": f"{count} matching courses in the catalogue",
            "confidence": 0.72,
        }
        for label, count in counts.most_common(6)
    ]


def suggest_interests(payload: dict, engine) -> dict:
    fallback = _fallback_interests(payload, engine)
    student = payload.get("student", {})
    program = engine.programs.get(_normalise(student.get("degree_code")), {})
    major = engine.majors.get(_normalise(student.get("major_code")), {})

    schema = {
        "type": "object",
        "properties": {
            "intro_message": {"type": "string"},
            "suggestions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "reason": {"type": "string"},
                        "confidence": {"type": "number"},
                    },
                    "required": ["label", "reason", "confidence"],
                },
            },
        },
        "required": ["intro_message", "suggestions"],
    }
    prompt = f"""
You are helping an ANU student start a degree plan.
Return concise JSON only. Suggest interests that can later steer elective choice.

Student: {json.dumps(student)}
Program: {json.dumps({"code": program.get("code"), "name": program.get("name"), "requirements": program.get("requirements", [])})}
Major: {json.dumps({"code": major.get("code"), "name": major.get("name"), "description": major.get("description")})}
Catalogue interest hints: {json.dumps(payload.get("catalogue_interests", []))}
"""
    response = _call_gemini(prompt, schema)
    suggestions = response.get("suggestions", []) if response else []

    if not suggestions:
        return {
            "source": "local",
            "intro_message": "A few interests stand out from your degree rules and course catalogue.",
            "suggestions": fallback,
        }

    return {
        "source": "gemini",
        "intro_message": response.get("intro_message", ""),
        "suggestions": suggestions[:8],
    }


def _prereq_chain(engine, code: str, completed: set[str], trail: set[str] | None = None) -> list[str]:
    normalised = _normalise(code)
    trail = trail or set()
    if normalised in trail:
        return []

    trail.add(normalised)
    course = engine.courses.get(normalised, {})
    chain = []
    for prereq in course.get("prerequisites", []):
        prereq_code = _normalise(prereq)
        if prereq_code not in completed:
            chain.extend(_prereq_chain(engine, prereq_code, completed, trail))
            chain.append(prereq_code)

    seen = set()
    return [item for item in chain if not (item in seen or seen.add(item))]


def _fallback_electives(payload: dict, engine, limit: int = 8) -> list[dict]:
    student = payload.get("student", {})
    interests = student.get("interests", [])
    completed = set(_normalise(code) for code in student.get("completed_courses", []))
    planned = set(
        _normalise(code)
        for semester in payload.get("plan", {}).get("semesters", [])
        for code in semester.get("courses", [])
    )
    major = engine.majors.get(_normalise(student.get("major_code")), {})
    major_pool = set(
        _normalise(code)
        for code in major.get("required_courses", []) + major.get("elective_courses", [])
    )

    ranked = []
    for code, course in engine.courses.items():
        if code in completed or code in planned:
            continue
        if any(_normalise(item) in completed for item in course.get("incompatible", [])):
            continue

        matches = _course_matches(course, interests)
        score = len(matches) * 12
        if code in major_pool:
            score += 10
        if course.get("level", 1000) >= 3000:
            score += 3
        if score <= 0:
            score = 1

        chain = _prereq_chain(engine, code, completed | planned)
        ranked.append((score - len(chain), course, chain, matches))

    ranked.sort(key=lambda item: item[0], reverse=True)
    electives = []
    for _, course, chain, matches in ranked[:limit]:
        reason = "Matches your interests" if matches else "Fills units while preserving prerequisite order"
        if matches:
            reason = f"Matches {', '.join(matches[:2])}"
        electives.append(
            {
                "code": course["code"],
                "reason": reason,
                "prerequisites": chain,
                "suggested_timing": "Place after prerequisites are complete",
                "risk": "Medium" if chain else "Low",
            }
        )

    return electives


def suggest_electives(payload: dict, engine) -> dict:
    fallback = _fallback_electives(payload, engine)
    student = payload.get("student", {})
    candidate_context = [
        {
            "code": item["code"],
            "name": engine.courses.get(item["code"], {}).get("name"),
            "prerequisites": item["prerequisites"],
            "reason": item["reason"],
        }
        for item in fallback[:12]
    ]
    schema = {
        "type": "object",
        "properties": {
            "plan_notes": {"type": "string"},
            "electives": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "code": {"type": "string"},
                        "reason": {"type": "string"},
                        "prerequisites": {"type": "array", "items": {"type": "string"}},
                        "suggested_timing": {"type": "string"},
                        "risk": {"type": "string"},
                    },
                    "required": ["code", "reason", "prerequisites", "suggested_timing", "risk"],
                },
            },
        },
        "required": ["plan_notes", "electives"],
    }
    prompt = f"""
Suggest ANU electives for this student. Choose only from the candidate list.
Account for prerequisite chains and the user's interests/preferences.
Return JSON only.

Student: {json.dumps(student)}
Current plan issues: {json.dumps(payload.get("issues", []))}
Candidate electives: {json.dumps(candidate_context)}
"""
    response = _call_gemini(prompt, schema)
    electives = response.get("electives", []) if response else []
    electives = [item for item in electives if _normalise(item.get("code")) in engine.courses]

    if not electives:
        return {
            "source": "local",
            "plan_notes": "Local recommendations are ranked by interests, prerequisites, and degree fit.",
            "electives": fallback,
        }

    return {
        "source": "gemini",
        "plan_notes": response.get("plan_notes", ""),
        "electives": electives[:8],
    }


def optimise_plan(payload: dict, engine) -> dict:
    fallback = _fallback_electives(payload, engine, limit=6)
    validation = payload.get("validation", {})
    student = payload.get("student", {})
    preferences = payload.get("preferences", {})
    recommended = [item["code"] for item in fallback[:4]]

    schema = {
        "type": "object",
        "properties": {
            "plan_strategy": {"type": "string"},
            "actions": {"type": "array", "items": {"type": "string"}},
            "recommended_courses": {"type": "array", "items": {"type": "string"}},
            "warnings": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["plan_strategy", "actions", "recommended_courses", "warnings"],
    }
    prompt = f"""
You are the smart optimise button for a degree planner.
Recommend concrete repairs that help complete the progress bar while matching preferences.
Return JSON only. Recommended courses must be real course codes from the provided candidates.

Student: {json.dumps(student)}
Preferences: {json.dumps(preferences)}
Validation: {json.dumps({"issues": validation.get("issues", []), "warnings": validation.get("warnings", []), "plannedProgress": validation.get("plannedProgress")})}
Candidate courses: {json.dumps(fallback)}
"""
    response = _call_gemini(prompt, schema)
    if not response:
        return {
            "source": "local",
            "plan_strategy": "Rebuild around prerequisite order, workload target, and high-fit electives.",
            "actions": [
                "Move courses after missing prerequisites.",
                "Fill unit gaps with electives that match the quiz preferences.",
                "Respect semester availability before adding stretch courses.",
            ],
            "recommended_courses": recommended,
            "warnings": validation.get("warnings", []),
        }

    valid_codes = [
        _normalise(code)
        for code in response.get("recommended_courses", [])
        if _normalise(code) in engine.courses
    ]
    if not valid_codes:
        valid_codes = recommended

    return {
        "source": "gemini",
        "plan_strategy": response.get("plan_strategy", ""),
        "actions": response.get("actions", []),
        "recommended_courses": valid_codes[:6],
        "warnings": response.get("warnings", []),
    }
