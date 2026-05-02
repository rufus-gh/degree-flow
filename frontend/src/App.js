import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  GraduationCap,
  Moon,
  Pencil,
  Sparkles,
  Sun,
  Wand2,
  X,
} from 'lucide-react';

import coursesData from './data/courses.json';
import programsData from './data/programs.json';
import majorsData from './data/majors.json';
import minorsData from './data/minors.json';
import { optimisePlanAI, suggestInterestsAI } from './utils/api';
import {
  DEFAULT_INTERESTS,
  buildDegreePlan,
  getAssessmentFocus,
  getExpectedProgress,
  getRequiredCourses,
  normaliseCode,
  parseWorkloadHours,
  sumUnits,
  uniqueCodes,
  validateTimeline,
} from './utils/planner';

const initialStudent = {
  degree_code: '',
  major_code: '',
  minor_code: '',
  handbook_year: 2026,
  completed_courses: [],
  current_courses: [],
  planned_courses: [],
  interests: [],
  study_mode: 'Full-time',
  current_year: 1,
  current_semester: 'S1',
  target_semesters: 6,
  preferred_workload: 'balanced',
  challenge_preference: 'balanced',
  assessment_preference: 'mixed',
  free_text_preferences: '',
};

function uniqueLabels(labels = []) {
  const seen = new Set();
  return labels
    .filter(Boolean)
    .filter(label => {
      const key = label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function fallbackInterests(program, major) {
  const relevant = new Set([
    ...(program?.rules || []).flatMap(rule => rule.courses || []),
    ...(major?.required_courses || []),
    ...(major?.elective_courses || []),
  ].map(normaliseCode));

  const counts = new Map();
  Object.values(coursesData).forEach(course => {
    if (relevant.size && !relevant.has(course.code) && course.subject_area !== 'COMP') return;
    (course.areas_of_interest || []).forEach(area => counts.set(area, (counts.get(area) || 0) + 1));
  });

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);
  return uniqueLabels([...ranked, ...DEFAULT_INTERESTS]).slice(0, 8);
}

function Field({ label, children }) {
  return (
    <label className="simple-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function PreferenceButton({ active, children, onClick }) {
  return (
    <button type="button" className={`simple-choice ${active ? 'active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

function CoursePill({ code, course, onRemove }) {
  return (
    <span className="simple-course-pill">
      <strong>{code}</strong>
      <small>{course?.name || 'Unknown course'}</small>
      <button type="button" onClick={() => onRemove(code)} aria-label={`Remove ${code}`}>
        <X size={13} />
      </button>
    </span>
  );
}

function SearchSelect({ options, value, onChange, placeholder }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);

  const selected = options.find(o => o.code === value);
  const inputValue = focused ? query : (selected?.name || '');

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return options.slice(0, 8);
    return options.filter(o =>
      o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [query, options]);

  return (
    <div className="search-select">
      <input
        className="input question-control"
        placeholder={placeholder}
        value={inputValue}
        onChange={e => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange(''); }}
        onFocus={() => { setFocused(true); setOpen(true); setQuery(''); }}
        onBlur={() => setTimeout(() => { setOpen(false); setFocused(false); }, 180)}
      />
      {open && filtered.length > 0 && (
        <ul className="search-dropdown">
          {filtered.map(o => (
            <li key={o.code} onMouseDown={() => { onChange(o.code); setQuery(''); setOpen(false); setFocused(false); }}>
              <strong>{o.code}</strong>
              <span>{o.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CourseSearch({ courses, onAdd }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (q.length < 2) return [];
    return Object.values(courses)
      .filter(c => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, courses]);

  function select(code) {
    onAdd(code);
    setQuery('');
    setOpen(false);
  }

  return (
    <div className="search-select">
      <input
        className="input question-control"
        placeholder="Search by code or name, e.g. COMP1100"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        onKeyDown={e => { if (e.key === 'Enter' && filtered.length) select(filtered[0].code); }}
      />
      {open && filtered.length > 0 && (
        <ul className="search-dropdown">
          {filtered.map(c => (
            <li key={c.code} onMouseDown={() => select(c.code)}>
              <strong>{c.code}</strong>
              <span>{c.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProgressBar({ current, planned, expected }) {
  return (
    <div className="simple-progress">
      <div className="simple-progress-labels">
        <span>Done {current}%</span>
        <span>Planned {planned}%</span>
        <span>Expected {expected}%</span>
      </div>
      <div className="simple-progress-track">
        <div className="simple-progress-fill planned" style={{ width: `${planned}%` }} />
        <div className="simple-progress-fill done" style={{ width: `${current}%` }} />
        <i style={{ left: `${expected}%` }} />
      </div>
    </div>
  );
}

function CalendarCourse({ code, status, courses }) {
  const course = courses[code];
  const focus = getAssessmentFocus(course);
  const invalid = status?.invalid;
  const current = status?.state === 'in-progress';

  return (
    <article className={`calendar-course ${invalid ? 'invalid' : ''} ${current ? 'current' : ''}`}>
      <div>
        <strong>{code}</strong>
        <span>{course?.name || 'Unknown course'}</span>
      </div>
      <small>{course?.units || 6}u · {focus} · {parseWorkloadHours(course?.workload)}h</small>
      {invalid && <em>{status.reasons[0]}</em>}
    </article>
  );
}

function DegreeCalendar({ plan, validation, courses }) {
  if (!plan) {
    return (
      <div className="calendar-empty">
        <CalendarDays size={28} />
        <strong>Choose your degree to see the calendar.</strong>
        <span>Your plan will appear here automatically.</span>
      </div>
    );
  }

  const years = plan.semesters.reduce((groups, semester) => {
    const key = `Year ${semester.year}`;
    groups[key] = groups[key] || [];
    groups[key].push(semester);
    return groups;
  }, {});

  return (
    <div className="degree-calendar">
      {Object.entries(years).map(([year, semesters]) => (
        <section key={year} className="calendar-year">
          <div className="calendar-year-label">{year}</div>
          <div className="calendar-semesters">
            {semesters.map(semester => (
              <article key={semester.id} className="calendar-semester">
                <header>
                  <span>{semester.term === 'S1' ? 'Semester 1' : 'Semester 2'}</span>
                  <strong>{sumUnits(courses, semester.courses)} units</strong>
                </header>
                <div className="calendar-courses">
                  {semester.courses.length ? (
                    semester.courses.map(code => (
                      <CalendarCourse key={`${semester.id}-${code}`} code={code} status={validation?.statusByCourse[code]} courses={courses} />
                    ))
                  ) : (
                    <div className="calendar-gap">No courses planned</div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
      {plan.unscheduled?.length > 0 && (
        <div className="calendar-warning">
          <AlertCircle size={16} />
          <span>Could not place: {plan.unscheduled.join(', ')}</span>
        </div>
      )}
    </div>
  );
}

function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === 'dark';

  return (
    <button className="theme-toggle" type="button" onClick={onToggle} aria-label="Toggle light and dark mode">
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
      <span>{isDark ? 'Light' : 'Dark'}</span>
    </button>
  );
}

function OnboardingSetup({
  student,
  programs,
  majors,
  minors,
  courses,
  program,
  availableMajors,
  availableMinors,
  interestOptions,
  selectedCompleted,
  updateStudent,
  toggleInterest,
  addCompletedCourse,
  removeCompletedCourse,
  onComplete,
}) {
  const programOptions = useMemo(() => Object.values(programs).map(p => ({ code: p.code, name: p.name })), [programs]);
  const [stepIndex, setStepIndex] = useState(0);
  const steps = [
    { id: 'degree', eyebrow: 'Step 1 of 10', title: 'What degree are you planning?' },
    { id: 'major', eyebrow: 'Step 2 of 10', title: 'Which major should we build around?' },
    { id: 'minor', eyebrow: 'Step 3 of 10', title: 'Do you want to include a minor?' },
    { id: 'timeline', eyebrow: 'Step 4 of 10', title: 'How quickly do you want to finish?' },
    { id: 'workload', eyebrow: 'Step 5 of 10', title: 'What workload feels right?' },
    { id: 'mode', eyebrow: 'Step 6 of 10', title: 'Will you study full-time or part-time?' },
    { id: 'current', eyebrow: 'Step 7 of 10', title: 'Where are you in the degree right now?' },
    { id: 'assessment', eyebrow: 'Step 8 of 10', title: 'What assessment style do you prefer?' },
    { id: 'interests', eyebrow: 'Step 9 of 10', title: 'What topics are you interested in?' },
    { id: 'completed', eyebrow: 'Step 10 of 10', title: 'What courses have you already completed?' },
  ];
  const step = steps[stepIndex];
  const progress = Math.round(((stepIndex + 1) / steps.length) * 100);
  const canContinue =
    (step.id !== 'degree' || Boolean(student.degree_code)) &&
    (step.id !== 'major' || !availableMajors.length || Boolean(student.major_code));

  const nextStep = () => {
    if (!canContinue) return;
    if (stepIndex === steps.length - 1) onComplete();
    else setStepIndex(current => Math.min(steps.length - 1, current + 1));
  };

  const previousStep = () => {
    setStepIndex(current => Math.max(0, current - 1));
  };

  const handleEnter = event => {
    if (event.key === 'Enter' && step.id !== 'completed') nextStep();
  };

  const stepContent = {
    degree: (
      <Field label="Degree">
        <SearchSelect
          options={programOptions}
          value={student.degree_code}
          onChange={code => updateStudent({ degree_code: code, major_code: '', minor_code: '', planned_courses: [] })}
          placeholder="Search by name or code…"
        />
      </Field>
    ),
    major: (
      <Field label="Major">
        <select
          className="select question-control"
          value={student.major_code}
          onChange={event => updateStudent({ major_code: event.target.value, planned_courses: [] })}
          disabled={!availableMajors.length}
          onKeyDown={handleEnter}
        >
          <option value="">{availableMajors.length ? 'Choose a major' : 'No majors available for this degree'}</option>
          {availableMajors.map(item => (
            <option key={item.code} value={item.code}>{majors[item.code]?.name || item.name}</option>
          ))}
        </select>
      </Field>
    ),
    minor: (
      <Field label="Minor">
        <select
          className="select question-control"
          value={student.minor_code}
          onChange={event => updateStudent({ minor_code: event.target.value, planned_courses: [] })}
          disabled={!availableMinors.length}
          onKeyDown={handleEnter}
        >
          <option value="">{availableMinors.length ? 'No minor' : 'No minors available for this degree'}</option>
          {availableMinors.map(item => (
            <option key={item.code} value={item.code}>{minors[item.code]?.name || item.name}</option>
          ))}
        </select>
      </Field>
    ),
    timeline: (
      <div className="question-options">
        {[4, 5, 6, 7, 8].map(count => (
          <PreferenceButton key={count} active={student.target_semesters === count} onClick={() => updateStudent({ target_semesters: count })}>
            {count} semesters
          </PreferenceButton>
        ))}
      </div>
    ),
    workload: (
      <div className="question-options">
        <PreferenceButton active={student.preferred_workload === 'light'} onClick={() => updateStudent({ preferred_workload: 'light' })}>Light</PreferenceButton>
        <PreferenceButton active={student.preferred_workload === 'balanced'} onClick={() => updateStudent({ preferred_workload: 'balanced' })}>Balanced</PreferenceButton>
        <PreferenceButton active={student.preferred_workload === 'challenging'} onClick={() => updateStudent({ preferred_workload: 'challenging' })}>Challenging</PreferenceButton>
      </div>
    ),
    mode: (
      <div className="question-options">
        <PreferenceButton active={student.study_mode === 'Full-time'} onClick={() => updateStudent({ study_mode: 'Full-time' })}>Full-time</PreferenceButton>
        <PreferenceButton active={student.study_mode === 'Part-time'} onClick={() => updateStudent({ study_mode: 'Part-time' })}>Part-time</PreferenceButton>
      </div>
    ),
    current: (
      <div className="question-options">
        <select className="select question-select" value={student.current_year} onChange={event => updateStudent({ current_year: Number(event.target.value) })}>
          {[1, 2, 3, 4].map(year => <option key={year} value={year}>Year {year}</option>)}
        </select>
        <select className="select question-select" value={student.current_semester} onChange={event => updateStudent({ current_semester: event.target.value })}>
          <option value="S1">Semester 1</option>
          <option value="S2">Semester 2</option>
        </select>
      </div>
    ),
    assessment: (
      <div className="question-options">
        <PreferenceButton active={student.assessment_preference === 'mixed'} onClick={() => updateStudent({ assessment_preference: 'mixed' })}>Mixed</PreferenceButton>
        <PreferenceButton active={student.assessment_preference === 'assignment'} onClick={() => updateStudent({ assessment_preference: 'assignment' })}>Assignments</PreferenceButton>
        <PreferenceButton active={student.assessment_preference === 'exam'} onClick={() => updateStudent({ assessment_preference: 'exam' })}>Exams</PreferenceButton>
      </div>
    ),
    interests: (
      <div className="question-interest-grid">
        {interestOptions.map(interest => (
          <PreferenceButton key={interest} active={student.interests.includes(interest)} onClick={() => toggleInterest(interest)}>
            {interest}
          </PreferenceButton>
        ))}
      </div>
    ),
    completed: (
      <div className="question-stack">
        <CourseSearch courses={courses} onAdd={addCompletedCourse} />
        <div className="simple-course-list setup-course-list">
          {selectedCompleted.map(code => (
            <CoursePill key={code} code={code} course={courses[code]} onRemove={removeCompletedCourse} />
          ))}
          {!selectedCompleted.length && <span className="simple-empty-text">You can skip this and add courses later.</span>}
        </div>
      </div>
    ),
  };

  return (
    <section className="wizard-screen">
      <div className="wizard-intro">
        <div className="simple-brand">
          <GraduationCap size={28} />
          <span>DegreeFlow</span>
        </div>
        <h1>Let’s build your degree plan.</h1>
        <p>
          One question at a time. We’ll use your answers to build a first-pass plan, then you can edit it from the calendar.
        </p>
        <div className="wizard-mini-summary">
          <span>{program?.name || 'Degree not selected'}</span>
          <span>{student.major_code ? majors[student.major_code]?.name : 'Major next'}</span>
          <span>{selectedCompleted.length} completed</span>
        </div>
      </div>

      <div className="wizard-card">
        <div className="wizard-progress">
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="wizard-question" key={step.id}>
          <div className="wizard-eyebrow">{step.eyebrow}</div>
          <h2>{step.title}</h2>
          {stepContent[step.id]}
        </div>
        <div className="wizard-footer">
          <div>
            <strong>{program?.name || 'Choose a degree to begin'}</strong>
            <span>{canContinue ? 'Looks good. Continue when you are ready.' : 'This answer is required before moving on.'}</span>
          </div>
          <div className="wizard-actions">
            <button className="btn btn-outline" type="button" disabled={stepIndex === 0} onClick={previousStep}>
              <ArrowLeft size={16} /> Back
            </button>
            <button className="btn btn-primary" type="button" disabled={!canContinue} onClick={nextStep}>
              {stepIndex === steps.length - 1 ? 'Build plan' : 'Continue'} <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function WelcomePage({ onStart }) {
  return (
    <section className="welcome-screen">
      <div className="welcome-card">
        <div className="welcome-brand">
          <GraduationCap size={32} />
          <span>DegreeFlow</span>
        </div>
        <h1>Plan your ANU degree with confidence.</h1>
        <p>
          Map your full degree from first year to graduation. Check prerequisites automatically,
          balance your workload, and get AI-powered course recommendations — all in one place.
        </p>
        <div className="welcome-features">
          <span>Visual degree timeline</span>
          <span>Prerequisite checking</span>
          <span>AI elective suggestions</span>
          <span>Workload balancer</span>
        </div>
        <button className="btn btn-primary welcome-cta" type="button" onClick={onStart}>
          Get started <ArrowRight size={18} />
        </button>
      </div>
    </section>
  );
}

function BuildingPlan() {
  return (
    <section className="building-screen">
      <div className="building-card">
        <div className="simple-brand compact-brand">
          <GraduationCap size={24} />
          <span>DegreeFlow</span>
        </div>
        <Sparkles className="building-spark" size={34} />
        <h1>Making your degree plan</h1>
        <p>Checking prerequisites, filling requirements, balancing workload, and placing courses into semesters.</p>
        <div className="build-progress">
          <span />
        </div>
      </div>
    </section>
  );
}

function CalendarView({
  student,
  program,
  plan,
  validation,
  courses,
  requiredCourses,
  currentProgress,
  plannedProgress,
  expectedProgress,
  hasIssues,
  aiNote,
  aiBusy,
  improvePlan,
  onEditSetup,
}) {
  return (
    <section className="calendar-screen">
      <header className="app-header">
        <div>
          <div className="simple-brand compact-brand">
            <GraduationCap size={24} />
            <span>DegreeFlow</span>
          </div>
          <h1>{program?.name || 'Your degree calendar'}</h1>
          <p>{student.target_semesters} semester plan · {student.preferred_workload} workload</p>
        </div>
        <div className="app-header-actions">
          <button className="btn btn-outline" type="button" onClick={onEditSetup}>
            <Pencil size={16} /> Edit setup
          </button>
          <button className="btn btn-outline" type="button" onClick={improvePlan} disabled={!plan || aiBusy}>
            <Wand2 size={16} /> {aiBusy ? 'Improving...' : 'Improve plan'}
          </button>
        </div>
      </header>

      <section className="simple-plan full-plan">
        {validation && (
          <div className={`simple-status ${hasIssues ? 'warning' : 'success'}`}>
            <div>
              {hasIssues ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
              <strong>{hasIssues ? `${validation.issues.length} things to fix` : 'Looks on track'}</strong>
            </div>
            <span>
              {validation.plannedUnits}/{validation.requiredUnits} units planned
              {requiredCourses.length ? ` · ${requiredCourses.length} required courses tracked` : ''}
            </span>
          </div>
        )}

        {validation && (
          <ProgressBar current={currentProgress} planned={plannedProgress} expected={expectedProgress} />
        )}

        {aiNote && (
          <div className="simple-ai-note">
            <Sparkles size={16} />
            <span>{aiNote}</span>
          </div>
        )}

        <DegreeCalendar plan={plan} validation={validation} courses={courses} />

        {validation?.issues?.length > 0 && (
          <div className="simple-issues">
            {validation.issues.slice(0, 4).map(issue => (
              <span key={issue}>{issue}</span>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

export default function App() {
  const [student, setStudent] = useState(initialStudent);
  const [interestOptions, setInterestOptions] = useState(DEFAULT_INTERESTS.slice(0, 8));
  const [aiNote, setAiNote] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [screen, setScreen] = useState('welcome');
  const [theme, setTheme] = useState('light');

  const courses = coursesData;
  const programs = programsData;
  const majors = majorsData;
  const minors = minorsData;
  const program = programs[student.degree_code];
  const major = majors[student.major_code];
  const minor = minors[student.minor_code];
  const availableMajors = program?.available_majors || [];
  const availableMinors = program?.available_minors || [];

  const context = useMemo(() => ({ student, courses, programs, majors, minors }), [student, courses, programs, majors, minors]);
  const plan = useMemo(() => (student.degree_code ? buildDegreePlan(context) : null), [student.degree_code, context]);
  const validation = useMemo(() => (plan ? validateTimeline(plan, context) : null), [plan, context]);
  const expectedProgress = getExpectedProgress(student, program || {});
  const requiredCourses = getRequiredCourses(program, major, minor);

  useEffect(() => {
    let cancelled = false;

    async function loadInterests() {
      if (!student.degree_code) {
        setInterestOptions(DEFAULT_INTERESTS.slice(0, 8));
        return;
      }

      const local = fallbackInterests(program, major);
      setInterestOptions(local);

      try {
        const response = await suggestInterestsAI({
          student,
          program,
          major,
          catalogue_interests: DEFAULT_INTERESTS,
        });
        if (!cancelled && response.suggestions?.length) {
          setInterestOptions(uniqueLabels(response.suggestions.map(item => item.label)).slice(0, 8));
        }
      } catch {
        if (!cancelled) setInterestOptions(local);
      }
    }

    loadInterests();
    return () => {
      cancelled = true;
    };
  }, [student.degree_code, student.major_code, program, major]);

  useEffect(() => {
    if (screen !== 'building') return undefined;

    const timeout = window.setTimeout(() => {
      setScreen('calendar');
    }, 2500);

    return () => window.clearTimeout(timeout);
  }, [screen]);

  function updateStudent(patch) {
    setStudent(current => ({ ...current, ...patch }));
  }

  function toggleInterest(interest) {
    setStudent(current => {
      const interests = new Set(current.interests);
      if (interests.has(interest)) interests.delete(interest);
      else interests.add(interest);
      return { ...current, interests: [...interests] };
    });
  }

  function addCompletedCourse(codeRaw) {
    const code = normaliseCode(codeRaw);
    if (!courses[code]) return;
    setStudent(current => ({
      ...current,
      completed_courses: uniqueCodes([...current.completed_courses, code]),
      current_courses: current.current_courses.filter(existing => existing !== code),
    }));
  }

  function removeCompletedCourse(code) {
    setStudent(current => ({
      ...current,
      completed_courses: current.completed_courses.filter(existing => existing !== code),
    }));
  }

  async function improvePlan() {
    if (!plan || !validation) return;
    setAiBusy(true);
    setAiNote('');

    try {
      const response = await optimisePlanAI({
        student,
        plan,
        validation,
        preferences: {
          workload: student.preferred_workload,
          assessment: student.assessment_preference,
          free_text: student.free_text_preferences,
        },
      });
      setStudent(current => ({
        ...current,
        planned_courses: uniqueCodes([...current.planned_courses, ...(response.recommended_courses || [])]),
      }));
      setAiNote(response.plan_strategy || 'I added a few elective options that fit the plan.');
    } catch {
      setAiNote('The plan is already built locally. Gemini suggestions are unavailable right now.');
    } finally {
      setAiBusy(false);
    }
  }

  const currentProgress = validation?.currentProgress || 0;
  const plannedProgress = validation?.plannedProgress || 0;
  const hasIssues = Boolean(validation?.issues?.length);
  const selectedCompleted = uniqueCodes(student.completed_courses);

  return (
    <main className={`simple-app ${theme}`}>
      <ThemeToggle theme={theme} onToggle={() => setTheme(current => (current === 'dark' ? 'light' : 'dark'))} />
      {screen === 'welcome' ? (
        <WelcomePage onStart={() => setScreen('onboarding')} />
      ) : screen === 'onboarding' ? (
        <OnboardingSetup
          student={student}
          programs={programs}
          majors={majors}
          minors={minors}
          courses={courses}
          program={program}
          availableMajors={availableMajors}
          availableMinors={availableMinors}
          interestOptions={interestOptions}
          selectedCompleted={selectedCompleted}
          updateStudent={updateStudent}
          toggleInterest={toggleInterest}
          addCompletedCourse={addCompletedCourse}
          removeCompletedCourse={removeCompletedCourse}
          onComplete={() => setScreen('building')}
        />
      ) : screen === 'building' ? (
        <BuildingPlan />
      ) : (
        <CalendarView
          student={student}
          program={program}
          plan={plan}
          validation={validation}
          courses={courses}
          requiredCourses={requiredCourses}
          currentProgress={currentProgress}
          plannedProgress={plannedProgress}
          expectedProgress={expectedProgress}
          hasIssues={hasIssues}
          aiNote={aiNote}
          aiBusy={aiBusy}
          improvePlan={improvePlan}
          onEditSetup={() => setScreen('onboarding')}
        />
      )}
    </main>
  );
}
