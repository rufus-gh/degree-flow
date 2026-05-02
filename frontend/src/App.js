import React, { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';

// ── Context ──────────────────────────────────────────────────────────
const AppContext = createContext();

function useApp() {
  return useContext(AppContext);
}

// ── Inline data (used when API not available) ────────────────────────
// In production, these would come from the backend API
import coursesData from './data/courses.json';
import programsData from './data/programs.json';
import majorsData from './data/majors.json';
import minorsData from './data/minors.json';

// ── Provider ─────────────────────────────────────────────────────────
function AppProvider({ children }) {
  const [student, setStudent] = useState({
    degree_code: '',
    major_code: '',
    minor_code: '',
    handbook_year: 2026,
    completed_courses: [],
    current_courses: [],
    interests: [],
    study_mode: 'Full-time',
  });

  const [courses] = useState(coursesData);
  const [programs] = useState(programsData);
  const [majors] = useState(majorsData);
  const [minors] = useState(minorsData);

  // ── Rules Engine (client-side fallback) ─────────────────────────
  const checkEligibility = useCallback((courseCode) => {
    const course = courses[courseCode];
    if (!course) return { eligible: false, reasons: ['Course not found'], missing_prerequisites: [] };

    const completed = new Set(student.completed_courses.map(c => c.toUpperCase()));
    if (completed.has(courseCode.toUpperCase())) {
      return { eligible: false, reasons: ['Already completed'], missing_prerequisites: [] };
    }

    const missing = (course.prerequisites || []).filter(p => !completed.has(p.toUpperCase()));
    const incompatDone = (course.incompatible || []).filter(i => completed.has(i.toUpperCase()));

    const reasons = [];
    if (missing.length) reasons.push(`Missing prerequisites: ${missing.join(', ')}`);
    incompatDone.forEach(i => reasons.push(`Incompatible with completed course ${i}`));

    return {
      eligible: missing.length === 0 && incompatDone.length === 0,
      reasons: reasons.length ? reasons : ['You are eligible to take this course'],
      missing_prerequisites: missing,
      incompatible_completed: incompatDone,
    };
  }, [courses, student.completed_courses]);

  const graduationAudit = useCallback(() => {
    const program = programs[student.degree_code];
    if (!program) return null;

    const completed = new Set(student.completed_courses.map(c => c.toUpperCase()));
    const totalUnits = [...completed].reduce((sum, c) => sum + (courses[c]?.units || 0), 0);
    const requiredUnits = program.total_units || 144;

    const missing = [];
    const done = [];

    // Total units
    if (totalUnits >= requiredUnits) {
      done.push({ type: 'units', description: `${totalUnits}/${requiredUnits} units completed` });
    } else {
      missing.push({ type: 'units', description: `Need ${requiredUnits - totalUnits} more units (${totalUnits}/${requiredUnits})` });
    }

    // Core courses
    (program.rules || []).forEach(rule => {
      if (rule.type === 'course_requirement') {
        (rule.courses || []).forEach(c => {
          const name = courses[c]?.name || c;
          if (completed.has(c.toUpperCase())) {
            done.push({ type: 'core', description: `${c} — ${name}` });
          } else {
            missing.push({ type: 'core', description: `${c} — ${name}` });
          }
        });
      }
    });

    // Level requirements
    const level3000 = [...completed].reduce((sum, c) =>
      sum + ((courses[c]?.level || 0) >= 3000 ? (courses[c]?.units || 0) : 0), 0
    );
    (program.rules || []).forEach(rule => {
      if (rule.type === 'level_requirement') {
        const req = rule.minimum_units || 30;
        if (level3000 >= req) {
          done.push({ type: 'level', description: `${level3000}/${req} units at 3000+ level` });
        } else {
          missing.push({ type: 'level', description: `Need ${req - level3000} more 3000+ units (${level3000}/${req})` });
        }
      }
    });

    return {
      can_graduate: missing.length === 0,
      total_units_completed: totalUnits,
      total_units_required: requiredUnits,
      missing,
      completed: done,
    };
  }, [programs, courses, student]);

  const generatePlan = useCallback(() => {
    const program = programs[student.degree_code];
    if (!program) return null;

    const completed = new Set(student.completed_courses.map(c => c.toUpperCase()));
    const needed = new Set();

    // Core courses
    (program.rules || []).forEach(rule => {
      if (rule.type === 'course_requirement') {
        rule.courses.forEach(c => { if (!completed.has(c.toUpperCase())) needed.add(c.toUpperCase()); });
      }
    });

    // Major courses
    const major = majors[student.major_code];
    if (major) {
      major.required_courses.forEach(c => { if (!completed.has(c.toUpperCase())) needed.add(c.toUpperCase()); });
      // Add electives to fill major
      let majorUnits = [...completed].filter(c =>
        [...major.required_courses, ...major.elective_courses].map(x => x.toUpperCase()).includes(c)
      ).reduce((s, c) => s + (courses[c]?.units || 0), 0);
      majorUnits += [...needed].filter(c =>
        [...major.required_courses, ...major.elective_courses].map(x => x.toUpperCase()).includes(c)
      ).reduce((s, c) => s + (courses[c]?.units || 0), 0);

      if (majorUnits < (major.units || 48)) {
        for (const c of major.elective_courses) {
          if (!completed.has(c.toUpperCase()) && !needed.has(c.toUpperCase())) {
            needed.add(c.toUpperCase());
            majorUnits += courses[c]?.units || 6;
            if (majorUnits >= (major.units || 48)) break;
          }
        }
      }
    }

    // Topological sort
    const sorted = [];
    const visited = new Set();
    function dfs(code) {
      if (visited.has(code)) return;
      visited.add(code);
      const course = courses[code];
      if (course) {
        (course.prerequisites || []).forEach(p => {
          if (needed.has(p.toUpperCase())) dfs(p.toUpperCase());
        });
      }
      sorted.push(code);
    }
    [...needed].forEach(c => dfs(c));

    // Assign to semesters
    const semesters = [];
    const assigned = new Set(completed);
    const remaining = [...sorted];
    const semNames = ['S1', 'S2'];

    for (let i = 0; i < 8 && remaining.length; i++) {
      const semName = semNames[i % 2];
      const year = Math.floor(i / 2) + 1;
      const semCourses = [];

      for (const code of [...remaining]) {
        if (semCourses.length >= 4) break;
        const course = courses[code];
        if (!course) continue;
        const prereqsMet = (course.prerequisites || []).every(p => assigned.has(p.toUpperCase()));
        const availableThisSem = !course.terms_offered?.length || course.terms_offered.includes(semName);
        if (prereqsMet && availableThisSem) {
          semCourses.push(code);
          remaining.splice(remaining.indexOf(code), 1);
        }
      }

      semCourses.forEach(c => assigned.add(c));
      if (semCourses.length) {
        semesters.push({
          year,
          semester: `Year ${year} ${semName}`,
          courses: semCourses,
          total_units: semCourses.reduce((s, c) => s + (courses[c]?.units || 6), 0),
        });
      }
    }

    return { semesters, unscheduled: remaining };
  }, [programs, courses, majors, student]);

  const value = {
    student, setStudent,
    courses, programs, majors, minors,
    checkEligibility, graduationAudit, generatePlan,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ── Navigation ───────────────────────────────────────────────────────
function Nav() {
  const location = useLocation();
  const links = [
    { to: '/', label: 'Home' },
    { to: '/setup', label: 'Setup' },
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/courses', label: 'Courses' },
    { to: '/planner', label: 'Planner' },
    { to: '/audit', label: 'Audit' },
  ];
  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link to="/" className="nav-logo">Degree<span>Flow</span></Link>
        <div className="nav-links">
          {links.map(l => (
            <Link key={l.to} to={l.to}
              className={`nav-link${location.pathname === l.to ? ' active' : ''}`}>
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}

// ── Home Page ────────────────────────────────────────────────────────
function HomePage() {
  const { courses, programs, majors } = useApp();
  const navigate = useNavigate();
  return (
    <div>
      <div className="hero">
        <h1>Navigate your <span>ANU degree</span> with confidence</h1>
        <p>
          Understand your degree requirements, choose the right courses,
          generate valid study plans, and check if you're on track to graduate.
        </p>
        <button className="btn btn-primary" style={{ fontSize: '1rem', padding: '0.8rem 2rem' }}
          onClick={() => navigate('/setup')}>
          Start Planning →
        </button>
      </div>

      <div className="grid grid-4" style={{ marginTop: '2rem' }}>
        {[
          { value: Object.keys(courses).length, label: 'Courses' },
          { value: Object.keys(programs).length, label: 'Programs' },
          { value: Object.keys(majors).length, label: 'Majors' },
          { value: '2026', label: 'Handbook Year' },
        ].map((s, i) => (
          <div key={i} className="card stat">
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-3" style={{ marginTop: '2rem' }}>
        {[
          { title: 'Degree Setup', desc: 'Select your degree, major, minor, and enter completed courses.', to: '/setup' },
          { title: 'Course Explorer', desc: 'Search and filter courses. See prerequisites and eligibility.', to: '/courses' },
          { title: 'Smart Planner', desc: 'Generate a valid semester-by-semester plan that follows all rules.', to: '/planner' },
          { title: 'Graduation Audit', desc: 'Check if you have met all requirements to graduate.', to: '/audit' },
          { title: 'Risk Warnings', desc: 'See warnings about risky choices that could delay graduation.', to: '/planner' },
          { title: 'What-If Simulator', desc: 'Test what happens if you change your major or minor.', to: '/planner' },
        ].map((f, i) => (
          <Link key={i} to={f.to} className="card" style={{ textDecoration: 'none' }}>
            <div className="card-title">{f.title}</div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>{f.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Setup Page ───────────────────────────────────────────────────────
function SetupPage() {
  const { student, setStudent, programs, majors, minors, courses } = useApp();
  const navigate = useNavigate();
  const [courseInput, setCourseInput] = useState('');

  const program = programs[student.degree_code];
  const availableMajors = program?.available_majors || [];
  const availableMinors = program?.available_minors || [];

  const addCourse = () => {
    const code = courseInput.toUpperCase().trim();
    if (code && courses[code] && !student.completed_courses.includes(code)) {
      setStudent(s => ({ ...s, completed_courses: [...s.completed_courses, code] }));
      setCourseInput('');
    }
  };

  const removeCourse = (code) => {
    setStudent(s => ({ ...s, completed_courses: s.completed_courses.filter(c => c !== code) }));
  };

  const completedUnits = student.completed_courses.reduce((s, c) => s + (courses[c]?.units || 0), 0);

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', marginBottom: '1.5rem' }}>Degree Setup</h1>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title">Program Details</div>
          <div className="form-group" style={{ marginTop: '1rem' }}>
            <label className="label">Degree Program</label>
            <select className="select" value={student.degree_code}
              onChange={e => setStudent(s => ({ ...s, degree_code: e.target.value, major_code: '', minor_code: '' }))}>
              <option value="">Select a degree...</option>
              {Object.values(programs).map(p => (
                <option key={p.code} value={p.code}>{p.name} ({p.code})</option>
              ))}
            </select>
          </div>

          {availableMajors.length > 0 && (
            <div className="form-group">
              <label className="label">Major</label>
              <select className="select" value={student.major_code}
                onChange={e => setStudent(s => ({ ...s, major_code: e.target.value }))}>
                <option value="">Select a major...</option>
                {availableMajors.map(m => (
                  <option key={m.code} value={m.code}>{m.name}</option>
                ))}
              </select>
            </div>
          )}

          {availableMinors.length > 0 && (
            <div className="form-group">
              <label className="label">Minor (optional)</label>
              <select className="select" value={student.minor_code}
                onChange={e => setStudent(s => ({ ...s, minor_code: e.target.value }))}>
                <option value="">None</option>
                {availableMinors.map(m => (
                  <option key={m.code} value={m.code}>{m.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="form-group">
            <label className="label">Study Mode</label>
            <select className="select" value={student.study_mode}
              onChange={e => setStudent(s => ({ ...s, study_mode: e.target.value }))}>
              <option value="Full-time">Full-time</option>
              <option value="Part-time">Part-time</option>
            </select>
          </div>

          <div className="form-group">
            <label className="label">Interests (for recommendations)</label>
            <select className="select" multiple style={{ height: '120px' }}
              value={student.interests}
              onChange={e => setStudent(s => ({
                ...s, interests: Array.from(e.target.selectedOptions, o => o.value)
              }))}>
              {['Computer Science', 'Artificial Intelligence', 'Machine Learning',
                'Cybersecurity', 'Software Engineering', 'Data Science',
                'Mathematics', 'Networks', 'Systems'].map(i => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Completed Courses</div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.5rem 0 1rem' }}>
            {student.completed_courses.length} courses · {completedUnits} units
          </p>

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <input className="input" placeholder="Course code (e.g. COMP1100)"
              value={courseInput} onChange={e => setCourseInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCourse()} />
            <button className="btn btn-primary" onClick={addCourse}>Add</button>
          </div>

          <div style={{ maxHeight: '400px', overflow: 'auto' }}>
            {student.completed_courses.map(code => {
              const course = courses[code];
              return (
                <div key={code} className="course-chip">
                  <span className="code">{code}</span>
                  <span className="name">{course?.name || 'Unknown'}</span>
                  <span className="units">{course?.units || 6}u</span>
                  <button className="btn btn-sm btn-outline" onClick={() => removeCourse(code)}
                    style={{ marginLeft: '0.5rem', padding: '0.2rem 0.5rem' }}>✕</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {student.degree_code && (
        <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
          <button className="btn btn-primary" style={{ fontSize: '1rem', padding: '0.8rem 2rem' }}
            onClick={() => navigate('/dashboard')}>
            Continue to Dashboard →
          </button>
        </div>
      )}
    </div>
  );
}

// ── Dashboard Page ───────────────────────────────────────────────────
function DashboardPage() {
  const { student, courses, programs, majors, graduationAudit, checkEligibility } = useApp();
  const navigate = useNavigate();

  if (!student.degree_code) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', marginBottom: '1rem' }}>No degree selected</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Set up your degree first to see your dashboard.</p>
        <button className="btn btn-primary" onClick={() => navigate('/setup')}>Go to Setup</button>
      </div>
    );
  }

  const program = programs[student.degree_code];
  const major = majors[student.major_code];
  const audit = graduationAudit();
  const completedUnits = student.completed_courses.reduce((s, c) => s + (courses[c]?.units || 0), 0);
  const progress = Math.min(100, Math.round((completedUnits / (program?.total_units || 144)) * 100));

  // Next available courses
  const availableCourses = Object.keys(courses).filter(code => {
    if (student.completed_courses.includes(code)) return false;
    const elig = checkEligibility(code);
    return elig.eligible;
  }).slice(0, 6);

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', marginBottom: '0.5rem' }}>
        {program?.name || student.degree_code}
      </h1>
      {major && <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Major: {major.name}</p>}

      <div className="grid grid-4" style={{ marginBottom: '1.5rem' }}>
        <div className="card stat">
          <div className="stat-value">{progress}%</div>
          <div className="stat-label">Progress</div>
        </div>
        <div className="card stat">
          <div className="stat-value">{completedUnits}/{program?.total_units || 144}</div>
          <div className="stat-label">Units</div>
        </div>
        <div className="card stat">
          <div className="stat-value">{student.completed_courses.length}</div>
          <div className="stat-label">Courses Done</div>
        </div>
        <div className="card stat">
          <div className="stat-value" style={{ color: audit?.can_graduate ? 'var(--green)' : 'var(--amber)' }}>
            {audit?.can_graduate ? 'Ready' : 'Not Yet'}
          </div>
          <div className="stat-label">Graduation</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-title">Degree Progress</div>
        <div className="progress-bar" style={{ marginTop: '1rem' }}>
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
          {completedUnits} of {program?.total_units || 144} units completed
        </p>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-header">
            <div className="card-title">Requirements</div>
            <button className="btn btn-sm btn-outline" onClick={() => navigate('/audit')}>Full Audit</button>
          </div>
          {audit?.completed?.map((r, i) => (
            <div key={i} className="check-item">
              <span className="check-icon done">✓</span>
              <span className="check-text">{r.description}</span>
            </div>
          ))}
          {audit?.missing?.map((r, i) => (
            <div key={i} className="check-item">
              <span className="check-icon missing">✗</span>
              <span className="check-text">{r.description}</span>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Available Courses</div>
            <button className="btn btn-sm btn-outline" onClick={() => navigate('/courses')}>Browse All</button>
          </div>
          {availableCourses.map(code => (
            <div key={code} className="course-chip" onClick={() => navigate(`/courses?selected=${code}`)}>
              <span className="code">{code}</span>
              <span className="name">{courses[code]?.name}</span>
              <span className="badge badge-green">Eligible</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Courses Page ─────────────────────────────────────────────────────
function CoursesPage() {
  const { courses, student, checkEligibility } = useApp();
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [semFilter, setSemFilter] = useState('');
  const [selectedCourse, setSelectedCourse] = useState(null);

  const filtered = Object.values(courses).filter(c => {
    if (search) {
      const q = search.toLowerCase();
      if (!c.code.toLowerCase().includes(q) && !c.name.toLowerCase().includes(q) && !(c.description || '').toLowerCase().includes(q)) return false;
    }
    if (levelFilter && c.level !== parseInt(levelFilter)) return false;
    if (semFilter && !(c.terms_offered || []).includes(semFilter)) return false;
    return true;
  });

  const selected = selectedCourse ? courses[selectedCourse] : null;
  const eligibility = selectedCourse ? checkEligibility(selectedCourse) : null;

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', marginBottom: '1.5rem' }}>Course Explorer</h1>

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <input className="input" style={{ maxWidth: '320px' }} placeholder="Search courses..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <select className="select" style={{ maxWidth: '160px' }} value={levelFilter}
          onChange={e => setLevelFilter(e.target.value)}>
          <option value="">All Levels</option>
          <option value="1000">1000-level</option>
          <option value="2000">2000-level</option>
          <option value="3000">3000-level</option>
          <option value="4000">4000-level</option>
        </select>
        <select className="select" style={{ maxWidth: '160px' }} value={semFilter}
          onChange={e => setSemFilter(e.target.value)}>
          <option value="">All Semesters</option>
          <option value="S1">Semester 1</option>
          <option value="S2">Semester 2</option>
        </select>
      </div>

      <div style={{ display: 'flex', gap: '1.25rem' }}>
        <div style={{ flex: 1 }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
            {filtered.length} courses found
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Units</th>
                  <th>Level</th>
                  <th>Offered</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const elig = checkEligibility(c.code);
                  const isCompleted = student.completed_courses.includes(c.code);
                  return (
                    <tr key={c.code} onClick={() => setSelectedCourse(c.code)} style={{ cursor: 'pointer' }}>
                      <td><strong style={{ color: 'var(--accent)' }}>{c.code}</strong></td>
                      <td>{c.name}</td>
                      <td>{c.units}</td>
                      <td>{c.level}</td>
                      <td>{(c.terms_offered || []).join(', ') || '—'}</td>
                      <td>
                        {isCompleted ? <span className="badge badge-green">Done</span> :
                         elig.eligible ? <span className="badge badge-blue">Eligible</span> :
                         <span className="badge badge-red">Locked</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {selected && (
          <div className="card" style={{ width: '380px', flexShrink: 0, alignSelf: 'flex-start', position: 'sticky', top: '80px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 700 }}>{selected.code}</div>
                <div className="card-title">{selected.name}</div>
              </div>
              <button className="btn btn-sm btn-outline" onClick={() => setSelectedCourse(null)}>✕</button>
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.75rem 0' }}>
              {selected.description}
            </p>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <span className="badge badge-blue">{selected.units} units</span>
              <span className="badge badge-purple">Level {selected.level}</span>
              {(selected.terms_offered || []).map(t => (
                <span key={t} className="badge badge-green">{t}</span>
              ))}
              {selected.is_stem && <span className="badge badge-amber">STEM</span>}
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <div className="label">Eligibility</div>
              <div className={`alert ${eligibility?.eligible ? 'alert-success' : 'alert-danger'}`}>
                {eligibility?.reasons?.map((r, i) => <div key={i}>{r}</div>)}
              </div>
            </div>

            {selected.prerequisites?.length > 0 && (
              <div style={{ marginBottom: '0.75rem' }}>
                <div className="label">Prerequisites</div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {selected.prerequisites.map(p => (
                    <span key={p} className={`badge ${student.completed_courses.includes(p) ? 'badge-green' : 'badge-red'}`}>
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {selected.incompatible?.length > 0 && (
              <div style={{ marginBottom: '0.75rem' }}>
                <div className="label">Incompatible With</div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {selected.incompatible.map(p => (
                    <span key={p} className="badge badge-amber">{p}</span>
                  ))}
                </div>
              </div>
            )}

            {selected.school && (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                <strong>School:</strong> {selected.school}
              </div>
            )}

            {selected.url && (
              <a href={selected.url} target="_blank" rel="noopener noreferrer"
                className="btn btn-outline btn-sm" style={{ marginTop: '1rem', width: '100%', justifyContent: 'center' }}>
                View on ANU Website →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Planner Page ─────────────────────────────────────────────────────
function PlannerPage() {
  const { student, courses, programs, majors, generatePlan } = useApp();
  const [plan, setPlan] = useState(null);
  const navigate = useNavigate();

  if (!student.degree_code) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', marginBottom: '1rem' }}>No degree selected</h2>
        <button className="btn btn-primary" onClick={() => navigate('/setup')}>Go to Setup</button>
      </div>
    );
  }

  const program = programs[student.degree_code];

  const handleGenerate = () => {
    const result = generatePlan();
    setPlan(result);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontFamily: 'var(--font-display)' }}>Study Planner</h1>
        <button className="btn btn-primary" onClick={handleGenerate}>Generate Plan</button>
      </div>

      {!plan && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <h3 style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Click "Generate Plan" to create your semester-by-semester study plan
          </h3>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
            {program?.name} · {student.completed_courses.length} courses completed
            {student.major_code && ` · Major: ${majors[student.major_code]?.name}`}
          </p>
        </div>
      )}

      {plan && (
        <>
          {plan.unscheduled?.length > 0 && (
            <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
              ⚠ {plan.unscheduled.length} course(s) could not be scheduled: {plan.unscheduled.join(', ')}
            </div>
          )}

          <div className="semester-grid">
            {plan.semesters?.map((sem, i) => (
              <div key={i} className="card semester-card">
                <div className="semester-label">{sem.semester}</div>
                {sem.courses.map(code => (
                  <div key={code} className="course-chip">
                    <span className="code">{code}</span>
                    <span className="name">{courses[code]?.name || code}</span>
                    <span className="units">{courses[code]?.units || 6}u</span>
                  </div>
                ))}
                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.5rem', textAlign: 'right' }}>
                  {sem.total_units} units
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Audit Page ───────────────────────────────────────────────────────
function AuditPage() {
  const { student, courses, programs, majors, graduationAudit } = useApp();
  const navigate = useNavigate();

  if (!student.degree_code) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', marginBottom: '1rem' }}>No degree selected</h2>
        <button className="btn btn-primary" onClick={() => navigate('/setup')}>Go to Setup</button>
      </div>
    );
  }

  const audit = graduationAudit();
  const program = programs[student.degree_code];
  const progress = Math.min(100, Math.round(((audit?.total_units_completed || 0) / (audit?.total_units_required || 144)) * 100));

  // Course mapping: show how each completed course is used
  const courseUsage = student.completed_courses.map(code => {
    const course = courses[code];
    const uses = [];
    // Check if it's a core course
    const isCore = (program?.rules || []).some(r =>
      r.type === 'course_requirement' && (r.courses || []).includes(code)
    );
    if (isCore) uses.push('Core requirement');

    const major = majors[student.major_code];
    if (major) {
      if (major.required_courses.includes(code)) uses.push(`Major required (${major.name})`);
      else if (major.elective_courses.includes(code)) uses.push(`Major elective (${major.name})`);
    }

    if (uses.length === 0) uses.push('Elective');

    return { code, name: course?.name || code, units: course?.units || 6, usage: uses.join(', ') };
  });

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', marginBottom: '1.5rem' }}>Graduation Audit</h1>

      <div className={`alert ${audit?.can_graduate ? 'alert-success' : 'alert-warning'}`} style={{ marginBottom: '1.5rem' }}>
        <span style={{ fontSize: '1.5rem' }}>{audit?.can_graduate ? '🎓' : '📋'}</span>
        <div>
          <strong>{audit?.can_graduate ? 'You are eligible to graduate!' : 'You are not yet eligible to graduate.'}</strong>
          <div style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
            {audit?.total_units_completed} / {audit?.total_units_required} units completed ({progress}%)
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-title">Progress</div>
        <div className="progress-bar" style={{ marginTop: '1rem', height: '12px' }}>
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title" style={{ color: 'var(--green)' }}>✓ Completed Requirements</div>
          {audit?.completed?.map((r, i) => (
            <div key={i} className="check-item">
              <span className="check-icon done">✓</span>
              <span className="check-text">{r.description}</span>
            </div>
          ))}
          {!audit?.completed?.length && (
            <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', padding: '1rem 0' }}>No requirements completed yet</p>
          )}
        </div>

        <div className="card">
          <div className="card-title" style={{ color: 'var(--red)' }}>✗ Missing Requirements</div>
          {audit?.missing?.map((r, i) => (
            <div key={i} className="check-item">
              <span className="check-icon missing">✗</span>
              <span className="check-text">{r.description}</span>
            </div>
          ))}
          {!audit?.missing?.length && (
            <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', padding: '1rem 0' }}>All requirements met!</p>
          )}
        </div>
      </div>

      {courseUsage.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <div className="card-title">Course Usage Map</div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
            How each completed course counts toward your degree
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Code</th><th>Name</th><th>Units</th><th>Counts Toward</th></tr>
              </thead>
              <tbody>
                {courseUsage.map(c => (
                  <tr key={c.code}>
                    <td><strong style={{ color: 'var(--accent)' }}>{c.code}</strong></td>
                    <td>{c.name}</td>
                    <td>{c.units}</td>
                    <td><span className="badge badge-blue">{c.usage}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────────
function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <div className="app">
          <Nav />
          <div className="main">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/setup" element={<SetupPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/courses" element={<CoursesPage />} />
              <Route path="/planner" element={<PlannerPage />} />
              <Route path="/audit" element={<AuditPage />} />
            </Routes>
          </div>
        </div>
      </AppProvider>
    </BrowserRouter>
  );
}

export default App;
