"""
Rules Engine for ANU Degree Validation.
Validates student plans against degree requirements, prerequisites, and university rules.
"""

import json
import os

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")


def _load(name: str) -> dict:
    path = os.path.join(DATA_DIR, f"{name}.json")

    if not os.path.exists(path):
        return {}

    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


class RulesEngine:
    def __init__(self):
        self.courses = _load("courses")
        self.programs = _load("programs")
        self.majors = _load("majors")
        self.minors = _load("minors")

    def reload(self):
        """Reload data from disk."""
        self.__init__()

    # ── Course eligibility ───────────────────────────────────────────

    def check_course_eligibility(
        self,
        course_code: str,
        completed: list[str],
        current: list[str] = None,
    ) -> dict:
        """Check if a student can take a specific course."""
        course_code = course_code.upper()
        current = current or []
        all_done = set(c.upper() for c in completed)

        result = {
            "course_code": course_code,
            "eligible": True,
            "reasons": [],
            "missing_prerequisites": [],
            "incompatible_completed": [],
        }

        course = self.courses.get(course_code)

        if not course:
            result["eligible"] = False
            result["reasons"].append(f"Course {course_code} not found in the database.")
            return result

        if course_code in all_done:
            result["eligible"] = False
            result["reasons"].append(f"You have already completed {course_code}.")
            return result

        if course_code in [c.upper() for c in current]:
            result["eligible"] = False
            result["reasons"].append(f"You are currently enrolled in {course_code}.")
            return result

        prereqs = course.get("prerequisites", [])

        for prereq in prereqs:
            if prereq.upper() not in all_done:
                result["eligible"] = False
                result["missing_prerequisites"].append(prereq)

        if result["missing_prerequisites"]:
            missing = ", ".join(result["missing_prerequisites"])
            result["reasons"].append(
                f"You cannot take {course_code} because you have not completed "
                f"the prerequisite(s): {missing}."
            )

        incompatibles = course.get("incompatible", [])

        for incompat in incompatibles:
            if incompat.upper() in all_done:
                result["eligible"] = False
                result["incompatible_completed"].append(incompat)
                result["reasons"].append(
                    f"You cannot take {course_code} because you have already "
                    f"completed the incompatible course {incompat}."
                )

        if result["eligible"]:
            prereq_text = ""
            if prereqs:
                prereq_text = f" You have met the prerequisites: {', '.join(prereqs)}."

            result["reasons"].append(
                f"You are eligible to take {course_code}.{prereq_text}"
            )

        return result

    # ── Degree requirement validation ────────────────────────────────

    def validate_plan(
        self,
        program_code: str,
        completed: list[str],
        planned: list[str] = None,
        major_code: str = None,
        minor_code: str = None,
    ) -> dict:
        """Validate a student's completed + planned courses against degree rules."""
        program_code = program_code.upper()
        planned = planned or []
        all_courses = set(c.upper() for c in completed + planned)

        program = self.programs.get(program_code)

        if not program:
            return {
                "valid": False,
                "errors": [f"Program {program_code} not found."],
                "warnings": [],
            }

        errors = []
        warnings = []

        total_units = sum(
            self.courses.get(c, {}).get("units", 6)
            for c in all_courses
            if c in self.courses
        )

        required_units = program.get("total_units", 144)

        if total_units < required_units:
            deficit = required_units - total_units
            errors.append(
                f"Plan has {total_units} units but requires {required_units} "
                f"({deficit} units short)."
            )

        level_1000_units = sum(
            self.courses.get(c, {}).get("units", 6)
            for c in all_courses
            if c in self.courses and self.courses[c].get("level", 0) == 1000
        )

        for rule in program.get("rules", []):
            if rule.get("type") == "level_cap":
                max_units = rule.get("maximum_units", 60)

                if level_1000_units > max_units:
                    errors.append(
                        f"Plan has {level_1000_units} units at 1000-level but "
                        f"the maximum is {max_units} units."
                    )

        level_3000_units = sum(
            self.courses.get(c, {}).get("units", 6)
            for c in all_courses
            if c in self.courses and self.courses[c].get("level", 0) >= 3000
        )

        for rule in program.get("rules", []):
            if rule.get("type") == "level_requirement":
                min_units = rule.get("minimum_units", 30)

                if level_3000_units < min_units:
                    errors.append(
                        f"Plan has {level_3000_units} units at 3000+ level but "
                        f"requires at least {min_units} units."
                    )

        for rule in program.get("rules", []):
            if rule.get("type") == "course_requirement":
                for course in rule.get("courses", []):
                    if course.upper() not in all_courses:
                        errors.append(
                            f"Missing compulsory course: {course} — "
                            f"{self.courses.get(course, {}).get('name', '')}."
                        )

        if major_code:
            major = self.majors.get(major_code.upper())

            if major:
                major_courses = set(c.upper() for c in all_courses) & set(
                    c.upper()
                    for c in major.get("required_courses", [])
                    + major.get("elective_courses", [])
                )

                major_units = sum(
                    self.courses.get(c, {}).get("units", 6)
                    for c in major_courses
                )

                if major_units < major.get("units", 48):
                    errors.append(
                        f"Major '{major['name']}' requires {major['units']} units "
                        f"but plan only has {major_units} units from the major."
                    )

                for course in major.get("required_courses", []):
                    if course.upper() not in all_courses:
                        errors.append(
                            f"Missing required major course: {course} — "
                            f"{self.courses.get(course, {}).get('name', '')}."
                        )
            else:
                warnings.append(f"Major '{major_code}' not found in database.")

        if minor_code:
            minor = self.minors.get(minor_code.upper())

            if minor:
                minor_courses = set(c.upper() for c in all_courses) & set(
                    c.upper()
                    for c in minor.get("required_courses", [])
                    + minor.get("elective_courses", [])
                )

                minor_units = sum(
                    self.courses.get(c, {}).get("units", 6)
                    for c in minor_courses
                )

                if minor_units < minor.get("units", 24):
                    warnings.append(
                        f"Minor '{minor['name']}' requires {minor['units']} units "
                        f"but plan only has {minor_units} units from the minor."
                    )
            else:
                warnings.append(f"Minor '{minor_code}' not found in database.")

        ordered = list(completed) + list(planned)
        seen = set()

        for course_code in ordered:
            c = course_code.upper()
            course = self.courses.get(c)

            if course:
                for prereq in course.get("prerequisites", []):
                    if prereq.upper() not in seen:
                        warnings.append(
                            f"{c} requires {prereq} as a prerequisite, but {prereq} "
                            f"is not scheduled before it."
                        )

            seen.add(c)

        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
            "total_units": total_units,
            "required_units": required_units,
            "level_1000_units": level_1000_units,
            "level_3000_units": level_3000_units,
        }

    # ── Graduation audit ─────────────────────────────────────────────

    def graduation_audit(
        self,
        program_code: str,
        completed: list[str],
        major_code: str = None,
        minor_code: str = None,
    ) -> dict:
        """Check whether a student is ready to graduate."""
        program = self.programs.get(program_code.upper())

        if not program:
            return {
                "can_graduate": False,
                "missing": [
                    {
                        "type": "program",
                        "description": f"Program {program_code} not found.",
                    }
                ],
                "completed": [],
                "warnings": [],
            }

        completed_set = set(c.upper() for c in completed)
        missing = []
        completed_reqs = []
        warnings = []

        total = sum(
            self.courses.get(c, {}).get("units", 6)
            for c in completed_set
            if c in self.courses
        )

        required = program.get("total_units", 144)

        if total >= required:
            completed_reqs.append(
                {
                    "type": "total_units",
                    "description": f"{total}/{required} units completed",
                }
            )
        else:
            missing.append(
                {
                    "type": "total_units",
                    "description": (
                        f"Need {required - total} more units "
                        f"({total}/{required} completed)"
                    ),
                }
            )

        for rule in program.get("rules", []):
            if rule.get("type") == "course_requirement":
                for course in rule.get("courses", []):
                    name = self.courses.get(course, {}).get("name", course)

                    if course.upper() in completed_set:
                        completed_reqs.append(
                            {
                                "type": "core_course",
                                "description": f"{course} — {name}",
                            }
                        )
                    else:
                        missing.append(
                            {
                                "type": "core_course",
                                "description": f"{course} — {name}",
                            }
                        )

        level_3000 = sum(
            self.courses.get(c, {}).get("units", 6)
            for c in completed_set
            if c in self.courses and self.courses[c].get("level", 0) >= 3000
        )

        for rule in program.get("rules", []):
            if rule.get("type") == "level_requirement":
                req = rule.get("minimum_units", 30)

                if level_3000 >= req:
                    completed_reqs.append(
                        {
                            "type": "level",
                            "description": (
                                f"{level_3000}/{req} units at 3000+ level"
                            ),
                        }
                    )
                else:
                    missing.append(
                        {
                            "type": "level",
                            "description": (
                                f"Need {req - level_3000} more units at 3000+ level "
                                f"({level_3000}/{req})"
                            ),
                        }
                    )

        level_1000 = sum(
            self.courses.get(c, {}).get("units", 6)
            for c in completed_set
            if c in self.courses and self.courses[c].get("level", 0) == 1000
        )

        for rule in program.get("rules", []):
            if rule.get("type") == "level_cap":
                cap = rule.get("maximum_units", 60)

                if level_1000 <= cap:
                    completed_reqs.append(
                        {
                            "type": "level_cap",
                            "description": (
                                f"{level_1000}/{cap} units at 1000-level "
                                f"(within limit)"
                            ),
                        }
                    )
                else:
                    missing.append(
                        {
                            "type": "level_cap",
                            "description": (
                                f"Exceeded 1000-level cap: {level_1000}/{cap} units"
                            ),
                        }
                    )

        if major_code:
            major = self.majors.get(major_code.upper())

            if major:
                major_all = set(
                    c.upper()
                    for c in major.get("required_courses", [])
                    + major.get("elective_courses", [])
                )

                major_done = completed_set & major_all

                major_units = sum(
                    self.courses.get(c, {}).get("units", 6)
                    for c in major_done
                )

                req_units = major.get("units", 48)

                if major_units >= req_units:
                    completed_reqs.append(
                        {
                            "type": "major",
                            "description": (
                                f"Major '{major['name']}': "
                                f"{major_units}/{req_units} units"
                            ),
                        }
                    )
                else:
                    missing.append(
                        {
                            "type": "major",
                            "description": (
                                f"Major '{major['name']}': need "
                                f"{req_units - major_units} more units "
                                f"({major_units}/{req_units})"
                            ),
                        }
                    )

                for course in major.get("required_courses", []):
                    if course.upper() not in completed_set:
                        name = self.courses.get(course, {}).get("name", course)
                        missing.append(
                            {
                                "type": "major_course",
                                "description": (
                                    f"Major required course: {course} — {name}"
                                ),
                            }
                        )
            else:
                warnings.append(f"Major '{major_code}' not found in database.")

        if minor_code:
            minor = self.minors.get(minor_code.upper())

            if minor:
                minor_all = set(
                    c.upper()
                    for c in minor.get("required_courses", [])
                    + minor.get("elective_courses", [])
                )

                minor_done = completed_set & minor_all

                minor_units = sum(
                    self.courses.get(c, {}).get("units", 6)
                    for c in minor_done
                )

                req_units = minor.get("units", 24)

                if minor_units >= req_units:
                    completed_reqs.append(
                        {
                            "type": "minor",
                            "description": (
                                f"Minor '{minor['name']}': "
                                f"{minor_units}/{req_units} units"
                            ),
                        }
                    )
                else:
                    missing.append(
                        {
                            "type": "minor",
                            "description": (
                                f"Minor '{minor['name']}': need "
                                f"{req_units - minor_units} more units "
                                f"({minor_units}/{req_units})"
                            ),
                        }
                    )

                for course in minor.get("required_courses", []):
                    if course.upper() not in completed_set:
                        name = self.courses.get(course, {}).get("name", course)
                        missing.append(
                            {
                                "type": "minor_course",
                                "description": (
                                    f"Minor required course: {course} — {name}"
                                ),
                            }
                        )
            else:
                warnings.append(f"Minor '{minor_code}' not found in database.")

        can_graduate = len(missing) == 0

        return {
            "can_graduate": can_graduate,
            "total_units_completed": total,
            "total_units_required": required,
            "missing": missing,
            "completed": completed_reqs,
            "warnings": warnings,
        }

    # ── Risk assessment ──────────────────────────────────────────────

    def assess_risks(
        self,
        plan_semesters: list[dict],
        completed: list[str],
    ) -> list[dict]:
        """Assess risks in a study plan."""
        risks = []
        completed_set = set(c.upper() for c in completed)

        for sem in plan_semesters:
            courses = sem.get("courses", [])

            total_units = sum(
                self.courses.get(c.upper(), {}).get("units", 6)
                for c in courses
            )

            if total_units > 24:
                risks.append(
                    {
                        "type": "workload",
                        "level": "High",
                        "message": (
                            f"Semester {sem.get('semester', '?')} has "
                            f"{total_units} units (standard is 24). "
                            f"You may need overload approval."
                        ),
                        "affected_courses": courses,
                    }
                )
            elif 0 < total_units < 18:
                risks.append(
                    {
                        "type": "workload",
                        "level": "Low",
                        "message": (
                            f"Semester {sem.get('semester', '?')} has only "
                            f"{total_units} units (underload)."
                        ),
                        "affected_courses": courses,
                    }
                )

            for course_code in courses:
                c = course_code.upper()
                dependents = []

                for other_code, other in self.courses.items():
                    if c in [p.upper() for p in other.get("prerequisites", [])]:
                        dependents.append(other_code)

                if len(dependents) >= 3:
                    risks.append(
                        {
                            "type": "prerequisite",
                            "level": "Medium",
                            "message": (
                                f"If you fail {c}, it could delay "
                                f"{len(dependents)} future courses: "
                                f"{', '.join(dependents[:5])}."
                            ),
                            "affected_courses": [c] + dependents[:5],
                        }
                    )

            for course_code in courses:
                c = course_code.upper()
                course = self.courses.get(c, {})
                terms = course.get("terms_offered", [])

                if len(terms) == 1:
                    risks.append(
                        {
                            "type": "availability",
                            "level": "Medium",
                            "message": (
                                f"{c} is only offered in {terms[0]}. "
                                f"Missing it may delay graduation by a full year."
                            ),
                            "affected_courses": [c],
                        }
                    )

        return risks

    # ── Course recommendation ────────────────────────────────────────

    def recommend_courses(
        self,
        completed: list[str],
        interests: list[str] = None,
        program_code: str = None,
        major_code: str = None,
        limit: int = 10,
    ) -> list[dict]:
        """Recommend courses based on interests and eligibility."""
        interests = interests or []
        completed_set = set(c.upper() for c in completed)
        recommendations = []

        for code, course in self.courses.items():
            if code in completed_set:
                continue

            elig = self.check_course_eligibility(code, completed)

            if not elig["eligible"]:
                continue

            score = 0

            course_interests = set(
                i.lower()
                for i in course.get("areas_of_interest", [])
            )

            student_interests = set(i.lower() for i in interests)
            overlap = course_interests & student_interests

            score += len(overlap) * 10

            if major_code:
                major = self.majors.get(major_code.upper(), {})
                all_major = (
                    major.get("required_courses", [])
                    + major.get("elective_courses", [])
                )

                if code in [c.upper() for c in all_major]:
                    score += 15

                if code in [c.upper() for c in major.get("required_courses", [])]:
                    score += 10

            level = course.get("level", 1000)

            if level == 1000:
                score += 3
            elif level == 2000:
                score += 2
            elif level == 3000:
                score += 1

            if score > 0:
                recommendations.append(
                    {
                        "code": code,
                        "name": course.get("name", ""),
                        "units": course.get("units", 6),
                        "level": level,
                        "score": score,
                        "match_reasons": list(overlap),
                        "description": course.get("description", "")[:150],
                        "terms_offered": course.get("terms_offered", []),
                    }
                )

        recommendations.sort(key=lambda x: x["score"], reverse=True)

        return recommendations[:limit]

    # ── Plan generation ──────────────────────────────────────────────

    def generate_plan(
        self,
        program_code: str,
        completed: list[str],
        major_code: str = None,
        minor_code: str = None,
        courses_per_sem: int = 4,
        num_semesters: int = 6,
    ) -> dict:
        """Generate a semester-by-semester study plan."""
        program = self.programs.get(program_code.upper())

        if not program:
            return {"error": f"Program {program_code} not found."}

        completed_set = set(c.upper() for c in completed)
        needed = set()

        for rule in program.get("rules", []):
            if rule.get("type") == "course_requirement":
                for c in rule.get("courses", []):
                    if c.upper() not in completed_set:
                        needed.add(c.upper())

        if major_code:
            major = self.majors.get(major_code.upper(), {})

            for c in major.get("required_courses", []):
                if c.upper() not in completed_set:
                    needed.add(c.upper())

            major_course_codes = [
                x.upper()
                for x in major.get("required_courses", [])
                + major.get("elective_courses", [])
            ]

            major_units_done = sum(
                self.courses.get(c, {}).get("units", 6)
                for c in completed_set
                if c in major_course_codes
            )

            major_units_planned = sum(
                self.courses.get(c, {}).get("units", 6)
                for c in needed
                if c in major_course_codes
            )

            total_major = major_units_done + major_units_planned

            if total_major < major.get("units", 48):
                for c in major.get("elective_courses", []):
                    code = c.upper()

                    if code not in completed_set and code not in needed:
                        needed.add(code)
                        total_major += self.courses.get(code, {}).get("units", 6)

                        if total_major >= major.get("units", 48):
                            break

        if minor_code:
            minor = self.minors.get(minor_code.upper(), {})

            for c in minor.get("required_courses", []):
                if c.upper() not in completed_set:
                    needed.add(c.upper())

        total_done = sum(
            self.courses.get(c, {}).get("units", 6)
            for c in completed_set
            if c in self.courses
        )

        total_planned = sum(
            self.courses.get(c, {}).get("units", 6)
            for c in needed
            if c in self.courses
        )

        required = program.get("total_units", 144)

        if total_done + total_planned < required:
            deficit_units = required - total_done - total_planned

            for code, course in self.courses.items():
                if deficit_units <= 0:
                    break

                if code not in completed_set and code not in needed:
                    elig = self.check_course_eligibility(code, list(completed_set))

                    if elig["eligible"]:
                        needed.add(code)
                        deficit_units -= course.get("units", 6)

        sorted_courses = self._topological_sort(list(needed), completed_set)

        semesters = []
        assigned = set(completed_set)
        remaining = list(sorted_courses)
        year = 1
        sem_names = ["S1", "S2"]

        for i in range(num_semesters):
            if not remaining:
                break

            sem_name = sem_names[i % 2]
            current_year = year + (i // 2)
            semester_courses = []
            semester_units = 0

            for course_code in list(remaining):
                if len(semester_courses) >= courses_per_sem:
                    break

                course = self.courses.get(course_code, {})
                prereqs = course.get("prerequisites", [])

                if all(p.upper() in assigned for p in prereqs):
                    terms = course.get("terms_offered", ["S1", "S2"])

                    if sem_name in terms or not terms:
                        semester_courses.append(course_code)
                        semester_units += course.get("units", 6)
                        remaining.remove(course_code)

            for c in semester_courses:
                assigned.add(c)

            if semester_courses:
                semesters.append(
                    {
                        "year": current_year,
                        "semester": f"Year {current_year} {sem_name}",
                        "courses": semester_courses,
                        "total_units": semester_units,
                        "warnings": [],
                    }
                )

        explanations = []

        for sem in semesters:
            for c in sem["courses"]:
                course = self.courses.get(c, {})
                prereqs = course.get("prerequisites", [])

                if prereqs:
                    explanations.append(
                        f"{c} is placed in {sem['semester']} because its "
                        f"prerequisite(s) {', '.join(prereqs)} are completed earlier."
                    )

        total_planned_units = total_done + sum(
            s["total_units"]
            for s in semesters
        )

        grad_sem = semesters[-1]["semester"] if semesters else "Unknown"

        risks = self.assess_risks(semesters, list(completed_set))

        risk_level = "Low"

        if any(r["level"] == "Critical" for r in risks):
            risk_level = "Critical"
        elif any(r["level"] == "High" for r in risks):
            risk_level = "High"
        elif any(r["level"] == "Medium" for r in risks):
            risk_level = "Medium"

        warnings = [r["message"] for r in risks]

        if remaining:
            warnings.append(
                f"{len(remaining)} courses could not be scheduled: "
                f"{', '.join(remaining[:5])}"
            )

        return {
            "semesters": semesters,
            "total_units": total_planned_units,
            "graduation_semester": grad_sem,
            "warnings": warnings,
            "risk_level": risk_level,
            "explanations": explanations,
            "unscheduled": remaining,
        }

    def _topological_sort(
        self,
        courses: list[str],
        completed: set[str],
    ) -> list[str]:
        """Sort courses by prerequisite order."""
        graph = {}

        for c in courses:
            course = self.courses.get(c, {})
            prereqs = [
                p.upper()
                for p in course.get("prerequisites", [])
                if p.upper() in set(courses)
            ]
            graph[c] = prereqs

        visited = set()
        order = []

        def dfs(node):
            if node in visited:
                return

            visited.add(node)

            for dep in graph.get(node, []):
                dfs(dep)

            order.append(node)

        for c in courses:
            dfs(c)

        return order

    # ── What-if analysis ─────────────────────────────────────────────

    def what_if_change_major(
        self,
        program_code: str,
        completed: list[str],
        current_major: str,
        new_major: str,
    ) -> dict:
        """Simulate changing major and compare outcomes."""
        current_plan = self.generate_plan(
            program_code,
            completed,
            major_code=current_major,
        )

        new_plan = self.generate_plan(
            program_code,
            completed,
            major_code=new_major,
        )

        current_total = len(
            [
                c
                for s in current_plan.get("semesters", [])
                for c in s["courses"]
            ]
        )

        new_total = len(
            [
                c
                for s in new_plan.get("semesters", [])
                for c in s["courses"]
            ]
        )

        current_major_data = self.majors.get(current_major.upper(), {})
        new_major_data = self.majors.get(new_major.upper(), {})

        return {
            "scenario": (
                f"Change major from "
                f"{current_major_data.get('name', current_major)} "
                f"to {new_major_data.get('name', new_major)}"
            ),
            "current": {
                "graduation": current_plan.get("graduation_semester", "Unknown"),
                "courses_remaining": current_total,
                "risk_level": current_plan.get("risk_level", "Low"),
            },
            "new": {
                "graduation": new_plan.get("graduation_semester", "Unknown"),
                "courses_remaining": new_total,
                "risk_level": new_plan.get("risk_level", "Low"),
            },
            "extra_courses": max(0, new_total - current_total),
            "dropped_courses": max(0, current_total - new_total),
            "warnings": new_plan.get("warnings", []),
        }