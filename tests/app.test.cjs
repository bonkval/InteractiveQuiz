const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');

function openApp({conflictOnSecondPut=false,reviewerStorageFull=false,chunkedLibrary=false,ownerAtStart=false,delayLibraryLoad=false,delayImportSave=false}={}) {
  const html = fs.readFileSync('index.html', 'utf8');
  const dom = new JSDOM(html, {url:'http://localhost/', runScripts:'outside-only', pretendToBeVisual:true});
  const {window} = dom;
  if(reviewerStorageFull){
    const setItem=window.Storage.prototype.setItem;
    window.Storage.prototype.setItem=function(key,value){
      if(String(key).startsWith('recall-reviewers-v1'))throw new window.DOMException('Storage quota exceeded','QuotaExceededError');
      return setItem.call(this,key,value);
    };
  }
  window.matchMedia = query => ({matches:query.includes('prefers-reduced-motion'), addEventListener(){}});
  window.HTMLElement.prototype.scrollIntoView = function() {};
  window.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  window.HTMLDialogElement.prototype.close = function() { this.open = false; };
  window.confirm = () => true;
  let owner = ownerAtStart;
  let sharedReviewers = null, sharedEtag = 'etag-1';
  let libraryPutCount = 0;
  const jsonResponse = (payload, status=200, etag='') => ({ok:status>=200&&status<300,status,headers:{get:name=>name.toLowerCase()==='etag'?etag:''},json:async()=>payload});
  window.fetch = async (path, options={}) => {
    if(path==='/api/auth'&&(!options.method||options.method==='GET'))return jsonResponse({owner,configured:true});
    if(path==='/api/auth'&&options.method==='POST'){
      const body=JSON.parse(options.body||'{}');
      if(body.action==='logout'){owner=false;return jsonResponse({owner:false});}
      if(body.username==='cval'&&body.password==='test-password'){owner=true;return jsonResponse({owner:true,username:'cval'});}
      return jsonResponse({error:'Username or password is incorrect.'},401);
    }
    if(path.startsWith('/api/library?id=')&&(!options.method||options.method==='GET')){
      const params=new URL(path,'http://localhost').searchParams;
      const reviewer=(sharedReviewers||[]).find(item=>item.id===params.get('id'));
      if(!reviewer)return jsonResponse({error:'Reviewer not found.'},404);
      const data=JSON.stringify(reviewer),size=200_000;
      if(data.length<=size)return jsonResponse({reviewer},200,sharedEtag);
      if(!params.has('part'))return jsonResponse({chunks:Math.ceil(data.length/size)},200,sharedEtag);
      const part=Number(params.get('part'));
      return jsonResponse({part,data:data.slice(part*size,(part+1)*size)},200,sharedEtag);
    }
    if(path==='/api/library'&&(!options.method||options.method==='GET')){
      if(delayLibraryLoad)await new Promise(resolve=>setTimeout(resolve,100));
      return jsonResponse(chunkedLibrary?{initialized:Array.isArray(sharedReviewers),entries:(sharedReviewers||[]).map(item=>({id:item.id}))}:{initialized:Array.isArray(sharedReviewers),reviewers:sharedReviewers||[]},200,Array.isArray(sharedReviewers)?sharedEtag:'');
    }
    if(path==='/api/library'&&options.method==='PUT'){
      libraryPutCount++;
      const changes=JSON.parse(options.body||'{}').changes||[];
      if(delayImportSave&&changes.some(change=>change.reviewer?.title==='Loading test'))await new Promise(resolve=>setTimeout(resolve,80));
      if(conflictOnSecondPut&&libraryPutCount===2){
        sharedReviewers=[...(sharedReviewers||[]),{id:'remote-reviewer',title:'Concurrent reviewer',questions:[{text:'Remote question',options:[],answer:'Remote answer'}]}];
        sharedEtag='etag-concurrent';
        return jsonResponse({error:'The shared library changed in another session. Refresh and try again.'},412);
      }
      sharedReviewers=[...(sharedReviewers||[])];
      for(const change of changes){
        sharedReviewers=sharedReviewers.filter(item=>item.id!==change.id);
        if(change.reviewer)sharedReviewers.push(change.reviewer);
      }
      sharedEtag=`etag-${Date.now()}`;
      return jsonResponse({saved:true,etag:sharedEtag},200,sharedEtag);
    }
    return jsonResponse({error:'Not found'},404);
  };
  window.eval(fs.readFileSync('reviewer-data.js', 'utf8'));
  window.eval(fs.readFileSync('core.js', 'utf8'));
  window.eval(fs.readFileSync('study-app.js', 'utf8'));
  return dom;
}

