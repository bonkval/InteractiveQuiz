const test = require('node:test');
const assert = require('node:assert/strict');

function response() {
  return {code:0,payload:null,headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.code=code;return this;},json(payload){this.payload=payload;return this;},send(payload){this.payload=payload;return this;}};
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

// Run the real handler with a conditional-write Blob store, without network access.
async function libraryFixture({weakReads=false,changeDuringHead=false,initialReviewers=[{id:'old',title:'Old reviewer',questions:[{text:'Question?',options:[]}]}]}={}) {
  const fs=require('node:fs');
  const {pathToFileURL}=require('node:url');
  const records=new Map();
  let version=0;
  const seed=(path,value)=>records.set(path,{value,etag:'"version-'+(++version)+'"'});
  seed('revvy/shared-reviewers.json',{reviewers:initialReviewers});
  seed('revvy/reviewers-index.json',{entries:[]});
  const storage={
    async get(path){const item=records.get(path);return item?{statusCode:200,stream:JSON.stringify(item.value),blob:{etag:(weakReads?'W/':'')+item.etag}}:null;},
    async head(path){
      if(changeDuringHead&&path==='revvy/shared-reviewers.json'){
        changeDuringHead=false;
        seed(path,{reviewers:[{id:'old',title:'Updated remotely',questions:[{text:'Question?',options:[]}]}]});
      }
      return {etag:records.get(path).etag};
    },
    async put(path,content,options){
      const item=records.get(path);
      if(item&&(!options.allowOverwrite||(options.ifMatch&&options.ifMatch!==item.etag))){const error=new Error('Precondition failed: ETag mismatch');error.name='BlobPreconditionFailedError';throw error;}
      if(options.addRandomSuffix)path+='-'+(++version);
      seed(path,JSON.parse(content));return {pathname:path,etag:records.get(path).etag};
    }
  };
  const key='__libraryFixture'+Math.random();globalThis[key]=storage;
  const source=fs.readFileSync('api/library.mjs','utf8')
    .replace(/import \{[^}]+\} from '@vercel\/blob';/,'const {get,put,head}=globalThis['+JSON.stringify(key)+'];')
    .replace("'./_owner-auth.mjs'",JSON.stringify(pathToFileURL(require('node:path').resolve('api/_owner-auth.mjs')).href));
  let handler;
  try{handler=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;}finally{delete globalThis[key];}
  const {createSession}=await import('../api/_owner-auth.mjs');
  return async(method,body,etag='',query={})=>{
    const result=response();
    await handler({method,body,query,headers:{host:'study.test',origin:'https://study.test',cookie:'revvy_owner='+createSession('cval'),'if-match':etag}},result);
    return result;
  };
}

test('weak download ETags do not block reviewer additions and persistent deletions',async()=>{
  const previous={...process.env};
  process.env.OWNER_USERNAME='cval';process.env.OWNER_PASSWORD='test-password';process.env.OWNER_SESSION_SECRET='test-session-secret-that-is-at-least-thirty-two-characters';
  try{
    const call=await libraryFixture({weakReads:true,changeDuringHead:true});
    const initial=await call('GET');
    assert.equal((await call('GET',undefined,'',{id:'old'})).payload.reviewer.title,'Updated remotely','a changed version is read again before using its metadata');
    const saved=await call('PUT',{changes:[{id:'new',reviewer:{id:'new',title:'New reviewer',questions:[{text:'New question?',options:[]}]}}]},initial.headers.ETag);
    assert.equal(saved.code,200,'adding a reviewer succeeds with the token returned by GET');
    const current=await call('GET');
    const removed=await call('PUT',{changes:[{id:'old',reviewer:null}],baseRevision:current.payload.revision},'W/"rewritten-http-token"');
    assert.equal(removed.code,200,'deleting a reviewer succeeds');
    assert.deepEqual((await call('GET')).payload.entries.map(item=>item.id),['new']);
    assert.equal((await call('GET',undefined,'',{id:'old'})).code,404,'legacy reviewer remains deleted');
    const stale=await call('PUT',{changes:[{id:'new',reviewer:null}]},initial.headers.ETag);
    assert.equal(stale.code,412,'genuine stale writes are still rejected');
  }finally{
    for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];
    Object.assign(process.env,previous);
  }
});

test('metadata listings omit question bytes; versioned exhibits remain portable through edits and deletion',async()=>{
  const previous={...process.env};
  process.env.OWNER_USERNAME='cval';process.env.OWNER_PASSWORD='test-password';process.env.OWNER_SESSION_SECRET='test-session-secret-that-is-at-least-thirty-two-characters';
  try{
    const image='data:image/png;base64,aGVsbG8=';
    const reviewer={id:'images',title:'With diagrams',updatedAt:123,questions:[{text:'Refer to the figure.',options:['one','two'],images:[image],image,correctAnswers:[0]}]};
    const call=await libraryFixture({initialReviewers:[reviewer]});
    const list=await call('GET'),entry=list.payload.entries[0];
    assert.equal(entry.title,reviewer.title);assert.equal(entry.questionCount,1);
    assert.ok(entry.reviewerRevision);assert.equal(JSON.stringify(list.payload).includes(image),false);
    const detail=await call('GET',undefined,'',{id:'images',v:entry.reviewerRevision});
    const projected=detail.payload.reviewer;
    assert.match(projected.questions[0].images[0],/^\/api\/library\?/);
    assert.equal(projected.questions[0].image,projected.questions[0].images[0]);
    const query=Object.fromEntries(new URL(projected.questions[0].image,'https://study.test').searchParams);
    const media=await call('GET',undefined,'',query);
    assert.equal(media.code,200);assert.equal(media.payload.toString(),'hello');
    assert.match(media.headers['Cache-Control'],/immutable/);assert.equal(media.headers['Content-Type'],'image/png');
    const portable=await call('GET',undefined,'',{id:'images',v:entry.reviewerRevision,raw:'1'});
    assert.equal(portable.payload.reviewer.questions[0].image,image);
    const saved=await call('PUT',{baseRevision:list.payload.revision,changes:[{id:'images',reviewer:{...projected,title:'Edited'}}]});
    assert.equal(saved.code,200);
    assert.notEqual(saved.payload.reviewers[0].reviewerRevision,entry.reviewerRevision);
    const exported=await call('GET',undefined,'',{id:'images',raw:'1'});
    assert.equal(exported.payload.reviewer.questions[0].images[0],image,'saving media references preserves original image bytes');
    assert.equal((await call('GET',undefined,'',query)).code,409,'old image versions cannot be mixed with new reviewer content');
    assert.equal((await call('GET',undefined,'',{id:'images',media:'not-a-real-hash'})).code,404);
    const current=await call('GET');
    const deleted=await call('PUT',{baseRevision:current.payload.revision,changes:[{id:'images',reviewer:null}]});
    assert.equal(deleted.code,200);assert.equal((await call('GET',undefined,'',query)).code,404);
    assert.deepEqual((await call('GET')).payload.entries,[]);
  }finally{
    for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];
    Object.assign(process.env,previous);
  }
});
