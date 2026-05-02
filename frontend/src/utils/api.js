/**
 * API client for DegreeFlow backend.
 * All calls go through /api/* and are proxied in dev.
 */

const API_BASE = process.env.REACT_APP_API_URL || '/api';

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'API error');
  }
  return res.json();
}

// ── Data endpoints ──────────────────────────────────────────────────
export const fetchPrograms = (career) =>
  request(`/programs${career ? `?career=${career}` : ''}`);

export const fetchProgram = (code) => request(`/programs/${code}`);

export const fetchCourses = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/courses${qs ? `?${qs}` : ''}`);
};

export const fetchCourse = (code) => request(`/courses/${code}`);

export const fetchMajors = () => request('/majors');
export const fetchMajor = (code) => request(`/majors/${code}`);
export const fetchMinors = () => request('/minors');
export const fetchMinor = (code) => request(`/minors/${code}`);
export const fetchMetadata = () => request('/metadata');
export const fetchSubjectAreas = () => request('/subject-areas');

// ── Action endpoints ────────────────────────────────────────────────
export const checkEligibility = (courseCode, student) =>
  request(`/eligibility/${courseCode}`, { method: 'POST', body: JSON.stringify(student) });

export const generatePlan = (planRequest) =>
  request('/generate-plan', { method: 'POST', body: JSON.stringify(planRequest) });

export const graduationAudit = (student) =>
  request('/graduation-audit', { method: 'POST', body: JSON.stringify(student) });

export const recommendCourses = (student, limit = 10) =>
  request(`/recommend?limit=${limit}`, { method: 'POST', body: JSON.stringify(student) });

export const whatIfChangeMajor = (student, newMajor) =>
  request(`/what-if/change-major?new_major=${newMajor}`, { method: 'POST', body: JSON.stringify(student) });

export const assessRisks = (planRequest) =>
  request('/assess-risks', { method: 'POST', body: JSON.stringify(planRequest) });

export const suggestInterestsAI = (payload) =>
  request('/ai/interests', { method: 'POST', body: JSON.stringify(payload) });

export const suggestElectivesAI = (payload) =>
  request('/ai/electives', { method: 'POST', body: JSON.stringify(payload) });

export const optimisePlanAI = (payload) =>
  request('/ai/optimise-plan', { method: 'POST', body: JSON.stringify(payload) });
