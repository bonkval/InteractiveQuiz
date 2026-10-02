import './reviewer-data.js';
import './exhibit-alts.js';
import './core.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
window.RevPdfJs = pdfjsLib;
window.RevPdfWorkerUrl = pdfWorkerUrl;
await import('./study-app.js');
