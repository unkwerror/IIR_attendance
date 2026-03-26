import { config } from '../config.js';

const store = new Map();

function key(name, ip, scope = '') {
  const scopePart = scope ? String(scope) : '-';
  return `${name}:${ip}:${scopePart}`;
}

function clean(name) {
  const now = Date.now();
  for (const [k, data] of store.entries()) {
    if (k.startsWith(name + ':') && data.resetAt < now) store.delete(k);
  }
}

export function isVerifyRateLimited(ip) {
  const name = 'verify-teacher';
  clean(name);
  const rec = store.get(key(name, ip));
  const now = Date.now();
  if (!rec) return false;
  if (now >= rec.resetAt) {
    store.delete(key(name, ip));
    return false;
  }
  return rec.count >= config.verifyMaxAttempts;
}

export function recordVerifyAttempt(ip, success) {
  const name = 'verify-teacher';
  if (success) {
    store.delete(key(name, ip));
    return;
  }
  const now = Date.now();
  const k = key(name, ip);
  let rec = store.get(k);
  if (!rec) {
    rec = { count: 0, resetAt: now + config.verifyRateWindowMs };
    store.set(k, rec);
  }
  rec.count += 1;
}

export function checkGenericLimit(name, ip, maxPerMinute, scope = '') {
  clean(name);
  const k = key(name, ip, scope);
  const rec = store.get(k);
  const now = Date.now();
  if (!rec) return true;
  if (now >= rec.resetAt) {
    store.delete(k);
    return true;
  }
  return rec.count < maxPerMinute;
}

export function recordGenericLimit(name, ip, scope = '') {
  const k = key(name, ip, scope);
  const now = Date.now();
  let rec = store.get(k);
  if (!rec || rec.resetAt < now) {
    rec = { count: 0, resetAt: now + 60000 };
    store.set(k, rec);
  }
  rec.count += 1;
}
