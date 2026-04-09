/**
 * Точка входа приложения: экраны, навигация, бизнес-логика.
 */

import { urlParams } from './config.js';
import * as api from './api.js';
import * as auth from './auth.js';

const uToken = urlParams.token;
const uSession = urlParams.session;

let cfg = { sessionId: null, interval: 15 };
let tLeft = 15;
let ticker = null;
let attTimer = null;
let startSessionInFlight = false;

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function afterSplash() {
  if (uToken && uSession) {
    show('screen-student');
    runCheck();
  } else {
    initTeacherEntry();
  }
}

function initSplash() {
  const splash = document.getElementById('screen-splash');
  const progressFill = document.getElementById('splash-progress-fill');
  if (!splash) {
    afterSplash();
    return;
  }
  const SPLASH_MS = 3400;
  const CROSSFADE_MS = 700;
  if (progressFill) progressFill.style.setProperty('--splash-duration', (SPLASH_MS / 1000) + 's');

  if (typeof window.startParticles === 'function') {
    window.startParticles('splash-particles-canvas', 'slowChaotic');
  }

  let splashDismissed = false;
  function dismissSplash() {
    if (splashDismissed) return;
    splashDismissed = true;

    const target = (uToken && uSession) ? 'screen-student' : 'screen-teacher-code';
    show(target);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        splash.classList.add('hide');
      });
    });
    setTimeout(() => {
      splash.style.display = 'none';
      if (target === 'screen-student') runCheck();
      else initTeacherEntry();
    }, CROSSFADE_MS);
  }

  const safetyTimer = setTimeout(dismissSplash, SPLASH_MS);
}

function startAppParticlesOnce() {
  if (window._appParticlesStarted || !window.startParticles) return;
  window._appParticlesStarted = true;
  requestAnimationFrame(() => {
    window.startParticles('app-particles-canvas', 'slowChaotic');
  });
}

function initStars() {
  const w = document.getElementById('bg-stars');
  if (!w) return;
  for (let i = 0; i < 100; i++) {
    const s = document.createElement('span');
    s.style.left = Math.random() * 100 + '%';
    s.style.top = Math.random() * 100 + '%';
    const sz = Math.random() < 0.15 ? 3 : 2;
    s.style.width = sz + 'px';
    s.style.height = sz + 'px';
    s.style.setProperty('--d', (2 + Math.random() * 4) + 's');
    s.style.setProperty('--delay', (Math.random() * 6) + 's');
    s.style.setProperty('--op', (0.2 + Math.random() * 0.65).toFixed(2));
    w.appendChild(s);
  }
}

function initTeacherEntry() {
  show('screen-teacher-code');
}

function onTeacherCodeInput(v) {
  for (let i = 0; i < 8; i++) {
    const d = document.getElementById('tcd' + i);
    if (d) d.className = 'tc-dot' + (i < v.length ? ' filled' : '');
  }
  const errWrap = document.getElementById('teacher-code-err');
  if (errWrap) errWrap.classList.remove('visible');
}

function toggleTeacherCodeVis() {
  const inp = document.getElementById('inp-teacher-code');
  const btn = document.getElementById('teacher-code-toggle');
  const wrap = inp && inp.closest('.tc-input-wrap');
  if (!inp || !btn) return;
  const isText = inp.type === 'text';
  inp.type = isText ? 'password' : 'text';
  if (wrap) wrap.classList.toggle('show-password', !isText);
  btn.style.color = isText ? 'rgba(255,255,255,.2)' : 'rgba(232,25,125,.7)';
}

async function submitTeacherCode() {
  const inp = document.getElementById('inp-teacher-code');
  const errWrap = document.getElementById('teacher-code-err');
  const errTxt = document.getElementById('teacher-code-err-txt');
  const code = (inp && inp.value) ? String(inp.value).trim() : '';
  if (!code) {
    if (errTxt) errTxt.textContent = 'Введите код доступа.';
    if (errWrap) errWrap.classList.add('visible');
    return;
  }
  if (errWrap) errWrap.classList.remove('visible');
  try {
    const { response, data } = await api.verifyTeacher(code);
    if (!response.ok) {
      if (response.status === 429 || data.error === 'too_many_attempts') {
        if (errTxt) errTxt.textContent = 'Слишком много попыток. Подождите 15 минут.';
      } else if (data.error === 'invalid_code') {
        if (errTxt) errTxt.textContent = 'Неверный код.';
      } else {
        if (errTxt) errTxt.textContent = 'Ошибка сервера.';
      }
      if (errWrap) errWrap.classList.add('visible');
      return;
    }
    if (data.token) auth.setTeacherToken(data.token);
    inp.value = '';
    onTeacherCodeInput('');
    show('screen-setup');
  } catch (e) {
    if (errTxt) errTxt.textContent = 'Нет связи с сервером.';
    if (errWrap) errWrap.classList.add('visible');
  }
}

