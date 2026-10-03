import {get, put} from '@vercel/blob';
import {readSession, sameOrigin} from './_owner-auth.mjs';

const LEGACY_PATH = 'revvy/shared-reviewers.json';
const INDEX_PATH = 'revvy/reviewers-index.json';
const MAX_BYTES = 4_000_000;
const CHUNK_CHARS = 600_000;
const JSON_TYPE = 'application/json; charset=utf-8';

async function readJson(pathname) {
  const blob = await get(pathname,{access:'private',useCache:false});
  if (!blob) return null;
  if (blob.statusCode !== 200 || !blob.stream) throw new Error(`Could not read ${pathname}.`);
  return {value:JSON.parse(await new Response(blob.stream).text()),etag:blob.blob.etag};
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
      if (!id) return response.status(200).json({initialized:Boolean(library.legacy || library.index),entries:entriesFor(library)});
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return response.status(400).json({error:'Invalid reviewer ID.'});
      const overlay=library.index?.value.entries.find(entry=>entry.id===id);
      if (overlay?.deleted) return response.status(404).json({error:'Reviewer was removed.'});
      const reviewer=overlay?.pathname ? (await readJson(overlay.pathname))?.value : library.legacy?.value.reviewers.find(item=>item.id===id);
      if (!reviewer || !validReviewer(reviewer)) return response.status(404).json({error:'Reviewer not found.'});
      const data=JSON.stringify(reviewer);
      if (data.length <= CHUNK_CHARS) return response.status(200).json({reviewer});
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
    const match=request.headers?.['if-match'] || '';
    if (match!==library.etag) return response.status(412).json({error:'The shared library changed in another session. Refresh and try again.'});
    const entries=new Map((library.index?.value.entries || []).map(entry=>[entry.id,entry]));
    for (const change of changes) {
      if (change.reviewer===null) { entries.set(change.id,{id:change.id,deleted:true}); continue; }
      const content=JSON.stringify(change.reviewer);
      if (Buffer.byteLength(content)>MAX_BYTES) return response.status(413).json({error:`Reviewer ${change.id} exceeds the upload limit.`});
      const blob=await put(`revvy/reviewers/${change.id}.json`,content,{access:'private',addRandomSuffix:true,contentType:JSON_TYPE});
      entries.set(change.id,{id:change.id,pathname:blob.pathname});
    }
    if (entriesFor({...library,index:{value:{entries:[...entries.values()]}}}).length>300) return response.status(400).json({error:'Library can contain up to 300 reviewers.'});
    const content=JSON.stringify({entries:[...entries.values()],updatedAt:Date.now()});
    const options={access:'private',addRandomSuffix:false,allowOverwrite:Boolean(library.index),contentType:JSON_TYPE,
      ...(library.index?{ifMatch:library.index.etag}:{})};
    const blob=await put(INDEX_PATH,content,options);
    response.setHeader('ETag',blob.etag);
    return response.status(200).json({saved:true,etag:blob.etag});
  } catch (error) {
    if (isConflict(error)) return response.status(412).json({error:'The shared library changed in another session. Refresh and try again.'});
    console.error('Shared library Blob write failed.',{name:error?.name,message:String(error?.message || error).slice(0,500)});
    return response.status(503).json({error:'Could not save the shared reviewers. Check the Vercel Function log.'});
  }
}
