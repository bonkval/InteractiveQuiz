import {get, put} from '@vercel/blob';
import {readSession, sameOrigin} from './_owner-auth.mjs';

const PATH = 'revvy/shared-notepad.json';
const MAX_NOTES_LENGTH = 50_000;

export default async function handler(request, response) {
  response.setHeader('Cache-Control','no-store, max-age=0');
  response.setHeader('X-Content-Type-Options','nosniff');
  if (request.method === 'GET') {
    try {
      const blob = await get(PATH,{access:'private',useCache:false});
      if (!blob) return response.status(200).json({initialized:false,notes:''});
      if (blob.statusCode !== 200 || !blob.stream) throw new Error('Could not read shared notes.');
      const saved = JSON.parse(await new Response(blob.stream).text());
      if (typeof saved.notes !== 'string' || saved.notes.length > MAX_NOTES_LENGTH) throw new Error('Shared notes are invalid.');
      response.setHeader('ETag',blob.blob.etag);
      return response.status(200).json({initialized:true,notes:saved.notes,updatedAt:saved.updatedAt||null});
    } catch {
      return response.status(503).json({error:'Shared notes storage is unavailable.'});
    }
  }
  if (request.method !== 'PUT') return response.status(405).json({error:'Use GET or PUT.'});
  if (!sameOrigin(request)) return response.status(403).json({error:'Request origin not allowed.'});
  if (!readSession(request)) return response.status(401).json({error:'Owner sign-in required.'});
  const notes = request.body?.notes;
  if (typeof notes !== 'string') return response.status(400).json({error:'Notes must be plain text.'});
  if (notes.length > MAX_NOTES_LENGTH) return response.status(413).json({error:'Shared notes are limited to 50,000 characters.'});
  const content = JSON.stringify({notes,updatedAt:Date.now()});
  const match = request.headers?.['if-match'];
  const options = {access:'private',addRandomSuffix:false,allowOverwrite:Boolean(match),contentType:'application/json; charset=utf-8',...(match?{ifMatch:match}:{})};
  try {
    let blob;
    try {
      blob = await put(PATH,content,options);
    } catch (error) {
      if (!match || !/specified key does not exist/i.test(String(error?.message || ''))) throw error;
      const createOptions = {...options,allowOverwrite:false};
      delete createOptions.ifMatch;
      blob = await put(PATH,content,createOptions);
    }
    response.setHeader('ETag',blob.etag);
    return response.status(200).json({saved:true,etag:blob.etag});
  } catch (error) {
    if (error?.name === 'BlobPreconditionFailedError' || /Precondition failed: ETag mismatch/i.test(String(error?.message || ''))) return response.status(412).json({error:'Shared notes changed in another session. Reload before saving.'});
    console.error('Shared notepad Blob write failed.',{pathname:PATH,name:error?.name||'UnknownBlobError',message:typeof error?.message==='string'?error.message.slice(0,500):''});
    return response.status(503).json({error:'Could not save shared notes. Check Vercel Blob storage and Function logs.'});
  }
}
