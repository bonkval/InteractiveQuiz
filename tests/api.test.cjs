const test = require('node:test');
const assert = require('node:assert/strict');

function response() {
  return {code:0,payload:null,headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.code=code;return this;},json(payload){this.payload=payload;return this;}};
}

test('owner authentication has no registration path and signs in with the configured username', async () => {
  const previous = {...process.env};
  process.env.OWNER_USERNAME='cval';process.env.OWNER_PASSWORD='test-password';process.env.OWNER_SESSION_SECRET='test-session-secret-that-is-at-least-thirty-two-characters';
  try {
    const {default:handler}=await import('../api/auth.mjs');
    const registration=response();
    await handler({method:'POST',headers:{origin:'https://study.test',host:'study.test'},body:{action:'signup',username:'other',password:'test-password'}},registration);
    assert.equal(registration.code,400);
    const invalid=response();
    await handler({method:'POST',headers:{origin:'https://study.test',host:'study.test'},body:{action:'login',username:'other',password:'test-password'}},invalid);
    assert.equal(invalid.code,401);
    const login=response();
    await handler({method:'POST',headers:{origin:'https://study.test',host:'study.test'},body:{action:'login',username:'cval',password:'test-password'}},login);
    assert.equal(login.code,200);
    assert.match(login.headers['Set-Cookie'],/HttpOnly/);
    const session=response();
    await handler({method:'GET',headers:{cookie:login.headers['Set-Cookie'].split(';')[0]}},session);
    assert.equal(session.payload.owner,true);
    const tampered=response(), validCookie=login.headers['Set-Cookie'].split(';')[0], cookieValue=validCookie.slice(validCookie.indexOf('=')+1);
    const altered=cookieValue[0]==='x'?'y':'x';
    await handler({method:'GET',headers:{cookie:`revvy_owner=${altered}${cookieValue.slice(1)}`}},tampered);
    assert.equal(tampered.payload.owner,false);
    const logout=response();
    await handler({method:'POST',headers:{origin:'https://study.test',host:'study.test',cookie:login.headers['Set-Cookie'].split(';')[0]},body:{action:'logout'}},logout);
    assert.match(logout.headers['Set-Cookie'],/Max-Age=0/);
  } finally {
    for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];
    for(const [key,value] of Object.entries(previous))process.env[key]=value;
  }
});

test('owner login fails closed when deployment secrets are missing', async () => {
  const previous={...process.env};
  delete process.env.OWNER_USERNAME;delete process.env.OWNER_PASSWORD;delete process.env.OWNER_SESSION_SECRET;
  try{
    const {default:handler}=await import('../api/auth.mjs');
    const status=response();await handler({method:'GET',headers:{}},status);
    assert.deepEqual(status.payload,{owner:false,configured:false});
    const login=response();await handler({method:'POST',headers:{},body:{action:'login',username:'cval',password:'anything'}},login);
    assert.equal(login.code,503);
  }finally{
    for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];
    for(const [key,value]of Object.entries(previous))process.env[key]=value;
  }
});

test('shared library writes require owner session and same-origin requests', async () => {
  const previous = {...process.env};
  process.env.OWNER_USERNAME='cval';process.env.OWNER_PASSWORD='test-password';process.env.OWNER_SESSION_SECRET='test-session-secret-that-is-at-least-thirty-two-characters';
  try {
    const {default:handler}=await import('../api/library.mjs');
    const missingSession=response();
    await handler({method:'PUT',headers:{origin:'https://study.test',host:'study.test'},body:{reviewers:[]}},missingSession);
    assert.equal(missingSession.code,401);
    const wrongOrigin=response();
    await handler({method:'PUT',headers:{origin:'https://evil.test',host:'study.test'},body:{reviewers:[]}},wrongOrigin);
    assert.equal(wrongOrigin.code,403);
  } finally {
    for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];
    for(const [key,value] of Object.entries(previous))process.env[key]=value;
  }
});
