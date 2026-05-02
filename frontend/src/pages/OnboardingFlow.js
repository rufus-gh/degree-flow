import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, CheckCircle2, Plus, Search, Sparkles, X } from 'lucide-react';
import { suggestInterestsAI } from '../utils/api';
import { DEFAULT_INTERESTS, normaliseCode, sumUnits, uniqueCodes } from '../utils/planner';

function localInterestSuggestions({ student, courses, programs, majors }) {
  const program = programs[student.degree_code];
  const major = majors[student.major_code];
  const relevant = new Set([
    ...(program?.rules || []).flatMap(rule => rule.courses || []),
    ...(major?.required_courses || []),
    ...(major?.elective_courses || []),
  ].map(normaliseCode));

  const counts = new Map();
  Object.values(courses).forEach(course => {
    const isRelevant = relevant.size === 0 || relevant.has(course.code) || course.subject_area === 'COMP';
    if (!isRelevant) return;
    (course.areas_of_interest || []).forEach(area => {
      counts.set(area, (counts.get(area) || 0) + 1);
    });
  });

  const suggestions = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, count]) => ({
      label,
      reason: `${count} matching catalogue courses`,
      confidence: 0.7,
    }));

  return suggestions.length ? suggestions : DEFAULT_INTERESTS.slice(0, 6).map(label => ({
    label,
    reason: 'Common pathway interest',
    confidence: 0.6,
  }));
}

function Stepper({ steps, active }) {
  return (
    <div className="onboarding-stepper">
      {steps.map((step, index) => (
        <div key={step} className={`step-dot ${index === active ? 'active' : ''} ${index < active ? 'done' : ''}`}>
          <span>{index < active ? <CheckCircle2 size={14} /> : index + 1}</span>
          <small>{step}</small>
        </div>
      ))}
    </div>
  );
}

