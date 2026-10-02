import {createSession, credentialsMatch, isConfigured, readSession, setSessionCookie, clearSessionCookie, sameOrigin} from './_owner-auth.mjs';

const attempts = new Map();
function rateLimited(request) {
  const ip = String(request.headers?.['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.until <= now) { attempts.set(ip, {count:0, until:now+15*60_000}); return false; }
  return entry.count >= 8;
}
function recordFailure(request) {
  const ip = String(request.headers?.['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const entry = attempts.get(ip) || {count:0,until:Date.now()+15*60_000};
  entry.count++;
  attempts.set(ip,entry);
  if (attempts.size > 500) attempts.delete(attempts.keys().next().value);
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control','no-store, max-age=0');
  response.setHeader('X-Content-Type-Options','nosniff');
  if (request.method === 'GET') return response.status(200).json({owner:readSession(request),configured:isConfigured()});
  if (request.method !== 'POST') return response.status(405).json({error:'Use GET or POST.'});
  if (!sameOrigin(request)) return response.status(403).json({error:'Request origin not allowed.'});
  const action = String(request.body?.action || '');
  if (action === 'logout') { clearSessionCookie(request,response); return response.status(200).json({owner:false}); }
  if (action !== 'login') return response.status(400).json({error:'Unknown action.'});
  if (!isConfigured()) return response.status(503).json({error:'Owner login is not configured for this deployment.'});
  if (rateLimited(request)) return response.status(429).json({error:'Too many sign-in attempts. Try again later.'});
  const username = typeof request.body?.username === 'string' ? request.body.username.trim() : '';
  const password = typeof request.body?.password === 'string' ? request.body.password : '';
  if (username.length > 100 || password.length > 256 || !await credentialsMatch(username,password)) {
    recordFailure(request);
    return response.status(401).json({error:'Username or password is incorrect.'});
  }
  attempts.delete(String(request.headers?.['x-forwarded-for'] || 'unknown').split(',')[0].trim());
  setSessionCookie(request,response,createSession(process.env.OWNER_USERNAME));
  return response.status(200).json({owner:true,username:process.env.OWNER_USERNAME});
}
