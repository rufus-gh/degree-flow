import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  GripVertical,
  Lock,
  Plus,
  RefreshCcw,
  Search,
  Sparkles,
  Target,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { optimisePlanAI, suggestElectivesAI } from '../utils/api';
import {
  addCourseWithPrerequisites,
  buildDegreePlan,
  clonePlan,
  evaluateDrop,
  getAssessmentFocus,
  getExpectedProgress,
  getCourseCapacity,
  isRequiredCourse,
  normaliseCode,
  parseWorkloadHours,
  reflowPlan,
  scoreCourseForPreferences,
  sumUnits,
  uniqueCodes,
  validateTimeline,
} from '../utils/planner';

function CourseStateBadge({ status }) {
  if (status?.invalid) return <span className="state-badge invalid">Invalid</span>;
  if (status?.state === 'completed') return <span className="state-badge completed">Completed</span>;
  if (status?.state === 'in-progress') return <span className="state-badge progress">In progress</span>;
  return <span className="state-badge planned">Planned</span>;
}

function CourseCard({ code, context, status, onDragStart, onRemove, removable = true }) {
  const { courses, programs, majors, minors, student } = context;
  const course = courses[code] || { code, name: 'Unknown course', prerequisites: [], corequisites: [], terms_offered: [] };
  const program = programs[student.degree_code];
  const major = majors[student.major_code];
  const minor = minors[student.minor_code];
  const required = status?.required || isRequiredCourse(code, program, major, minor);
  const focus = getAssessmentFocus(course);
  const hours = parseWorkloadHours(course.workload);
  const stateClass = status?.invalid ? 'invalid' : status?.state || 'planned';

  return (
    <article
      className={`flow-course ${stateClass} ${required ? 'required' : ''}`}
      draggable={status?.state !== 'completed'}
      onDragStart={event => onDragStart(event, code)}
    >
      <div className="course-drag-handle"><GripVertical size={16} /></div>
      <div className="flow-course-main">
        <div className="flow-course-top">
          <strong>{code}</strong>
          <div className="course-tags">
            {required && <span className="state-badge required"><Lock size={12} /> Compulsory</span>}
            <CourseStateBadge status={status} />
          </div>
        </div>
        <div className="flow-course-name">{course.name}</div>
        <div className="course-meta-row">
          <span>{course.units || 6} units</span>
          <span>{hours}h</span>
          <span>{focus}</span>
          <span>{(course.terms_offered || []).join('/') || 'Any term'}</span>
        </div>
        <div className="flow-course-details">
          {(course.prerequisites || []).length > 0 && (
            <div className="dependency-row prereq-line">
              <span>Prereq</span>
              <strong>{course.prerequisites.join(', ')}</strong>
            </div>
          )}
          {(course.corequisites || []).length > 0 && (
            <div className="dependency-row coreq-line">
              <span>Coreq</span>
              <strong>{course.corequisites.join(', ')}</strong>
            </div>
          )}
          {status?.reasons?.length > 0 && (
            <div className="course-reason">{status.reasons[0]}</div>
          )}
        </div>
      </div>
      {removable && status?.state === 'planned' && (
        <button className="icon-button remove-course" onClick={() => onRemove(code)} aria-label={`Remove ${code}`}>
          <X size={14} />
        </button>
      )}
    </article>
  );
}

function ProgressComparison({ validation, expectedProgress, aligned }) {
  return (
    <div className={`progress-comparison ${aligned ? 'aligned' : 'behind'}`}>
      <div className="progress-labels">
        <span>Completed {validation.currentProgress}%</span>
        <span>Planned {validation.plannedProgress}%</span>
        <span>Expected {expectedProgress}%</span>
      </div>
      <div className="comparison-track">
        <div className="comparison-fill completed" style={{ width: `${validation.currentProgress}%` }} />
        <div className="comparison-fill planned" style={{ width: `${validation.plannedProgress}%` }} />
        <div className="expected-marker" style={{ left: `${expectedProgress}%` }}>
          <span />
        </div>
      </div>
    </div>
  );
}