async function startSession() {
  if (startSessionInFlight) return;
  const subject = document.getElementById('inp-subject').value.trim() || 'Занятие';
  const interval = parseInt(document.getElementById('inp-interval').value, 10) || 15;
  const startBtn = document.getElementById('btn-start-session');
  const teacherToken = auth.getTeacherToken();
  if (!teacherToken) {
    show('screen-teacher-code');
    const e = document.getElementById('teacher-code-err-txt'), w = document.getElementById('teacher-code-err');
    if (e) e.textContent = 'Сессия истекла. Введите код преподавателя снова.';
    if (w) w.classList.add('visible');
    return;
  }
  startSessionInFlight = true;
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.dataset.prevText = startBtn.textContent || '';
    startBtn.textContent = 'ЗАПУСК...';
  }
  try {
    const { response, data } = await api.createSession({
      teacherToken,
      subject,
      qrInterval: interval,
      fingerprintRequired: true
    });
    if (response.status === 403 && (data.error === 'teacher_required' || data.error === 'invalid_or_expired')) {
      auth.clearTeacherToken();
      show('screen-teacher-code');
      const e = document.getElementById('teacher-code-err-txt'), w = document.getElementById('teacher-code-err');
      if (e) e.textContent = 'Сессия истекла. Введите код преподавателя снова.';
      if (w) w.classList.add('visible');
      return;
    }
    if (!response.ok) {
      const reason = data.error || `http_${response.status}`;
      throw new Error(reason);
    }
    const s = data.session;
    cfg.sessionId = data.sessionId;
    cfg.interval = s.qrInterval || interval;
    document.getElementById('lbl-subject').textContent = s.subject;
    document.getElementById('info-ivl').textContent = `${cfg.interval} сек`;
    const geoChip = document.getElementById('info-geo');
    if (geoChip) geoChip.textContent = 'Fingerprint';
    show('screen-teacher');
    document.getElementById('att-box').style.display = 'block';
    genQR();
    startTimer();
    startAttendancePolling();
  } catch (e) {
    const map = {
      too_many_requests: 'Слишком много запросов. Подождите минуту и попробуйте снова.',
      internal_error: 'Внутренняя ошибка сервера. Попробуйте через несколько секунд.',
      http_0: 'Сервер недоступен. Проверьте подключение к интернету.'
    };
    const msg = map[e.message] || `Ошибка при создании сессии (${e.message}).`;
    alert(msg);
  } finally {
    startSessionInFlight = false;
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.textContent = startBtn.dataset.prevText || 'ЗАПУСТИТЬ СЕССИЮ →';
    }
  }
}

async function genQR() {
  if (!cfg.sessionId) return;
  const teacherToken = auth.getTeacherToken();
  if (!teacherToken) return;
  try {
    const { response, data } = await api.getQrToken(cfg.sessionId, cfg.interval, teacherToken);
    if (response.status === 403 && data.error === 'teacher_required') {
      auth.clearTeacherToken();
      show('screen-teacher-code');
      const e = document.getElementById('teacher-code-err-txt'), w = document.getElementById('teacher-code-err');
      if (e) e.textContent = 'Сессия истекла. Введите код преподавателя снова.';
      if (w) w.classList.add('visible');
      return;
    }
    if (!response.ok) throw new Error('qr');
    const token = data.token;
    const tok = document.getElementById('info-tok');
    if (tok) tok.textContent = token.slice(0, 8) + '…';
    const base = location.origin + location.pathname;
    const url = `${base}?sid=${encodeURIComponent(cfg.sessionId)}&t=${encodeURIComponent(token)}`;
    renderQR(url);
  } catch (e) {
    alert('Не удалось получить QR‑токен с сервера.');
  }
}