async function signInOwner(dom) {
  const {document}=dom.window;
  await new Promise(resolve=>setTimeout(resolve,0));
  document.querySelector('#account-button').click();
  document.querySelector('#account-username').value='cval';
  document.querySelector('#account-password').value='test-password';
  document.querySelector('#account-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  for(let i=0;i<20&&(!document.body.classList.contains('owner-session')||document.querySelector('#account-dialog').open);i++)await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(document.body.classList.contains('owner-session'),'owner login enables owner controls');
}

test('guest can review, flag a question, and start a flagged set', () => {
  const dom = openApp(), {document, localStorage} = dom.window;
  document.querySelector('[data-reviewer]').click();
  document.querySelector('#start-quiz').click();
  assert.match(document.querySelector('.question-text').textContent, /spanning-tree/i);
  document.querySelector('#flag-question').click();
  assert.equal(document.querySelector('#flag-question').getAttribute('aria-pressed'), 'true');
  document.querySelector('[data-option="1"]').click();
  document.querySelector('#next-question').click();
  assert.equal(document.querySelector('.answer-result-overlay.correct')?.textContent,'Correct');
  assert.equal(document.querySelector('.answer-result-badge svg')?.getAttribute('viewBox'),'0 0 16 16');
  const history = JSON.parse(localStorage.getItem('rev-question-history-v1'));
  assert.equal(Object.values(history['reviewer-s2-it0015'])[0], 'correct');
  document.querySelector('#exit-quiz').click();
  const filter = document.querySelector('#study-filter');
  filter.value = 'flagged';
  document.querySelector('#start-quiz').click();
  assert.equal(document.querySelectorAll('.question-index-card').length, 1);
  dom.window.close();
});

test('import previews and saves online when browser reviewer storage is full', async () => {
  const dom = openApp({reviewerStorageFull:true}), {document, localStorage} = dom.window;
  await signInOwner(dom);
  document.querySelector('#new-reviewer').click();
  document.querySelector('#paste-text').value = 'Question 1\nWhich choice is right?\nChoice A: one\nCorrect! Choice B: two\nChoice C: three\nChoice D: four';
  document.querySelector('#import-submit').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(document.querySelector('#import-preview').hidden, false);
  assert.match(document.querySelector('#import-preview').textContent, /4 choices/);
  document.querySelector('.preview-question summary').click();
  const questionEditor = document.querySelector('[data-edit="text"]');
  assert.ok(questionEditor, 'import preview has a direct question editor');
  document.querySelector('#import-submit').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(document.querySelector('#import-dialog').open,false);
  assert.equal(localStorage.getItem('recall-reviewers-v1:user:owner'),null);
  assert.match(document.querySelector('#main-panel').textContent,/New reviewer/);
  dom.window.location.hash = '#data';
  dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));
  assert.match(document.querySelector('#main-panel').textContent, /Browser compatibility/);
  assert.match(document.querySelector('#main-panel').textContent, /Local storage/);
  document.querySelector('#delete-local-data').click();
  assert.equal(localStorage.getItem('recall-reviewers-v1'),null);
  dom.window.close();
});

test('import shows progress while saving and confirms completion', async () => {
  const dom=openApp({delayImportSave:true}),{document}=dom.window;
  await signInOwner(dom);
  await new Promise(resolve=>setTimeout(resolve,100));
  document.querySelector('#new-reviewer').click();
  document.querySelector('#reviewer-name').value='Loading test';
  document.querySelector('#paste-text').value='Question 1\nWhich choice is right?\nChoice A: one\nCorrect! Choice B: two';
  document.querySelector('#import-submit').click();
  assert.match(document.querySelector('#import-feedback').textContent,/Found 1 question/);
  document.querySelector('#import-submit').click();
  assert.match(document.querySelector('#import-feedback').textContent,/Saving reviewer/);
  assert.ok(document.querySelector('#import-feedback').classList.contains('loading'));
  assert.equal(document.querySelector('#import-submit').disabled,true);
  assert.equal(document.querySelector('#cancel-import').disabled,true);
  await new Promise(resolve=>setTimeout(resolve,120));
  assert.equal(document.querySelector('#import-dialog').open,false);
  assert.match(document.querySelector('#main-panel').textContent,/Loading test/);
  assert.match([...document.querySelectorAll('.toast')].at(-1)?.textContent||'',/Import complete: 1 question/);
  dom.window.close();
});

