import './core.js';
import './reviewer-client.js';
import './course-app.js';
import normalStyles from './styles.css?url';

let starterLoad, pdfLoad, styleLoad;
window.RevLoadStarter = () => starterLoad ||= Promise.all([
  import('./reviewer-data.js'), import('./exhibit-alts.js')
]);
window.RevLoadPdf = () => pdfLoad ||= Promise.all([
  import('pdfjs-dist/legacy/build/pdf.mjs'),
  import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
]).then(([lib, worker]) => ({lib, worker:worker.default})).catch(error => { pdfLoad=null; throw error; });
window.RevLoadNormalStyles = () => styleLoad ||= new Promise((resolve,reject) => {
  const link=document.createElement('link');
  link.rel='stylesheet'; link.href=normalStyles; link.id='normal-styles';
  link.onload=resolve;
  link.onerror=()=>{link.remove();styleLoad=null;reject(new Error('The normal layout could not load. Try again.'));};
  document.head.append(link);
});
if (!document.documentElement.classList.contains('plain-mode')) await window.RevLoadNormalStyles();
await import('./study-app.js');
