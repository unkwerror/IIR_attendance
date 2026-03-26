import http from 'k6/http';
import { check, fail } from 'k6';
import { Rate } from 'k6/metrics';

const checkOkRate = new Rate('check_ok_rate');
const attendanceOkRate = new Rate('attendance_ok_rate');

const BASE_URL = String(__ENV.BASE_URL || '').replace(/\/$/, '');
const TEACHER_CODE = String(__ENV.TEACHER_CODE || '');
const USERS = Number(__ENV.USERS || 80);
const QR_LIFETIME_SEC = Number(__ENV.QR_LIFETIME_SEC || 30);
const SUBJECT_PREFIX = String(__ENV.SUBJECT_PREFIX || 'k6-load');

const jsonHeaders = { 'Content-Type': 'application/json' };

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
  const headers = extra.headers || jsonHeaders;
  const tags = extra.tags || {};
  return http.post(url, JSON.stringify(body), { headers, tags });
}

export const options = {
  scenarios: {
    attendance_80_users: {
      executor: 'per-vu-iterations',
      vus: USERS,
      iterations: 1,
      maxDuration: '2m'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1500'],
    check_ok_rate: ['rate>0.95'],
    attendance_ok_rate: ['rate>0.95']
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
    fail(`verify teacher failed: status=${verifyRes.status}, body=${JSON.stringify(verifyData)}`);
  }

  const authHeaders = { ...jsonHeaders, Authorization: `Bearer ${teacherToken}` };
  const sessionBody = {
    teacherToken,
    subject: `${SUBJECT_PREFIX}-${Date.now()}`,
    qrInterval: QR_LIFETIME_SEC,
    fingerprintRequired: true
  };
  const sessionRes = postJson(
    `${BASE_URL}/api/sessions`,
    sessionBody,
    { headers: authHeaders, tags: { name: 'create_session' } }
  );
  const sessionData = safeJson(sessionRes);
  const sessionId = sessionData.sessionId;

  if (!check(sessionRes, { 'create session: status 201': (r) => r.status === 201 && !!sessionId })) {
    fail(`create session failed: status=${sessionRes.status}, body=${JSON.stringify(sessionData)}`);
  }

  const qrRes = postJson(
    `${BASE_URL}/api/sessions/${sessionId}/qr-token`,
    { lifetimeSec: QR_LIFETIME_SEC },
    { headers: authHeaders, tags: { name: 'create_qr_token' } }
  );
  const qrData = safeJson(qrRes);
  const qrToken = qrData.token;

  if (!check(qrRes, { 'create qr-token: status 201': (r) => r.status === 201 && !!qrToken })) {
    fail(`create qr-token failed: status=${qrRes.status}, body=${JSON.stringify(qrData)}`);
  }

  return { sessionId, qrToken, teacherToken };
}

export default function (data) {
  const fingerprint = `k6_fp_${__VU}_${__ITER}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

  const checkRes = postJson(
    `${BASE_URL}/api/check`,
    {
      sessionId: data.sessionId,
      token: data.qrToken,
      fingerprint
    },
    { tags: { name: 'api_check' } }
  );
  const checkData = safeJson(checkRes);
  const checkOk = checkRes.status === 200 && checkData.ok === true && !!checkData.oneTimeToken;
  checkOkRate.add(checkOk);

  if (!checkOk) {
    if (__ENV.DEBUG === 'true') {
      console.log(`check failed: status=${checkRes.status}, body=${JSON.stringify(checkData)}`);
    }
    return;
  }

  const attendanceRes = postJson(
    `${BASE_URL}/api/attendances`,
    {
      sessionId: data.sessionId,
      oneTimeToken: checkData.oneTimeToken,
      fingerprint,
      studentName: `K6 User ${__VU}`,
      studentGroup: `K6-${String((__VU % 20) + 1).padStart(2, '0')}`
    },
    { tags: { name: 'api_attendance' } }
  );
  const attendanceData = safeJson(attendanceRes);
  const attendanceOk = attendanceRes.status === 201 && attendanceData.ok === true;
  attendanceOkRate.add(attendanceOk);

  if (!attendanceOk && __ENV.DEBUG === 'true') {
    console.log(`attendance failed: status=${attendanceRes.status}, body=${JSON.stringify(attendanceData)}`);
  }
}

export function teardown(data) {
  if (!data || !data.sessionId || !data.teacherToken) return;
  const authHeaders = { ...jsonHeaders, Authorization: `Bearer ${data.teacherToken}` };
  postJson(
    `${BASE_URL}/api/sessions/${data.sessionId}/end`,
    {},
    { headers: authHeaders, tags: { name: 'end_session' } }
  );
}
