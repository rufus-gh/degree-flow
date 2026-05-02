export const DEFAULT_INTERESTS = [
  'Computer Science',
  'Artificial Intelligence',
  'Machine Learning',
  'Cybersecurity',
  'Software Engineering',
  'Data Science',
  'Mathematics',
  'Networks',
  'Systems',
  'Product Design',
  'Research',
];

export function normaliseCode(code) {
  return String(code || '').trim().toUpperCase();
}

export function uniqueCodes(codes = []) {
  const seen = new Set();
  return codes
    .map(normaliseCode)
    .filter(Boolean)
    .filter(code => {
      if (seen.has(code)) return false;
      seen.add(code);
      return true;
    });
}

export function getProgramCore(program) {
  return (program?.rules || [])
    .filter(rule => rule.type === 'course_requirement')
    .flatMap(rule => rule.courses || [])
    .map(normaliseCode);
}

export function getRequiredCourses(program, major, minor) {
  return uniqueCodes([
    ...getProgramCore(program),
    ...(major?.required_courses || []),
    ...(minor?.required_courses || []),
  ]);
}

export function isRequiredCourse(code, program, major, minor) {
  return getRequiredCourses(program, major, minor).includes(normaliseCode(code));
}

export function getCourseUnits(courses, code) {
  return courses?.[normaliseCode(code)]?.units || 0;
}

export function sumUnits(courses, codes = []) {
  return uniqueCodes(codes).reduce((sum, code) => sum + getCourseUnits(courses, code), 0);
}

export function parseWorkloadHours(workload = '') {
  const match = String(workload).match(/(\d+)\s*hours?/i);
  return match ? Number(match[1]) : 130;
}

export function getAssessmentFocus(course = {}) {
  const text = (course.assessment || []).join(' ').toLowerCase();
  const hasExam = /exam|midterm|test/.test(text);
  const hasAssignment = /assignment|lab|project|presentation|portfolio|report|code walk/.test(text);

  if (hasExam && hasAssignment) return 'Mixed';
  if (hasExam) return 'Exam';
  if (/project|presentation|portfolio/.test(text)) return 'Project';
  if (hasAssignment) return 'Assignment';
  return 'Coursework';
}

export function semesterTerm(index, startTerm = 'S1') {
  const cycle = startTerm === 'S2' ? ['S2', 'S1'] : ['S1', 'S2'];
  return cycle[index % 2];
}

export function semesterYear(index, student = {}) {
  const startYear = Number(student.current_year || 1);
  const offset = student.current_semester === 'S2' ? 1 : 0;
  return startYear + Math.floor((index + offset) / 2);
}

export function semesterLabel(index, student = {}) {
  const year = semesterYear(index, student);
  const term = semesterTerm(index, student.current_semester || 'S1');
  return `Year ${year} ${term}`;
}

export function getCourseCapacity(student = {}) {
  if (student.study_mode === 'Part-time') return 2;
  if (student.preferred_workload === 'light') return 3;
  if (student.preferred_workload === 'challenging') return 5;
  return 4;
}

function preferredUnitCap(student = {}) {
  if (student.study_mode === 'Part-time') return 12;
  if (student.preferred_workload === 'light') return 18;
  if (student.preferred_workload === 'challenging') return 30;
  return 24;
}

function courseMatchesInterest(course, interests = []) {
  const areas = new Set((course?.areas_of_interest || []).map(area => area.toLowerCase()));
  return interests.filter(interest => areas.has(String(interest).toLowerCase()));
}

export function scoreCourseForPreferences(course, student = {}, major = null) {
  if (!course) return -1000;

  let score = 0;
  const matches = courseMatchesInterest(course, student.interests || []);
  score += matches.length * 12;

  const majorPool = new Set([
    ...(major?.required_courses || []),
    ...(major?.elective_courses || []),
  ].map(normaliseCode));
  if (majorPool.has(course.code)) score += 10;

  const focus = getAssessmentFocus(course);
  if (student.assessment_preference === 'exam' && focus === 'Exam') score += 8;
  if (student.assessment_preference === 'assignment' && ['Assignment', 'Project'].includes(focus)) score += 8;
  if (student.assessment_preference === 'mixed' && focus === 'Mixed') score += 5;

  const hours = parseWorkloadHours(course.workload);
  if (student.preferred_workload === 'light') score += Math.max(0, 150 - hours) / 10;
  if (student.preferred_workload === 'challenging') score += Math.max(0, hours - 110) / 12;

  if (student.challenge_preference === 'stretch' && (course.level || 0) >= 3000) score += 6;
  if (student.challenge_preference === 'steady' && (course.level || 0) <= 2000) score += 4;

  score += (course.terms_offered || []).length;
  score += Math.max(0, (course.level || 1000) - 1000) / 1000;
  return score;
}