function renderQR(text) {
  if (typeof qrcode !== 'function') return;
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const M = qr.getModuleCount();
  const PAD = 6;
  const cv = document.getElementById('qrcanvas');
  if (!cv) return;
  const NATIVE = 1200;
  cv.width = NATIVE;
  cv.height = NATIVE;
  const DS = NATIVE / (M + PAD * 2);
  const frame = cv.parentElement;
  const display = frame ? Math.min(frame.clientWidth - 16, frame.clientHeight - 16) || 480 : 480;
  cv.style.width = display + 'px';
  cv.style.height = display + 'px';
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, NATIVE, NATIVE);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < M; r++) {
    for (let c = 0; c < M; c++) {
      if (qr.isDark(r, c)) {
        const x = (PAD + c) * DS;
        const y = (PAD + r) * DS;
        ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(DS), Math.ceil(DS));
      }
    }
  }
}

function newSession() {
  if (ticker) clearInterval(ticker);
  if (attTimer) clearInterval(attTimer);
  cfg.sessionId = null;
  show('screen-setup');
}

async function endSession() {
  if (!cfg.sessionId) return;
  const teacherToken = auth.getTeacherToken();
  if (!teacherToken) return;
  if (ticker) clearInterval(ticker);
  if (attTimer) clearInterval(attTimer);

  try {
    await api.endSessionApi(cfg.sessionId, teacherToken);
  } catch (_) {}

  const subjectEl = document.getElementById('post-subject');
  const subjectText = document.getElementById('lbl-subject')?.textContent || '';
  if (subjectEl) subjectEl.textContent = subjectText;

  show('screen-post-session');
  loadPostSessionData();
}

