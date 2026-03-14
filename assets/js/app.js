/**
 * Точка входа приложения: экраны, навигация, бизнес-логика.
 */

import { urlParams } from './config.js';
import * as api from './api.js';
import * as auth from './auth.js';

const uToken = urlParams.token;
const uSession = urlParams.session;
const uGeo = urlParams.geo;

let cfg = { sessionId: null, interval: 15 };
let tLeft = 15;
let ticker = null;
let attTimer = null;

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
  const video = document.getElementById('splash-video');
  const progressFill = document.getElementById('splash-progress-fill');
  if (!splash || !video) {
    afterSplash();
    return;
  }
  const SPLASH_MS = 3400;
  const CROSSFADE_MS = 700;
  if (progressFill) progressFill.style.setProperty('--splash-duration', (SPLASH_MS / 1000) + 's');

  function dismissSplash() {
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

  let videoEnded = false;
  const safetyTimer = setTimeout(() => { if (!videoEnded) dismissSplash(); }, SPLASH_MS);
  video.addEventListener('canplay', () => { video.classList.add('ready'); video.play().catch(() => {}); });
  video.addEventListener('ended', () => { videoEnded = true; clearTimeout(safetyTimer); dismissSplash(); });
  video.addEventListener('error', () => {});
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

async function initTeacherEntry() {
  const token = auth.getTeacherToken();
  if (!token) {
    show('screen-teacher-code');
    return;
  }
  try {
    const { response } = await api.checkTeacherToken(token);
    if (response.ok) {
      show('screen-setup');
      return;
    }
  } catch (e) {}
  auth.clearTeacherToken();
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
  if (!inp || !btn) return;
  const isText = inp.type === 'text';
  inp.type = isText ? 'password' : 'text';
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

function captureGeo() {
  const st = document.getElementById('geo-status');
  const inp = document.getElementById('inp-geo');
  st.className = 'geo-status';
  st.innerHTML = '<span class="geo-dot"></span>Определяем координаты…';
  if (!navigator.geolocation) {
    st.className = 'geo-status err';
    st.innerHTML = '<span class="geo-dot"></span>Геолокация не поддерживается браузером';
    return;
  }
  let resolved = false;
  function applyPosition(pos) {
    if (resolved) return;
    resolved = true;
    const lat = pos.coords.latitude.toFixed(6);
    const lng = pos.coords.longitude.toFixed(6);
    const acc = Math.round(pos.coords.accuracy);
    inp.value = `${lat}, ${lng}`;
    inp.dataset.acc = acc;
    const radSlider = document.getElementById('inp-radius');
    const radVal = document.getElementById('radius-val');
    const suggested = Math.min(300, Math.max(80, Math.round(acc * 0.15) + 80));
    radSlider.value = suggested;
    radVal.textContent = suggested + 'м';
    const accLabel = acc < 50 ? 'GPS' : acc < 500 ? 'WiFi' : 'IP-геолокация';
    const isUnreliable = acc > 500;
    st.className = 'geo-status ' + (isUnreliable ? 'err' : 'ok');
    if (isUnreliable) {
      st.innerHTML = `<span class="geo-dot"></span>⚠ ${accLabel}, ±${acc} м — геопроверка будет отключена (слишком низкая точность). Защита только по fingerprint.`;
    } else {
      st.innerHTML = `<span class="geo-dot"></span>Зафиксировано ✓ (${accLabel}, ±${acc} м → радиус ${suggested} м)`;
    }
  }
  function onError(err) {
    if (resolved) return;
    resolved = true;
    st.className = 'geo-status err';
    const msg = err.code === 1
      ? 'Доступ запрещён. Разрешите геолокацию в настройках браузера, затем нажмите ⊕ снова.'
      : err.code === 3
        ? 'Нет ответа. Проверьте, что геолокация включена в системе.'
        : 'Геолокация недоступна на этом устройстве.';
    st.innerHTML = `<span class="geo-dot"></span>${msg}`;
  }
  navigator.geolocation.getCurrentPosition(applyPosition, (err) => {
    if (err.code === 1) { onError(err); return; }
    navigator.geolocation.getCurrentPosition(applyPosition, onError, { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false });
  }, { timeout: 8000, maximumAge: 0, enableHighAccuracy: true });
}

async function startSession() {
  const subject = document.getElementById('inp-subject').value.trim() || 'Занятие';
  const interval = parseInt(document.getElementById('inp-interval').value, 10) || 15;
  const geoRaw = document.getElementById('inp-geo').value.trim();
  const radius = parseInt(document.getElementById('inp-radius').value, 10) || 80;
  let geoLat = null, geoLng = null;
  if (geoRaw) {
    const parts = geoRaw.split(',').map((s) => parseFloat(s.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      geoLat = parts[0];
      geoLng = parts[1];
    }
  }
  const teacherToken = auth.getTeacherToken();
  if (!teacherToken) {
    show('screen-teacher-code');
    const e = document.getElementById('teacher-code-err-txt'), w = document.getElementById('teacher-code-err');
    if (e) e.textContent = 'Сессия истекла. Введите код преподавателя снова.';
    if (w) w.classList.add('visible');
    return;
  }
  try {
    const { response, data } = await api.createSession({
      teacherToken,
      subject,
      qrInterval: interval,
      geoLat,
      geoLng,
      geoRadius: radius,
      fingerprintRequired: true,
      geoRequired: !!(geoLat && geoLng)
    });
    if (response.status === 403 && (data.error === 'teacher_required' || data.error === 'invalid_or_expired')) {
      auth.clearTeacherToken();
      show('screen-teacher-code');
      const e = document.getElementById('teacher-code-err-txt'), w = document.getElementById('teacher-code-err');
      if (e) e.textContent = 'Сессия истекла. Введите код преподавателя снова.';
      if (w) w.classList.add('visible');
      return;
    }
    if (!response.ok) throw new Error('create');
    const s = data.session;
    cfg.sessionId = data.sessionId;
    cfg.interval = s.qrInterval || interval;
    cfg.geoRequired = !!s.geoRequired;
    document.getElementById('lbl-subject').textContent = s.subject;
    document.getElementById('info-ivl').textContent = `${cfg.interval} сек`;
    const geoChip = document.getElementById('info-geo');
    if (geoChip) geoChip.textContent = (s.geoLat != null) ? 'Geo + FP' : 'Fingerprint';
    show('screen-teacher');
    document.getElementById('att-box').style.display = 'block';
    genQR();
    startTimer();
    startAttendancePolling();
  } catch (e) {
    alert('Ошибка при создании сессии. Проверьте подключение к серверу.');
  }
}

async function genQR() {
  if (!cfg.sessionId) return;
  try {
    const { response, data } = await api.getQrToken(cfg.sessionId, cfg.interval);
    if (!response.ok) throw new Error('qr');
    const token = data.token;
    const tok = document.getElementById('info-tok');
    if (tok) tok.textContent = token.slice(0, 8) + '…';
    const base = location.origin + location.pathname;
    let url = `${base}?sid=${encodeURIComponent(cfg.sessionId)}&t=${encodeURIComponent(token)}`;
    if (cfg.geoRequired) url += '&g=1';
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
  show('screen-setup');
  const inp = document.getElementById('inp-geo');
  const st = document.getElementById('geo-status');
  if (inp && inp.value) {
    st.className = 'geo-status ok';
    st.innerHTML = '<span class="geo-dot"></span>Координаты сохранены с прошлой сессии. Нажмите ⊕ чтобы обновить.';
  }
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

function showFail(icon, title, desc) {
  const card = document.getElementById('st-card');
  if (!card) return;
  card.innerHTML = `
    <div class="st-icon fail">${icon}</div>
    <div class="st-title">${title}</div>
    <div class="st-sep"></div>
    <div class="st-desc">${desc}</div>
    <div class="st-tag fail">Отказано в доступе</div>`;
}

async function runCheck() {
  if (!uToken || !uSession) return showFail('✕', 'Неверная ссылка', 'Параметры повреждены. Отсканируйте QR заново.');
  const st = document.getElementById('st-card');
  if (!st) return;
  st.innerHTML = `
    <div class="st-icon spin"><div class="spin-r"></div></div>
    <div class="st-title spin">Проверяем устройство…</div>
    <div class="st-desc">Секунду — идёт проверка QR</div>`;

  let fp = 'fb_' + navigator.userAgent + screen.width + screen.height;
  try {
    const fpResult = await Promise.race([
      (async () => { const r = await (await FingerprintJS.load()).get(); return r.visitorId; })(),
      new Promise((res) => setTimeout(() => res(null), 3000))
    ]);
    if (fpResult) fp = fpResult;
  } catch (e) {}

  let lat = null, lng = null;
  if (uGeo && navigator.geolocation) {
    st.innerHTML = `
      <div class="st-icon spin"><div class="spin-r"></div></div>
      <div class="st-title spin">Проверяем геолокацию…</div>
      <div class="st-desc">Разрешите доступ к местоположению</div>`;
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000, maximumAge: 0, enableHighAccuracy: true })
      );
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
    } catch (e) {
      if (e.code === 1) return showFail('📍', 'Нужна геолокация', 'Разрешите доступ к геопозиции в настройках браузера и попробуйте снова.');
      if (e.code === 3) return showFail('📍', 'Геолокация недоступна', 'Не удалось определить местоположение. Попробуйте у окна или на улице.');
      return showFail('📍', 'Нужна геолокация', 'Разрешите доступ к геопозиции и попробуйте снова.');
    }
    st.innerHTML = `
      <div class="st-icon spin"><div class="spin-r"></div></div>
      <div class="st-title spin">Проверяем устройство…</div>
      <div class="st-desc">Секунду — идёт проверка</div>`;
  }

  try {
    const { response, data } = await api.checkAccess({
      sessionId: uSession,
      token: uToken,
      fingerprint: fp,
      geoLat: lat,
      geoLng: lng
    });
    if (!response.ok || !data.ok) {
      const err = data.error || 'unknown';
      if (err === 'token expired') return showFail('⏱', 'QR устарел', 'Код истёк. Отсканируйте свежий QR с проектора.');
      if (err === 'invalid token') return showFail('✕', 'Неверный код', 'Код недействителен. Отсканируйте QR ещё раз.');
      if (err === 'already_marked') return showFail('⚠', 'Уже отмечен', 'Вы уже отметились на этом занятии.');
      if (err === 'out_of_radius') return showFail('📍', 'Вы не в аудитории', 'Система определила, что вы вне аудитории.');
      if (err === 'geolocation required') return showFail('📍', 'Нужна геолокация', 'Разрешите доступ к геопозиции и попробуйте снова.');
      if (err === 'qr_code_overused') return showFail('⏱', 'Код перегружен', 'Этим кодом уже отметилось много устройств. Дождитесь обновления QR на экране и отсканируйте заново.');
      if (response.status === 429 || data.error === 'too_many_requests') return showFail('⏱', 'Слишком много запросов', 'Подождите минуту и отсканируйте QR снова.');
      return showFail('✕', 'Ошибка', 'Не удалось пройти проверку. Попробуйте ещё раз.');
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
        <input type="text" id="st-name" placeholder="Фамилия Имя" required
          style="width:100%;background:var(--sf);border:1.5px solid var(--bd);color:var(--wh);font-family:'Inter',sans-serif;font-size:14px;padding:10px 12px;border-radius:10px;outline:none;">
        <input type="text" id="st-group" placeholder="Группа (например, ИТ‑21)" required
          style="width:100%;background:var(--sf);border:1.5px solid var(--bd);color:var(--wh);font-family:'Inter',sans-serif;font-size:14px;padding:10px 12px;border-radius:10px;outline:none;">
        <button type="submit"
          style="margin-top:4px;width:100%;padding:11px 14px;background:var(--pk);border:none;border-radius:10px;color:#fff;font-family:'Unbounded',sans-serif;font-size:12px;font-weight:800;letter-spacing:.08em;cursor:pointer;">
          ОТПРАВИТЬ
        </button>
      </form>
      <div class="st-tag ok" style="margin-top:8px;">Сессия: ${session.subject || 'Занятие'}</div>
    </div>`;

  const form = document.getElementById('att-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('st-name').value.trim();
    const group = document.getElementById('st-group').value.trim();
    if (!name || !group) return;
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
        if (err === 'oneTimeToken expired') return showFail('⏱', 'Сессия истекла', 'Слишком долгое заполнение. Отсканируйте QR заново.');
        if (response.status === 429 || err === 'too_many_requests') return showFail('⏱', 'Слишком много запросов', 'Подождите минуту и попробуйте снова.');
        return showFail('✕', 'Ошибка', 'Не удалось сохранить отметку. Попробуйте снова.');
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
      showFail('✕', 'Сервер недоступен', 'Не удалось отправить данные. Попробуйте ещё раз.');
    }
  });
}

function startAttendancePolling() {
  if (!cfg.sessionId) return;
  const box = document.getElementById('att-box');
  if (box) box.style.display = 'block';
  const load = async () => {
    try {
      const { response, data } = await api.getAttendances(cfg.sessionId);
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
    } catch (e) {}
  };
  load();
  if (attTimer) clearInterval(attTimer);
  attTimer = setInterval(load, 5000);
}

startAppParticlesOnce();
initStars();
initSplash();

window.show = show;
window.onTeacherCodeInput = onTeacherCodeInput;
window.toggleTeacherCodeVis = toggleTeacherCodeVis;
window.submitTeacherCode = submitTeacherCode;
window.captureGeo = captureGeo;
window.startSession = startSession;
window.newSession = newSession;