test('reviewer rename retries an ETag conflict and keeps reviewers added concurrently', async () => {
  const dom=openApp({conflictOnSecondPut:true}),{document,localStorage}=dom.window;
  await signInOwner(dom);
  document.querySelector('[data-reviewer]').click();
  document.querySelector('#edit-reviewer').click();
  document.querySelector('#reviewer-name').value='CCST';
  document.querySelector('#import-submit').click();
  for(let i=0;i<50&&document.querySelector('#import-preview').hidden;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(document.querySelector('#import-preview').hidden,false);
  document.querySelector('#import-submit').click();
  for(let i=0;i<50&&document.querySelector('#import-dialog').open;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(document.querySelector('#import-dialog').open,false,'rename completes after refreshing the stale ETag');
  assert.equal(localStorage.getItem('recall-reviewers-v1:user:owner'),null);
  assert.match(document.querySelector('#main-panel').textContent,/CCST/);
  assert.ok(document.querySelectorAll('[data-reviewer]').length>=2,'the concurrently added reviewer is retained');
  dom.window.close();
});

test('deleted shared reviewers stay removed after a refresh', async () => {
  const dom=openApp(),{document}=dom.window;
  await signInOwner(dom);
  assert.equal(document.querySelectorAll('[data-reviewer]').length,1);
  document.querySelector('[data-delete]').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(document.querySelectorAll('[data-reviewer]').length,0);
  document.querySelector('#account-signout').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(document.querySelectorAll('[data-reviewer]').length,0);
  dom.window.close();
});

test('reviewer deletion waits for the shared library to finish loading', async () => {
  const dom=openApp({ownerAtStart:true,delayLibraryLoad:true}),{document}=dom.window;
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(document.body.classList.contains('owner-session'));
  document.querySelector('[data-delete]').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(document.querySelectorAll('[data-reviewer]').length,1);
  assert.match(document.querySelector('.toast')?.textContent||'',/finish loading/);
  await new Promise(resolve=>setTimeout(resolve,150));
  document.querySelector('[data-delete]').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(document.querySelectorAll('[data-reviewer]').length,0);
  dom.window.close();
});

test('quick filters separate incorrect and I-dont-know cards', () => {
  const dom = openApp(), {document} = dom.window;
  document.querySelector('[data-reviewer]').click();
  document.querySelector('#start-quiz').click();
  document.querySelector('[data-option="0"]').click();
  document.querySelector('#next-question').click();
  document.querySelector('#dont-know').click();
  document.querySelector('#exit-quiz').click();
  document.querySelector('#study-filter').value = 'incorrect';
  document.querySelector('#start-quiz').click();
  assert.equal(document.querySelectorAll('.question-index-card').length, 1);
  assert.match(document.querySelector('.question-text').textContent, /spanning-tree/i);
  document.querySelector('#exit-quiz').click();
  document.querySelector('#study-filter').value = 'unknown';
  document.querySelector('#start-quiz').click();
  assert.equal(document.querySelectorAll('.question-index-card').length, 1);
  assert.match(document.querySelector('.question-text').textContent, /EtherChannel/i);
  dom.window.close();
});

test('Import prompt requests an image-capable PDF for direct import', () => {
  const studyApp = fs.readFileSync('study-app.js','utf8');
  const html = fs.readFileSync('index.html','utf8');
  assert.match(studyApp,/_Revvy_Import\.pdf/);
  assert.match(studyApp,/exactly one complete question on each PDF page/);
  assert.match(studyApp,/embedded PNG or JPEG image/);
  assert.match(html,/_Revvy_Import\.pdf/);
});

test('default import prompt adapts the supported shapes to the source reviewer', () => {
  const dom=openApp(),{window}=dom,{document,localStorage}=window;
  localStorage.setItem('rev-import-prompt-v2','obsolete prompt');
  window.location.hash='#import-prompt';
  window.dispatchEvent(new window.Event('hashchange'));
  const prompt=document.querySelector('#master-prompt').value;
  assert.match(prompt,/Create one actual PDF file/);
  assert.match(prompt,/only the question types present/);
  assert.match(prompt,/one complete question on each PDF page/);
  assert.match(prompt,/Question 1/);
  assert.match(prompt,/Correct! Choice B/);
  assert.match(prompt,/Answer: <exact answer>/);
  assert.match(prompt,/Word bank: SFTP, TFTP/);
  assert.match(prompt,/embedded PNG or JPEG image/);
  assert.match(prompt,/Put the question wording immediately after that heading/);
  assert.doesNotMatch(prompt,/add "Original question: <number>"/);
  assert.doesNotMatch(prompt,/UTF-8 JSON file/);
  assert.doesNotMatch(prompt,/obsolete prompt/);
  dom.window.close();
});

test('saved import prompt drops provenance labels before copying', () => {
  const dom=openApp(),{window}=dom,{document,localStorage}=window;
  localStorage.setItem('rev-import-prompt-v5', 'If the source uses different question numbers, add "Original question: <number>" below the heading. Add "Source page: <number>" when the source identifies one.');
  window.location.hash='#import-prompt';
  window.dispatchEvent(new window.Event('hashchange'));
  const prompt=document.querySelector('#master-prompt').value;
  assert.match(prompt,/Put the question wording immediately after that heading/);
  assert.doesNotMatch(prompt,/add "Original question: <number>"/);
  dom.window.close();
});

test('pixel lava backdrop exists behind the app without pointer tracking', () => {
  const dom = openApp(), {document} = dom.window;
  const field = document.querySelector('#lava-field');
  assert.ok(field);
  assert.equal(field.querySelectorAll('.lava-blob').length, 5);
  assert.ok(field.querySelector('.lava-pixels'));
  dom.window.close();
});

test('motion stays visible on desktop and can be reduced or follow the device', () => {
  const dom=openApp(),{document,localStorage}=dom.window;
  const toggle=document.querySelector('#motion-toggle');
  assert.equal(document.documentElement.classList.contains('motion-reduced'),false);
  assert.equal(document.querySelector('#motion-state').textContent,'On');
  toggle.click();
  assert.equal(localStorage.getItem('rev-motion'),'off');
  assert.ok(document.documentElement.classList.contains('motion-reduced'));
  toggle.click();
  assert.equal(localStorage.getItem('rev-motion'),'auto');
  assert.ok(document.documentElement.classList.contains('motion-reduced'));
  toggle.click();
  assert.equal(localStorage.getItem('rev-motion'),'on');
  assert.equal(document.documentElement.classList.contains('motion-reduced'),false);
  dom.window.close();
});

test('public visitors do not see reviewer editing or registration', () => {
  const dom = openApp(), {document} = dom.window;
  assert.equal(document.querySelector('#new-reviewer').hidden,true);
  assert.equal(document.querySelector('#import-trigger').hidden,true);
  document.querySelector('#account-button').click();
  assert.ok(document.querySelector('#account-username'));
  assert.equal(document.querySelector('#account-switch'),null);
  assert.equal(document.querySelector('#account-guest'),null);
  dom.window.close();
});

test('chunked shared reviewers become visible to signed-out visitors after refresh', async () => {
  const dom=openApp({chunkedLibrary:true}),{document}=dom.window;
  await signInOwner(dom);
  document.querySelector('#new-reviewer').click();
  document.querySelector('#reviewer-name').value='Shared set';
  document.querySelector('#paste-text').value='Question 1\nWhich answer is shared?\nCorrect! Choice A: Yes\nChoice B: No';
  document.querySelector('#import-submit').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  document.querySelector('#import-submit').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  document.querySelector('#account-signout').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(document.body.classList.contains('owner-session'),false);
  assert.ok([...document.querySelectorAll('[data-reviewer]')].some(button=>button.textContent.includes('Shared set')));
  assert.equal(document.querySelector('#new-reviewer').hidden,true);
  dom.window.close();
});

test('copy fallback includes every exhibit reference', async () => {
  const dom = openApp(), {document, navigator} = dom.window;
  await signInOwner(dom);
  let copied = '';
  navigator.clipboard = {writeText: async text => { copied = text; }};
  document.querySelector('#new-reviewer').click();
  document.querySelector('#paste-text').value = JSON.stringify({questions:[{sourceNumber:'1',text:'Refer to both exhibits. Which answer is right?',options:['One','Two'],correctAnswers:[1],images:['data:image/png;base64,aGVsbG8=','data:image/png;base64,d29ybGQ='],imageAlts:['First diagram','Second diagram']}]});
  document.querySelector('#import-submit').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  document.querySelector('#import-submit').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  document.querySelector('#start-quiz').click();
  document.querySelector('#copy-question').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(copied, /Exhibit 1: attached image/);
  assert.match(copied, /Exhibit 2: attached image/);
  dom.window.close();
});

test('explanation toggle stays visible while answering and across cards', () => {
  const dom = openApp(), {document} = dom.window;
  document.querySelector('[data-reviewer]').click();
  document.querySelector('#start-quiz').click();
  const card = document.querySelector('.question-card');
  document.querySelector('#toggle-explanations').click();
  assert.ok(document.querySelector('.explanation-panel'));
  assert.equal(document.querySelector('.question-card'), card, 'toggling does not rebuild the question');
  document.querySelector('[data-option="1"]').click();
  assert.ok(document.querySelector('.explanation-panel'));
  document.querySelector('#next-question').click();
  assert.ok(document.querySelector('.explanation-panel'));
  assert.equal(document.querySelector('#toggle-explanations').getAttribute('aria-checked'), 'true');
  document.querySelector('#toggle-explanations').click();
  assert.equal(document.querySelector('.explanation-panel'), null);
  assert.equal(document.querySelector('#toggle-explanations').getAttribute('aria-checked'), 'false');
  dom.window.close();
});

test('audio can pause, resume, stop, and start again after changing cards', () => {
  const dom = openApp(), {document} = dom.window;
  const synth = {speaking:false, paused:false, utterances:[], cancel() { this.speaking=false; this.paused=false; }, speak(utterance) { this.utterances.push(utterance); this.speaking=true; }, pause() { this.paused=true; }, resume() { this.paused=false; }};
  dom.window.speechSynthesis = synth;
  dom.window.SpeechSynthesisUtterance = class { constructor(text) { this.text=text; } };
  document.querySelector('[data-reviewer]').click();
  document.querySelector('#start-quiz').click();
  document.querySelector('#read-question').click();
  assert.equal(document.querySelector('#read-question').textContent, 'Pause audio');
  document.querySelector('#read-question').click();
  assert.equal(synth.paused, true);
  assert.equal(document.querySelector('#read-question').textContent, 'Resume audio');
  document.querySelector('#toggle-explanations').click();
  assert.equal(document.querySelector('#read-question').textContent, 'Resume audio');
  document.querySelector('#read-question').click();
  assert.equal(synth.paused, false);
  assert.equal(document.querySelector('#read-question').textContent, 'Pause audio');
  document.querySelector('#stop-reading').click();
  assert.equal(document.querySelector('#read-question').textContent, 'Use audio');
  document.querySelector('#read-question').click();
  assert.equal(synth.utterances.length, 2);
  document.querySelector('#next-question').click();
  assert.equal(synth.speaking, false);
  assert.equal(document.querySelector('#read-question').textContent, 'Use audio');
  dom.window.close();
});

test('a corrected PDF answer is entered as text and can be graded', async () => {
  const dom = openApp(), {document} = dom.window;
  await signInOwner(dom);
  document.querySelector('#new-reviewer').click();
  document.querySelector('#paste-text').value = 'Question 1\nCompute the CIDR.\nChoice A: 1/20\nChoice B: 1/21\nANSWER + EXPLANATION\nNo listed answer is fully correct. The result is 1/22.';
  document.querySelector('#import-submit').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  document.querySelector('#import-submit').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  document.querySelector('#start-quiz').click();
  assert.ok(document.querySelector('.unmatched-choices'));
  const answer = document.querySelector('#short-answer');
  answer.value = '1/22';
  answer.dispatchEvent(new dom.window.Event('input', {bubbles:true}));
  document.querySelector('#next-question').click();
  assert.match(document.querySelector('.result-score').textContent, /1\s*\/\s*1/);
  dom.window.close();
});

test('Show answer fills written, matching, grouped, and choice controls', async () => {
  const dom=openApp(),{document}=dom.window;
  await signInOwner(dom);
  document.querySelector('#new-reviewer').click();
  document.querySelector('#paste-text').value=JSON.stringify({questions:[
    {sourceNumber:'1',text:'Compute the CIDR.',options:['Wrong /20','Wrong /21'],correctAnswers:[],answer:'172.16.199.25/22'},
    {sourceNumber:'2',text:'Match the protocols.',answerTiles:['SFTP','TFTP'],matches:[{prompt:'Uses SSH',answer:'SFTP'},{prompt:'Uses port 22',answer:'SFTP'}]},
    {sourceNumber:'3',text:'Enter both commands.',parts:[{prompt:'First',answer:'ping'},{prompt:'Second',answer:'tracert'}]},
    {sourceNumber:'4',text:'Judge each statement.',statements:['One','Two'],statementAnswers:['True','False']},
    {sourceNumber:'5',text:'Choose two.',options:['A','B','C','D'],correctAnswers:[1,3]},
    {sourceNumber:'6',text:'Single choice.',options:['A','B'],correctAnswers:[0]},
    {sourceNumber:'7',text:'Unkeyed question.',options:['A','B'],correctAnswers:[]}
  ]});
  document.querySelector('#import-submit').click();await new Promise(resolve=>setTimeout(resolve,0));
  document.querySelector('#import-submit').click();await new Promise(resolve=>setTimeout(resolve,0));
  document.querySelector('#start-quiz').click();
  const openCard=index=>document.querySelector(`[data-jump="${index}"]`).click();
  document.querySelector('#show-answer').click();
  assert.equal(document.querySelector('#short-answer').value,'172.16.199.25/22');
  openCard(1);document.querySelector('#show-answer').click();
  assert.deepEqual([...document.querySelectorAll('[data-match-target]')].map(target=>target.textContent),['SFTP','SFTP']);
  openCard(2);document.querySelector('#show-answer').click();
  assert.deepEqual([...document.querySelectorAll('[data-part]')].map(field=>field.value),['ping','tracert']);
  openCard(3);document.querySelector('#show-answer').click();
  assert.deepEqual(['True','False'].map((value,index)=>document.querySelector(`[data-statement="${index}"][data-value="${value}"]`).getAttribute('aria-pressed')),['true','true']);
  openCard(4);document.querySelector('#show-answer').click();
  assert.deepEqual([...document.querySelectorAll('[data-option][aria-pressed="true"]')].map(button=>Number(button.dataset.option)),[1,3]);
  openCard(5);document.querySelector('#show-answer').click();
  assert.equal(document.querySelector('[data-option="0"]').getAttribute('aria-pressed'),'true');
  openCard(6);document.querySelector('#show-answer').click();
  assert.match(document.querySelector('.feedback-area').textContent,/No answer key/);
  assert.equal(document.querySelectorAll('[data-option][aria-pressed="true"]').length,0);
  dom.window.close();
});

test('a filled answer is saved for review without earning a correct point', async () => {
  const dom=openApp(),{document}=dom.window;
  await signInOwner(dom);
  document.querySelector('#new-reviewer').click();
  document.querySelector('#paste-text').value=JSON.stringify({questions:[{text:'Name the command.',answer:'tracert'}]});
  document.querySelector('#import-submit').click();await new Promise(resolve=>setTimeout(resolve,0));
  document.querySelector('#import-submit').click();await new Promise(resolve=>setTimeout(resolve,0));
  document.querySelector('#start-quiz').click();
  document.querySelector('#show-answer').click();
  assert.equal(document.querySelector('#short-answer').value,'tracert');
  document.querySelector('#next-question').click();
  assert.ok(document.querySelector('#finish-now'));
  document.querySelector('#finish-now').click();
  assert.match(document.querySelector('.result-score').textContent,/0\s*\/\s*1/);
  dom.window.close();
});

test('tutorial entry and study shortcut bar are removed', () => {
  const dom=openApp(),{document}=dom.window;
  assert.equal(document.querySelector('#help-link'),null);
  document.querySelector('[data-reviewer]').click();
  document.querySelector('#start-quiz').click();
  assert.equal(document.querySelector('.shortcut-hint'),null);
  dom.window.close();
});

test('grouped true-false statements show three cards on one page and score three points', async () => {
  const dom=openApp(),{document}=dom.window;
  await signInOwner(dom);
  document.querySelector('#new-reviewer').click();
  document.querySelector('#paste-text').value='Question 1: For each statement, select True or False.\nF High latency decreases bandwidth.\nT Low bandwidth can increase latency.\nT Less congestion can increase throughput.';
  document.querySelector('#import-submit').click(); await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(document.querySelectorAll('.preview-question').length,1);
  document.querySelector('#import-submit').click(); await new Promise(resolve=>setTimeout(resolve,0));
  document.querySelector('#start-quiz').click();
  assert.equal(document.querySelectorAll('.statement-item').length,3);
  assert.equal(document.querySelectorAll('.question-index-card').length,1, 'one page contains all three statements');
  assert.doesNotMatch(document.querySelector('#question-prompt').textContent,/High latency decreases bandwidth/);
  assert.match(document.querySelectorAll('.statement-item h3')[0].textContent,/High latency decreases bandwidth/);
  assert.equal(document.querySelectorAll('.statement-choices .answer-option').length,6);
  [['False','True'],['True','True'],['True','True']].forEach((pair,index)=>document.querySelector(`[data-statement="${index}"][data-value="${pair[0]}"]`).click());
  assert.equal(document.querySelectorAll('.statement-item.is-answered').length,3);
  document.querySelector('#next-question').click();
  assert.match(document.querySelector('.result-score').textContent,/3\s*\/\s*3/);
  dom.window.close();
});

test('grouped statement text is not repeated in the scenario', async () => {
  const dom=openApp(),{document}=dom.window;
  await signInOwner(dom);
  const statements=['The interfaces can communicate over Layer 2.','The interfaces are administratively shut down.','The interfaces have default IP addresses.'];
  document.querySelector('#new-reviewer').click();
  document.querySelector('#paste-text').value=JSON.stringify({questions:[{sourceNumber:'87',type:'grouped-boolean',text:`You purchase a new switch. 1. ${statements.join(' 2. ')}`,statements,statementAnswers:['True','False','False'],explanation:'Check each statement.'}]});
  document.querySelector('#import-submit').click();await new Promise(resolve=>setTimeout(resolve,0));
  document.querySelector('#import-submit').click();await new Promise(resolve=>setTimeout(resolve,0));
  document.querySelector('#start-quiz').click();
  assert.equal(document.querySelector('#question-prompt').textContent,'You purchase a new switch.');
  assert.deepEqual([...document.querySelectorAll('.statement-item h3')].map(item=>item.textContent),statements);
  document.querySelector('#toggle-explanations').click();
  assert.ok(document.querySelector('.statement-list').compareDocumentPosition(document.querySelector('.explanation-panel')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  dom.window.close();
});

test('matching answer tiles can be selected and dropped onto one-card targets',async()=>{
  const dom=openApp(),{document}=dom.window;
  await signInOwner(dom);
  document.querySelector('#new-reviewer').click();
  document.querySelector('#paste-text').value='Question 1: Move each term to its correct example.\nWord: IaaS\nWord: SaaS\nWord: PaaS\nExample 1: Cloud virtual machines | IaaS\nExample 2: Web app subscription | SaaS\nExample 3: Build software using a cloud platform | PaaS';
  document.querySelector('#import-submit').click();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(document.querySelectorAll('.preview-question').length,1);
  document.querySelector('#import-submit').click();await new Promise(resolve=>setTimeout(resolve,0));
  document.querySelector('#start-quiz').click();assert.equal(document.querySelectorAll('.matching-row').length,3);
  const placements=[['IaaS',0],['SaaS',1],['PaaS',2]];
  for(const [tile,index] of placements){document.querySelector(`[data-match-tile="${tile}"]`).click();document.querySelector(`[data-match-target="${index}"]`).click();}
  document.querySelector('#next-question').click();assert.match(document.querySelector('.result-score').textContent,/3\s*\/\s*3/);
  dom.window.close();
});

test('matching answers can be reused and written parts score separately',async()=>{
  const dom=openApp(),{document}=dom.window;
  await signInOwner(dom);
  document.querySelector('#new-reviewer').click();
  document.querySelector('#paste-text').value=JSON.stringify({questions:[
    {text:'Match protocols.',matches:[{prompt:'Uses SSH',answer:'SFTP'},{prompt:'Uses port 22',answer:'SFTP'}],answerTiles:['SFTP','TFTP']},
    {text:'Name both commands.',parts:[{prompt:'First command',answer:'ping'},{prompt:'Second command',answer:'tracert'}]}
  ]});
  document.querySelector('#import-submit').click();await new Promise(resolve=>setTimeout(resolve,0));
  document.querySelector('#import-submit').click();await new Promise(resolve=>setTimeout(resolve,0));
  document.querySelector('#start-quiz').click();
  document.querySelector('[data-match-tile="SFTP"]').click();document.querySelector('[data-match-target="0"]').click();
  document.querySelector('[data-match-tile="SFTP"]').click();document.querySelector('[data-match-target="1"]').click();
  document.querySelector('#next-question').click();
  assert.equal(document.querySelectorAll('[data-part]').length,2);
  const first=document.querySelector('[data-part="0"]');first.value='ping';first.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  const second=document.querySelector('[data-part="1"]');second.value='wrong';second.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  document.querySelector('#next-question').click();
  assert.match(document.querySelector('.result-score').textContent,/3\s*\/\s*4/);
  dom.window.close();
});

test('multi-select cards award partial points for correct selections',async()=>{
  const dom=openApp(),{document}=dom.window;
  await signInOwner(dom);
  document.querySelector('#new-reviewer').click();
  document.querySelector('#paste-text').value=JSON.stringify({questions:[{text:'Choose two.',options:['A','B','C','D'],correctAnswers:[1,3]}]});
  document.querySelector('#import-submit').click();await new Promise(resolve=>setTimeout(resolve,0));
  document.querySelector('#import-submit').click();await new Promise(resolve=>setTimeout(resolve,0));
  document.querySelector('#start-quiz').click();
  document.querySelector('[data-option="1"]').click();
  document.querySelector('#next-question').click();
  assert.match(document.querySelector('.result-score').textContent,/1\s*\/\s*2/);
  dom.window.close();
});

test('mixed reviewer filters and retry keep a usable reviewer selected', async () => {
  const dom = openApp(), {document} = dom.window;
  await signInOwner(dom);
  document.querySelector('#new-reviewer').click();
  document.querySelector('#paste-text').value = 'Question 1\nOther topic?\nCorrect! Choice A: Yes\nChoice B: No';
  document.querySelector('#import-submit').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  document.querySelector('#import-submit').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  document.querySelector('[data-reviewer="reviewer-s2-it0015"]').click();
  document.querySelector('[data-mix-reviewer]').checked = true;
  document.querySelector('#study-filter').value = 'flagged';
  document.querySelector('#start-quiz').click();
  assert.match(document.querySelector('#reviewer-title').textContent, /S2 It0015/);
  document.querySelector('#study-filter').value = 'all';
  document.querySelector('#start-quiz').click();
  document.querySelector('#next-question').click();
  assert.ok(document.querySelector('.question-text'));
  document.querySelector('#exit-quiz').click();
  assert.match(document.querySelector('#reviewer-title').textContent, /S2 It0015/);
  dom.window.close();
});

test('print view includes reviewer exhibits before opening the print dialog', async () => {
  const dom = openApp(), {document} = dom.window;
  let html = '', printed = false;
  dom.window.open = () => ({
    document:{write(value){html += value;},close(){},images:[]},
    focus(){},print(){printed = true;},closed:false
  });
  document.querySelector('[data-reviewer]').click();
  document.querySelector('#start-quiz').click();
  document.querySelector('#print-review').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(html, /<img src="data:image\//);
  assert.equal(printed, true);
  dom.window.close();
});
