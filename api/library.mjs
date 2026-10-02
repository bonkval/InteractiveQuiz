import {get, put} from '@vercel/blob';
import {readSession, sameOrigin} from './_owner-auth.mjs';

const PATH = 'revvy/shared-reviewers.json';
const MAX_BYTES = 4_000_000;

function validate(value) {
  if (!value || !Array.isArray(value.reviewers) || value.reviewers.length > 300) return 'Library must contain up to 300 reviewers.';
  for (const reviewer of value.reviewers) {
    if (!reviewer || typeof reviewer.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(reviewer.id) ||
        typeof reviewer.title !== 'string' || !reviewer.title.trim() || reviewer.title.length > 70 ||
        !Array.isArray(reviewer.questions) || !reviewer.questions.length || reviewer.questions.length > 20_000) return 'A reviewer has invalid details.';
    for (const question of reviewer.questions) {
      if (!question || typeof question.text !== 'string' || !question.text.trim() || question.text.length > 20_000 ||
          !Array.isArray(question.options) || question.options.length > 100) return 'A question has invalid details.';
    }
  }
  return null;
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control','no-store, max-age=0');
  response.setHeader('X-Content-Type-Options','nosniff');
  if (request.method === 'GET') {
    try {
      const blob = await get(PATH,{access:'private'});
      if (!blob) return response.status(200).json({initialized:false,reviewers:[]});
      if (blob.statusCode !== 200 || !blob.stream) throw new Error('Could not read shared library.');
      const library = JSON.parse(await new Response(blob.stream).text());
      if (!Array.isArray(library.reviewers)) throw new Error('Shared library is invalid.');
      response.setHeader('ETag',blob.blob.etag);
      return response.status(200).json({initialized:true,reviewers:library.reviewers});
    } catch {
      return response.status(503).json({error:'Shared library storage is unavailable. Connect a private Vercel Blob store to this project.'});
    }
  }
  if (request.method !== 'PUT') return response.status(405).json({error:'Use GET or PUT.'});
  if (!sameOrigin(request)) return response.status(403).json({error:'Request origin not allowed.'});
  if (!readSession(request)) return response.status(401).json({error:'Owner sign-in required.'});
  const length = Number(request.headers?.['content-length'] || 0);
  if (length > MAX_BYTES) return response.status(413).json({error:'Reviewer library is too large to save in one request.'});
  const value = request.body;
  const invalid = validate(value);
  if (invalid) return response.status(400).json({error:invalid});
  const content = JSON.stringify({reviewers:value.reviewers,updatedAt:Date.now()});
  if (Buffer.byteLength(content) > MAX_BYTES) return response.status(413).json({error:'Reviewer library is too large to save in one request.'});
  try {
    const headers = {'Content-Type':'application/json; charset=utf-8'};
    const match = request.headers?.['if-match'];
    const blob = await put(PATH,content,{access:'private',addRandomSuffix:false,allowOverwrite:true,contentType:headers['Content-Type'],...(match?{ifMatch:match}:{})});
    response.setHeader('ETag',blob.etag);
    return response.status(200).json({saved:true,etag:blob.etag});
  } catch (error) {
    if (error?.name === 'BlobPreconditionFailedError') return response.status(412).json({error:'The shared library changed in another session. Refresh and try again.'});
    return response.status(503).json({error:'Could not save the shared library. Check Vercel Blob storage configuration.'});
  }
}
