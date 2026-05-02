import React, { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, Navigate } from 'react-router-dom';

import coursesData from './data/courses.json';
import programsData from './data/programs.json';
import majorsData from './data/majors.json';
import minorsData from './data/minors.json';

import HomeLanding from './pages/HomeLanding';
import OnboardingFlow from './pages/OnboardingFlow';
import DegreeTimelinePlanner from './pages/DegreeTimelinePlanner';

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
  onboarding_complete: false,
};

function AppContent() {
  const [student, setStudent] = useState(() => {
    const saved = localStorage.getItem('degreeflow_student');
    return saved ? { ...initialStudent, ...JSON.parse(saved) } : initialStudent;
  });
  const [theme, setTheme] = useState('dark');
  const navigate = useNavigate();

  useEffect(() => {
    localStorage.setItem('degreeflow_student', JSON.stringify(student));
  }, [student]);

  const app = {
    student,
    setStudent,
    courses: coursesData,
    programs: programsData,
    majors: majorsData,
    minors: minorsData,
    theme,
    setTheme,
  };

  return (
    <main className={`app-container ${theme}`}>
      <Routes>
        <Route path="/" element={<HomeLanding app={app} navigate={navigate} />} />
        <Route path="/setup" element={<OnboardingFlow app={app} navigate={navigate} />} />
        <Route path="/planner" element={<DegreeTimelinePlanner app={app} navigate={navigate} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
