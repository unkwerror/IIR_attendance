import crypto from 'crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const ID_REGEX = /^[A-Za-z0-9]{8,64}$/;

export function genId(len = 24) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function isValidId(id) {
  return typeof id === 'string' && ID_REGEX.test(id);
}