function FeedbackPanel({ validation, expectedProgress, smartResult, aiLoading, onSmart }) {
  const hasIssues = validation.issues.length > 0;
  const aligned = !hasIssues && validation.plannedProgress >= expectedProgress;

  return (
    <aside className={`feedback-panel ${hasIssues ? 'danger' : 'success'}`}>
      <div className="feedback-title">
        {hasIssues ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
        <strong>{hasIssues ? 'Plan needs attention' : 'Plan is looking good'}</strong>
      </div>
      <ProgressComparison validation={validation} expectedProgress={expectedProgress} aligned={aligned} />
      <div className="feedback-list">
        {(hasIssues ? validation.issues : ['No blocking prerequisite, timing, or unit issues detected.'])
          .slice(0, 5)
          .map(item => <p key={item}>{item}</p>)}
        {!hasIssues && validation.warnings.slice(0, 2).map(item => <p key={item}>{item}</p>)}
      </div>
      {smartResult?.plan_strategy && (
        <div className="smart-result">
          <Bot size={15} />
          <span>{smartResult.plan_strategy}</span>
        </div>
      )}
      {hasIssues && (
        <button className="btn btn-primary smart-button" onClick={onSmart} disabled={aiLoading}>
          <Wand2 size={16} /> {aiLoading ? 'Optimising...' : 'Smart optimise'}
        </button>
      )}
    </aside>
  );
}

function SemesterNode({ semester, index, context, validation, dropPreview, onDragStart, onDragOver, onDragLeave, onDrop, onRemove }) {
  const unitTotal = sumUnits(context.courses, semester.courses);
  const hours = uniqueCodes(semester.courses).reduce((sum, code) => sum + parseWorkloadHours(context.courses[code]?.workload), 0);
  const capacity = getCourseCapacity(context.student);
  const preview = dropPreview?.index === index ? dropPreview : null;

  return (
    <section
      className={`semester-node ${preview ? (preview.valid ? 'drop-valid' : 'drop-invalid') : ''}`}
      onDragOver={event => onDragOver(event, index)}
      onDragLeave={onDragLeave}
      onDrop={event => onDrop(event, index)}
    >
      <div className="semester-spine" />
      <div className="semester-card-flow">
        <div className="semester-flow-header">
          <div>
            <span className="semester-kicker">{semester.term}</span>
            <h2>{semester.semester}</h2>
          </div>
          <div className="semester-load">
            <strong>{unitTotal}u</strong>
            <span>{semester.courses.length}/{capacity} courses · {hours}h</span>
          </div>
        </div>

        {preview && (
          <div className={`drop-message ${preview.valid ? 'ok' : 'bad'}`}>
            {preview.valid ? 'This course fits here.' : preview.reasons[0]}
          </div>
        )}

        <div className="flow-course-stack">
          {semester.courses.map(code => (
            <CourseCard
              key={`${semester.id}-${code}`}
              code={code}
              context={context}
              status={validation.statusByCourse[code]}
              onDragStart={(event, courseCode) => onDragStart(event, courseCode, index)}
              onRemove={courseCode => onRemove(courseCode, index)}
            />
          ))}
          {semester.courses.length === 0 && (
            <div className="empty-dropzone">Drop compatible courses here</div>
          )}
        </div>
      </div>
    </section>
  );
}

function Legend() {
  return (
    <div className="legend-panel">
      <div className="legend-title">Legend</div>
      <span><i className="legend-line dotted" /> Dotted prerequisite</span>
      <span><i className="legend-line solid" /> Solid corequisite</span>
      <span><i className="legend-line future" /> Grey future path</span>
      <span><i className="legend-chip completed" /> Completed</span>
      <span><i className="legend-chip invalid" /> Invalid</span>
      <span><i className="legend-chip required" /> Compulsory</span>
    </div>
  );
}

export default function DegreeTimelinePlanner({ app, navigate }) {
  const { student, courses, programs, majors, minors } = app;
  const [plan, setPlan] = useState(null);
  const [dragged, setDragged] = useState(null);
  const [dropPreview, setDropPreview] = useState(null);
  const [searchOpen, setSearchOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [zoom, setZoom] = useState(0.95);
  const [aiLoading, setAiLoading] = useState(false);
  const [electiveLoading, setElectiveLoading] = useState(false);
  const [aiElectives, setAiElectives] = useState([]);
  const [smartResult, setSmartResult] = useState(null);

  const context = useMemo(() => ({ student, courses, programs, majors, minors }), [student, courses, programs, majors, minors]);
  const program = programs[student.degree_code];
  const major = majors[student.major_code];

  useEffect(() => {
    if (student.degree_code && !plan) {
      setPlan(buildDegreePlan(context));
    }
  }, [student.degree_code, context, plan]);

  const validation = useMemo(() => {
    if (!plan) return null;
    return validateTimeline(plan, context);
  }, [plan, context]);

  const expectedProgress = getExpectedProgress(student, program || {});
  const aligned = validation ? validation.issues.length === 0 && validation.plannedProgress >= expectedProgress : false;

  const filteredCourses = useMemo(() => {
    const query = search.trim().toLowerCase();
    const planned = new Set((plan?.semesters || []).flatMap(semester => semester.courses));

    return Object.values(courses)
      .filter(course => !query || `${course.code} ${course.name} ${course.description || ''}`.toLowerCase().includes(query))
      .sort((a, b) => {
        const aPlanned = planned.has(a.code) ? -100 : 0;
        const bPlanned = planned.has(b.code) ? -100 : 0;
        return (bPlanned + scoreCourseForPreferences(b, student, major)) - (aPlanned + scoreCourseForPreferences(a, student, major));
      })
      .slice(0, query ? 16 : 28);
  }, [courses, search, student, major, plan]);

  if (!student.degree_code) {
    return (
      <div className="card empty-state-card">
        <h2>No degree selected</h2>
        <p>Run onboarding first so the planner knows your degree rules and preferences.</p>
        <button className="btn btn-primary" onClick={() => navigate('/setup')}>
          Start onboarding
        </button>
      </div>
    );
  }

  const regenerate = () => {
    setSmartResult(null);
    setPlan(buildDegreePlan(context));
  };

  const handleDragStart = (event, code, fromSemesterIndex = null) => {
    const courseCode = normaliseCode(code);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', courseCode);
    setDragged({ code: courseCode, fromSemesterIndex });
  };

  const handleDragOver = (event, semesterIndex) => {
    event.preventDefault();
    const code = dragged?.code || normaliseCode(event.dataTransfer.getData('text/plain'));
    if (!code || !plan) return;
    const preview = evaluateDrop(plan, code, semesterIndex, dragged?.fromSemesterIndex, context);
    setDropPreview({ index: semesterIndex, ...preview });
  };

  const handleDrop = (event, semesterIndex) => {
    event.preventDefault();
    const code = dragged?.code || normaliseCode(event.dataTransfer.getData('text/plain'));
    if (!code || !plan) return;

    const preview = evaluateDrop(plan, code, semesterIndex, dragged?.fromSemesterIndex, context);
    if (preview.valid) {
      setPlan(preview.nextPlan);
      setSmartResult(null);
    } else {
      setSmartResult({
        plan_strategy: `${code} does not fit in ${plan.semesters[semesterIndex].semester}: ${preview.reasons[0]}`,
      });
    }
    setDragged(null);
    setDropPreview(null);
  };

  const removeCourse = (code, semesterIndex) => {
    const next = clonePlan(plan);
    next.semesters[semesterIndex].courses = next.semesters[semesterIndex].courses.filter(existing => existing !== code);
    setPlan(next);
  };

  const addCourse = code => {
    setPlan(addCourseWithPrerequisites(plan, code, context));
    setSmartResult(null);
  };

  const suggestElectives = async () => {
    if (!validation) return;
    setElectiveLoading(true);
    const fallback = Object.values(courses)
      .filter(course => !(plan?.semesters || []).some(semester => semester.courses.includes(course.code)))
      .sort((a, b) => scoreCourseForPreferences(b, student, major) - scoreCourseForPreferences(a, student, major))
      .slice(0, 6)
      .map(course => ({
        code: course.code,
        reason: `Matches ${student.interests?.[0] || 'your preferences'} and can be planned with prerequisites.`,
        prerequisites: course.prerequisites || [],
        risk: 'Low',
      }));

    try {
      const response = await suggestElectivesAI({
        student,
        plan,
        issues: validation.issues,
        interests: student.interests,
      });
      setAiElectives(response.electives?.length ? response.electives : fallback);
      setSmartResult({ plan_strategy: response.plan_notes || 'Electives suggested from your preferences.' });
    } catch (error) {
      setAiElectives(fallback);
      setSmartResult({ plan_strategy: 'Using local elective suggestions because Gemini is unavailable.' });
    } finally {
      setElectiveLoading(false);
    }
  };

  const smartOptimise = async () => {
    if (!validation) return;
    setAiLoading(true);
    const fallbackCodes = aiElectives.map(item => item.code).filter(Boolean);

    try {
      const response = await optimisePlanAI({
        student,
        plan,
        validation,
        preferences: {
          workload: student.preferred_workload,
          challenge: student.challenge_preference,
          assessment: student.assessment_preference,
          free_text: student.free_text_preferences,
        },
      });
      const recommended = uniqueCodes(response.recommended_courses || response.electives?.map(item => item.code) || fallbackCodes);
      setPlan(reflowPlan(plan, context, recommended));
      setSmartResult(response);
    } catch (error) {
      setPlan(reflowPlan(plan, context, fallbackCodes));
      setSmartResult({ plan_strategy: 'Rebuilt locally around prerequisite order, workload preference, and remaining unit gaps.' });
    } finally {
      setAiLoading(false);
    }
  };

  const zoomMode = zoom < 0.84 ? 'zoom-compact' : zoom > 1.06 ? 'zoom-detail' : 'zoom-normal';
  const completedCourses = uniqueCodes(student.completed_courses);

  return (
    <div className="planner-page">
      <div className="planner-header">
        <div>
          <div className="eyebrow"><Target size={16} /> Flowchart planner</div>
          <h1>{program?.name || student.degree_code}</h1>
          <p>{major?.name ? `Major: ${major.name}` : 'No major selected'} · {student.target_semesters} semester target</p>
        </div>
        <div className="planner-actions">
          <button className="btn btn-outline" onClick={() => setSearchOpen(open => !open)}>
            <Search size={16} /> {searchOpen ? 'Hide courses' : 'Add courses'}
          </button>
          <button className="btn btn-outline" onClick={suggestElectives} disabled={electiveLoading}>
            <Bot size={16} /> {electiveLoading ? 'Suggesting...' : 'Suggest electives'}
          </button>
          <button className="btn btn-outline" onClick={regenerate}>
            <RefreshCcw size={16} /> Rebuild
          </button>
        </div>
      </div>

      {validation && (
        <div className="planner-summary-grid">
          <FeedbackPanel
            validation={validation}
            expectedProgress={expectedProgress}
            smartResult={smartResult}
            aiLoading={aiLoading}
            onSmart={smartOptimise}
          />
          <Legend />
          <div className={`summary-tile ${aligned ? 'success' : 'warning'}`}>
            <strong>{aligned ? 'On pace' : 'Needs alignment'}</strong>
            <span>{validation.plannedUnits}/{validation.requiredUnits} units planned</span>
            <small>Expected marker compares your current degree point with planned completion progress.</small>
          </div>
        </div>
      )}

      {aiElectives.length > 0 && (
        <div className="elective-suggestions">
          <div className="elective-title"><Sparkles size={16} /> Elective suggestions</div>
          {aiElectives.slice(0, 6).map(item => (
            <button key={item.code} type="button" onClick={() => addCourse(item.code)}>
              <strong>{item.code}</strong>
              <span>{item.reason}</span>
              <Plus size={15} />
            </button>
          ))}
        </div>
      )}

      <div className="zoom-toolbar">
        <ZoomOut size={16} />
        <input
          type="range"
          min="0.75"
          max="1.15"
          step="0.05"
          value={zoom}
          onChange={event => setZoom(Number(event.target.value))}
          aria-label="Timeline zoom"
        />
        <ZoomIn size={16} />
        <span>{zoom < 0.84 ? 'Overview' : zoom > 1.06 ? 'Class detail' : 'Balanced'}</span>
      </div>

      <div className={`planner-workspace ${searchOpen ? 'with-catalog' : ''}`}>
        {searchOpen && (
          <aside className="catalog-drawer">
            <div className="catalog-header">
              <div>
                <strong>Course catalogue</strong>
                <span>Drag into the timeline or add with prerequisites.</span>
              </div>
            </div>
            <div className="search-input">
              <Search size={16} />
              <input className="input" placeholder="Search all courses" value={search} onChange={event => setSearch(event.target.value)} />
            </div>
            <div className="catalog-list">
              {filteredCourses.map(course => (
                <article
                  key={course.code}
                  className="catalog-course"
                  draggable
                  onDragStart={event => handleDragStart(event, course.code, null)}
                >
                  <div>
                    <strong>{course.code}</strong>
                    <span>{course.name}</span>
                    <small>{getAssessmentFocus(course)} · {parseWorkloadHours(course.workload)}h</small>
                  </div>
                  <button className="icon-button" onClick={() => addCourse(course.code)} aria-label={`Add ${course.code}`}>
                    <Plus size={15} />
                  </button>
                </article>
              ))}
            </div>
          </aside>
        )}

        <main className={`timeline-board ${zoomMode}`}>
          {completedCourses.length > 0 && (
            <section className="completed-node">
              <div className="semester-spine completed" />
              <div className="semester-card-flow completed-card">
                <div className="semester-flow-header">
                  <div>
                    <span className="semester-kicker">History</span>
                    <h2>Completed courses</h2>
                  </div>
                  <div className="semester-load">
                    <strong>{sumUnits(courses, completedCourses)}u</strong>
                    <span>{completedCourses.length} courses</span>
                  </div>
                </div>
                <div className="flow-course-stack">
                  {completedCourses.map(code => (
                    <CourseCard
                      key={`completed-${code}`}
                      code={code}
                      context={context}
                      status={validation?.statusByCourse[code] || { state: 'completed', invalid: false, reasons: [] }}
                      onDragStart={() => {}}
                      onRemove={() => {}}
                      removable={false}
                    />
                  ))}
                </div>
              </div>
            </section>
          )}

          {(plan?.semesters || []).map((semester, index) => (
            <SemesterNode
              key={semester.id}
              semester={semester}
              index={index}
              context={context}
              validation={validation}
              dropPreview={dropPreview}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragLeave={() => setDropPreview(null)}
              onDrop={handleDrop}
              onRemove={removeCourse}
            />
          ))}

          {plan?.unscheduled?.length > 0 && (
            <div className="unscheduled-box">
              <AlertTriangle size={16} />
              <span>Unscheduled: {plan.unscheduled.join(', ')}</span>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
