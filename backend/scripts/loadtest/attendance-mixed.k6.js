import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const BASE_URL = String(__ENV.BASE_URL || '').replace(/\/$/, '');
const TEACHER_CODE = String(__ENV.TEACHER_CODE || '');
const USERS = Number(__ENV.USERS || 120);
const DUPLICATE_SHARE = Number(__ENV.DUPLICATE_SHARE || 0.35);
const QR_LIFETIME_SEC = Number(__ENV.QR_LIFETIME_SEC || 15);
const THINK_TIME_SEC = Number(__ENV.THINK_TIME_SEC || 0.15);
const SUBJECT_PREFIX = String(__ENV.SUBJECT_PREFIX || 'k6-mixed');
const DEBUG = __ENV.DEBUG === 'true';

const jsonHeaders = { 'Content-Type': 'application/json' };

const firstMarkRate = new Rate('first_mark_rate');
const duplicateBlockedRate = new Rate('duplicate_blocked_rate');
const duplicatePassedCount = new Counter('duplicate_passed_count');
const duplicateAttemptedCount = new Counter('duplicate_attempted_count');

function must(value, name) {
  if (!value) fail(`${name} is required`);
  return value;
}

function safeJson(response) {
  try {
    return response.json();
  } catch (_) {
    return {};
  }
}

function postJson(url, body, extra = {}) {
  const headers = { ...jsonHeaders, ...(extra.headers || {}) };
  const tags = extra.tags || {};
  return http.post(url, JSON.stringify(body), { headers, tags });
}

function shouldTryDuplicate() {
  if (DUPLICATE_SHARE <= 0) return false;
  if (DUPLICATE_SHARE >= 1) return true;
  return Math.random() < DUPLICATE_SHARE;
}

function createQrToken(sessionId, authHeaders) {
  const res = postJson(
    `${BASE_URL}/api/sessions/${sessionId}/qr-token`,
    { lifetimeSec: QR_LIFETIME_SEC },
    { headers: authHeaders, tags: { name: 'create_qr_token' } }
  );
  return { res, data: safeJson(res) };
}

function apiCheck(sessionId, token, fingerprint) {
  const res = postJson(
    `${BASE_URL}/api/check`,
    { sessionId, token, fingerprint },
    { tags: { name: 'api_check' } }
  );
  return { res, data: safeJson(res) };
}

function apiAttendance(sessionId, oneTimeToken, fingerprint, suffix = '') {
  const res = postJson(
    `${BASE_URL}/api/attendances`,
    {
      sessionId,
      oneTimeToken,
      fingerprint,
      studentName: `Mixed User ${__VU}${suffix}`,
      studentGroup: `K6-MIX-${String((__VU % 20) + 1).padStart(2, '0')}`
    },
    { tags: { name: 'api_attendance' } }
  );
  return { res, data: safeJson(res) };
}