function hasIncompatibility(courses, code, selectedCodes) {
  const course = courses[code];
  const selected = new Set(uniqueCodes(selectedCodes));
  const incompatible = new Set((course?.incompatible || []).map(normaliseCode));

  if ([...incompatible].some(other => selected.has(other))) return true;

  return [...selected].some(otherCode => {
    const other = courses[otherCode];
    return (other?.incompatible || []).map(normaliseCode).includes(code);
  });
}

function topologicalSort(codes, courses) {
  const needed = new Set(uniqueCodes(codes));
  const visiting = new Set();
  const visited = new Set();
  const order = [];

  function visit(code) {
    if (visited.has(code) || !needed.has(code)) return;
    if (visiting.has(code)) return;
    visiting.add(code);

    (courses[code]?.prerequisites || [])
      .map(normaliseCode)
      .filter(prereq => needed.has(prereq))
      .forEach(visit);

    visiting.delete(code);
    visited.add(code);
    order.push(code);
  }

  [...needed].forEach(visit);
  return order;
}

function collectMissingPrereqs(code, courses, completedSet, currentSet, neededSet, trail = new Set()) {
  const normalised = normaliseCode(code);
  if (!courses[normalised] || trail.has(normalised)) return;
  trail.add(normalised);

  (courses[normalised].prerequisites || []).map(normaliseCode).forEach(prereq => {
    if (!completedSet.has(prereq) && !currentSet.has(prereq)) {
      neededSet.add(prereq);
      collectMissingPrereqs(prereq, courses, completedSet, currentSet, neededSet, trail);
    }
  });
}

function canUseCandidate(code, courses, selectedCodes) {
  const course = courses[code];
  if (!course) return false;
  return !hasIncompatibility(courses, code, selectedCodes);
}

export function buildDegreePlan({ student, courses, programs, majors, minors, aiElectives = [] }) {
  const program = programs?.[student.degree_code] || null;
  const major = majors?.[student.major_code] || null;
  const minor = minors?.[student.minor_code] || null;
  const semesterCount = Math.max(2, Math.min(12, Number(student.target_semesters || (program?.duration_years || 3) * 2 || 6)));
  const completed = new Set(uniqueCodes(student.completed_courses));
  const current = new Set(uniqueCodes(student.current_courses).filter(code => courses[code] && !completed.has(code)));
  const needed = new Set();

  const addIfNeeded = code => {
    const normalised = normaliseCode(code);
    if (!courses[normalised] || completed.has(normalised) || current.has(normalised)) return;
    if (!canUseCandidate(normalised, courses, [...completed, ...current, ...needed])) return;
    needed.add(normalised);
    collectMissingPrereqs(normalised, courses, completed, current, needed);
  };

  getRequiredCourses(program, major, minor).forEach(addIfNeeded);
  uniqueCodes(student.planned_courses || []).forEach(addIfNeeded);
  aiElectives.map(item => normaliseCode(item?.code || item)).forEach(addIfNeeded);

  const majorPool = new Set([...(major?.required_courses || []), ...(major?.elective_courses || [])].map(normaliseCode));
  let majorUnits = sumUnits(courses, [...completed, ...current, ...needed].filter(code => majorPool.has(code)));
  const majorTarget = major?.units || 0;

  if (major && majorUnits < majorTarget) {
    [...(major.elective_courses || [])]
      .map(normaliseCode)
      .filter(code => courses[code])
      .sort((a, b) => scoreCourseForPreferences(courses[b], student, major) - scoreCourseForPreferences(courses[a], student, major))
      .forEach(code => {
        if (majorUnits >= majorTarget) return;
        const before = needed.size;
        addIfNeeded(code);
        if (needed.size > before) majorUnits += getCourseUnits(courses, code);
      });
  }

  const requiredUnits = program?.total_units || 144;
  let totalUnits = sumUnits(courses, [...completed, ...current, ...needed]);

  if (totalUnits < requiredUnits) {
    Object.values(courses)
      .filter(course => !completed.has(course.code) && !current.has(course.code) && !needed.has(course.code))
      .filter(course => canUseCandidate(course.code, courses, [...completed, ...current, ...needed]))
      .sort((a, b) => scoreCourseForPreferences(b, student, major) - scoreCourseForPreferences(a, student, major))
      .forEach(course => {
        if (totalUnits >= requiredUnits) return;
        const before = needed.size;
        addIfNeeded(course.code);
        if (needed.size > before) {
          totalUnits = sumUnits(courses, [...completed, ...current, ...needed]);
        }
      });
  }

  const semesters = Array.from({ length: semesterCount }, (_, index) => ({
    id: `sem-${index}`,
    year: semesterYear(index, student),
    term: semesterTerm(index, student.current_semester || 'S1'),
    semester: semesterLabel(index, student),
    courses: index === 0 ? [...current] : [],
  }));

  const capacity = getCourseCapacity(student);
  const unitCap = preferredUnitCap(student);
  const assigned = new Set(completed);
  const remaining = topologicalSort([...needed], courses).filter(code => !current.has(code));

  semesters.forEach(semester => {
    const sameSemester = new Set(semester.courses);
    let units = sumUnits(courses, semester.courses);

    for (const code of [...remaining]) {
      if (semester.courses.length >= capacity) break;
      const course = courses[code];
      if (!course) continue;
      if (units + getCourseUnits(courses, code) > unitCap && semester.courses.length > 0) continue;

      const prereqsMet = (course.prerequisites || []).map(normaliseCode).every(prereq => assigned.has(prereq));
      const coreqsMet = (course.corequisites || []).map(normaliseCode).every(coreq => assigned.has(coreq) || sameSemester.has(coreq) || !courses[coreq]);
      const termOk = !(course.terms_offered || []).length || (course.terms_offered || []).includes(semester.term);
      const compatible = !hasIncompatibility(courses, code, [...assigned, ...sameSemester]);

      if (prereqsMet && coreqsMet && termOk && compatible) {
        semester.courses.push(code);
        sameSemester.add(code);
        units += getCourseUnits(courses, code);
        remaining.splice(remaining.indexOf(code), 1);
      }
    }

    semester.courses.forEach(code => assigned.add(code));
  });

  return {
    semesters,
    unscheduled: remaining,
    source: 'local',
    generatedAt: new Date().toISOString(),
  };
}

