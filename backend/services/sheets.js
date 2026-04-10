import crypto from 'crypto';
import { config } from '../config.js';

let accessTokenCache = null;
let tokenExpiresAt = 0;

function parseGoogleCredentials(raw) {
  const src = String(raw || '').trim();
  if (!src) return null;
  const unescapedQuotes = src.split('\\"').join('"');
  const normalizedBackslashNewlines = unescapedQuotes.replace(/\\\r?\n/g, '\\n');

  const attempts = [
    src,
    unescapedQuotes,
    normalizedBackslashNewlines,
    normalizedBackslashNewlines.replace(/\\\\n/g, '\\n')
  ];

  for (const candidate of attempts) {
    try {
      let parsed = JSON.parse(candidate);
      if (typeof parsed === 'string') {
        parsed = JSON.parse(parsed);
      }
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch (_) {}
  }
  return null;
}

function generateJWT(clientEmail, privateKey) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const payload = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp,
    iat
  };
  const encHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const unsigned = `${encHeader}.${encPayload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
  return `${unsigned}.${signature}`;
}

async function getAccessToken(creds) {
  if (accessTokenCache && Date.now() < tokenExpiresAt) {
    return accessTokenCache;
  }
  const jwt = generateJWT(creds.client_email, creds.private_key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Auth failed: ${res.status} ${errText}`);
  }
  const data = await res.json();
  accessTokenCache = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return accessTokenCache;
}

export async function appendAttendanceRow({ createdAt, studentName, studentGroup, sessionSubject }) {
  const { credentials, spreadsheetId } = config.googleSheets;
  if (!credentials || !spreadsheetId) return;
  
  const creds = parseGoogleCredentials(credentials);
  if (!creds) {
    console.error('Invalid GOOGLE_SHEETS_CREDENTIALS JSON');
    return;
  }

  const d = new Date(createdAt || Date.now());
  const ymd = d.toLocaleString('en-CA', {
    timeZone: config.localTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  try {
    const token = await getAccessToken(creds);
    const range = 'A:D';
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;
    
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: [[ymd, studentName || '', studentGroup || '', sessionSubject || '']]
      })
    });
    
    if (!res.ok) {
      const errText = await res.text();
      console.error('[sheets] append failed:', res.status, errText);
    }
  } catch (e) {
    console.error('[sheets] append to Google Sheets error', e);
  }
}
