import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const BASE_URL = String(__ENV.BASE_URL || '').replace(/\/$/, '');
const TEACHER_CODE = String(__ENV.TEACHER_CODE || '');
const SUBJECT_PREFIX = String(__ENV.SUBJECT_PREFIX || 'k6-ramp');
const MAX_VUS = Number(__ENV.MAX_VUS || 200);
const QR_LIFETIME_SEC = Number(__ENV.QR_LIFETIME_SEC || 15);
const HOLD_SEC = Number(__ENV.HOLD_SEC || 60);
const THINK_TIME_SEC = Number(__ENV.THINK_TIME_SEC || 0.2);
const DEBUG = __ENV.DEBUG === 'true';

const jsonHeaders = { 'Content-Type': 'application/json' };

const qrTokenOkRate = new Rate('qr_token_ok_rate');
const checkOkRate = new Rate('check_ok_rate');
const attendanceOkRate = new Rate('attendance_ok_rate');
const flowSuccessRate = new Rate('flow_success_rate');
const blockedByForwardCounter = new Counter('blocked_by_forward_count');
const staleTokenCounter = new Counter('token_stale_count');

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

function calcStages(maxVus, holdSec) {
  const t25 = Math.max(20, Math.floor(maxVus * 0.25));
  const t50 = Math.max(40, Math.floor(maxVus * 0.5));
  const t75 = Math.max(60, Math.floor(maxVus * 0.75));
  return [
    { duration: '30s', target: t25 },
    { duration: '30s', target: t50 },
    { duration: '30s', target: t75 },
    { duration: '30s', target: maxVus },
    { duration: `${holdSec}s`, target: maxVus },
    { duration: '20s', target: 0 }
  ];
}

export const options = {
  scenarios: {
    attendance_ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      gracefulRampDown: '20s',
      stages: calcStages(MAX_VUS, HOLD_SEC)
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
    qr_token_ok_rate: ['rate>0.95'],
    check_ok_rate: ['rate>0.95'],
    attendance_ok_rate: ['rate>0.95'],
    flow_success_rate: ['rate>0.9']
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
  const qrRes = postJson(
    `${BASE_URL}/api/sessions/${data.sessionId}/qr-token`,
    { lifetimeSec: QR_LIFETIME_SEC },
    { headers: authHeaders, tags: { name: 'create_qr_token' } }
  );
  const qrData = safeJson(qrRes);
  const qrOk = qrRes.status === 201 && !!qrData.token;
  qrTokenOkRate.add(qrOk);

  if (!qrOk) {
    flowSuccessRate.add(false);
    if (DEBUG) console.log(`qr-token failed: status=${qrRes.status}, body=${JSON.stringify(qrData)}`);
    sleep(THINK_TIME_SEC);
    return;
  }

  const fingerprint = `k6_dev_${__VU}_${__ITER}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const checkRes = postJson(
    `${BASE_URL}/api/check`,
    {
      sessionId: data.sessionId,
      token: qrData.token,
      fingerprint
    },
    { tags: { name: 'api_check' } }
  );
  const checkData = safeJson(checkRes);
  const checkOk = checkRes.status === 200 && checkData.ok === true && !!checkData.oneTimeToken;
  checkOkRate.add(checkOk);

  if (!checkOk) {
    if (checkData.error === 'qr_forward_blocked') blockedByForwardCounter.add(1);
    if (checkData.error === 'token_stale') staleTokenCounter.add(1);
    flowSuccessRate.add(false);
    if (DEBUG) console.log(`check failed: status=${checkRes.status}, body=${JSON.stringify(checkData)}`);
    sleep(THINK_TIME_SEC);
    return;
  }

  const attendanceRes = postJson(
    `${BASE_URL}/api/attendances`,
    {
      sessionId: data.sessionId,
      oneTimeToken: checkData.oneTimeToken,
      fingerprint,
      studentName: `K6 User ${__VU}-${__ITER}`,
      studentGroup: `K6-${String((__VU % 20) + 1).padStart(2, '0')}`
    },
    { tags: { name: 'api_attendance' } }
  );
  const attendanceData = safeJson(attendanceRes);
  const attendanceOk = attendanceRes.status === 201 && attendanceData.ok === true;
  attendanceOkRate.add(attendanceOk);
  flowSuccessRate.add(attendanceOk);

  if (!attendanceOk && DEBUG) {
    console.log(`attendance failed: status=${attendanceRes.status}, body=${JSON.stringify(attendanceData)}`);
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
