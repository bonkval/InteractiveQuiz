(() => {
  'use strict';
  const STORAGE_KEY = 'recall-reviewers-v1';
  const state = { reviewers: loadReviewers(), activeId: null, session: null, questionIndex: 0, answers: {}, checked: false, sourceText: '', selectedFile: null, unknown: new Set(), retryRound: false };
  const NAV_KEY = 'rev-sidebar-open';
  const THEME_KEY = 'rev-theme';
  const PROMPT_KEY = 'rev-master-prompt-v1';
  const DEFAULT_MASTER_PROMPT = `I want you to create an interactive quiz reviewer for me a local web app would suffice
Put this at the prompt section so every time, the reviewer is the same
Master prompt: Keep everything word for word, do not change the position of the correct answer, if its on the 1st, 2nd, 3rd, or 4th option then keep it there. If its identification then no need to do anything since its already organized by the reviewer. The most important thing I want you to do is organize and just make the reviewer easy to read and to remove all the duplicates since i will just copy 100 question with correct answers multiple times in this file. Do not do something that is not mentioned here. All the correct answers is in letter A or the first option. Thats a problem since i want this to serve as a reviewer. Shuffle the position of the correct answers for example. For number 1
Correct! designated
alternate
blocked
Disabled
Instead of that you can make it as
alternate
Correct! designated
blocked
Disabled
Or like this
alternate
blocked
Correct! designated
Disabled
Or like this
alternate
blocked
Disabled
Correct! designated
For the True or false just keep it as is.
If there is a duplicate and the other one is wrong, remove the wrong one and keep the correct one.
If theres no duplicate and there is only the wrong one, then just keep it as is because it will still serve as the reviewer.`;
  const DEFAULT_IMPORT_PROMPT = `Convert this reviewer into clean plain text that Rev can import.

Preserve the wording of every question, choice, and answer. Keep choice order unchanged and keep each correct answer in its original position. Use Correct! only for an answer explicitly marked correct in the source. Never mark a student’s wrong choice as correct. Keep True/False and identification questions as they are.

Remove page numbers, repeated copies of the same question, and unrelated headers or footers. If duplicate copies conflict, use the copy with a clearly marked correct answer. Do not invent missing questions, choices, or answers.

Return only plain text in this exact structure. Number each question. Put every choice on its own line and label it Choice A:, Choice B:, and so on. Prefix the correct choice with Correct!. For example:

Question 1
Question text
Choice A: first choice
Correct! Choice B: second choice
Choice C: third choice

For identification questions use:
Question 2
Question text
Answer: answer text

Do not include markdown fences, introductions, explanations, or a separate answer key.

Reviewer to convert:
[PASTE REVIEWER HERE]`;

  const $ = (s, root = document) => root.querySelector(s);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  function loadReviewers() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } }
  function saveReviewers() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.reviewers)); } catch { toast('Storage is full. Export this reviewer to keep a backup.'); } }
  function toast(message) { const el = document.createElement('div'); el.className='toast'; el.textContent=message; document.body.append(el); setTimeout(()=>el.remove(),2600); }
  function parseReviewer(text) {
    const questions=[]; let current=null, inOptions=false;
    const finish=()=>{if(!current)return;current.text=current.textParts.join('\n').trim();delete current.textParts;current.options=current.options.map(x=>x.trim()).filter(Boolean);current.correctAnswers=[...new Set(current.correctAnswers)].filter(i=>i>=0&&i<current.options.length);current.type=current.options.length?(current.options.length===2&&/^(true|false)$/i.test(current.options.join(''))?'boolean':'choice'):'text';if(current.text||current.options.length||current.answer)questions.push(current);current=null;inOptions=false;};
    const begin=(num,tail='')=>{finish();current={sourceNumber:String(num),textParts:tail?[tail]:[],options:[],correctAnswers:[]};};
    for(const raw of String(text||'').replace(/\r/g,'').replace(/\u200b/g,'').replace(/^\s*```[^\n]*\n/gm,'').replace(/^\s*```\s*$/gm,'').split('\n')){
      const line=raw.trim();if(!line)continue;
      let m=line.match(/^(?:Question|Q)\s*#?\s*(\d+)\s*[:.)-]?\s*(.*)$/i);if(m){begin(m[1],m[2]);continue;}
      if(!current){m=line.match(/^(?:#{1,4}\s*)?(?:Question\s*)?(\d{1,4})[.) :\-]+(.+)$/i);if(m){begin(m[1],m[2]);continue;}if(/^\d+$/.test(line))continue;current={sourceNumber:String(questions.length+1),textParts:[],options:[],correctAnswers:[]};}
      m=line.match(/^Answer\s*:\s*(.+)$/i);if(m){current.answer=m[1].trim();current.correctAnswerText=current.answer;inOptions=false;continue;}
      m=line.match(/^(.*?)\s*\((correct|wrong)\)$/i);if(m){const value=m[1].trim();if(/You Answered/i.test(value))current.textParts.push(value);else{current.options.push(value.replace(/^(?:\([A-H]\)|[A-H][.)])\s*/i,''));if(m[2].toLowerCase()==='correct')current.correctAnswers.push(current.options.length-1);}inOptions=true;continue;}
      m=line.match(/^(?:Correct!\s*|Correct:\s*|\*\s*Correct:\s*|✓\s*|✅\s*)(.*)$/i);if(m){if(!inOptions&&current.textParts.length>1){let endOfQuestion=-1;for(let i=current.textParts.length-1;i>=0;i--){if(/[?:]$/.test(current.textParts[i])){endOfQuestion=i;break;}}if(endOfQuestion>=0){current.options.push(...current.textParts.splice(endOfQuestion+1));}else{const tail=current.textParts.pop();if(tail)current.options.push(tail);}}current.options.push(m[1].replace(/^(?:(?:Choice|Option)\s+[A-H]\s*[:.)-]\s*|\([A-H]\)\s*|[A-H][.)]\s*)/i,''));current.correctAnswers.push(current.options.length-1);inOptions=true;continue;}
      m=line.match(/^(?:Choice|Option)\s+[A-H]\s*[:.)-]\s*(.*)$/i)||line.match(/^[A-H][.)]\s+(.+)$/i);if(m){if(!inOptions&&current.textParts.length>1){const tail=current.textParts.pop();if(tail)current.options.push(tail);}current.options.push(m[1]);inOptions=true;continue;}
      if(inOptions)current.options.push(line);else current.textParts.push(line);
    }
    finish();return questions;
  }
    function renderLibrary() {
    const list=$('#reviewer-list');
    list.innerHTML=state.reviewers.map(r=>`<button class="reviewer-item ${r.id===state.activeId?'active':''}" data-reviewer="${escapeHtml(r.id)}"><svg class="ui-icon reviewer-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.75h7l4 4v12.5H7zM14 3.75v4h4M10 12h5M10 16h5"/></svg><span class="reviewer-copy"><span class="reviewer-title">${escapeHtml(r.title)}</span></span><span class="reviewer-delete" data-delete="${escapeHtml(r.id)}" title="Delete reviewer" aria-label="Delete reviewer">×</span></button>`).join('');
    list.querySelectorAll('[data-reviewer]').forEach(btn=>btn.addEventListener('click', e=>{if(e.target.closest('[data-delete]'))return;openReviewer(btn.dataset.reviewer);}));
    list.querySelectorAll('[data-delete]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();deleteReviewer(btn.dataset.delete);}));
  }
  function deleteReviewer(id) { state.reviewers=state.reviewers.filter(r=>r.id!==id);if(state.activeId===id){state.activeId=null;state.session=null;renderMain();}saveReviewers();renderLibrary(); }
  function activeReviewer(){return state.reviewers.find(r=>r.id===state.activeId);}
  function openReviewer(id){if(location.hash==='#prompt')history.replaceState(null,'',location.pathname+location.search);state.activeId=id;state.session=null;state.answers={};state.unknown=new Set();state.retryRound=false;state.questionIndex=0;renderLibrary();renderMain();}
  function renderMain(){const panel=$('#main-panel'),reviewer=activeReviewer(),intro=$('#intro');const studying=Boolean(reviewer&&state.session&&state.session!=='results');document.body.classList.toggle('is-studying',studying);const promptPage=location.hash==='#prompt'||location.hash==='#import-prompt';document.body.classList.toggle('prompt-open',promptPage);intro.hidden=studying||promptPage;if(promptPage){renderPrompt(location.hash==='#import-prompt');return;}if(!reviewer){panel.innerHTML=`<div class="welcome"><div class="welcome-inner"><button class="primary-button" id="welcome-import">Add reviewer <span>→</span></button></div></div>`;$('#welcome-import').onclick=openImport;return;}if(!state.session){const count=reviewer.questions.length;panel.innerHTML=`<div class="welcome"><div class="welcome-inner"><h2>${escapeHtml(reviewer.title)}</h2><p>${count} questions</p><button class="primary-button" id="start-quiz" ${count?'':'disabled'}>Start reviewing <span>→</span></button><div style="margin-top:15px"><button class="mini-control" id="export-reviewer">Export</button><button class="mini-control" id="edit-reviewer">Edit questions</button></div></div></div>`;$('#start-quiz').onclick=()=>startQuiz(false);$('#export-reviewer').onclick=()=>exportReviewer(reviewer);$('#edit-reviewer').onclick=editReviewer;return;}if(state.session==='results'){renderResults();return;}renderQuestion();}
  function openPrompt(which='master'){location.hash=which==='import'?'#import-prompt':'#prompt';state.session=null;renderMain();}
  function renderPrompt(isImport=false){const key=isImport?'rev-import-prompt-v1':PROMPT_KEY,initial=isImport?DEFAULT_IMPORT_PROMPT:DEFAULT_MASTER_PROMPT,saved=localStorage.getItem(key)||initial,title=isImport?'Import prompt':'Master prompt';$('#intro').hidden=true;document.body.classList.remove('is-studying');$('#main-panel').innerHTML='<section class="prompt-editor"><div class="prompt-top"><h1>'+title+'</h1><span class="prompt-saved" id="prompt-saved">Saved in this browser</span></div><textarea id="master-prompt" spellcheck="true"></textarea><div class="prompt-actions"><button class="secondary-button" id="copy-prompt">Copy prompt</button><button class="primary-button" id="save-prompt">Save changes</button></div></section>';$('#master-prompt').value=saved;$('#save-prompt').onclick=()=>{localStorage.setItem(key,$('#master-prompt').value);$('#prompt-saved').textContent='Saved';};$('#master-prompt').oninput=()=>{$('#prompt-saved').textContent='Unsaved changes';};$('#copy-prompt').onclick=async()=>{try{await navigator.clipboard.writeText($('#master-prompt').value);toast('Prompt copied.');}catch{const field=$('#master-prompt');field.select();document.execCommand('copy');toast('Prompt copied.');}};}
  function startQuiz(shuffle){const r=activeReviewer();if(!r)return;let order=r.questions.map((_,i)=>i);if(shuffle)for(let i=order.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}state.session=order;state.questionIndex=0;state.answers={};state.unknown=new Set();state.retryRound=false;state.checked=false;renderMain();}
  function currentQuestion(){const r=activeReviewer();return r?.questions[state.session[state.questionIndex]];}
  function renderQuestion(){
    const q=currentQuestion(),r=activeReviewer(),n=state.questionIndex+1,total=state.session.length,questionId=state.session[state.questionIndex];
    const pct=Math.round((n-1)/total*100);
    let controls='';
    if(q.options?.length){
      const multi=q.correctAnswers.length>1;
      controls='<div class="answer-list">'+q.options.map((o,i)=>{const selected=(state.answers[questionId]||[]).includes(i),correct=q.correctAnswers.includes(i);let cls=selected?'selected':'';if(state.checked)cls=correct?'correct':selected?'incorrect':'';return '<button class="answer-option '+cls+'" data-option="'+i+'"><span class="option-letter">'+(multi?'?':String.fromCharCode(65+i))+'</span><span>'+escapeHtml(o)+'</span></button>';}).join('')+'</div>';
    }else controls='<input class="short-answer" id="short-answer" type="text" autocomplete="off" placeholder="Type your answer?" value="'+escapeHtml((state.answers[questionId]||[])[0]??'')+'">';
    const selected=state.answers[questionId]||[];
    const feedback=state.checked?'<span class="feedback neutral">Answer: '+escapeHtml(q.correctAnswers.map(i=>q.options[i]).join(', ')||q.answer||'')+'</span>':'';
    const cards=state.session.map((id,i)=>'<button class="question-index-card '+(i===state.questionIndex?'current ':'')+(state.unknown.has(id)?'unknown ':'')+(state.answers[id]?.length?'answered':'')+'" data-jump="'+i+'" aria-label="Go to question '+(i+1)+'" title="Question '+(i+1)+'"><span>'+ (i+1) +'</span></button>').join('');
    $('#main-panel').innerHTML='<div class="study-head"><div class="study-label"><span class="study-chip">'+escapeHtml(r.title)+'</span>'+(state.retryRound?'<span class="study-chip retry-chip">Retrying unknown cards</span>':'')+'</div><div class="study-controls"><button class="mini-control" id="shuffle-questions">Shuffle</button><button class="mini-control" id="exit-quiz">Exit</button></div></div><nav class="question-deck" aria-label="Question cards">'+cards+'</nav><div class="progress-row"><div class="progress-track"><div class="progress-fill" style="width:'+pct+'%"></div></div><span class="progress-copy">'+n+' / '+total+'</span></div><article class="question-card"><div class="question-number">'+n+'</div><div class="question-text">'+escapeHtml(q.text)+'</div>'+(q.image?'<img class="question-image" src="'+escapeHtml(q.image)+'" alt="Question exhibit">':'')+'</article>'+controls+'<div class="question-footer"><div class="feedback-area">'+feedback+'</div><div class="nav-buttons"><button class="secondary-button" id="show-answer">Show answer</button><button class="secondary-button" id="dont-know">I don?t know</button>'+'<button class="secondary-button" id="prev-question" '+(state.questionIndex===0?'disabled':'')+'>Back</button><button class="primary-button" id="next-question">'+(n===total?'Finish':'Next')+'</button></div></div>';
    $('#main-panel').querySelectorAll('[data-option]').forEach(btn=>btn.onclick=()=>{const i=Number(btn.dataset.option);let ans=state.answers[questionId]||[];if(q.correctAnswers.length>1)ans=ans.includes(i)?ans.filter(x=>x!==i):[...ans,i];else ans=[i];state.answers[questionId]=ans;state.checked=false;renderQuestion();});
    const short=$('#short-answer');if(short)short.oninput=()=>{state.answers[questionId]=short.value?[short.value]:[];};
    $('#show-answer').onclick=()=>{state.checked=true;state.unknown.delete(questionId);renderQuestion();};
    $('#dont-know').onclick=()=>{state.unknown.add(questionId);goNext();};$('#next-question').onclick=goNext;
    const prev=$('#prev-question');if(prev)prev.onclick=()=>moveQuestion(-1);
    $('#main-panel').querySelectorAll('[data-jump]').forEach(btn=>btn.onclick=()=>{state.questionIndex=Number(btn.dataset.jump);state.checked=false;renderQuestion();});
    $('#exit-quiz').onclick=()=>{state.session=null;renderMain();};$('#shuffle-questions').onclick=()=>startQuiz(true);
  }
  function goNext(){if(state.questionIndex<state.session.length-1){moveQuestion(1);return;}if(state.retryRound){if(state.unknown.size){const pending=[...state.unknown].filter(id=>state.session.includes(id));state.session=pending;state.questionIndex=0;state.checked=false;renderMain();return;}state.session='results';renderMain();return;}if(state.unknown.size){state.session=[...state.unknown].filter(id=>state.session.includes(id));state.questionIndex=0;state.checked=false;state.retryRound=true;renderMain();return;}state.session='results';renderMain();}
  function sameSet(a,b){return a.length===b.length&&a.every(x=>b.includes(x));}
  function normalizeAnswer(s){return String(s).toLowerCase().trim().replace(/[.,!?;:]$/,'').replace(/\s+/g,' ');}
  function moveQuestion(delta){state.questionIndex=Math.min(state.session.length-1,Math.max(0,state.questionIndex+delta));state.checked=false;renderQuestion();}
  function renderResults(){const r=activeReviewer(),total=r.questions.length;let score=0;const rows=r.questions.map((q,i)=>{const a=state.answers[i]||[],ok=q.options?.length?sameSet(a,q.correctAnswers):normalizeAnswer(a[0]||'')===normalizeAnswer(q.answer||'');if(ok)score++;return {q,ok,i};});$('#main-panel').innerHTML='<div class="result-view"><div><h2 class="result-title">Review complete.</h2><div class="result-score">'+score+'<span style="font-size:22px;color:#a3a4ac"> / '+total+'</span></div><p class="result-sub">'+(state.unknown.size?state.unknown.size+' cards still need review.':'Round complete.')+'</p><div class="result-actions"><button class="secondary-button" id="back-to-reviewer">Done</button><button class="primary-button" id="retry-quiz">Review again</button></div><div class="review-list">'+rows.map((x,i)=>'<button class="review-row result-jump" data-result-jump="'+x.i+'"><span>'+(i+1)+'. '+escapeHtml(x.q.text.slice(0,75))+(x.q.text.length>75?'?':'')+'</span><span style="color:'+(x.ok?'#39845e':state.unknown.has(x.i)?'#a46818':'#c45b60')+'">'+(x.ok?'Correct':state.unknown.has(x.i)?'I don?t know':'Review')+'</span></button>').join('')+'</div></div></div>';$('#back-to-reviewer').onclick=()=>{state.session=null;renderMain();};$('#retry-quiz').onclick=()=>startQuiz(false);$('#main-panel').querySelectorAll('[data-result-jump]').forEach(btn=>btn.onclick=()=>{state.session=Array.from({length:total},(_,i)=>i);state.questionIndex=Number(btn.dataset.resultJump);state.retryRound=false;renderQuestion();});}
  function exportReviewer(r){const blob=new Blob([JSON.stringify(r,null,2)],{type:'application/json'});download(blob,`${safeName(r.title)}.json`);}
  function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  function safeName(s){return String(s).replace(/[^a-z0-9-_]+/gi,'-').replace(/^-|-$/g,'').slice(0,60)||'reviewer';}
  function editReviewer(){const r=activeReviewer();if(!r)return;const text=reviewerToText(r);$('#paste-text').value=text;openImport(r.id);}
  function reviewerToText(r){return r.questions.map((q,i)=>`Question ${i+1}\n${q.text}\n${q.options?.length?q.options.map((o,j)=>`${q.correctAnswers.includes(j)?'Correct! ':''}${o}`).join('\n'):q.answer||''}`).join('\n\n');}
  function openImport(editId=null){const d=$('#import-dialog');if(editId)d.dataset.editId=editId;else delete d.dataset.editId;state.sourceText='';state.selectedFile=null;$('#file-status').textContent='PDF text is extracted locally in your browser.';if(!editId)$('#paste-text').value='';showImportTab('paste');d.showModal();}
  function showImportTab(tab){document.querySelectorAll('.import-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));$('#paste-pane').hidden=tab!=='paste';$('#file-pane').hidden=tab!=='file';}
  function addReviewer(text,title,editId){const questions=parseReviewer(text);if(!questions.length){toast('No questions found. Use Question 1 headings or the saved Import prompt.');return;}const reviewer={id:editId||crypto.randomUUID(),title:(title||'New reviewer').replace(/\.(pdf|txt|md)$/i,'').slice(0,70),questions,updatedAt:Date.now()};if(editId){const i=state.reviewers.findIndex(r=>r.id===editId);if(i>=0)state.reviewers[i]=reviewer;else state.reviewers.push(reviewer);}else state.reviewers.unshift(reviewer);state.activeId=reviewer.id;if(location.hash==='#prompt'||location.hash==='#import-prompt')history.replaceState(null,'',location.pathname+location.search);state.session=null;saveReviewers();renderLibrary();renderMain();$('#import-dialog').close();toast(`${questions.length} questions added.`);}
  async function extractFile(file){
    if(!file)return;state.selectedFile=file;$('#file-status').textContent='Reading '+file.name+'?';
    try{
      if(file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf')){
        if(!window.pdfjsLib)throw new Error('The PDF reader did not load. Check your connection, then refresh.');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        const pdf=await window.pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise,pages=[];
        for(let i=1;i<=pdf.numPages;i++){const content=await (await pdf.getPage(i)).getTextContent();let lines=[],lastY=null;for(const item of content.items){if(!item.str?.trim())continue;const y=item.transform?.[5];if(lastY!==null&&typeof y==='number'&&Math.abs(y-lastY)>3)lines.push('\n');lines.push(item.str);if(typeof y==='number')lastY=y;}pages.push(lines.join(''));}
        state.sourceText=pages.join('\n\n');$('#file-status').textContent='Ready ? '+pdf.numPages+' pages extracted';
      }else{state.sourceText=await file.text();if(!state.sourceText.trim())throw new Error('This file has no readable text.');$('#file-status').textContent='Ready ? '+file.name;}
    }catch(error){state.sourceText='';state.selectedFile=null;$('#file-status').textContent=error.message||'Could not read this file.';toast(error.message||'Could not read this file.');}
  }
  function init(){if(!state.reviewers.length&&window.RECALL_STARTER_REVIEWER)state.reviewers=[clone(window.RECALL_STARTER_REVIEWER)];saveReviewers();document.body.classList.toggle('sidebar-collapsed',localStorage.getItem(NAV_KEY)==='false');document.body.classList.toggle('dark',localStorage.getItem(THEME_KEY)==='dark');syncThemeLabel();renderLibrary();renderMain();$('#prompt-link').onclick=e=>{e.preventDefault();openPrompt('master');};$('#import-prompt-link').onclick=e=>{e.preventDefault();openPrompt('import');};window.addEventListener('hashchange',renderMain);$('#sidebar-toggle').onclick=()=>{const collapsed=document.body.classList.toggle('sidebar-collapsed');localStorage.setItem(NAV_KEY,String(!collapsed));$('#sidebar-toggle').setAttribute('aria-label',collapsed?'Expand navigation':'Collapse navigation');$('#sidebar-toggle').title=collapsed?'Expand navigation':'Collapse navigation';};$('#new-reviewer').onclick=openImport;$('#import-trigger').onclick=openImport;$('#cancel-import').onclick=()=>$('#import-dialog').close();document.querySelectorAll('.import-tab').forEach(b=>b.onclick=()=>showImportTab(b.dataset.tab));$('#file-input').onchange=()=>extractFile($('#file-input').files[0]).catch(e=>{console.error(e);toast('Could not read this file.');});$('#import-submit').onclick=()=>{const d=$('#import-dialog'),file=state.selectedFile;const text=$('#paste-pane').hidden?state.sourceText:$('#paste-text').value;if($('#paste-pane').hidden&&state.selectedFile&&!state.sourceText.trim()){toast('Wait for the file to finish reading or choose it again.');return;}if(!text.trim()){toast('Choose a file or paste your reviewer first.');return;}const title=file?.name||'New reviewer';addReviewer(text,title,d.dataset.editId);};$('#theme-toggle').onclick=()=>{const dark=document.body.classList.toggle('dark');localStorage.setItem(THEME_KEY,dark?'dark':'light');syncThemeLabel();};}
  function syncThemeLabel(){const dark=document.body.classList.contains('dark');$('#theme-state').textContent=dark?'Dark':'Light';$('#theme-toggle').setAttribute('aria-label',`Switch to ${dark?'light':'dark'} mode`);}
  init();
})();
