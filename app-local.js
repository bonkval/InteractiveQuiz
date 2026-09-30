(() => {
  'use strict';
  const KEY = 'recall-reviewers-v1';
  const SESSION_KEY = 'rev-quiz-session-v1';
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

For identification, preserve the main answer. Include alternate answers only when the source explicitly lists them:
Question 2
Question text
Answer: answer text
Also accepted: another valid answer | a common abbreviation

For multiple correct answers, prefix each correct choice with Correct!. Do not add markdown fences or a separate answer key.

Reviewer to convert:
[PASTE REVIEWER HERE]`;
  let sessionSaveWarningShown = false;
  const $ = (s, root = document) => root.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const get = (key, fallback = null) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
  const put = (key, value) => { try { localStorage.setItem(key, value); return true; } catch { toast('Could not save on this device. Export a backup.'); return false; } };
  const state = {
    reviewers: [], activeId: null, screen: 'home', order: [], position: 0, mode: 'quiz',
    answers: {}, results: {}, revealed: new Set(), unknown: new Set(), retry: false,
    sourceText: '', selectedFiles: [], importBusy: false, reviewerSearch: '', reviewerSort: 'recent'
  };
  function toast(message) {
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = message;
    document.body.append(el); setTimeout(() => el.remove(), 3200);
  }
  function showAnswerResult(correct) {
    document.querySelectorAll('.answer-result-overlay').forEach(item => item.remove());
    const mark = document.createElement('div');
    mark.className = `answer-result-overlay ${correct ? 'correct' : 'incorrect'}`;
    mark.setAttribute('role', 'status');
    mark.setAttribute('aria-label', correct ? 'Correct answer' : 'Incorrect answer');
    const icon = correct
      ? '<path d="M7 17.5 13 23.5 25 10.5" pathLength="1" />'
      : '<path d="m10 10 14 14" pathLength="1" /><path d="m24 10-14 14" pathLength="1" />';
    mark.innerHTML = `<span class="answer-result-badge" aria-hidden="true"><svg viewBox="0 0 34 34" fill="none">${icon}</svg></span>`;
    document.body.append(mark);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => mark.remove(), reducedMotion ? 260 : 760);
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
    restoreSession();
  }
  function saveReviewers() { return put(KEY, JSON.stringify(state.reviewers)); }
  function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch {} }
  function saveSession() {
    if (!currentReviewer() || !['study', 'retry-prompt', 'results'].includes(state.screen)) return;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        reviewerId: state.activeId, screen: state.screen, order: state.order,
        position: state.position, answers: state.answers, results: state.results,
        revealed: [...state.revealed], unknown: [...state.unknown], retry: state.retry, mode: state.mode
      }));
      sessionSaveWarningShown = false;
    } catch {
      if (!sessionSaveWarningShown) toast('Progress could not be saved because device storage is full.');
      sessionSaveWarningShown = true;
    }
  }
  function restoreSession() {
    try {
      const saved = JSON.parse(get(SESSION_KEY, 'null'));
      const reviewer = state.reviewers.find(item => item.id === saved?.reviewerId);
      const order = Array.isArray(saved?.order) ? saved.order.filter(i => Number.isInteger(i) && i >= 0 && i < (reviewer?.questions.length || 0)) : [];
      if (!reviewer || !order.length || !['study', 'retry-prompt', 'results'].includes(saved.screen)) return clearSession();
      state.activeId = reviewer.id; state.screen = saved.screen; state.order = order;
      state.position = Math.min(Math.max(0, Number(saved.position) || 0), order.length - 1);
      state.answers = saved.answers && typeof saved.answers === 'object' ? saved.answers : {};
      state.results = saved.results && typeof saved.results === 'object' ? saved.results : {};
      state.revealed = new Set(Array.isArray(saved.revealed) ? saved.revealed : []);
      state.unknown = new Set(Array.isArray(saved.unknown) ? saved.unknown : []);
      state.retry = Boolean(saved.retry); state.mode = saved.mode === 'practice' ? 'practice' : 'quiz';
    } catch { clearSession(); }
  }
  function currentReviewer() { return state.reviewers.find(x => x.id === state.activeId); }
  function clearHash() { if (location.hash) history.replaceState(null, '', location.pathname + location.search); }
  function setMobileNav(open) {
    const wasOpen = document.body.classList.contains('mobile-nav-open');
    document.body.classList.toggle('mobile-nav-open', open);
    $('#mobile-nav-toggle').setAttribute('aria-expanded', String(open));
    $('#mobile-nav-toggle').setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    $('#nav-scrim').hidden = !open;
    if (open) $('#new-reviewer').focus();
    else if (wasOpen && document.body.classList.contains('mobile-nav')) $('#mobile-nav-toggle').focus();
  }
  function renderLibrary() {
    const search = state.reviewerSearch.trim().toLocaleLowerCase();
    const reviewers = [...state.reviewers].sort((a, b) => {
      if (state.reviewerSort === 'az') return String(a.title || '').localeCompare(String(b.title || ''));
      if (state.reviewerSort === 'oldest') return (a.updatedAt || 0) - (b.updatedAt || 0);
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    }).filter(reviewer => !search || String(reviewer.title || '').toLocaleLowerCase().includes(search));
    $('#reviewer-list').innerHTML = reviewers.length ? reviewers.map(r => `<div class="reviewer-entry">
      <button class="reviewer-item ${r.id === state.activeId && !location.hash ? 'active' : ''}" data-reviewer="${esc(r.id)}" aria-current="${r.id === state.activeId && !location.hash ? 'page' : 'false'}">
        <svg class="ui-icon reviewer-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.75h7l4 4v12.5H7zM14 3.75v4h4M10 12h5M10 16h5"/></svg>
        <span class="reviewer-copy"><span class="reviewer-title">${esc(r.title)}</span></span>
      </button><button class="reviewer-delete" data-delete="${esc(r.id)}" aria-label="Delete ${esc(r.title)}" title="Delete reviewer">×</button>
    </div>`).join('') : `<p class="reviewer-empty">${search ? 'No matching reviewers' : 'No reviewers yet'}</p>`;
    $('#reviewer-list').querySelectorAll('[data-reviewer]').forEach(b => b.onclick = () => selectReviewer(b.dataset.reviewer));
    $('#reviewer-list').querySelectorAll('[data-delete]').forEach(b => b.onclick = () => deleteReviewer(b.dataset.delete));
    $('#prompt-link').classList.toggle('active', location.hash === '#prompt');
    $('#import-prompt-link').classList.toggle('active', location.hash === '#import-prompt');
  }
  function selectReviewer(id) {
    const selectedFromMobileNav = document.body.classList.contains('mobile-nav-open');
    setMobileNav(false);
    clearSession();
    clearHash(); state.activeId = id; state.screen = 'home'; state.order = [];
    render();
    if (selectedFromMobileNav) $('#start-quiz')?.focus();
  }
  function deleteReviewer(id) {
    const reviewer = state.reviewers.find(x => x.id === id);
    if (!reviewer || !confirm(`Delete "${reviewer.title}"?`)) return;
    state.reviewers = state.reviewers.filter(x => x.id !== id);
    if (state.activeId === id) { clearSession(); state.activeId = null; state.screen = 'home'; clearHash(); }
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
      <div class="welcome-actions"><button class="secondary-button" id="practice-quiz" ${reviewer.questions.length ? '' : 'disabled'}>Practice (no score)</button></div>
      <div class="welcome-actions"><button class="mini-control" id="edit-reviewer">Edit questions</button>
      <button class="mini-control" id="export-reviewer">Export</button></div></div></div>`;
    $('#start-quiz').onclick = () => startQuiz(false, 'quiz');
    $('#practice-quiz').onclick = () => startQuiz(false, 'practice');
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
  function startQuiz(shuffle = false, mode = 'quiz') {
    const reviewer = currentReviewer(); if (!reviewer?.questions.length) return;
    state.order = reviewer.questions.map((_, i) => i);
    if (shuffle) shuffleInPlace(state.order);
    state.position = 0; state.answers = {}; state.results = {}; state.revealed.clear(); state.unknown.clear();
    state.retry = false; state.mode = mode; state.screen = 'study'; clearSession(); render();
  }
  function shuffleInPlace(values) {
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1)); [values[i], values[j]] = [values[j], values[i]];
    }
  }
  function syncCurrentCard(answered) {
    const card = $('.question-index-card.current');
    if (!card) return;
    const id = state.order[state.position], question = currentReviewer().questions[id];
    card.classList.toggle('answered', answered);
    card.classList.remove('correct', 'incorrect');
    card.querySelector('.card-result')?.remove();
    const label = state.unknown.has(id) ? 'marked to review' : answered ? 'answered' : '';
    card.setAttribute('aria-label', `Question ${esc(question.sourceNumber)}${label ? `, ${label}` : ''}`);
    card.title = `Question ${esc(question.sourceNumber)}${label ? `: ${label}` : ''}`;
  }
  function renderQuestion(direction = '') {
    const reviewer = currentReviewer(), id = state.order[state.position], q = reviewer?.questions[id];
    if (!q) { state.screen = 'home'; return render(); }
    const revealed = state.revealed.has(id), selected = state.answers[id] || [];
    const deck = state.order.map((key, position) => {
      const item = reviewer.questions[key];
      const result = state.results[key];
      const status = result === true ? 'correct' : result === false ? 'incorrect' : state.unknown.has(key) ? 'unknown' : '';
      const label = result === true ? 'correct' : result === false ? 'incorrect' : state.unknown.has(key) ? 'marked to review' : '';
      return `<button class="question-index-card ${position === state.position ? 'current' : ''} ${status} ${state.answers[key]?.length ? 'answered' : ''}"
        data-jump="${position}" aria-current="${position === state.position ? 'step' : 'false'}" aria-label="Question ${esc(item.sourceNumber)}${label ? `, ${label}` : ''}" title="Question ${esc(item.sourceNumber)}${label ? `: ${label}` : ''}"><span>${esc(item.sourceNumber)}</span>${result === true ? '<small class="card-result">&#10003;</small>' : result === false ? '<small class="card-result">&#10005;</small>' : ''}</button>`;
    }).join('');
    let input;
    if (q.options.length) {
      const multi = q.correctAnswers.length > 1;
      input = `<div class="answer-list" role="group" aria-labelledby="question-prompt">${q.options.map((o, i) => {
        const checked = selected.includes(i);
        const graded = Object.hasOwn(state.results, id);
        const cls = revealed || graded ? (q.correctAnswers.includes(i) ? 'correct' : checked ? 'incorrect' : '') : checked ? 'selected' : '';
        return `<button class="answer-option ${cls}" data-option="${i}" aria-keyshortcuts="${i < 9 ? `${i + 1} ArrowUp ArrowDown` : 'ArrowUp ArrowDown'}" aria-pressed="${checked}">
          <span class="option-letter">${multi ? '□' : String.fromCharCode(65 + i)}</span><span>${esc(o)}</span></button>`;
      }).join('')}</div>`;
    } else {
      input = `<input class="short-answer" id="short-answer" type="text" autocomplete="off" aria-label="Your answer for question ${esc(q.sourceNumber)}" placeholder="Type your answer" value="${esc(selected[0] ?? '')}">`;
    }
    const knownAnswer = q.options.length ? q.correctAnswers.map(i => q.options[i]).join(', ') : q.answer;
    const graded = Object.hasOwn(state.results, id), answerIsCorrect = state.results[id] === true;
    const status = graded ? `<span class="feedback ${answerIsCorrect ? 'good' : 'bad'}">${answerIsCorrect ? 'Correct' : 'Incorrect — marked on the card above'}</span>` : '';
    const feedback = revealed ? (knownAnswer ? `<span class="feedback neutral">Answer: ${esc(knownAnswer)}</span>` : '<span class="feedback neutral">No answer key in this reviewer.</span>') : '';
    const selectionHint = q.correctAnswers.length > 1 ? '<p class="selection-hint">Select all that apply</p>' : '';
    const deckEl = $('.question-deck');
    const oldScroll = deckEl?.scrollLeft ?? null;
    const exhibits = [...new Set([...(q.images || []), ...(q.image ? [q.image] : [])])];
    $('#main-panel').innerHTML = `<div class="study-head"><div class="study-label"><span class="study-chip">${esc(reviewer.title)}</span>
      ${state.mode === 'practice' ? '<span class="study-chip practice-chip">Practice</span>' : ''}
      ${state.retry ? '<span class="study-chip retry-chip">Review later</span>' : ''}</div><div class="study-controls">
      <button class="mini-control" id="shuffle-questions">Shuffle cards</button><button class="mini-control" id="exit-quiz">Exit</button></div></div>
      <nav class="question-deck" aria-label="Question cards">${deck}</nav>
      <div class="progress-row"><div class="progress-track"><div class="progress-fill" style="width:${Math.round(state.position / state.order.length * 100)}%"></div></div>
      <span class="progress-copy">${state.position + 1} / ${state.order.length}</span></div>
      <p class="shortcut-hint">1–9 choose · ↑/↓ choices · ←/→ move · Enter next</p>
      <article class="question-card" tabindex="-1"><div class="question-card-top"><div class="question-number">${esc(q.sourceNumber)}</div><button type="button" class="copy-question-button" id="copy-question" aria-label="Copy question, choices, and exhibit">Copy all</button></div><div class="question-text" id="question-prompt">${esc(q.text)}</div>
      ${exhibits.map((image, i) => `<img class="question-image" src="${esc(image)}" alt="Exhibit ${i + 1}" loading="lazy">`).join('')}
      ${(q.imageRefs || []).map(ref => `<div class="missing-exhibit">Exhibit image not attached: ${esc(ref)}</div>`).join('')}</article>
      ${selectionHint}${input}<div class="question-footer"><div class="feedback-area" role="status">${status || feedback}</div>
      <div class="nav-buttons"><button class="secondary-button" id="show-answer">Show answer</button>
      <button class="secondary-button" id="dont-know">I don't know</button>
      <button class="secondary-button" id="prev-question" aria-keyshortcuts="ArrowLeft" ${state.position ? '' : 'disabled'}>Back</button>
      <button class="primary-button" id="next-question" aria-keyshortcuts="Enter ArrowRight">${state.position === state.order.length - 1 ? 'Finish' : 'Next'}</button></div></div>`;
    if (direction && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const offset = direction === 'next' ? 9 : -9;
      $('#main-panel').querySelectorAll('.question-card,.answer-list,.short-answer').forEach((element, index) => {
        const enter = element.animate([
          { opacity: 0, transform: `translateX(${offset}px)` },
          { opacity: 1, transform: 'translateX(0)' }
        ], { duration: 220, delay: index * 30, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'both' });
        enter.onfinish = () => enter.cancel();
      });
    }
    if (direction) $('.question-card').focus({preventScroll:true});
    if (oldScroll !== null) $('.question-deck').scrollLeft = oldScroll;
    $('.question-index-card.current')?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
    $('#main-panel').querySelectorAll('[data-option]').forEach(b => b.onclick = () => {
      const option = Number(b.dataset.option), multi = q.correctAnswers.length > 1;
      const current = state.answers[id] || [];
      const answer = multi ? (current.includes(option) ? current.filter(x => x !== option) : [...current, option]) : [option];
      state.answers[id] = answer;
      delete state.results[id]; state.revealed.delete(id);
      $('#main-panel').querySelectorAll('[data-option]').forEach(choice => {
        const isSelected = answer.includes(Number(choice.dataset.option));
        choice.classList.remove('correct', 'incorrect');
        choice.classList.toggle('selected', isSelected);
        choice.setAttribute('aria-pressed', String(isSelected));
      });
      const feedbackArea = $('.feedback-area'); if (feedbackArea) feedbackArea.textContent = '';
      syncCurrentCard(answer.length > 0);
      saveSession();
    });
    $('#short-answer')?.addEventListener('input', e => {
      state.answers[id] = e.target.value ? [e.target.value] : [];
      state.revealed.delete(id);
      delete state.results[id];
      const feedbackArea = $('.feedback-area'); if (feedbackArea) feedbackArea.textContent = '';
      syncCurrentCard(state.answers[id].length > 0);
      saveSession();
    });
    $('#show-answer').onclick = () => { state.revealed.add(id); renderQuestion(); };
    $('#copy-question').onclick = async () => {
      const copyText = [`Question ${q.sourceNumber}`, q.text, ...q.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`)].join('\n');
      const images = [...new Set([...(q.images || []), ...(q.image ? [q.image] : [])])].filter(source => /^data:image\//i.test(source));
      try {
        if (images.length && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
          const response = await fetch(images[0]);
          const blob = await response.blob();
          await navigator.clipboard.write([new ClipboardItem({'text/plain': new Blob([copyText], {type:'text/plain'}), [blob.type]:blob})]);
          toast('Question and exhibit copied.');
        } else {
          if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(copyText);
          else { const field = document.createElement('textarea'); field.value = copyText; field.style.position='fixed'; field.style.opacity='0'; document.body.append(field); field.select(); const copied=document.execCommand('copy'); field.remove(); if (!copied) throw new Error('Clipboard unavailable'); }
          toast(images.length ? 'Question and choices copied. Exhibit image could not be copied here.' : 'Question and choices copied.');
        }
      } catch {
        toast('Could not copy automatically. Check clipboard permissions.');
      }
    };
    $('#dont-know').onclick = () => advance(true);
    $('#prev-question').onclick = () => { state.position--; renderQuestion('previous'); };
    $('#next-question').onclick = () => advance(false);
    $('#main-panel').querySelectorAll('[data-jump]').forEach(b => b.onclick = () => {
      const target = Number(b.dataset.jump), direction = target > state.position ? 'next' : 'previous';
      state.position = target; renderQuestion(direction);
    });
    $('#exit-quiz').onclick = () => { clearSession(); state.screen = 'home'; render(); };
    $('#shuffle-questions').onclick = () => {
      const currentId = state.order[state.position]; shuffleInPlace(state.order);
      state.position = state.order.indexOf(currentId); renderQuestion();
    };
    saveSession();
  }
  function advance(dontKnow) {
    const id = state.order[state.position];
    const question = currentReviewer().questions[id];
    const answer = state.answers[id] || [];
    if (dontKnow) {
      state.unknown.add(id);
      delete state.results[id];
    } else if (state.mode === 'practice') {
      if (answer.length) state.unknown.delete(id);
      else if (state.revealed.has(id)) state.unknown.add(id);
    } else if (answer.length && (question.correctAnswers.length || question.answer)) {
      state.results[id] = RevCore.isCorrect(question, answer);
      showAnswerResult(state.results[id]);
      if (state.results[id]) state.unknown.delete(id);
      else if (state.retry) state.unknown.add(id);
    } else if (state.revealed.has(id) && !answer.length) {
      delete state.results[id];
      state.unknown.add(id);
    } else if (answer.length) {
      delete state.results[id];
      state.unknown.delete(id);
    }
    if (state.position < state.order.length - 1) { state.position++; renderQuestion('next'); return; }
    state.screen = state.unknown.size ? 'retry-prompt' : 'results'; render();
  }
  function renderRetryPrompt() {
    saveSession();
    const count = state.unknown.size;
    $('#main-panel').innerHTML = `<div class="welcome"><div class="welcome-inner"><h2>${count} card${count === 1 ? '' : 's'} to review later</h2>
      <div class="welcome-actions"><button class="primary-button" id="retry-unknown">Review these cards</button>
      <button class="secondary-button" id="finish-now">Finish for now</button></div></div></div>`;
    $('#retry-unknown').onclick = () => {
      state.order = [...state.unknown].sort((a, b) => a - b);
      state.position = 0; state.retry = true; state.screen = 'study'; renderQuestion('next');
    };
    $('#finish-now').onclick = () => { state.screen = 'results'; render(); };
  }
  function renderResults() {
    saveSession();
    const reviewer = currentReviewer();
    const keyed = reviewer.questions.filter(q => q.correctAnswers.length || q.answer);
    const score = reviewer.questions.filter((q, i) => (q.correctAnswers.length || q.answer) && RevCore.isCorrect(q, state.answers[i])).length;
    const outcomes = reviewer.questions.map((q, i) => {
      const hasKey = q.correctAnswers.length || q.answer;
      const correct = hasKey && RevCore.isCorrect(q, state.answers[i]);
      const status = state.unknown.has(i) ? 'I don\'t know'
        : state.mode === 'practice' ? (state.answers[i]?.length || state.revealed.has(i) ? 'Practiced' : 'Not practiced')
          : !hasKey ? 'No key' : correct ? 'Correct' : state.answers[i]?.length ? 'Incorrect' : 'Not answered';
      const missed = state.mode === 'practice' ? state.unknown.has(i) : state.unknown.has(i) || (hasKey && !correct);
      const tone = status === 'Correct' ? 'correct' : status === 'Incorrect' ? 'incorrect'
        : status === 'I don\'t know' || status === 'Not answered' ? 'unknown' : 'neutral';
      return {q, i, status, tone, missed};
    });
    const missed = outcomes.filter(result => result.missed);
    const summary = `<section class="missed-summary"><div class="missed-summary-head"><div><h3>${state.mode === 'practice' ? 'Cards to revisit' : 'Missed questions'}</h3>
      <p>${missed.length ? `${missed.length} card${missed.length === 1 ? '' : 's'} ready to review` : 'You are all caught up.'}</p></div><span class="missed-count">${missed.length}</span></div>
      ${missed.length ? `<div class="missed-items">${missed.map(({q, i, status, tone}) => `<button class="missed-item status-${tone}" data-result-jump="${i}">
        <span class="missed-item-number">${esc(q.sourceNumber)}</span><span class="missed-item-text">${esc(q.text)}</span><span class="result-status">${status}</span></button>`).join('')}</div>` : ''}
      ${missed.length ? `<button class="primary-button" id="review-missed">Review missed cards</button>` : ''}</section>`;
    const completion = state.mode === 'practice'
      ? `<p class="result-sub">Practice complete · ${reviewer.questions.length} cards</p>`
      : `<div class="result-score">${score}<span class="score-total"> / ${keyed.length}</span></div>
        <p class="result-sub">${keyed.length < reviewer.questions.length ? `${keyed.length} scored · ${reviewer.questions.length - keyed.length} without an answer key` : `${reviewer.questions.length} questions`}</p>`;
    $('#main-panel').innerHTML = `<div class="result-view"><div><h2 class="result-title">${state.mode === 'practice' ? 'Practice complete' : 'Review complete'}</h2>
      ${completion}${summary}
      <div class="result-actions"><button class="secondary-button" id="back-to-reviewer">Done</button>
      <button class="primary-button" id="retry-quiz">${state.mode === 'practice' ? 'Practice again' : 'Review again'}</button></div>
      <div class="review-list">${outcomes.map(({q, i, status, tone}) => `<button class="review-row result-jump status-${tone}" data-result-jump="${i}">
      <span>${esc(q.sourceNumber)}. ${esc(q.text.slice(0, 100))}</span><span class="result-status">${status}</span></button>`).join('')}</div></div></div>`;
    $('#back-to-reviewer').onclick = () => { clearSession(); state.screen = 'home'; render(); };
    $('#retry-quiz').onclick = () => startQuiz(false, state.mode);
    $('#review-missed')?.addEventListener('click', () => {
      state.order = missed.map(result => result.i); state.position = 0;
      state.unknown = new Set(state.order); state.retry = true; state.screen = 'study'; renderQuestion('next');
    });
    $('#main-panel').querySelectorAll('[data-result-jump]').forEach(b => b.onclick = () => {
      state.order = reviewer.questions.map((_, i) => i); state.position = Number(b.dataset.resultJump);
      state.retry = false; state.screen = 'study'; renderQuestion('next');
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
        : q.answer ? `Answer: ${q.answer}${(q.acceptedAnswers || []).length ? `\nAlso accepted: ${q.acceptedAnswers.join(' | ')}` : ''}` : ''}${refs.map(image => `\nExhibit: ${image}`).join('')}`;
    }).join('\n\n');
  }
  function exportReviewer(reviewer) {
    const blob = new Blob([JSON.stringify(reviewer, null, 2)], {type:'application/json'});
    const a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = (reviewer.title.replace(/[^a-z0-9-_]+/gi, '-').slice(0, 60) || 'reviewer') + '.json';
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportLibraryBackup() {
    const payload = {format:'rev-backup-v1',exportedAt:new Date().toISOString(),reviewers:state.reviewers};
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    const a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = `rev-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`${state.reviewers.length} reviewer${state.reviewers.length === 1 ? '' : 's'} backed up.`);
  }
  async function restoreLibraryBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      const source = Array.isArray(data) ? data : Array.isArray(data?.reviewers) ? data.reviewers : data?.questions ? [data] : null;
      if (!source?.length || source.some(item => !item || !Array.isArray(item.questions) || !item.questions.length ||
        item.questions.some(question => !question || typeof question !== 'object' || !String(question.text || '').trim()))) {
        throw new Error('This file does not contain a Rev reviewer backup.');
      }
      if (!confirm(`Restore ${source.length} reviewer${source.length === 1 ? '' : 's'}? Reviewers with matching IDs will be updated; other reviewers stay here.`)) return;
      const restored = source.map(item => ({
        ...item, id:String(item.id || crypto.randomUUID()), title:String(item.title || 'Imported reviewer').slice(0,70),
        questions:item.questions.map(RevCore.normalizeQuestion), updatedAt:Number(item.updatedAt) || Date.now()
      }));
      const previous = state.reviewers, merged = [...previous];
      for (const reviewer of restored) {
        const at = merged.findIndex(item => item.id === reviewer.id);
        if (at >= 0) merged[at] = reviewer; else merged.push(reviewer);
      }
      state.reviewers = merged;
      if (!saveReviewers()) { state.reviewers = previous; return; }
      clearSession();
      state.screen = 'home'; state.order = []; state.position = 0; state.answers = {}; state.results = {};
      state.revealed.clear(); state.unknown.clear(); state.retry = false;
      if (!state.activeId || !state.reviewers.some(item => item.id === state.activeId)) state.activeId = restored[0].id;
      render(); toast(`Restored ${restored.length} reviewer${restored.length === 1 ? '' : 's'}.`);
    } catch (error) { toast(error.message || 'Could not restore this backup.'); }
    finally { $('#backup-file').value = ''; }
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
      clearSession();
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
  function installKeyboardShortcuts() {
    document.addEventListener('keydown', event => {
      if (event.key === 'Tab' && document.body.classList.contains('mobile-nav-open')) {
        const items = [...$('#sidebar').querySelectorAll('button:not(:disabled),a[href],input:not([hidden]),select')]
          .filter(item => item.getClientRects().length);
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        return;
      }
      if (event.key === 'Escape' && document.body.classList.contains('mobile-nav-open')) {
        setMobileNav(false); return;
      }
      if (document.body.classList.contains('mobile-nav-open')) return;
      if (state.screen !== 'study' || $('#import-dialog').open || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target.matches('input,textarea,select,[contenteditable="true"]')) {
        if (event.key === 'Enter' && target.id === 'short-answer') { event.preventDefault(); $('#next-question')?.click(); }
        return;
      }
      const optionButtons = [...$('#main-panel').querySelectorAll('[data-option]')];
      if (/^[1-9]$/.test(event.key) && Number(event.key) <= optionButtons.length) {
        event.preventDefault(); optionButtons[Number(event.key) - 1].click(); return;
      }
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && target.matches('[data-option]')) {
        event.preventDefault();
        const index = optionButtons.indexOf(target), direction = event.key === 'ArrowDown' ? 1 : -1;
        optionButtons[(index + direction + optionButtons.length) % optionButtons.length]?.focus(); return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault(); $('#prev-question')?.click(); return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault(); $('#next-question')?.click(); return;
      }
      if (event.key === 'Enter' && target.matches('[data-option]') && target.getAttribute('aria-pressed') === 'true') {
        event.preventDefault(); $('#next-question')?.click(); return;
      }
      if (event.key === 'Enter' && !target.closest('button,a')) {
        event.preventDefault(); $('#next-question')?.click();
      }
    });
  }
  function initialize() {
    load();
    const mobileLayout = window.matchMedia('(max-width:760px)');
    const applySidebarLayout = () => {
      document.body.classList.toggle('mobile-nav', mobileLayout.matches);
      document.body.classList.toggle('sidebar-collapsed', !mobileLayout.matches && get('rev-sidebar-open') === 'false');
      if (!mobileLayout.matches) setMobileNav(false);
    };
    applySidebarLayout();
    mobileLayout.addEventListener?.('change', applySidebarLayout);
    document.body.classList.toggle('dark', get('rev-theme') === 'dark');
    const setThemeAppearance = dark => {
      $('#theme-state').textContent = dark ? 'Dark' : 'Light';
      $('#theme-icon').innerHTML = dark
        ? '<path d="M20.2 15.1A8.4 8.4 0 0 1 8.9 3.8 8.5 8.5 0 1 0 20.2 15.1Z"/>'
        : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>';
      $('#theme-toggle').setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
    };
    setThemeAppearance(document.body.classList.contains('dark'));
    $('#sidebar-toggle').onclick = () => {
      const collapsed = document.body.classList.toggle('sidebar-collapsed');
      put('rev-sidebar-open', String(!collapsed));
      $('#sidebar-toggle').setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation');
    };
    $('#mobile-nav-toggle').onclick = () => setMobileNav(!document.body.classList.contains('mobile-nav-open'));
    $('#nav-scrim').onclick = () => setMobileNav(false);
    $('#theme-toggle').onclick = () => {
      const dark = document.body.classList.toggle('dark');
      put('rev-theme', dark ? 'dark' : 'light'); setThemeAppearance(dark);
    };
    $('#new-reviewer').onclick = () => { setMobileNav(false); openImport(); };
    $('#import-trigger').onclick = () => { setMobileNav(false); openImport(); };
    $('#prompt-link').addEventListener('click', () => setMobileNav(false));
    $('#import-prompt-link').addEventListener('click', () => setMobileNav(false));
    $('#reviewer-search').oninput = event => { state.reviewerSearch = event.target.value; renderLibrary(); };
    $('#reviewer-sort').onchange = event => { state.reviewerSort = event.target.value; renderLibrary(); };
    $('#backup-library').onclick = exportLibraryBackup;
    $('#restore-library').onclick = () => { setMobileNav(false); $('#backup-file').click(); };
    $('#backup-file').onchange = event => { if (event.target.files[0]) restoreLibraryBackup(event.target.files[0]); };
    $('#cancel-import').onclick = () => $('#import-dialog').close();
    document.querySelectorAll('.import-tab').forEach(b => b.onclick = () => showImportTab(b.dataset.tab));
    $('#file-input').onchange = e => {
      state.selectedFiles = [...e.target.files];
      $('#file-status').textContent = state.selectedFiles.map(x => x.name).join(', ') || 'PDF text is extracted locally. Attach image files and reference them with Exhibit: filename.png.';
      feedback('');
    };
    $('#import-submit').onclick = submitImport;
    window.addEventListener('hashchange', render);
    window.addEventListener('pagehide', saveSession);
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveSession(); });
    installKeyboardShortcuts();
    render();
  }
  initialize();
})();
