import './reviewer-data.js';
import './exhibit-alts.js';
import './core.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
window.RevPdfJs = pdfjsLib;
window.RevPdfWorkerUrl = pdfWorkerUrl;
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
window.RevAuthClient = null;
if (url && key) {
  const {createClient} = await import('@supabase/supabase-js');
  window.RevAuthClient = createClient(url, key);
}
await import('./study-app.js');
