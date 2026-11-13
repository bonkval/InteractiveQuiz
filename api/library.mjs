import {get, head, put} from '@vercel/blob';
import {readSession, sameOrigin} from './_owner-auth.mjs';
import {createHash} from 'node:crypto';

const LEGACY_PATH = 'revvy/shared-reviewers.json';
const INDEX_PATH = 'revvy/reviewers-index.json';
const MAX_BYTES = 4_000_000;
const CHUNK_CHARS = 600_000;
const JSON_TYPE = 'application/json; charset=utf-8';

async function readJson(pathname) {
  for (let attempt=0;attempt<3;attempt++) {
    const blob = await get(pathname,{access:'private',useCache:false});
    if (!blob) return null;
    if (blob.statusCode !== 200 || !blob.stream) throw new Error(`Could not read ${pathname}.`);
    const value=JSON.parse(await new Response(blob.stream).text());
    let etag=blob.blob.etag;
    if (etag.startsWith('W/')) {
      // Download proxies can weaken ETags. Conditional writes need the storage
      // API's original token, verified against the version we actually read.
      const metadata=await head(pathname);
      if (metadata.etag.replace(/^W\//,'')!==etag.slice(2)) continue;
      etag=metadata.etag;
      if (etag.startsWith('W/')) throw new Error('Storage did not provide a strong revision.');
    }
    return {value,etag};
  }
  throw new Error('Shared reviewers changed while reading. Try again.');
}

async function readLibrary() {
  const [legacy,index] = await Promise.all([readJson(LEGACY_PATH),readJson(INDEX_PATH)]);
  if (legacy && !Array.isArray(legacy.value.reviewers)) throw new Error('Legacy library is invalid.');
  if (index && (!Array.isArray(index.value.entries) || index.value.entries.length > 1000)) throw new Error('Reviewer index is invalid.');
  return {legacy,index,etag:index?.etag || legacy?.etag || ''};
}

function entriesFor({legacy,index}) {
  const entries = new Map((legacy?.value.reviewers || []).map(reviewer=>[reviewer.id,{id:reviewer.id}]));
  for (const entry of index?.value.entries || []) {
    if (entry.deleted) entries.delete(entry.id);
    else entries.set(entry.id,{id:entry.id});
  }
  return [...entries.values()];
}

const digest=value=>createHash('sha256').update(value).digest('hex');
function reviewerRevision(library,id) {
  const entry=library.index?.value.entries.find(item=>item.id===id);
  return entry?.pathname ? digest(entry.pathname) : digest(`${library.legacy?.etag || ''}:${id}`);
}
async function reviewerFor(library,id) {
  const entry=library.index?.value.entries.find(item=>item.id===id);
  if(entry?.deleted)return null;
  return entry?.pathname ? (await readJson(entry.pathname))?.value : library.legacy?.value.reviewers.find(item=>item.id===id);
}
function summary(reviewer) {
  return {title:reviewer.title,questionCount:reviewer.questions.length,updatedAt:Number(reviewer.updatedAt)||0};
}
async function catalogFor(library) {
  const items=entriesFor(library),result=new Array(items.length);let next=0;
  await Promise.all(Array.from({length:Math.min(3,items.length)},async()=>{
    while(next<items.length){
      const i=next++,{id}=items[i];
      const overlay=library.index?.value.entries.find(entry=>entry.id===id);
      const metadata=overlay?.title ? overlay : summary(await reviewerFor(library,id));
      result[i]={id,title:metadata.title,questionCount:metadata.questionCount,updatedAt:metadata.updatedAt,reviewerRevision:reviewerRevision(library,id)};
    }
  }));
  return result;
}
function mediaFor(reviewer) {
  const media=new Map();
  for(const question of reviewer.questions)for(const source of [...(question.images||[]),question.image].filter(Boolean)){
    if(/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(source))media.set(digest(source),source);
  }
  return media;
}
function withMediaUrls(reviewer,revision) {
  const media=mediaFor(reviewer);
  const replace=source=>media.has(digest(source)) ? `/api/library?id=${encodeURIComponent(reviewer.id)}&media=${digest(source)}&v=${revision}` : source;
  return {...reviewer,questions:reviewer.questions.map(question=>({...question,
    ...(question.images?{images:question.images.map(replace)}:{}),...(question.image?{image:replace(question.image)}:{})}))};
}
async function materializeMedia(reviewer,library) {
  const sources=new Map();
  async function replace(source) {
    if(!String(source).startsWith('/api/library?'))return source;
    const url=new URL(source,'https://revvy.invalid'),id=url.searchParams.get('id'),hash=url.searchParams.get('media');
    if(!hash||url.searchParams.get('v')!==reviewerRevision(library,id))throw new Error('An exhibit changed. Reload the reviewer before saving.');
    if(!sources.has(id))sources.set(id,reviewerFor(library,id).then(original=>{
      if(!original)throw new Error('An exhibit reviewer was removed.');return mediaFor(original);
    }));
    const original=(await sources.get(id)).get(hash);
    if(!original)throw new Error('Exhibit not found.');
    return original;
  }
  const questions=[];
  for(const question of reviewer.questions)questions.push({...question,
    ...(question.images?{images:await Promise.all(question.images.map(replace))}:{}),...(question.image?{image:await replace(question.image)}:{})});
  return {...reviewer,questions};
}

function validReviewer(reviewer) {
  if (!reviewer || typeof reviewer.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(reviewer.id) ||
      typeof reviewer.title !== 'string' || !reviewer.title.trim() || reviewer.title.length > 70 ||
      !Array.isArray(reviewer.questions) || !reviewer.questions.length || reviewer.questions.length > 20_000) return false;
  return reviewer.questions.every(question=>question && typeof question.text === 'string' && question.text.trim() &&
    question.text.length <= 20_000 && Array.isArray(question.options) && question.options.length <= 100);
}

function isConflict(error) {
  return error?.name === 'BlobPreconditionFailedError' || /Precondition failed: ETag mismatch|already exists/i.test(String(error?.message || ''));
}

export default async function handler(request,response) {
  response.setHeader('Cache-Control','no-store, max-age=0');
  response.setHeader('X-Content-Type-Options','nosniff');
  if (request.method === 'GET') {
    try {
      const library=await readLibrary();
      if (library.etag) response.setHeader('ETag',library.etag);
      const id=String(request.query?.id || '');
      if (!id) return response.status(200).json({initialized:Boolean(library.legacy || library.index),revision:library.etag,entries:await catalogFor(library)});
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return response.status(400).json({error:'Invalid reviewer ID.'});
      const overlay=library.index?.value.entries.find(entry=>entry.id===id);
      if (overlay?.deleted) return response.status(404).json({error:'Reviewer was removed.'});
      const reviewer=await reviewerFor(library,id);
      if (!reviewer || !validReviewer(reviewer)) return response.status(404).json({error:'Reviewer not found.'});
      const revision=reviewerRevision(library,id);
      if(request.query?.v && request.query.v!==revision)return response.status(409).json({error:'This reviewer changed. Refresh the reviewer list and try again.'});
      if(request.query?.media){
        const source=mediaFor(reviewer).get(String(request.query.media));
        if(!source)return response.status(404).json({error:'Exhibit not found.'});
        const [,type,data]=source.match(/^data:([^;]+);base64,([\s\S]+)$/i);
        response.setHeader('Content-Type',type.toLowerCase().replace('image/jpg','image/jpeg'));
        response.setHeader('Cache-Control','private, max-age=31536000, immutable');
        return response.status(200).send(Buffer.from(data.replace(/\s/g,''),'base64'));
      }
      // Existing clients receive portable inline images; new clients pin v and
      // fetch only the exhibits on the question they open. GET never migrates data.
      const data=JSON.stringify(request.query?.v&&!request.query?.raw ? withMediaUrls(reviewer,revision) : reviewer);
      if (data.length <= CHUNK_CHARS) return response.status(200).json({reviewer:JSON.parse(data),reviewerRevision:revision});
      const chunks=Math.ceil(data.length/CHUNK_CHARS);
      if (request.query?.part === undefined) return response.status(200).json({chunks});
      const part=Number(request.query.part);
      if (!Number.isInteger(part) || part<0 || part>=chunks) return response.status(400).json({error:'Invalid reviewer part.'});
      return response.status(200).json({part,data:data.slice(part*CHUNK_CHARS,(part+1)*CHUNK_CHARS)});
    } catch (error) {
      console.error('Shared library read failed.',{message:String(error?.message || error).slice(0,500)});
      return response.status(503).json({error:'Shared reviewer storage is unavailable.'});
    }
  }
  if (request.method !== 'PUT') return response.status(405).json({error:'Use GET or PUT.'});
  if (!sameOrigin(request)) return response.status(403).json({error:'Request origin not allowed.'});
  if (!readSession(request)) return response.status(401).json({error:'Owner sign-in required.'});
  if (Number(request.headers?.['content-length'] || 0)>MAX_BYTES) return response.status(413).json({error:'Reviewer changes exceed the upload limit.'});
  const changes=request.body?.changes;
  if (!Array.isArray(changes) || !changes.length || changes.length>300 || changes.some(change=>
      !change || typeof change.id!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(change.id) ||
      (change.reviewer!==null && (!validReviewer(change.reviewer) || change.reviewer.id!==change.id)))) {
    return response.status(400).json({error:'Invalid reviewer changes.'});
  }
  if (Buffer.byteLength(JSON.stringify(request.body))>MAX_BYTES) return response.status(413).json({error:'Reviewer changes exceed the upload limit.'});
  try {
    const library=await readLibrary();
    // Carry the revision in JSON too: an HTTP intermediary may rewrite ETag.
    const match=request.body?.baseRevision ?? request.headers?.['if-match'] ?? '';
    if (match!==library.etag) return response.status(412).json({error:'The shared library changed in another session. Refresh and try again.'});
    const entries=new Map((library.index?.value.entries || []).map(entry=>[entry.id,entry]));
    const saved=[];
    for (const change of changes) {
      if (change.reviewer===null) { entries.set(change.id,{id:change.id,deleted:true}); continue; }
      const reviewer=await materializeMedia(change.reviewer,library);
      const content=JSON.stringify(reviewer);
      if (Buffer.byteLength(content)>MAX_BYTES) return response.status(413).json({error:`Reviewer ${change.id} exceeds the upload limit.`});
      const blob=await put(`revvy/reviewers/${change.id}.json`,content,{access:'private',addRandomSuffix:true,contentType:JSON_TYPE});
      entries.set(change.id,{id:change.id,pathname:blob.pathname,...summary(reviewer)});
      saved.push({...withMediaUrls(reviewer,digest(blob.pathname)),reviewerRevision:digest(blob.pathname)});
    }
    if (entriesFor({...library,index:{value:{entries:[...entries.values()]}}}).length>300) return response.status(400).json({error:'Library can contain up to 300 reviewers.'});
    const content=JSON.stringify({entries:[...entries.values()],updatedAt:Date.now()});
    const options={access:'private',addRandomSuffix:false,allowOverwrite:Boolean(library.index),contentType:JSON_TYPE,
      ...(library.index?{ifMatch:library.index.etag}:{})};
    const blob=await put(INDEX_PATH,content,options);
    response.setHeader('ETag',blob.etag);
    return response.status(200).json({saved:true,revision:blob.etag,etag:blob.etag,reviewers:saved});
  } catch (error) {
    if (isConflict(error)) return response.status(412).json({error:'The shared library changed in another session. Refresh and try again.'});
    console.error('Shared library Blob write failed.',{name:error?.name,message:String(error?.message || error).slice(0,500)});
    return response.status(503).json({error:'Could not save the shared reviewers. Check the Vercel Function log.'});
  }
}
