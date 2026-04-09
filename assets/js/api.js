/**
 * Клиент API бэкенда. Все запросы через один базовый метод.
 */

import { apiBase } from './config.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 0;
const RETRY_DELAY_MS = 1500;
const CHECK_TIMEOUT_MS = 10_000;
const ATTENDANCE_TIMEOUT_MS = 12_000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function makeRequestError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

async function requestOnce(endpoint, options = {}) {
  const { headers: optionHeaders = {}, timeout = DEFAULT_TIMEOUT_MS, ...restOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(apiBase + endpoint, {
      ...restOptions,
      headers: { 'Content-Type': 'application/json', ...optionHeaders },
      signal: controller.signal
    });
    const data = await res.json().catch(() => ({}));
    return { response: res, data };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw makeRequestError('request_timeout');
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw makeRequestError('offline');
    }
    throw makeRequestError('network_error');
  } finally {
    clearTimeout(timer);
  }
}

async function request(endpoint, options = {}) {
  const { retries = DEFAULT_RETRIES, ...rest } = options;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await requestOnce(endpoint, rest);
      if (result.response.status >= 500 && attempt < retries) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      return result;
    } catch (e) {
      lastError = e;
      if (attempt < retries) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }
  throw lastError;
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

export async function healthPing() {
  return requestOnce('/health', { timeout: 8000 });
}

export async function checkAccess(body) {
  return request('/api/check', {
    method: 'POST',
    body: JSON.stringify(body),
    timeout: CHECK_TIMEOUT_MS,
    retries: 0
  });
}

export async function submitAttendance(body) {
  return request('/api/attendances', {
    method: 'POST',
    body: JSON.stringify(body),
    timeout: ATTENDANCE_TIMEOUT_MS,
    retries: 0
  });
}

export async function getAttendances(sessionId, teacherToken) {
  return request(`/api/sessions/${sessionId}/attendances`, withTeacherAuth(teacherToken));
}

export async function endSessionApi(sessionId, teacherToken) {
  return request(`/api/sessions/${sessionId}/end`, withTeacherAuth(teacherToken, {
    method: 'POST',
    body: JSON.stringify({})
  }));
}

export async function downloadCsvBlob(sessionId, teacherToken) {
  const res = await fetch(`${apiBase}/api/sessions/${sessionId}/attendances/csv`, {
    headers: { Authorization: `Bearer ${teacherToken}` }
  });
  if (!res.ok) throw new Error(`csv_${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `attendance_${sessionId}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function getSessionStats(sessionId, teacherToken) {
  return request(`/api/sessions/${sessionId}/stats`, withTeacherAuth(teacherToken));
}