export function validateTimeline(plan, { student, courses, programs, majors, minors }) {
  const program = programs?.[student.degree_code] || null;
  const major = majors?.[student.major_code] || null;
  const minor = minors?.[student.minor_code] || null;
  const completed = new Set(uniqueCodes(student.completed_courses));
  const current = new Set(uniqueCodes(student.current_courses));
  const seen = new Set(completed);
  const allPlanned = new Set(completed);
  const issues = [];
  const warnings = [];
  const statusByCourse = {};
  const required = new Set(getRequiredCourses(program, major, minor));
  const unitCap = preferredUnitCap(student);

  completed.forEach(code => {
    statusByCourse[code] = {
      state: 'completed',
      required: required.has(code),
      invalid: false,
      reasons: [],
    };
  });

  (plan?.semesters || []).forEach((semester, semesterIndex) => {
    const sameSemester = new Set(uniqueCodes(semester.courses));
    const semesterUnits = sumUnits(courses, semester.courses);
    const semesterHours = uniqueCodes(semester.courses).reduce((sum, code) => sum + parseWorkloadHours(courses[code]?.workload), 0);

    if (semesterUnits > unitCap) {
      warnings.push(`${semester.semester} is ${semesterUnits} units; your selected workload target is ${unitCap} units.`);
    }

    if (semesterHours > 560) {
      warnings.push(`${semester.semester} has about ${semesterHours} hours of workload.`);
    }

    uniqueCodes(semester.courses).forEach(code => {
      const course = courses[code];
      const reasons = [];

      if (!course) {
        reasons.push('Course is not in the catalogue.');
      } else {
        const duplicateBefore = allPlanned.has(code);
        if (duplicateBefore) reasons.push('Course appears more than once.');

        const missingPrereqs = (course.prerequisites || []).map(normaliseCode).filter(prereq => !seen.has(prereq));
        if (missingPrereqs.length) reasons.push(`Missing prerequisite${missingPrereqs.length > 1 ? 's' : ''}: ${missingPrereqs.join(', ')}`);

        const missingCoreqs = (course.corequisites || []).map(normaliseCode).filter(coreq => !seen.has(coreq) && !sameSemester.has(coreq));
        if (missingCoreqs.length) reasons.push(`Missing corequisite${missingCoreqs.length > 1 ? 's' : ''}: ${missingCoreqs.join(', ')}`);

        const terms = course.terms_offered || [];
        if (terms.length && !terms.includes(semester.term)) {
          reasons.push(`Usually offered in ${terms.join(', ')}, not ${semester.term}.`);
        }

        const incompatible = (course.incompatible || []).map(normaliseCode).filter(other => seen.has(other) || sameSemester.has(other));
        const reverseIncompatible = [...seen, ...sameSemester].filter(other => (courses[other]?.incompatible || []).map(normaliseCode).includes(code));
        const conflicts = uniqueCodes([...incompatible, ...reverseIncompatible]).filter(other => other !== code);
        if (conflicts.length) reasons.push(`Incompatible with ${conflicts.join(', ')}.`);
      }

      const state = semesterIndex === 0 && current.has(code) ? 'in-progress' : 'planned';
      statusByCourse[code] = {
        state,
        required: required.has(code),
        invalid: reasons.length > 0,
        reasons,
      };

      if (reasons.length) {
        issues.push(`${code}: ${reasons[0]}`);
      }

      allPlanned.add(code);
    });

    sameSemester.forEach(code => seen.add(code));
  });

  required.forEach(code => {
    if (!allPlanned.has(code)) {
      issues.push(`Missing compulsory course ${code}.`);
    }
  });

  const completedUnits = sumUnits(courses, [...completed]);
  const plannedUnits = sumUnits(courses, [...allPlanned]);
  const requiredUnits = program?.total_units || 144;

  if (plannedUnits < requiredUnits) {
    issues.push(`Plan is ${requiredUnits - plannedUnits} units short of the ${requiredUnits} unit degree requirement.`);
  }

  const level1000Units = [...allPlanned].reduce((sum, code) => sum + ((courses[code]?.level || 0) === 1000 ? getCourseUnits(courses, code) : 0), 0);
  const level3000Units = [...allPlanned].reduce((sum, code) => sum + ((courses[code]?.level || 0) >= 3000 ? getCourseUnits(courses, code) : 0), 0);

  (program?.rules || []).forEach(rule => {
    if (rule.type === 'level_cap' && level1000Units > (rule.maximum_units || 60)) {
      issues.push(`Too many 1000-level units: ${level1000Units}/${rule.maximum_units || 60}.`);
    }

    if (rule.type === 'level_requirement' && level3000Units < (rule.minimum_units || 30)) {
      issues.push(`Need ${(rule.minimum_units || 30) - level3000Units} more units at 3000-level or above.`);
    }
  });

  return {
    issues,
    warnings,
    statusByCourse,
    invalidCount: Object.values(statusByCourse).filter(status => status.invalid).length,
    completedUnits,
    plannedUnits,
    requiredUnits,
    currentProgress: Math.min(100, Math.round((completedUnits / requiredUnits) * 100)),
    plannedProgress: Math.min(100, Math.round((plannedUnits / requiredUnits) * 100)),
  };
}

