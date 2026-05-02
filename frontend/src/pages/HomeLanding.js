import React from 'react';
import { ArrowRight, Bot, CheckCircle2, GraduationCap, Route, Sparkles } from 'lucide-react';

function MiniCourse({ code, state, label }) {
  return (
    <div className={`mini-course ${state}`}>
      <span>{code}</span>
      <small>{label}</small>
    </div>
  );
}

function MiniDiagram() {
  return (
    <div className="home-diagram" aria-label="Degree timeline preview">
      <div className="diagram-rail" />
      <div className="mini-term">
        <div className="mini-term-label">Completed</div>
        <MiniCourse code="COMP1100" state="done" label="Core" />
      </div>
      <div className="mini-term">
        <div className="mini-term-label">Now</div>
        <MiniCourse code="COMP1110" state="now" label="In progress" />
        <MiniCourse code="COMP1600" state="valid" label="Fits" />
      </div>
      <div className="mini-term">
        <div className="mini-term-label">Next</div>
        <MiniCourse code="COMP3600" state="locked" label="Prereq" />
        <MiniCourse code="COMP2100" state="valid" label="Planned" />
      </div>
      <div className="mini-connector dotted">prerequisite</div>
      <div className="mini-connector solid">corequisite</div>
    </div>
  );
}

export default function HomeLanding({ app, navigate }) {
  const { courses, programs, majors } = app;

  return (
    <div className="home-page">
      <section className="home-hero">
        <div className="home-copy">
          <div className="eyebrow"><Sparkles size={16} /> The future of academic planning is here</div>
          <h1>Degree planning, elevated.</h1>
          <p className="intro-message">
            Map your entire academic journey with rule-aware AI. Prerequisite checks, 
            workload balancing, and smart elective discovery in one high-fidelity flow.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary btn-hero" onClick={() => navigate('/setup')}>
              <GraduationCap size={20} /> Begin <ArrowRight size={20} />
            </button>
            <button className="btn btn-outline btn-hero" onClick={() => navigate('/planner')}>
              <Route size={20} /> Open planner
            </button>
          </div>
        </div>
        <MiniDiagram />
      </section>

      <section className="home-strip">
        {[
          { value: Object.keys(courses).length, label: 'Courses mapped' },
          { value: Object.keys(programs).length, label: 'Programs' },
          { value: Object.keys(majors).length, label: 'Majors' },
          { value: 'Gemini', label: 'AI assist' },
        ].map(item => (
          <div key={item.label} className="stat compact-stat">
            <div className="stat-value">{item.value}</div>
            <div className="stat-label">{item.label}</div>
          </div>
        ))}
      </section>

      <section className="feature-band">
        {[
          {
            icon: <CheckCircle2 size={20} />,
            title: 'Live compatibility',
            desc: 'Drag a course into the timeline and the destination reacts green or red before you drop it.',
          },
          {
            icon: <Route size={20} />,
            title: 'Vertical flowchart',
            desc: 'Time runs top to bottom, with tagged states for completed, current, planned, invalid, and compulsory courses.',
          },
          {
            icon: <Bot size={20} />,
            title: 'Smart fixes',
            desc: 'When the plan has gaps, the smart button asks Gemini for a strategy and rebuilds around your quiz preferences.',
          },
        ].map(feature => (
          <article key={feature.title} className="feature-card">
            <div className="feature-icon">{feature.icon}</div>
            <h2>{feature.title}</h2>
            <p>{feature.desc}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
