(() => {
  'use strict';
  const KEY = 'recall-reviewers-v1';
  const SEED_KEY = 'rev-starter-seeded-v1';
  const MASTER_KEY = 'rev-master-prompt-v1';
  const IMPORT_KEY = 'rev-import-prompt-v1';
  const MASTER = `I want you to create an interactive quiz reviewer for me a local web app would suffice
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
  const IMPORT = `Convert this reviewer into plain text for Rev.

Preserve the exact wording and order of every question and choice. Preserve every correct answer at its existing choice position. Mark a choice correct only when the source explicitly identifies it as correct. A student's wrong answer is not correct. Keep True/False and identification questions as they are. Remove duplicate questions, page numbers, and unrelated headers. If duplicates disagree, keep the copy with a clear correct answer. Do not invent missing questions, choices, answers, or exhibits.

For any question that refers to a picture, diagram, topology, screenshot, or exhibit, keep its reference and add a line inside the question block: Exhibit: exact-image-filename.png. Preserve filenames exactly and attach each image only to the question that refers to it. Never replace an exhibit with a description or invent one. If an exhibit file is not available, write Exhibit: missing.

Return only this format, with one choice per line:
Question 1
Question text
Choice A: first choice
Correct! Choice B: second choice
Choice C: third choice

For identification:
Question 2
Question text
Answer: answer text

For multiple correct answers, prefix each correct choice with Correct!. Do not add markdown fences or a separate answer key.

Reviewer to convert:
[PASTE REVIEWER HERE]`;
  const $ = (s, root = document) => root.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const get = (key, fallback = null) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
  const put = (key, value) => { try { localStorage.setItem(key, value); return true; } catch { toast('Could not save on this device. Export a backup.'); return false; } };
  const state = {
    reviewers: [], activeId: null, screen: 'home', order: [], position: 0,
    answers: {}, revealed: new Set(), unknown: new Set(), retry: false,
    sourceText: '', selectedFiles: [], importBusy: false
  };
  function toast(message) {
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = message;
    document.body.append(el); setTimeout(() => el.remove(), 3200);
  }
  function load() {
    try {
      const saved = JSON.parse(get(KEY, '[]'));
      if (Array.isArray(saved)) state.reviewers = saved.filter(x => x && Array.isArray(x.questions))
        .map(x => ({...x, questions: x.questions.map(RevCore.normalizeQuestion)}));
    } catch { state.reviewers = []; }
    const starter = window.RECALL_STARTER_REVIEWER;
    const oldStarter = state.reviewers.find(x => x.id === 'reviewer-s2-it0015');
    if (starter && oldStarter?.questions?.length === 170 &&
        oldStarter.questions[1]?.options?.length === 3 &&
        oldStarter.questions[5]?.options?.[0] === 'configuration would correct the problem?') {
      oldStarter.questions = starter.questions.map(RevCore.normalizeQuestion);
      oldStarter.title = starter.title;
      saveReviewers();
    }
    let addedExhibits = false;
    for (const reviewer of state.reviewers) for (const question of reviewer.questions) {
      if (question.images?.length || question.image) continue;
      const source = starter?.questions.find(item => RevCore.normalize(item.text) === RevCore.normalize(question.text));
      if (source?.images?.length) { question.images = [...source.images]; addedExhibits = true; }
    }
    if (addedExhibits) saveReviewers();
    if (!get(SEED_KEY) && get(KEY) === null && window.RECALL_STARTER_REVIEWER) {
      state.reviewers = [{...starter, id: starter.id || crypto.randomUUID(),
        questions: starter.questions.map(RevCore.normalizeQuestion)}];
      saveReviewers(); put(SEED_KEY, '1');
    }
  }
  function saveReviewers() { return put(KEY, JSON.stringify(state.reviewers)); }
  function currentReviewer() { return state.reviewers.find(x => x.id === state.activeId); }
  function clearHash() { if (location.hash) history.replaceState(null, '', location.pathname + location.search); }
  function renderLibrary() {
    $('#reviewer-list').innerHTML = state.reviewers.map(r => `<div class="reviewer-entry">
      <button class="reviewer-item ${r.id === state.activeId && !location.hash ? 'active' : ''}" data-reviewer="${esc(r.id)}">
        <svg class="ui-icon reviewer-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.75h7l4 4v12.5H7zM14 3.75v4h4M10 12h5M10 16h5"/></svg>
        <span class="reviewer-copy"><span class="reviewer-title">${esc(r.title)}</span></span>
      </button><button class="reviewer-delete" data-delete="${esc(r.id)}" aria-label="Delete ${esc(r.title)}" title="Delete reviewer">×</button>
    </div>`).join('');
    $('#reviewer-list').querySelectorAll('[data-reviewer]').forEach(b => b.onclick = () => selectReviewer(b.dataset.reviewer));
    $('#reviewer-list').querySelectorAll('[data-delete]').forEach(b => b.onclick = () => deleteReviewer(b.dataset.delete));
    $('#prompt-link').classList.toggle('active', location.hash === '#prompt');
    $('#import-prompt-link').classList.toggle('active', location.hash === '#import-prompt');
  }
  function selectReviewer(id) {
    clearHash(); state.activeId = id; state.screen = 'home'; state.order = [];
    render();
  }
  function deleteReviewer(id) {
    const reviewer = state.reviewers.find(x => x.id === id);
    if (!reviewer || !confirm(`Delete "${reviewer.title}"?`)) return;
    state.reviewers = state.reviewers.filter(x => x.id !== id);
    if (state.activeId === id) { state.activeId = null; state.screen = 'home'; clearHash(); }
    saveReviewers(); render();
  }
  function render() {
    const prompt = location.hash === '#prompt' || location.hash === '#import-prompt';
    const easterEgg = location.hash === '#easter-egg';
    const studying = ['study', 'retry-prompt', 'results'].includes(state.screen) && !prompt && !easterEgg;
    document.body.classList.toggle('is-studying', studying);
    document.body.classList.toggle('prompt-open', prompt);
    document.body.classList.toggle('easter-egg-open', easterEgg);
    $('#intro').hidden = prompt || studying || !!currentReviewer();
    renderLibrary();
    if (easterEgg) return renderEasterEgg();
    if (prompt) return renderPrompt(location.hash === '#import-prompt');
    const reviewer = currentReviewer();
    if (!reviewer) {
      $('#main-panel').innerHTML = '<div class="welcome"><button class="primary-button" id="welcome-import">Add reviewer</button></div>';
      $('#welcome-import').onclick = () => openImport(); return;
    }
    if (state.screen === 'study') return renderQuestion();
    if (state.screen === 'retry-prompt') return renderRetryPrompt();
    if (state.screen === 'results') return renderResults();
    $('#main-panel').innerHTML = `<div class="welcome"><div class="welcome-inner"><h2>${esc(reviewer.title)}</h2>
      <p>${reviewer.questions.length} questions</p>
      <button class="primary-button" id="start-quiz" ${reviewer.questions.length ? '' : 'disabled'}>Start reviewing</button>
      <div class="welcome-actions"><button class="mini-control" id="edit-reviewer">Edit questions</button>
      <button class="mini-control" id="export-reviewer">Export</button></div></div></div>`;
    $('#start-quiz').onclick = () => startQuiz();
    $('#edit-reviewer').onclick = () => openImport(reviewer);
    $('#export-reviewer').onclick = () => exportReviewer(reviewer);
  }
  function renderEasterEgg() {
    $('#intro').hidden = true;
    $('#main-panel').innerHTML = `<section class="easter-egg-page"><p>09655236422 - alam nyo na gagawin</p><button class="secondary-button" id="egg-back">Back to reviewer</button></section>`;
    $('#egg-back').onclick = () => { clearHash(); render(); };
  }
  function renderPrompt(importPrompt) {
    const key = importPrompt ? IMPORT_KEY : MASTER_KEY;
    $('#main-panel').innerHTML = `<section class="prompt-editor"><div class="prompt-top"><h1>${importPrompt ? 'Import prompt' : 'Master prompt'}</h1>
      <span class="prompt-saved" id="prompt-saved">Saved on this device</span></div>
      <textarea id="master-prompt" spellcheck="true"></textarea><div class="prompt-actions">
      <button class="secondary-button" id="copy-prompt">Copy prompt</button>
      <button class="primary-button" id="save-prompt">Save changes</button></div></section>`;
    const field = $('#master-prompt'); field.value = get(key, importPrompt ? IMPORT : MASTER);
    field.oninput = () => $('#prompt-saved').textContent = 'Unsaved changes';
    $('#save-prompt').onclick = () => { if (put(key, field.value)) $('#prompt-saved').textContent = 'Saved'; };
    $('#copy-prompt').onclick = async () => {
      try { await navigator.clipboard.writeText(field.value); }
      catch { field.select(); document.execCommand('copy'); }
      toast('Prompt copied.');
    };
  }
  function startQuiz(shuffle = false) {
    const reviewer = currentReviewer(); if (!reviewer?.questions.length) return;
    state.order = reviewer.questions.map((_, i) => i);
    if (shuffle) shuffleInPlace(state.order);
    state.position = 0; state.answers = {}; state.revealed.clear(); state.unknown.clear();
    state.retry = false; state.screen = 'study'; render();
  }
  function shuffleInPlace(values) {
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1)); [values[i], values[j]] = [values[j], values[i]];
    }
  }
  function renderQuestion() {
    const reviewer = currentReviewer(), id = state.order[state.position], q = reviewer?.questions[id];
    if (!q) { state.screen = 'home'; return render(); }
    const revealed = state.revealed.has(id), selected = state.answers[id] || [];
    const deck = state.order.map((key, position) => {
      const item = reviewer.questions[key];
      return `<button class="question-index-card ${position === state.position ? 'current' : ''} ${state.unknown.has(key) ? 'unknown' : ''} ${state.answers[key]?.length ? 'answered' : ''}"
        data-jump="${position}" aria-label="Question ${esc(item.sourceNumber)}" title="Question ${esc(item.sourceNumber)}"><span>${esc(item.sourceNumber)}</span></button>`;
    }).join('');
    let input;
    if (q.options.length) {
      const multi = q.correctAnswers.length > 1;
      input = `<div class="answer-list">${q.options.map((o, i) => {
        const checked = selected.includes(i);
        const cls = revealed ? (q.correctAnswers.includes(i) ? 'correct' : checked ? 'incorrect' : '') : checked ? 'selected' : '';
        return `<button class="answer-option ${cls}" data-option="${i}" aria-pressed="${checked}">
          <span class="option-letter">${multi ? '□' : String.fromCharCode(65 + i)}</span><span>${esc(o)}</span></button>`;
      }).join('')}</div>`;
    } else {
      input = `<input class="short-answer" id="short-answer" type="text" autocomplete="off" placeholder="Type your answer" value="${esc(selected[0] ?? '')}">`;
    }
    const knownAnswer = q.options.length ? q.correctAnswers.map(i => q.options[i]).join(', ') : q.answer;
    const feedback = revealed ? (knownAnswer ? `Answer: ${esc(knownAnswer)}` : 'No answer key in this reviewer.') : '';
    const deckEl = $('.question-deck');
    const oldScroll = deckEl?.scrollLeft ?? null;
    const exhibits = [...new Set([...(q.images || []), ...(q.image ? [q.image] : [])])];
    $('#main-panel').innerHTML = `<div class="study-head"><div class="study-label"><span class="study-chip">${esc(reviewer.title)}</span>
      ${state.retry ? '<span class="study-chip retry-chip">Review later</span>' : ''}</div><div class="study-controls">
      <button class="mini-control" id="shuffle-questions">Shuffle cards</button><button class="mini-control" id="exit-quiz">Exit</button></div></div>
      <nav class="question-deck" aria-label="Question cards">${deck}</nav>
      <div class="progress-row"><div class="progress-track"><div class="progress-fill" style="width:${Math.round(state.position / state.order.length * 100)}%"></div></div>
      <span class="progress-copy">${state.position + 1} / ${state.order.length}</span></div>
      <article class="question-card"><div class="question-number">${esc(q.sourceNumber)}</div><div class="question-text">${esc(q.text)}</div>
      ${exhibits.map((image, i) => `<img class="question-image" src="${esc(image)}" alt="Exhibit ${i + 1}" loading="lazy">`).join('')}
      ${(q.imageRefs || []).map(ref => `<div class="missing-exhibit">Exhibit image not attached: ${esc(ref)}</div>`).join('')}</article>
      ${input}<div class="question-footer"><div class="feedback-area" role="status">${feedback ? `<span class="feedback neutral">${feedback}</span>` : ''}</div>
      <div class="nav-buttons"><button class="secondary-button" id="show-answer">Show answer</button>
      <button class="secondary-button" id="dont-know">I don't know</button>
      <button class="secondary-button" id="prev-question" ${state.position ? '' : 'disabled'}>Back</button>
      <button class="primary-button" id="next-question">${state.position === state.order.length - 1 ? 'Finish' : 'Next'}</button></div></div>`;
    if (oldScroll !== null) $('.question-deck').scrollLeft = oldScroll;
    else $('.question-index-card.current')?.scrollIntoView({block:'nearest',inline:'nearest'});
    $('#main-panel').querySelectorAll('[data-option]').forEach(b => b.onclick = () => {
      const option = Number(b.dataset.option), multi = q.correctAnswers.length > 1;
      state.answers[id] = multi ? (selected.includes(option) ? selected.filter(x => x !== option) : [...selected, option]) : [option];
      state.revealed.delete(id); renderQuestion();
    });
    $('#short-answer')?.addEventListener('input', e => {
      state.answers[id] = e.target.value ? [e.target.value] : [];
      state.revealed.delete(id);
    });
    $('#show-answer').onclick = () => { state.revealed.add(id); renderQuestion(); };
    $('#dont-know').onclick = () => advance(true);
    $('#prev-question').onclick = () => { state.position--; renderQuestion(); };
    $('#next-question').onclick = () => advance(false);
    $('#main-panel').querySelectorAll('[data-jump]').forEach(b => b.onclick = () => {
      state.position = Number(b.dataset.jump); renderQuestion();
    });
    $('#exit-quiz').onclick = () => { state.screen = 'home'; render(); };
    $('#shuffle-questions').onclick = () => {
      const currentId = state.order[state.position]; shuffleInPlace(state.order);
      state.position = state.order.indexOf(currentId); renderQuestion();
    };
  }
  function advance(dontKnow) {
    const id = state.order[state.position];
    if (dontKnow) state.unknown.add(id);
    else if (state.answers[id]?.length || state.revealed.has(id)) state.unknown.delete(id);
    if (state.position < state.order.length - 1) { state.position++; renderQuestion(); return; }
    state.screen = state.unknown.size ? 'retry-prompt' : 'results'; render();
  }
  function renderRetryPrompt() {
    const count = state.unknown.size;
    $('#main-panel').innerHTML = `<div class="welcome"><div class="welcome-inner"><h2>${count} card${count === 1 ? '' : 's'} to review later</h2>
      <div class="welcome-actions"><button class="primary-button" id="retry-unknown">Review these cards</button>
      <button class="secondary-button" id="finish-now">Finish for now</button></div></div></div>`;
    $('#retry-unknown').onclick = () => {
      state.order = [...state.unknown].sort((a, b) => a - b);
      state.position = 0; state.retry = true; state.screen = 'study'; render();
    };
    $('#finish-now').onclick = () => { state.screen = 'results'; render(); };
  }
  function renderResults() {
    const reviewer = currentReviewer();
    const keyed = reviewer.questions.filter(q => q.correctAnswers.length || q.answer);
    const score = reviewer.questions.filter((q, i) => (q.correctAnswers.length || q.answer) && RevCore.isCorrect(q, state.answers[i])).length;
    $('#main-panel').innerHTML = `<div class="result-view"><div><h2 class="result-title">Review complete</h2>
      <div class="result-score">${score}<span class="score-total"> / ${keyed.length}</span></div>
      <p class="result-sub">${keyed.length < reviewer.questions.length ? `${reviewer.questions.length - keyed.length} without an answer key` : `${reviewer.questions.length} questions`}</p>
      <div class="result-actions"><button class="secondary-button" id="back-to-reviewer">Done</button>
      <button class="primary-button" id="retry-quiz">Review again</button></div>
      <div class="review-list">${reviewer.questions.map((q, i) => `<button class="review-row result-jump" data-result-jump="${i}">
      <span>${esc(q.sourceNumber)}. ${esc(q.text.slice(0, 80))}</span><span class="result-status">${state.unknown.has(i) ? 'I don\'t know' : !(q.correctAnswers.length || q.answer) ? 'No key' : RevCore.isCorrect(q, state.answers[i]) ? 'Correct' : 'Review'}</span></button>`).join('')}</div></div></div>`;
    $('#back-to-reviewer').onclick = () => { state.screen = 'home'; render(); };
    $('#retry-quiz').onclick = () => startQuiz();
    $('#main-panel').querySelectorAll('[data-result-jump]').forEach(b => b.onclick = () => {
      state.order = reviewer.questions.map((_, i) => i); state.position = Number(b.dataset.resultJump);
      state.retry = false; state.screen = 'study'; render();
    });
  }
  function reviewerToText(reviewer) {
    return reviewer.questions.map(q => {
      const images = [...new Set([...(q.images || []), ...(q.image ? [q.image] : [])])];
      const readableImages = images.filter(image => !/^data:image\//i.test(image));
      const hasEmbeddedImage = images.some(image => /^data:image\//i.test(image));
      const refs = [...new Set([...(q.imageRefs || []), ...readableImages, ...(hasEmbeddedImage ? ['attached'] : [])])];
      return `Question ${q.sourceNumber}\n${q.text}\n${q.options.length
        ? q.options.map((o, i) => `${q.correctAnswers.includes(i) ? 'Correct! ' : ''}Choice ${String.fromCharCode(65 + i)}: ${o}`).join('\n')
        : q.answer ? `Answer: ${q.answer}` : ''}${refs.map(image => `\nExhibit: ${image}`).join('')}`;
    }).join('\n\n');
  }
  function exportReviewer(reviewer) {
    const blob = new Blob([JSON.stringify(reviewer, null, 2)], {type:'application/json'});
    const a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = (reviewer.title.replace(/[^a-z0-9-_]+/gi, '-').slice(0, 60) || 'reviewer') + '.json';
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function openImport(reviewer = null) {
    const dialog = $('#import-dialog');
    dialog.dataset.editId = reviewer?.id || '';
    state.sourceText = ''; state.selectedFiles = []; state.importBusy = false;
    $('#reviewer-name').value = reviewer?.title || '';
    $('#paste-text').value = reviewer ? reviewerToText(reviewer) : '';
    $('#file-input').value = ''; $('#file-status').textContent = 'PDF text is extracted locally. Attach image files and reference each filename with Exhibit: filename.png.';
    $('#import-feedback').textContent = '';
    showImportTab('paste'); dialog.showModal(); $('#reviewer-name').focus();
  }
  function showImportTab(tab) {
    document.querySelectorAll('.import-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('#paste-pane').hidden = tab !== 'paste'; $('#file-pane').hidden = tab !== 'file';
    $('#import-feedback').textContent = '';
  }
  function feedback(message, error = false) {
    const el = $('#import-feedback'); el.textContent = message; el.classList.toggle('error', error);
  }
  async function extractPdf(file) {
    if (!window.pdfjsLib) throw Error('PDF reader is unavailable. Check your connection and try again.');
    const pdf = await pdfjsLib.getDocument({data: await file.arrayBuffer()}).promise;
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number), content = await page.getTextContent();
      const rows = [];
      for (const item of content.items) {
        if (!item.str?.trim()) continue;
        const y = Math.round(item.transform[5] * 2) / 2;
        const last = rows.at(-1);
        if (last && Math.abs(last.y - y) <= 2) {
          const gap = item.transform[4] - last.end;
          last.text += (gap > 2 ? ' ' : '') + item.str;
          last.end = item.transform[4] + (item.width || 0);
        } else rows.push({x:item.transform[4], y, text:item.str, end:item.transform[4] + (item.width || 0)});
      }
      pages.push(rows.map(r => ({x:r.x,y:r.y,text:r.text.trim()})).filter(r => r.text));
    }
    const text = RevCore.formatPdfRows(pages);
    if (!text.trim()) throw Error('This PDF has no selectable text. Use the Import prompt with copied text.');
    return text;
  }
  async function submitImport() {
    if (state.importBusy) return;
    state.importBusy = true; $('#import-submit').disabled = true;
    try {
      const tab = $('.import-tab.active').dataset.tab, files = state.selectedFiles;
      const file = files.find(x => !x.type.startsWith('image/'));
      const exhibitFiles = files.filter(x => x.type.startsWith('image/'));
      let source = $('#paste-text').value;
      if (tab === 'file' && file) source = /\.pdf$/i.test(file.name) ? await extractPdf(file) : await file.text();
      else if (tab === 'file' && !source.trim()) return feedback('Choose a reviewer file or paste text, then attach any exhibit images.', true);
      if (!source.trim()) return feedback('Paste questions or choose a file.', true);
      const parsed = RevCore.parseImport(source);
      if (!parsed.questions.length) return feedback('No questions found. Use Question 1 headings or the Import prompt.', true);
      const empty = parsed.questions.filter(q => !q.text);
      if (empty.length) return feedback(`${empty.length} question(s) have no question text. Check the formatting before saving.`, true);
      const imageFiles = [];
      for (const imageFile of exhibitFiles) imageFiles.push({name:imageFile.name,data:await fileToDataUrl(imageFile)});
      const editId = $('#import-dialog').dataset.editId;
      const previousReviewer = state.reviewers.find(item => item.id === editId);
      const fallbackQuestions = window.RECALL_STARTER_REVIEWER?.questions || [];
      const resolved = RevCore.resolveImageFiles(parsed.questions, imageFiles, fallbackQuestions, previousReviewer?.questions || []);
      if (resolved.unresolved.length) return feedback(`Attach image file(s) matching: ${resolved.unresolved.join(', ')}`, true);
      const title = ($('#reviewer-name').value.trim() || parsed.title || file?.name?.replace(/\.[^.]+$/, '') || 'New reviewer').slice(0, 70);
      const reviewer = {id: editId || crypto.randomUUID(), title, questions: parsed.questions, updatedAt: Date.now()};
      const index = state.reviewers.findIndex(x => x.id === editId);
      const previous = index >= 0 ? state.reviewers[index] : null;
      if (index >= 0) state.reviewers[index] = reviewer; else state.reviewers.unshift(reviewer);
      if (!saveReviewers()) {
        if (index >= 0) state.reviewers[index] = previous;
        else state.reviewers.shift();
        return feedback('Browser storage is full. Export or remove a reviewer, then try again.', true);
      }
      state.activeId = reviewer.id; state.screen = 'home'; clearHash();
      $('#import-dialog').close(); render();
      if (parsed.warnings.length) toast(`Imported ${parsed.questions.length} questions. ${parsed.warnings.length} formatting note(s).`);
      else toast(`Imported ${parsed.questions.length} questions.`);
    } catch (error) {
      feedback(error.message || 'Could not read the reviewer or exhibit image.', true);
    } finally {
      state.importBusy = false; $('#import-submit').disabled = false;
    }
  }
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`Could not read image ${file.name}.`));
      reader.readAsDataURL(file);
    });
  }
  function initialize() {
    load();
    document.body.classList.toggle('sidebar-collapsed', get('rev-sidebar-open') === 'false');
    document.body.classList.toggle('dark', get('rev-theme') === 'dark');
    $('#theme-state').textContent = document.body.classList.contains('dark') ? 'Dark' : 'Light';
    $('#sidebar-toggle').onclick = () => {
      const collapsed = document.body.classList.toggle('sidebar-collapsed');
      put('rev-sidebar-open', String(!collapsed));
      $('#sidebar-toggle').setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation');
    };
    $('#theme-toggle').onclick = () => {
      const dark = document.body.classList.toggle('dark');
      put('rev-theme', dark ? 'dark' : 'light'); $('#theme-state').textContent = dark ? 'Dark' : 'Light';
    };
    $('#new-reviewer').onclick = () => openImport();
    $('#import-trigger').onclick = () => openImport();
    $('#cancel-import').onclick = () => $('#import-dialog').close();
    document.querySelectorAll('.import-tab').forEach(b => b.onclick = () => showImportTab(b.dataset.tab));
    $('#file-input').onchange = e => {
      state.selectedFiles = [...e.target.files];
      $('#file-status').textContent = state.selectedFiles.map(x => x.name).join(', ') || 'PDF text is extracted locally. Attach image files and reference them with Exhibit: filename.png.';
      feedback('');
    };
    $('#import-submit').onclick = submitImport;
    window.addEventListener('hashchange', render);
    render();
  }
  initialize();
})();
