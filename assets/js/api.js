/**
 * Клиент API бэкенда. Все запросы через один базовый метод.
 */

import { apiBase } from './config.js';

async function request(endpoint, options = {}) {
  const res = await fetch(apiBase + endpoint, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  return { response: res, data };
}

function withTeacherAuth(token, options = {}) {
  if (!token) return options;
  return {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  };
}

export async function checkTeacherToken(token) {
  return request('/api/check-teacher-token', { method: 'POST', body: JSON.stringify({ token }) });
}

export async function verifyTeacher(code) {
  return request('/api/verify-teacher', { method: 'POST', body: JSON.stringify({ code }) });
}

export async function createSession(body) {
  return request('/api/sessions', withTeacherAuth(body?.teacherToken, {
    method: 'POST',
    body: JSON.stringify(body)
  }));
}

export async function getQrToken(sessionId, lifetimeSec, teacherToken) {
  return request(`/api/sessions/${sessionId}/qr-token`, withTeacherAuth(teacherToken, {
    method: 'POST',
    body: JSON.stringify({ lifetimeSec })
  }));
}

export async function checkAccess(body) {
  return request('/api/check', { method: 'POST', body: JSON.stringify(body) });
}

export async function submitAttendance(body) {
  return request('/api/attendances', { method: 'POST', body: JSON.stringify(body) });
}

export async function getAttendances(sessionId, teacherToken) {
  return request(`/api/sessions/${sessionId}/attendances`, withTeacherAuth(teacherToken));
}