export const options = {
  scenarios: {
    mixed_attendance: {
      executor: 'per-vu-iterations',
      vus: USERS,
      iterations: 1,
      maxDuration: '3m'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    first_mark_rate: ['rate>0.95'],
    duplicate_blocked_rate: ['rate>0.98']
  }
};

export function setup() {
  must(BASE_URL, 'BASE_URL');
  must(TEACHER_CODE, 'TEACHER_CODE');

  const verifyRes = postJson(
    `${BASE_URL}/api/verify-teacher`,
    { code: TEACHER_CODE },
    { tags: { name: 'verify_teacher' } }
  );
  const verifyData = safeJson(verifyRes);
  const teacherToken = verifyData.token;

  if (!check(verifyRes, { 'verify teacher: status 200': (r) => r.status === 200 && !!teacherToken })) {
    fail(
      `verify teacher failed: status=${verifyRes.status}, body=${JSON.stringify(verifyData)}. ` +
      `Hint: if TEACHER_CODE contains "$", pass it in single quotes or escape as \\$.`
    );
  }

  const authHeaders = { Authorization: `Bearer ${teacherToken}` };
  const sessionRes = postJson(
    `${BASE_URL}/api/sessions`,
    {
      teacherToken,
      subject: `${SUBJECT_PREFIX}-${Date.now()}`,
      qrInterval: Math.max(QR_LIFETIME_SEC, 10),
      fingerprintRequired: true
    },
    { headers: authHeaders, tags: { name: 'create_session' } }
  );
  const sessionData = safeJson(sessionRes);
  const sessionId = sessionData.sessionId;

  if (!check(sessionRes, { 'create session: status 201': (r) => r.status === 201 && !!sessionId })) {
    fail(`create session failed: status=${sessionRes.status}, body=${JSON.stringify(sessionData)}`);
  }

  return { sessionId, teacherToken };
}

export default function (data) {
  const authHeaders = { Authorization: `Bearer ${data.teacherToken}` };
  const fingerprint = `mixed_agent_fp_${__VU}`;

  const qr1 = createQrToken(data.sessionId, authHeaders);
  if (!(qr1.res.status === 201 && qr1.data.token)) {
    firstMarkRate.add(false);
    if (DEBUG) console.log(`qr1 failed: status=${qr1.res.status}, body=${JSON.stringify(qr1.data)}`);
    sleep(THINK_TIME_SEC);
    return;
  }

  const check1 = apiCheck(data.sessionId, qr1.data.token, fingerprint);
  if (!(check1.res.status === 200 && check1.data.ok === true && check1.data.oneTimeToken)) {
    firstMarkRate.add(false);
    if (DEBUG) console.log(`check1 failed: status=${check1.res.status}, body=${JSON.stringify(check1.data)}`);
    sleep(THINK_TIME_SEC);
    return;
  }

  const attendance1 = apiAttendance(data.sessionId, check1.data.oneTimeToken, fingerprint);
  const firstOk = attendance1.res.status === 201 && attendance1.data.ok === true;
  firstMarkRate.add(firstOk);
  if (!firstOk) {
    if (DEBUG) {
      console.log(`attendance1 failed: status=${attendance1.res.status}, body=${JSON.stringify(attendance1.data)}`);
    }
    sleep(THINK_TIME_SEC);
    return;
  }

  if (!shouldTryDuplicate()) {
    sleep(THINK_TIME_SEC);
    return;
  }

  duplicateAttemptedCount.add(1);

  const qr2 = createQrToken(data.sessionId, authHeaders);
  if (!(qr2.res.status === 201 && qr2.data.token)) {
    duplicateBlockedRate.add(false);
    if (DEBUG) console.log(`qr2 failed: status=${qr2.res.status}, body=${JSON.stringify(qr2.data)}`);
    sleep(THINK_TIME_SEC);
    return;
  }

  const check2 = apiCheck(data.sessionId, qr2.data.token, fingerprint);
  if (check2.res.status === 403 && check2.data.error === 'already_marked') {
    duplicateBlockedRate.add(true);
    sleep(THINK_TIME_SEC);
    return;
  }

  if (!(check2.res.status === 200 && check2.data.ok === true && check2.data.oneTimeToken)) {
    duplicateBlockedRate.add(false);
    if (DEBUG) console.log(`check2 failed: status=${check2.res.status}, body=${JSON.stringify(check2.data)}`);
    sleep(THINK_TIME_SEC);
    return;
  }

  const attendance2 = apiAttendance(data.sessionId, check2.data.oneTimeToken, fingerprint, '-retry');
  const blockedAtAttendance = attendance2.res.status === 403 && attendance2.data.error === 'already_marked';
  duplicateBlockedRate.add(blockedAtAttendance);
  if (!blockedAtAttendance) {
    duplicatePassedCount.add(1);
    if (DEBUG) {
      console.log(`duplicate passed: status=${attendance2.res.status}, body=${JSON.stringify(attendance2.data)}`);
    }
  }

  sleep(THINK_TIME_SEC);
}

export function teardown(data) {
  if (!data || !data.sessionId || !data.teacherToken) return;
  postJson(
    `${BASE_URL}/api/sessions/${data.sessionId}/end`,
    {},
    {
      headers: { Authorization: `Bearer ${data.teacherToken}` },
      tags: { name: 'end_session' }
    }
  );
}