function ChoicePill({ active, children, onClick }) {
  return (
    <button type="button" className={`choice-pill ${active ? 'active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

function CoursePicker({ title, field, student, courses, setStudent }) {
  const [search, setSearch] = useState('');
  const selected = uniqueCodes(student[field]);
  const selectedSet = new Set(selected);
  const results = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];

    return Object.values(courses)
      .filter(course => !selectedSet.has(course.code))
      .filter(course => {
        const haystack = `${course.code} ${course.name} ${course.description || ''}`.toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 8);
  }, [courses, search, selectedSet]);

  const addCourse = code => {
    const normalised = normaliseCode(code);
    if (!courses[normalised] || selectedSet.has(normalised)) return;
    setStudent(current => ({ ...current, [field]: uniqueCodes([...current[field], normalised]) }));
    setSearch('');
  };

  const removeCourse = code => {
    setStudent(current => ({ ...current, [field]: uniqueCodes(current[field]).filter(existing => existing !== code) }));
  };

  return (
    <div className="course-picker">
      <div className="field-head">
        <div>
          <label className="label">{title}</label>
          <p>{selected.length} courses · {sumUnits(courses, selected)} units</p>
        </div>
      </div>
      <div className="search-input">
        <Search size={16} />
        <input
          className="input"
          placeholder="Search by code or name"
          value={search}
          onChange={event => setSearch(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && addCourse(search)}
        />
      </div>
      {results.length > 0 && (
        <div className="picker-results">
          {results.map(course => (
            <button key={course.code} type="button" onClick={() => addCourse(course.code)}>
              <span><strong>{course.code}</strong> {course.name}</span>
              <Plus size={16} />
            </button>
          ))}
        </div>
      )}
      <div className="selected-course-grid">
        {selected.map(code => (
          <div key={code} className="selected-course">
            <span>
              <strong>{code}</strong>
              <small>{courses[code]?.name || 'Unknown course'}</small>
            </span>
            <button type="button" onClick={() => removeCourse(code)} aria-label={`Remove ${code}`}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function OnboardingFlow({ app, navigate }) {
  const { student, setStudent, programs, majors, minors, courses } = app;
  const [step, setStep] = useState(student.onboarding_complete ? 1 : 0);
  const [interestSuggestions, setInterestSuggestions] = useState([]);
  const [suggestionState, setSuggestionState] = useState('idle');
  const steps = ['Intro', 'Degree', 'Timeline', 'Quiz', 'Courses'];

  const program = programs[student.degree_code];
  const availableMajors = program?.available_majors || [];
  const availableMinors = program?.available_minors || [];

  const updateStudent = patch => setStudent(current => ({ ...current, ...patch }));

  useEffect(() => {
    let cancelled = false;
    if (!student.degree_code) {
      setInterestSuggestions([]);
      return undefined;
    }

    async function loadSuggestions() {
      setSuggestionState('loading');
      const fallback = localInterestSuggestions({ student, courses, programs, majors });
      try {
        const response = await suggestInterestsAI({
          student,
          program,
          major: majors[student.major_code],
          catalogue_interests: DEFAULT_INTERESTS,
        });
        if (!cancelled) {
          setInterestSuggestions(response.suggestions?.length ? response.suggestions : fallback);
          setSuggestionState(response.source === 'gemini' ? 'gemini' : 'local');
        }
      } catch (error) {
        if (!cancelled) {
          setInterestSuggestions(fallback);
          setSuggestionState('local');
        }
      }
    }

    loadSuggestions();
    return () => {
      cancelled = true;
    };
  }, [student.degree_code, student.major_code, courses, programs, majors, program]);

  const toggleInterest = interest => {
    setStudent(current => {
      const existing = new Set(current.interests || []);
      if (existing.has(interest)) existing.delete(interest);
      else existing.add(interest);
      return { ...current, interests: [...existing] };
    });
  };

  const canContinue = step !== 1 || Boolean(student.degree_code);

  const finish = () => {
    setStudent(current => ({ ...current, onboarding_complete: true }));
    navigate('/planner');
  };

  return (
    <div className="onboarding-page">
      <div className="onboarding-shell">
        <Stepper steps={steps} active={step} />

        {step === 0 && (
          <section className="onboarding-panel intro-panel">
            <div className="eyebrow"><Sparkles size={16} /> Personalised setup</div>
            <h1>Let’s turn your degree into a live map.</h1>
            <p>
              DegreeFlow asks for the few details that change your plan: degree rules,
              timing, workload preference, interests, and what you have already taken.
              The planner then validates every move as you drag courses through time.
            </p>
            <div className="intro-checks">
              <span><CheckCircle2 size={16} /> Multi-choice quiz</span>
              <span><CheckCircle2 size={16} /> Gemini interest suggestions</span>
              <span><CheckCircle2 size={16} /> Drag-and-drop flowchart</span>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="onboarding-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">Degree details</div>
                <h1>What are you studying?</h1>
              </div>
              {suggestionState === 'gemini' && <span className="ai-source"><Bot size={14} /> Gemini ready</span>}
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label className="label">Degree Program</label>
                <select
                  className="select"
                  value={student.degree_code}
                  onChange={event => updateStudent({ degree_code: event.target.value, major_code: '', minor_code: '' })}
                >
                  <option value="">Select a degree...</option>
                  {Object.values(programs).map(item => (
                    <option key={item.code} value={item.code}>{item.name} ({item.code})</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="label">Major</label>
                <select
                  className="select"
                  value={student.major_code}
                  onChange={event => updateStudent({ major_code: event.target.value })}
                  disabled={!availableMajors.length}
                >
                  <option value="">Select a major...</option>
                  {availableMajors.map(item => {
                    const major = majors[item.code] || item;
                    return <option key={item.code} value={item.code}>{major.name}</option>;
                  })}
                </select>
              </div>

              <div className="form-group">
                <label className="label">Minor</label>
                <select
                  className="select"
                  value={student.minor_code}
                  onChange={event => updateStudent({ minor_code: event.target.value })}
                  disabled={!availableMinors.length}
                >
                  <option value="">None</option>
                  {availableMinors.map(item => {
                    const minor = minors[item.code] || item;
                    return <option key={item.code} value={item.code}>{minor.name}</option>;
                  })}
                </select>
              </div>

              <div className="form-group">
                <label className="label">Handbook Year</label>
                <input
                  className="input"
                  type="number"
                  value={student.handbook_year}
                  onChange={event => updateStudent({ handbook_year: Number(event.target.value) || 2026 })}
                />
              </div>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="onboarding-panel">
            <div className="eyebrow">Timeline and pace</div>
            <h1>How should the timeline behave?</h1>
            <div className="form-grid">
              <div className="form-group">
                <label className="label">Current Year</label>
                <select className="select" value={student.current_year} onChange={event => updateStudent({ current_year: Number(event.target.value) })}>
                  {[1, 2, 3, 4, 5].map(year => <option key={year} value={year}>Year {year}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label">Current Semester</label>
                <select className="select" value={student.current_semester} onChange={event => updateStudent({ current_semester: event.target.value })}>
                  <option value="S1">Semester 1</option>
                  <option value="S2">Semester 2</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label">Target Semesters Remaining</label>
                <input
                  className="input"
                  min="2"
                  max="12"
                  type="number"
                  value={student.target_semesters}
                  onChange={event => updateStudent({ target_semesters: Number(event.target.value) || 6 })}
                />
              </div>
              <div className="form-group">
                <label className="label">Study Mode</label>
                <select className="select" value={student.study_mode} onChange={event => updateStudent({ study_mode: event.target.value })}>
                  <option value="Full-time">Full-time</option>
                  <option value="Part-time">Part-time</option>
                </select>
              </div>
            </div>

            <div className="choice-section">
              <label className="label">Preferred workload</label>
              <div className="choice-row">
                <ChoicePill active={student.preferred_workload === 'light'} onClick={() => updateStudent({ preferred_workload: 'light' })}>Lighter load</ChoicePill>
                <ChoicePill active={student.preferred_workload === 'balanced'} onClick={() => updateStudent({ preferred_workload: 'balanced' })}>Balanced</ChoicePill>
                <ChoicePill active={student.preferred_workload === 'challenging'} onClick={() => updateStudent({ preferred_workload: 'challenging' })}>More challenge</ChoicePill>
              </div>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="onboarding-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">Personalised quiz</div>
                <h1>What should electives optimise for?</h1>
              </div>
              <span className="ai-source"><Bot size={14} /> {suggestionState === 'loading' ? 'Thinking' : 'Suggestions'}</span>
            </div>

            <div className="choice-section">
              <label className="label">Interests</label>
              <div className="choice-row wrap">
                {[...interestSuggestions.map(item => item.label), ...DEFAULT_INTERESTS]
                  .filter((value, index, list) => list.indexOf(value) === index)
                  .slice(0, 14)
                  .map(interest => (
                    <ChoicePill
                      key={interest}
                      active={(student.interests || []).includes(interest)}
                      onClick={() => toggleInterest(interest)}
                    >
                      {interest}
                    </ChoicePill>
                  ))}
              </div>
              {interestSuggestions.length > 0 && (
                <div className="suggestion-notes">
                  {interestSuggestions.slice(0, 3).map(item => (
                    <span key={item.label}>{item.label}: {item.reason}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="choice-section">
              <label className="label">Assessment style</label>
              <div className="choice-row">
                <ChoicePill active={student.assessment_preference === 'mixed'} onClick={() => updateStudent({ assessment_preference: 'mixed' })}>Mixed</ChoicePill>
                <ChoicePill active={student.assessment_preference === 'assignment'} onClick={() => updateStudent({ assessment_preference: 'assignment' })}>Assignments/projects</ChoicePill>
                <ChoicePill active={student.assessment_preference === 'exam'} onClick={() => updateStudent({ assessment_preference: 'exam' })}>Exam-heavy</ChoicePill>
              </div>
            </div>

            <div className="choice-section">
              <label className="label">Challenge level</label>
              <div className="choice-row">
                <ChoicePill active={student.challenge_preference === 'steady'} onClick={() => updateStudent({ challenge_preference: 'steady' })}>Steady</ChoicePill>
                <ChoicePill active={student.challenge_preference === 'balanced'} onClick={() => updateStudent({ challenge_preference: 'balanced' })}>Balanced</ChoicePill>
                <ChoicePill active={student.challenge_preference === 'stretch'} onClick={() => updateStudent({ challenge_preference: 'stretch' })}>Stretch me</ChoicePill>
              </div>
            </div>

            <div className="form-group">
              <label className="label">Anything else Gemini should know?</label>
              <textarea
                className="input textarea"
                value={student.free_text_preferences}
                onChange={event => updateStudent({ free_text_preferences: event.target.value })}
                placeholder="Optional: e.g. avoid exam pile-ups, keep Fridays lighter, finish in 4 semesters..."
              />
            </div>
          </section>
        )}

        {step === 4 && (
          <section className="onboarding-panel">
            <div className="eyebrow">Course history</div>
            <h1>What should the planner treat as done or underway?</h1>
            <div className="dual-picker">
              <CoursePicker title="Completed courses" field="completed_courses" student={student} courses={courses} setStudent={setStudent} />
              <CoursePicker title="In progress now" field="current_courses" student={student} courses={courses} setStudent={setStudent} />
            </div>
          </section>
        )}

        <div className="onboarding-actions">
          <button className="btn btn-outline" disabled={step === 0} onClick={() => setStep(current => Math.max(0, current - 1))}>
            <ArrowLeft size={16} /> Back
          </button>
          {step < steps.length - 1 ? (
            <button className="btn btn-primary" disabled={!canContinue} onClick={() => setStep(current => Math.min(steps.length - 1, current + 1))}>
              Continue <ArrowRight size={16} />
            </button>
          ) : (
            <button className="btn btn-primary" onClick={finish}>
              Build my flowchart <Sparkles size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
