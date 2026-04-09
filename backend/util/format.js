import crypto from 'crypto';

export function fpShort(fp) {
  const s = String(fp || '');
  return s.length <= 18 ? s : `${s.slice(0, 8)}...${s.slice(-6)}`;
}

export function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip || '')).digest('hex').slice(0, 32);
}

export function hashUa(ua) {
  return crypto.createHash('sha256').update(String(ua || '')).digest('hex').slice(0, 32);
}
