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
    const options = {access:'private',addRandomSuffix:false,allowOverwrite:Boolean(match),contentType:headers['Content-Type'],...(match?{ifMatch:match}:{})};
    // A first write must create the key. Only permit overwrites when the caller
    // supplies the ETag returned by a prior read, so an uninitialized library
    // cannot accidentally enter the Blob overwrite path.
    let blob;
    try {
      blob = await put(PATH,content,options);
    } catch (error) {
      // The ETag can outlive a Blob that was removed from the Vercel dashboard.
      // Recreate only when the failed condition proves the key is gone. With
      // overwrite disabled, a concurrent recreation cannot be clobbered.
      if (!match || !/specified key does not exist/i.test(String(error?.message || ''))) throw error;
      console.warn('Shared library ETag referenced a missing Blob; retrying as a create.', {pathname:PATH});
      const createOptions = {...options,allowOverwrite:false};
      delete createOptions.ifMatch;
      blob = await put(PATH,content,createOptions);
    }
    response.setHeader('ETag',blob.etag);
    return response.status(200).json({saved:true,etag:blob.etag});
  } catch (error) {
    if (error?.name === 'BlobPreconditionFailedError') return response.status(412).json({error:'The shared library changed in another session. Refresh and try again.'});
    const errorName = typeof error?.name === 'string' ? error.name : 'UnknownBlobError';
    console.error('Shared library Blob write failed.', {
      pathname:PATH,
      conditionalWrite:Boolean(request.headers?.['if-match']),
      name:errorName,
      message:typeof error?.message === 'string' ? error.message.slice(0,500) : '',
      statusCode:Number.isInteger(error?.statusCode) ? error.statusCode : undefined,
      code:typeof error?.code === 'string' ? error.code : undefined,
      cause:error?.cause ? {
        name:typeof error.cause.name === 'string' ? error.cause.name : undefined,
        message:typeof error.cause.message === 'string' ? error.cause.message.slice(0,500) : String(error.cause).slice(0,500)
      } : undefined,
      stack:typeof error?.stack === 'string' ? error.stack.slice(0,2500) : undefined
    });
    const guidance = errorName === 'BlobAccessError'
      ? 'Vercel rejected the Blob credentials or project access.'
      : errorName === 'BlobStoreNotFoundError'
        ? 'This deployment cannot find its connected Blob store.'
        : 'Check the Vercel Function logs for the Blob write failure.';
    return response.status(503).json({error:`Could not save the shared library: ${guidance} (${errorName}).`});
  }
}
