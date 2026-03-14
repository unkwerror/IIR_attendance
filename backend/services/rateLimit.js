import { config } from '../config.js';

const store = new Map();

function key(name, ip) {
  return `${name}:${ip}`;
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

const limiters = new Map();

function getLimiter(name, maxPerMinute) {
  if (!limiters.has(name)) {
    limiters.set(name, { max: maxPerMinute, storeKey: (ip) => key(name, ip) });
  }
  return limiters.get(name);
}

export function checkGenericLimit(name, ip, maxPerMinute) {
  clean(name);
  const lim = getLimiter(name, maxPerMinute);
  const k = lim.storeKey(ip);
  const rec = store.get(k);
  const now = Date.now();
  const windowStart = now - 60000;
  if (!rec) return true;
  if (rec.resetAt < windowStart) {
    store.delete(k);
    return true;
  }
  return rec.count < maxPerMinute;
}

export function recordGenericLimit(name, ip) {
  const k = key(name, ip);
  const now = Date.now();
  let rec = store.get(k);
  if (!rec || rec.resetAt < now) {
    rec = { count: 0, resetAt: now + 60000 };
    store.set(k, rec);
  }
  rec.count += 1;
}