export function clonePlan(plan) {
  return {
    ...plan,
    semesters: (plan?.semesters || []).map(semester => ({
      ...semester,
      courses: [...(semester.courses || [])],
    })),
  };
}

export function evaluateDrop(plan, code, toSemesterIndex, fromSemesterIndex, context) {
  const courseCode = normaliseCode(code);
  const nextPlan = clonePlan(plan);

  nextPlan.semesters.forEach((semester, index) => {
    if (index === fromSemesterIndex || semester.courses.includes(courseCode)) {
      semester.courses = semester.courses.filter(existing => existing !== courseCode);
    }
  });

  nextPlan.semesters[toSemesterIndex].courses.push(courseCode);

  const validation = validateTimeline(nextPlan, context);
  const courseStatus = validation.statusByCourse[courseCode];
  const semester = nextPlan.semesters[toSemesterIndex];
  const capacity = getCourseCapacity(context.student);
  const tooManyCourses = semester.courses.length > capacity;
  const reasons = [...(courseStatus?.reasons || [])];

  if (tooManyCourses) {
    reasons.push(`This semester is above your ${capacity} course workload preference.`);
  }

  return {
    valid: reasons.length === 0,
    reasons,
    nextPlan,
  };
}

export function addCourseWithPrerequisites(plan, code, context) {
  const courseCode = normaliseCode(code);
  const { student, courses } = context;
  const completed = new Set(uniqueCodes(student.completed_courses));
  const current = new Set(uniqueCodes(student.current_courses));
  const additions = new Set([courseCode]);
  collectMissingPrereqs(courseCode, courses, completed, current, additions);
  const existing = new Set((plan?.semesters || []).flatMap(semester => semester.courses).map(normaliseCode));
  const plannedCourses = uniqueCodes([...existing, ...additions]);

  return buildDegreePlan({
    ...context,
    student: {
      ...student,
      planned_courses: plannedCourses,
    },
  });
}

export function reflowPlan(plan, context, extraCourses = []) {
  const existing = (plan?.semesters || []).flatMap(semester => semester.courses);
  const current = uniqueCodes(context.student.current_courses);
  const planned = uniqueCodes([...existing, ...extraCourses]).filter(code => !current.includes(code));

  return buildDegreePlan({
    ...context,
    student: {
      ...context.student,
      planned_courses: planned,
    },
    aiElectives: extraCourses,
  });
}

export function getExpectedProgress(student = {}, program = {}) {
  const totalSemesters = Number(student.target_semesters || (program.duration_years || 3) * 2 || 6);
  const currentYear = Number(student.current_year || 1);
  const elapsedBeforeYear = Math.max(0, currentYear - 1) * 2;
  const elapsed = elapsedBeforeYear + (student.current_semester === 'S2' ? 1 : 0);
  return Math.min(100, Math.round((elapsed / totalSemesters) * 100));
}