async function loadPostSessionData() {
  if (!cfg.sessionId) return;
  const teacherToken = auth.getTeacherToken();
  if (!teacherToken) return;

  try {
    const { response, data } = await api.getAttendances(cfg.sessionId, teacherToken);
    if (response.ok) {
      const cnt = document.getElementById('post-att-count');
      const list = document.getElementById('post-att-list');
      if (cnt) cnt.textContent = data.count || 0;
      if (list) {
        const items = data.items || [];
        if (items.length === 0) {
          list.innerHTML = '<div style="font-size:12px;opacity:.6;">Никто не отметился.</div>';
        } else {
          list.innerHTML = items.map((it, i) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;">
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:11px;opacity:.6;">${i + 1}.</span>
                <span>${esc(it.name)}</span>
              </div>
              <span style="font-size:11px;color:var(--mt);">${esc(it.group)}</span>
            </div>`).join('');
        }
      }
    }
  } catch (_) {}

  try {
    const { response, data } = await api.getSessionStats(cfg.sessionId, teacherToken);
    const content = document.getElementById('post-stats-content');
    const timelineEl = document.getElementById('post-stats-timeline');
    if (!content || !timelineEl) return;
    if (!response.ok || data.total === undefined) {
      content.textContent = 'Не удалось загрузить.';
      return;
    }
    if (data.total === 0) {
      content.textContent = 'Нет отметок.';
      return;
    }
    const fmtTime = (iso) => {
      if (!iso) return '—';
      return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    content.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;">
        <div>Всего: <strong style="color:var(--pk);">${data.total}</strong></div>
        <div>Среднее: <strong>${data.avgDelaySec} сек</strong></div>
        <div>Первая: <strong>${fmtTime(data.firstMarkAt)}</strong></div>
        <div>Последняя: <strong>${fmtTime(data.lastMarkAt)}</strong></div>
      </div>`;
    const tl = data.timeline || [];
    if (tl.length === 0) return;
    const maxCount = Math.max(...tl.map((b) => b.count), 1);
    timelineEl.innerHTML = tl.map((b) => {
      const h = Math.max(2, Math.round((b.count / maxCount) * 56));
      const label = b.count > 0 ? b.count : '';
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:2px;">
        <span style="font-size:9px;color:var(--pk);font-weight:700;">${label}</span>
        <div style="width:100%;height:${h}px;background:var(--pk);border-radius:3px 3px 0 0;opacity:${b.count > 0 ? 1 : 0.15};"></div>
      </div>`;
    }).join('');
  } catch (_) {}
}

function startTimer() {
  tLeft = cfg.interval;
  updTimer();
  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => {
    tLeft--;
    updTimer();
    if (tLeft <= 0) {
      genQR();
      tLeft = cfg.interval;
    }
  }, 1000);
}

function updTimer() {
  const pct = (tLeft / cfg.interval) * 100;
  const fillEl = document.getElementById('t-fill');
  const cdEl = document.getElementById('t-cd');
  if (fillEl) fillEl.style.width = pct + '%';
  if (cdEl) cdEl.textContent = tLeft;
  const u = tLeft <= 5;
  if (fillEl) fillEl.classList.toggle('urg', u);
  if (cdEl) cdEl.classList.toggle('urg', u);
}

function esc(s) {
  if (s == null || s === undefined) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

const CYRILLIC_NAME_REG = /^[а-яА-ЯёЁ\s]*$/;
const GROUP_REG = /^[а-яА-ЯёЁ0-9\-]*$/;
const MAX_NAME_LEN = 80;
const MAX_GROUP_LEN = 20;

function filterCyrillicName(el) {
  if (!el) return;
  el.addEventListener('input', () => {
    const v = el.value.replace(/[^а-яА-ЯёЁ\s]/g, '');
    if (v.length > MAX_NAME_LEN) el.value = v.slice(0, MAX_NAME_LEN);
    else if (v !== el.value) el.value = v;
  });
}

function filterGroup(el) {
  if (!el) return;
  el.addEventListener('input', () => {
    const v = el.value.replace(/[^а-яА-ЯёЁ0-9\-]/g, '');
    if (v.length > MAX_GROUP_LEN) el.value = v.slice(0, MAX_GROUP_LEN);
    else if (v !== el.value) el.value = v;
  });
}

function validateCyrillicName(name) {
  if (!name || !name.trim()) return 'Введите фамилию и имя.';
  if (!CYRILLIC_NAME_REG.test(name)) return 'Только кириллица и пробелы. Без цифр и латиницы.';
  if (name.length > MAX_NAME_LEN) return `Не более ${MAX_NAME_LEN} символов.`;
  return null;
}

function validateGroup(group) {
  if (!group || !group.trim()) return 'Введите группу.';
  if (!GROUP_REG.test(group)) return 'Только кириллица, цифры и дефис.';
  if (group.length > MAX_GROUP_LEN) return `Не более ${MAX_GROUP_LEN} символов.`;
  return null;
}

function showStudentFieldError(inputEl, message) {
  const errEl = document.getElementById('att-form-err');
  if (errEl) {
    errEl.textContent = message;
    errEl.style.display = 'block';
  }
  if (inputEl) inputEl.focus();
}

function showFail(icon, title, desc, opts = {}) {
  const card = document.getElementById('st-card');
  if (!card) return;
  const tagClass = opts.warn ? 'ok' : 'fail';
  const tagText = opts.tagText || 'Отказано в доступе';
  card.innerHTML = `
    <div class="st-icon fail">${icon}</div>
    <div class="st-title">${title}</div>
    <div class="st-sep"></div>
    <div class="st-desc">${desc}</div>
    <div class="st-tag ${tagClass}">${tagText}</div>`;
}

const DEVICE_ID_KEY = 'attendance_device_id';
const LEGACY_DEVICE_ID_KEY = 'attendance_fallback_fp';
const DEVICE_ID_COOKIE = 'attendance_device_id';
const DEVICE_ID_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365 * 2;

function hash32(input, seed = 0) {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function normalizePlatform() {
  const p = String(navigator.platform || '').toLowerCase();
  if (p.includes('iphone') || p.includes('ipad') || p.includes('ipod')) return 'ios';
  if (p.includes('android')) return 'android';
  if (p.includes('win')) return 'windows';
  if (p.includes('mac')) return 'mac';
  if (p.includes('linux')) return 'linux';
  return 'other';
}

function getCanvasProbe() {
  try {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 16;
    const ctx = c.getContext('2d');
    if (!ctx) return '0';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '13px sans-serif';
    ctx.fillText('\u{1F600}Aa1', 2, 12);
    const d = ctx.getImageData(0, 0, 64, 16).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 37) h = (h * 31 + d[i]) >>> 0;
    return h.toString(36);
  } catch (_) {
    return '0';
  }
}

function getGLRenderer() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return '';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
  } catch (_) {
    return '';
  }
}

function getDeterministicDeviceId() {
  const maxScreen = Math.max(screen.width || 0, screen.height || 0);
  const minScreen = Math.min(screen.width || 0, screen.height || 0);
  const dpr = Math.round((window.devicePixelRatio || 1) * 100);
  const timeZone = (Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions().timeZone) || '';
  const languages = Array.isArray(navigator.languages) ? navigator.languages.join(',') : (navigator.language || '');
  const src = [
    normalizePlatform(),
    languages,
    String(navigator.maxTouchPoints || 0),
    String(navigator.hardwareConcurrency || 0),
    String(screen.colorDepth || 0),
    String(maxScreen),
    String(minScreen),
    String(dpr),
    String(new Date().getTimezoneOffset()),
    timeZone,
    getCanvasProbe(),
    getGLRenderer()
  ].join('|');
  const parts = [
    hash32(src, 0),
    hash32(src, 1),
    hash32(src, 2),
    hash32(src, 3)
  ];
  return parts.map((n) => n.toString(16).padStart(8, '0')).join('');
}

function getDeterministicBrowserHash() {
  const src = [
    navigator.platform || '',
    navigator.language || '',
    String(Math.max(screen.width || 0, screen.height || 0)),
    String(Math.min(screen.width || 0, screen.height || 0)),
    String(screen.colorDepth || ''),
    String(new Date().getTimezoneOffset())
  ].join('|');
  const parts = [
    hash32(src, 0),
    hash32(src, 1),
    hash32(src, 2),
    hash32(src, 3)
  ];
  return parts.map((n) => n.toString(16).padStart(8, '0')).join('');
}

function readCookie(name) {
  const parts = String(document.cookie || '').split(';');
  for (const p of parts) {
    const [k, ...rest] = p.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function writeCookie(name, value, maxAgeSec) {
  const base = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}`;
  document.cookie = `${base}; SameSite=Lax`;
  document.cookie = `${base}; SameSite=None; Secure`;
}

function readStoredDeviceId() {
  let id = '';
  try {
    id = String(localStorage.getItem(DEVICE_ID_KEY) || '').trim().toLowerCase();
    if (!id) id = String(localStorage.getItem(LEGACY_DEVICE_ID_KEY) || '').trim().toLowerCase();
  } catch (_) {}
  if (!id) {
    try {
      id = String(readCookie(DEVICE_ID_COOKIE) || '').trim().toLowerCase();
    } catch (_) {}
  }
  return id;
}

function persistDeviceId(id) {
  try {
    localStorage.setItem(DEVICE_ID_KEY, id);
    localStorage.setItem(LEGACY_DEVICE_ID_KEY, id);
  } catch (_) {}
  try {
    writeCookie(DEVICE_ID_COOKIE, id, DEVICE_ID_COOKIE_MAX_AGE_SEC);
  } catch (_) {}
}

function getStableDeviceFingerprint() {
  const deterministic = getDeterministicDeviceId();
  if (deterministic) {
    persistDeviceId(deterministic);
    return `dev_${deterministic}`;
  }
  const saved = readStoredDeviceId();
  if (saved) return `dev_${saved}`;
  return `dev_anon_${getDeterministicBrowserHash()}`;
}

async function runCheck() {
  if (!uToken || !uSession) return showFail('✕', 'Неверная ссылка', 'Параметры повреждены. Отсканируйте QR заново.');
  const st = document.getElementById('st-card');
  if (!st) return;
  st.innerHTML = `
    <div class="st-icon spin"><div class="spin-r"></div></div>
    <div class="st-title spin">Проверяем устройство…</div>
    <div class="st-desc">Секунду — идёт проверка QR</div>`;

  const fp = getStableDeviceFingerprint();

  try {
    const { response, data } = await api.checkAccess({
      sessionId: uSession,
      token: uToken,
      fingerprint: fp
    });
    if (!response.ok || !data.ok) {
      const err = data.error || 'unknown';
      if (err === 'bot_denied') return showFail('✕', 'Бот заблокирован', 'Автоматические запросы запрещены. Откройте ссылку вручную в браузере.');
      if (err === 'token expired' || err === 'token_stale' || err === 'invalid token') {
        return showFail('⏱', 'QR-код устарел', 'Этот код больше не действует. Посмотрите на экран преподавателя и отсканируйте новый QR-код камерой телефона.', { tagText: 'Отсканируйте новый QR' });
      }
      if (err === 'already_marked') return showFail('⚠', 'Уже отмечен', 'Вы уже отметились на этом занятии.');
      if (err === 'out_of_radius') return showFail('📍', 'Вы не в аудитории', 'Система определила, что вы вне аудитории.');
      if (err === 'geolocation required') return showFail('📍', 'Нужна геолокация', 'Разрешите доступ к геопозиции и попробуйте снова.');
      if (err === 'qr_forward_blocked') return showFail('⏱', 'Код уже использован', 'Этот QR уже привязан к другому устройству. Дождитесь нового QR и сканируйте снова.', { tagText: 'Отсканируйте новый QR' });
      if (err === 'qr_code_overused') return showFail('⏱', 'Код перегружен', 'Этим кодом уже отметилось много устройств. Дождитесь обновления QR на экране и отсканируйте заново.', { tagText: 'Отсканируйте новый QR' });
      if (err === 'session already ended') return showFail('✕', 'Сессия завершена', 'Преподаватель уже завершил эту сессию.');
      if (response.status === 429 || data.error === 'too_many_requests') return showFail('⏱', 'Слишком много запросов', 'Подождите минуту и отсканируйте QR снова.');
      return showFail('✕', 'Ошибка', 'Не удалось пройти проверку. Отсканируйте QR-код заново.', { tagText: 'Попробуйте ещё раз' });
    }
    showStudentForm(data.session, data.oneTimeToken, fp);
  } catch (e) {
    showFail('✕', 'Сервер недоступен', 'Не удалось связаться с сервером. Попробуйте позже.');
  }
}

function showStudentForm(session, oneTimeToken, fingerprint) {
  const sc = document.getElementById('screen-student');
  if (!sc) return;
  sc.innerHTML = `
    <div class="st-brand"><div class="st-bd"></div><div class="st-bn">STARTUP STUDIO NSU</div></div>
    <div class="st-card ok" id="st-card">
      <div class="st-icon ok">✍</div>
      <div class="st-title">Отметка на занятии</div>
      <div class="st-desc">Введите свои данные, чтобы подтвердить присутствие.</div>
      <div class="st-sep"></div>
      <form id="att-form" style="width:100%;display:flex;flex-direction:column;gap:10px;margin-top:6px;">
        <input type="text" id="st-name" placeholder="Фамилия Имя" required maxlength="80" autocomplete="off"
          style="width:100%;background:var(--sf);border:1.5px solid var(--bd);color:var(--wh);font-family:'Inter',sans-serif;font-size:14px;padding:10px 12px;border-radius:10px;outline:none;">
        <input type="text" id="st-group" placeholder="Группа" required maxlength="20" autocomplete="off"
          style="width:100%;background:var(--sf);border:1.5px solid var(--bd);color:var(--wh);font-family:'Inter',sans-serif;font-size:14px;padding:10px 12px;border-radius:10px;outline:none;">
        <button type="submit"
          style="margin-top:4px;width:100%;padding:11px 14px;background:var(--pk);border:none;border-radius:10px;color:#fff;font-family:'Unbounded',sans-serif;font-size:12px;font-weight:800;letter-spacing:.08em;cursor:pointer;">
          ОТПРАВИТЬ
        </button>
        <div id="att-form-err" role="alert" style="display:none;color:var(--dn);font-size:12px;margin-top:4px;"></div>
      </form>
      <div class="st-tag ok" style="margin-top:8px;">Сессия: ${esc(session.subject || 'Занятие')}</div>
    </div>`;

  const form = document.getElementById('att-form');
  if (!form) return;
  const nameInput = document.getElementById('st-name');
  const groupInput = document.getElementById('st-group');
  filterCyrillicName(nameInput);
  filterGroup(groupInput);
  const errEl = document.getElementById('att-form-err');
  if (nameInput) nameInput.addEventListener('input', () => { if (errEl) errEl.style.display = 'none'; });
  if (groupInput) groupInput.addEventListener('input', () => { if (errEl) errEl.style.display = 'none'; });
  let submitting = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const name = (nameInput && nameInput.value.trim()) || '';
    const group = (groupInput && groupInput.value.trim()) || '';
    const nameErr = validateCyrillicName(name);
    if (nameErr) {
      showStudentFieldError(nameInput, nameErr);
      return;
    }
    const groupErr = validateGroup(group);
    if (groupErr) {
      showStudentFieldError(groupInput, groupErr);
      return;
    }
    if (errEl) errEl.style.display = 'none';
    submitting = true;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Отправка...';
    try {
      const { response, data } = await api.submitAttendance({
        sessionId: uSession,
        oneTimeToken,
        fingerprint,
        studentName: name,
        studentGroup: group
      });
      if (!response.ok || !data.ok) {
        const err = data.error || 'unknown';
        if (err === 'already_marked') return showFail('⚠', 'Уже отмечен', 'Вы уже отметились на этом занятии.');
        if (err === 'oneTimeToken expired' || err === 'invalid oneTimeToken') {
          return showFail('⏱', 'Токен формы истёк', 'Отсканируйте QR-код заново с экрана преподавателя и заполните форму повторно.', { tagText: 'Отсканируйте новый QR' });
        }
        if (response.status === 429 || err === 'too_many_requests') return showFail('⏱', 'Слишком много запросов', 'Подождите минуту и попробуйте снова.');
        btn.disabled = false;
        btn.textContent = 'ОТПРАВИТЬ';
        submitting = false;
        if (errEl) {
          errEl.textContent = 'Не удалось сохранить отметку. Попробуйте снова.';
          errEl.style.display = '';
        }
        return;
      }
      const card = document.getElementById('st-card');
      if (card) {
        card.innerHTML = `
          <div class="st-icon ok">✓</div>
          <div class="st-title">Вы отмечены!</div>
          <div class="st-sep"></div>
          <div class="st-desc">Посещаемость зафиксирована. Можно закрыть эту страницу.</div>
          <div class="st-tag ok">Подтверждено</div>`;
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'ОТПРАВИТЬ';
      submitting = false;
      if (errEl) {
        errEl.textContent = 'Не удалось связаться с сервером. Попробуйте ещё раз.';
        errEl.style.display = '';
      }
    }
  });
}

function startAttendancePolling() {
  if (!cfg.sessionId) return;
  const box = document.getElementById('att-box');
  if (box) box.style.display = 'block';
  const load = async () => {
    const teacherToken = auth.getTeacherToken();
    if (!teacherToken) return;
    try {
      const { response, data } = await api.getAttendances(cfg.sessionId, teacherToken);
      if (response.status === 403 && data.error === 'teacher_required') {
        auth.clearTeacherToken();
        show('screen-teacher-code');
        const e = document.getElementById('teacher-code-err-txt'), w = document.getElementById('teacher-code-err');
        if (e) e.textContent = 'Сессия истекла. Введите код преподавателя снова.';
        if (w) w.classList.add('visible');
        return;
      }
      if (!response.ok) return;
      const listEl = document.getElementById('att-list');
      const cnt = document.getElementById('att-count');
      if (!listEl || !cnt) return;
      cnt.textContent = data.count || 0;
      const items = data.items || [];
      if (items.length === 0) {
        listEl.innerHTML = '<div style="font-size:12px;color:var(--mt);opacity:.8;">Пока никто не отметился.</div>';
        return;
      }
      listEl.innerHTML = items.map((it, idx) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:11px;opacity:.6;">${idx + 1}.</span>
            <span>${esc(it.name)}</span>
          </div>
          <span style="font-size:11px;color:var(--mt);">${esc(it.group)}</span>
        </div>`).join('');
      listEl.scrollTop = listEl.scrollHeight;
    } catch (e) {}
  };
  load();
  if (attTimer) clearInterval(attTimer);
  attTimer = setInterval(load, 5000);
}

function downloadCsv() {
  if (!cfg.sessionId) return;
  const teacherToken = auth.getTeacherToken();
  if (!teacherToken) return;
  const url = api.getCsvUrl(cfg.sessionId, teacherToken);
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

startAppParticlesOnce();
initStars();
initSplash();

window.downloadCsv = downloadCsv;
window.endSession = endSession;
window.show = show;
window.onTeacherCodeInput = onTeacherCodeInput;
window.toggleTeacherCodeVis = toggleTeacherCodeVis;
window.submitTeacherCode = submitTeacherCode;
window.startSession = startSession;
window.newSession = newSession;
