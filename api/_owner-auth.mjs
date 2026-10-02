import {createHmac, randomBytes, timingSafeEqual, scrypt as scryptCallback} from 'node:crypto';

const scrypt = (value, salt) => new Promise((resolve,reject)=>scryptCallback(value,salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(key)));

const COOKIE = 'revvy_owner';
const SESSION_SECONDS = 60 * 60 * 24 * 14;

function secret() {
  return process.env.OWNER_SESSION_SECRET || '';
}

export function isConfigured() {
  return Boolean(process.env.OWNER_USERNAME && process.env.OWNER_PASSWORD && secret().length >= 32);
}

function signature(value) {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}

export function createSession(username) {
  const payload = Buffer.from(JSON.stringify({sub:username, exp:Math.floor(Date.now()/1000)+SESSION_SECONDS, nonce:randomBytes(12).toString('base64url')})).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function readSession(request) {
  if (!isConfigured()) return false;
  const raw = request.headers?.cookie || '';
  const token = raw.split(';').map(part=>part.trim()).find(part=>part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);
  if (!token) return false;
  const [payload, supplied, extra] = token.split('.');
  if (!payload || !supplied || extra) return false;
  const expected = Buffer.from(signature(payload));
  const actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return session.sub === process.env.OWNER_USERNAME && Number(session.exp) > Math.floor(Date.now()/1000);
  } catch { return false; }
}

export async function credentialsMatch(username, password) {
  const salt=secret();
  const [expected,supplied]=await Promise.all([
    scrypt(`${process.env.OWNER_USERNAME}\0${process.env.OWNER_PASSWORD}`,salt),
    scrypt(`${username}\0${password}`,salt)
  ]);
  return timingSafeEqual(expected, supplied);
}

export function setSessionCookie(request, response, token) {
  const secure = process.env.NODE_ENV === 'production' || request.headers?.['x-forwarded-proto'] === 'https';
  response.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure?'; Secure':''}`);
}

export function clearSessionCookie(request, response) {
  const secure = process.env.NODE_ENV === 'production' || request.headers?.['x-forwarded-proto'] === 'https';
  response.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure?'; Secure':''}`);
}

export function sameOrigin(request) {
  const origin = request.headers?.origin;
  if (!origin) return true;
  const host = request.headers?.['x-forwarded-host'] || request.headers?.host;
  try { return Boolean(host) && new URL(origin).host.toLowerCase() === String(host).toLowerCase(); }
  catch { return false; }
}
