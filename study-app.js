(() => {
  'use strict';
  const auth = window.RevAuthClient || null;
  const accountsConfigured = Boolean(auth);
  const KEY = 'recall-reviewers-v1';
  const SESSION_KEY = 'rev-quiz-session-v1';
  const SEED_KEY = 'rev-starter-seeded-v1';
  const FLAGS_KEY = 'rev-flags-v1';
  const HISTORY_KEY = 'rev-question-history-v1';
  const scopedKey = key => state.user ? `${key}:user:${state.user.id}` : key;
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

For any question that refers to a picture, diagram, topology, screenshot, or exhibit, keep its reference and add a line inside the question block: Exhibit: exact-image-filename.png. Preserve filenames exactly and attach each image only to the question that refers to it. Never replace an exhibit with a description or invent one. If an exhibit file is not available, write Exhibit: missing. If the image is available, add an Alt text: line that briefly describes what is visible. Do not invent details you cannot see.

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
  let pdfLoad = null;
  const $ = (s, root = document) => root.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const get = (key, fallback = null) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
  const put = (key, value) => { try { localStorage.setItem(key, value); return true; } catch { toast('Could not save on this device. Export a backup.'); return false; } };
  const state = {
    reviewers: [], user: null, activeId: null, screen: 'home', order: [], sessionIds: [], position: 0, mode: 'quiz',
    answers: {}, results: {}, revealed: new Set(), unknown: new Set(), retry: false,
    flags: {}, history: {}, sourceText: '', selectedFiles: [], importBusy: false, importPreview: null,
    reviewerSearch: '', reviewerSort: 'recent'
  };
  function toast(message) {
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = message;
    el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
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
    state.reviewers = [];
    try { state.flags = JSON.parse(get(scopedKey(FLAGS_KEY), '{}')) || {}; } catch { state.flags = {}; }
    try { state.history = JSON.parse(get(scopedKey(HISTORY_KEY), '{}')) || {}; } catch { state.history = {}; }
    try {
      const saved = JSON.parse(get(scopedKey(KEY), '[]'));
      if (Array.isArray(saved)) state.reviewers = saved.filter(x => x && Array.isArray(x.questions))
        .map(x => ({...x, questions: x.questions.map(RevCore.normalizeQuestion)}));
    } catch { state.reviewers = []; }
    const starter = window.RECALL_STARTER_REVIEWER;
    if (starter?.questions && window.REV_EXHIBIT_ALTS) for (const question of starter.questions) {
      const description = window.REV_EXHIBIT_ALTS[String(question.sourceNumber)];
      if (description && (question.images?.length || question.image)) question.imageAlts = [description];
    }
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
      if (reviewer.id === 'reviewer-s2-it0015' && window.REV_EXHIBIT_ALTS) {
        const description = window.REV_EXHIBIT_ALTS[String(question.sourceNumber)];
        if (description && (question.images?.length || question.image) && question.imageAlts?.[0] !== description) {
          question.imageAlts = [description]; addedExhibits = true;
        }
      }
      if (question.images?.length || question.image) continue;
      const source = starter?.questions.find(item => RevCore.normalize(item.text) === RevCore.normalize(question.text));
      if (source?.images?.length) { question.images = [...source.images]; if (source.imageAlts?.length) question.imageAlts = [...source.imageAlts]; addedExhibits = true; }
    }
    if (addedExhibits) saveReviewers();
    if (!get(scopedKey(SEED_KEY)) && get(scopedKey(KEY)) === null && window.RECALL_STARTER_REVIEWER) {
      state.reviewers = [{...starter, id: starter.id || crypto.randomUUID(),
        questions: starter.questions.map(RevCore.normalizeQuestion)}];
      saveReviewers(); put(scopedKey(SEED_KEY), '1');
    }
    restoreSession();
  }
  function saveReviewers() { return put(scopedKey(KEY), JSON.stringify(state.reviewers)); }
  function clearSession() { try { localStorage.removeItem(scopedKey(SESSION_KEY)); } catch {} }
  function saveSession() {
    if (!currentReviewer() || !['study', 'retry-prompt', 'results'].includes(state.screen)) return;
    try {
      localStorage.setItem(scopedKey(SESSION_KEY), JSON.stringify({
        reviewerId: state.activeId, screen: state.screen, order: state.order, sessionIds: state.sessionIds,
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
      const saved = JSON.parse(get(scopedKey(SESSION_KEY), 'null'));
      const reviewer = state.reviewers.find(item => item.id === saved?.reviewerId);
      const order = Array.isArray(saved?.order) ? saved.order.filter(i => Number.isInteger(i) && i >= 0 && i < (reviewer?.questions.length || 0)) : [];
      if (!reviewer || !order.length || !['study', 'retry-prompt', 'results'].includes(saved.screen)) return clearSession();
      state.activeId = reviewer.id; state.screen = saved.screen; state.order = order;
      state.sessionIds = Array.isArray(saved.sessionIds) ? saved.sessionIds.filter(i => Number.isInteger(i) && i >= 0 && i < reviewer.questions.length) : [...order];
      state.position = Math.min(Math.max(0, Number(saved.position) || 0), order.length - 1);
      state.answers = saved.answers && typeof saved.answers === 'object' ? saved.answers : {};
      state.results = saved.results && typeof saved.results === 'object' ? saved.results : {};
      state.revealed = new Set(Array.isArray(saved.revealed) ? saved.revealed : []);
      state.unknown = new Set(Array.isArray(saved.unknown) ? saved.unknown : []);
      state.retry = Boolean(saved.retry); state.mode = saved.mode === 'practice' ? 'practice' : 'quiz';
    } catch { clearSession(); }
  }
  function currentReviewer() { return state.reviewers.find(x => x.id === state.activeId); }
  const questionKey = question => RevCore.normalize(question.text);
  function isFlagged(question) { return Boolean(state.flags[state.activeId]?.includes(questionKey(question))); }
  function toggleFlag(question) {
    const key = questionKey(question), flags = new Set(state.flags[state.activeId] || []);
    if (flags.has(key)) flags.delete(key); else flags.add(key);
    state.flags[state.activeId] = [...flags];
    put(scopedKey(FLAGS_KEY), JSON.stringify(state.flags));
    renderQuestion();
  }
  function recordHistory(question, status) {
    const history = state.history[state.activeId] || {};
    history[questionKey(question)] = status;
    state.history[state.activeId] = history;
    put(scopedKey(HISTORY_KEY), JSON.stringify(state.history));
  }
  function filteredQuestionIds(reviewer, filter) {
    const history = state.history[reviewer.id] || {};
    return reviewer.questions.map((question, index) => ({question, index})).filter(({question}) => {
      const status = history[questionKey(question)];
      if (filter === 'flagged') return Boolean(state.flags[reviewer.id]?.includes(questionKey(question)));
      if (filter === 'unanswered') return !status || status === 'unanswered';
      return filter === 'all' || status === filter;
    }).map(({index}) => index);
  }
  function switchAccount(user) {
    if (state.user?.id === user?.id) return;
    saveSession();
    state.user = user || null;
    state.activeId = null; state.screen = 'home'; state.order = []; state.sessionIds = []; state.position = 0;
    state.answers = {}; state.results = {}; state.revealed.clear(); state.unknown.clear();
    state.retry = false; clearHash(); load();
    $('#account-label').textContent = user?.email || 'Sign in';
    $('#account-button').setAttribute('aria-label', user ? `Account: ${user.email}` : 'Sign in or create an account');
    $('#account-signout').hidden = !user;
    render();
  }
  function showAccountDialog(mode = 'signin') {
    const dialog = $('#account-dialog');
    $('#account-form').reset();
    $('#account-feedback').textContent = accountsConfigured ? '' : 'Add Supabase settings to enable accounts.';
    $('#account-feedback').classList.toggle('error', !accountsConfigured);
    $('#account-submit').disabled = !accountsConfigured;
    $('#account-email').disabled = !accountsConfigured;
    $('#account-password').disabled = !accountsConfigured;
    $('#account-guest').hidden = Boolean(state.user);
    setAccountMode(mode);
    dialog.showModal();
    if (accountsConfigured && !window.matchMedia('(max-width:760px)').matches) $('#account-email').focus();
  }
  function setAccountMode(mode) {
    const signup = mode === 'signup';
    $('#account-dialog').dataset.mode = mode;
    $('#account-heading').textContent = signup ? 'Create account' : 'Sign in';
    $('#account-submit').textContent = signup ? 'Create account' : 'Sign in';
    $('#account-switch').textContent = signup ? 'Already have an account? Sign in' : 'New to Rev? Create an account';
    $('#account-password').autocomplete = signup ? 'new-password' : 'current-password';
    $('#account-consent-row').hidden = !signup;
    $('#account-consent').required = signup;
    $('#account-feedback').textContent = accountsConfigured ? '' : 'Add Supabase settings to enable accounts.';
    $('#account-feedback').classList.toggle('error', !accountsConfigured);
  }
  async function submitAccount(event) {
    event.preventDefault();
    if (!auth) return;
    const email = $('#account-email').value.trim();
    const password = $('#account-password').value;
    const submit = $('#account-submit');
    const feedback = $('#account-feedback');
    submit.disabled = true; feedback.textContent = ''; feedback.classList.remove('error');
    try {
      const signup = $('#account-dialog').dataset.mode === 'signup';
      const result = signup
        ? await auth.auth.signUp({email, password, options:{emailRedirectTo:location.origin, data:{terms_version:'2026-10-01', terms_accepted_at:new Date().toISOString()}}})
        : await auth.auth.signInWithPassword({email, password});
      if (result.error) throw result.error;
      if (result.data.session?.user) {
        switchAccount(result.data.session.user);
        $('#account-dialog').close();
        toast(signup ? 'Account created.' : 'Signed in.');
      } else {
        feedback.textContent = 'Check your email to confirm your account, then sign in.';
        $('#account-password').value = '';
      }
    } catch (error) {
      feedback.textContent = error.message || 'Could not access your account.';
      feedback.classList.add('error');
    } finally { submit.disabled = false; }
  }
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
    $('#data-link').classList.toggle('active', location.hash === '#data');
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
    delete state.flags[id]; delete state.history[id];
    put(scopedKey(FLAGS_KEY), JSON.stringify(state.flags));
    put(scopedKey(HISTORY_KEY), JSON.stringify(state.history));
    if (state.activeId === id) { clearSession(); state.activeId = null; state.screen = 'home'; clearHash(); }
    saveReviewers(); render();
  }
  function render() {
    const prompt = location.hash === '#prompt' || location.hash === '#import-prompt';
    const easterEgg = location.hash === '#easter-egg';
    const dataScreen = location.hash === '#data';
    const studying = ['study', 'retry-prompt', 'results'].includes(state.screen) && !prompt && !easterEgg && !dataScreen;
    document.body.classList.toggle('is-studying', studying);
    document.body.classList.toggle('prompt-open', prompt);
    document.body.classList.toggle('easter-egg-open', easterEgg);
    $('#intro').hidden = prompt || studying || dataScreen || !!currentReviewer();
    renderLibrary();
    if (easterEgg) return renderEasterEgg();
    if (prompt) return renderPrompt(location.hash === '#import-prompt');
    if (dataScreen) return renderDataSettings();
    const reviewer = currentReviewer();
    if (!reviewer) {
      $('#main-panel').innerHTML = '<div class="welcome"><button class="primary-button" id="welcome-import">Add reviewer</button></div>';
      $('#welcome-import').onclick = () => openImport(); return;
    }
    if (state.screen === 'study') return renderQuestion();
    if (state.screen === 'retry-prompt') return renderRetryPrompt();
    if (state.screen === 'results') return renderResults();
    const filters = [['all','All questions'],['incorrect','Incorrect'],['unanswered','Unanswered'],['unknown',"I don't know"],['flagged','Flagged']];
    $('#main-panel').innerHTML = `<div class="welcome"><div class="welcome-inner"><h2>${esc(reviewer.title)}</h2>
      <p>${reviewer.questions.length} questions</p>
      <label class="field-label study-filter-label" for="study-filter">Study</label><select id="study-filter" class="study-filter">${filters.map(([value,label]) => `<option value="${value}">${label} (${filteredQuestionIds(reviewer,value).length})</option>`).join('')}</select>
      <button class="primary-button" id="start-quiz" ${reviewer.questions.length ? '' : 'disabled'}>Start reviewing</button>
      <div class="welcome-actions"><button class="secondary-button" id="practice-quiz" ${reviewer.questions.length ? '' : 'disabled'}>Practice (no score)</button></div>
      <div class="welcome-actions"><button class="mini-control" id="edit-reviewer">Edit questions</button>
      <button class="mini-control" id="export-reviewer">Export</button></div></div></div>`;
    $('#start-quiz').onclick = () => startQuiz(false, 'quiz', $('#study-filter').value);
    $('#practice-quiz').onclick = () => startQuiz(false, 'practice', $('#study-filter').value);
    $('#edit-reviewer').onclick = () => openImport(reviewer);
    $('#export-reviewer').onclick = () => exportReviewer(reviewer);
  }
  function renderEasterEgg() {
    $('#intro').hidden = true;
    $('#main-panel').innerHTML = `<section class="easter-egg-page"><p>09655236422 - alam nyo na gagawin</p><button class="secondary-button" id="egg-back">Back to reviewer</button></section>`;
    $('#egg-back').onclick = () => { clearHash(); render(); };
  }
  function removeLocalStudyData() {
    const prefixes = [KEY, SESSION_KEY, SEED_KEY, FLAGS_KEY, HISTORY_KEY, MASTER_KEY, IMPORT_KEY, 'rev-theme', 'rev-sidebar-open'];
    try {
      for (const key of Object.keys(localStorage)) if (prefixes.some(prefix => key === prefix || key.startsWith(`${prefix}:user:`))) localStorage.removeItem(key);
      localStorage.setItem(KEY, '[]'); localStorage.setItem(SEED_KEY, '1');
      if (state.user) { localStorage.setItem(scopedKey(KEY), '[]'); localStorage.setItem(scopedKey(SEED_KEY), '1'); }
    } catch { toast('Some browser data could not be removed. Check browser site storage.'); }
    state.reviewers = []; state.flags = {}; state.history = {}; state.activeId = null;
    state.screen = 'home'; state.order = []; state.sessionIds = []; state.position = 0;
    state.answers = {}; state.results = {}; state.revealed.clear(); state.unknown.clear();
    state.retry = false; clearHash(); render();
  }
  function renderDataSettings() {
    saveSession();
    $('#main-panel').innerHTML = `<section class="data-page"><h1>Data &amp; deletion</h1>
      <p>Reviewers, exhibits, study progress, flags, and prompts are stored on this device. Accounts do not sync reviewers between devices yet.</p>
      <div class="data-card"><h2>Back up your reviewers</h2><p>Download a copy before deleting or moving devices.</p><button class="secondary-button" id="data-backup">Download backup</button></div>
      <div class="data-card"><h2>Delete study data on this device</h2><p>Removes all Rev reviewers, answers, progress, flags, prompts, and preferences stored in this browser. Exported backup files are unaffected. Your Supabase account remains active.</p><button class="danger-button" id="delete-local-data">Delete local study data</button></div>
      ${state.user ? `<div class="data-card"><h2>Delete account</h2><p>Permanently removes the signed-in Supabase account and local Rev study data on this device. This requires the hosted deletion service.</p><button class="danger-button" id="delete-account">Delete account</button></div>` : ''}
      <p><a href="privacy.html">Privacy Policy</a> · <a href="terms.html">Terms</a> · <a href="cookies.html">Cookie Policy</a></p>
      <button class="secondary-button" id="data-back">Back to reviewer</button><p class="import-feedback" id="data-feedback" role="status" aria-live="polite"></p></section>`;
    $('#data-backup').onclick = exportLibraryBackup;
    $('#data-back').onclick = () => { clearHash(); render(); };
    $('#delete-local-data').onclick = () => {
      if (!confirm('Delete all Rev study data stored in this browser? Export a backup first if you want to keep it.')) return;
      removeLocalStudyData(); toast('Local study data deleted.');
    };
    $('#delete-account')?.addEventListener('click', async () => {
      if (prompt('Type DELETE to permanently remove this account and local study data.') !== 'DELETE') return;
      const button = $('#delete-account'), status = $('#data-feedback');
      button.disabled = true; status.textContent = 'Deleting account…';
      try {
        const {data, error} = await auth.auth.getSession();
        if (error || !data.session?.access_token) throw new Error('Sign in again, then retry account deletion.');
        const response = await fetch('/api/delete-account', {method:'POST', headers:{Authorization:`Bearer ${data.session.access_token}`}});
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Account deletion is unavailable on this deployment.');
        await auth.auth.signOut().catch(() => {});
        state.user = null; removeLocalStudyData();
        $('#account-label').textContent = 'Sign in'; $('#account-signout').hidden = true;
        toast('Account and local study data deleted.');
      } catch (error) { status.textContent = error.message || 'Could not delete account.'; button.disabled = false; }
    });
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
  function startQuiz(shuffle = false, mode = 'quiz', filter = 'all') {
    const reviewer = currentReviewer(); if (!reviewer?.questions.length) return;
    state.order = filteredQuestionIds(reviewer, filter);
    if (!state.order.length) return toast('No questions match this filter. Choose another study set.');
    state.sessionIds = [...state.order];
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
    card.setAttribute('aria-label', `Question ${question.sourceNumber}${label ? `, ${label}` : ''}${isFlagged(question) ? ', flagged' : ''}`);
    card.title = `Question ${question.sourceNumber}${label ? `: ${label}` : ''}${isFlagged(question) ? ', flagged' : ''}`;
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
      const flagged = isFlagged(item);
      return `<button class="question-index-card ${position === state.position ? 'current' : ''} ${status} ${flagged ? 'flagged' : ''} ${state.answers[key]?.length ? 'answered' : ''}"
        data-jump="${position}" aria-current="${position === state.position ? 'step' : 'false'}" aria-label="Question ${esc(item.sourceNumber)}${label ? `, ${label}` : ''}${flagged ? ', flagged' : ''}" title="Question ${esc(item.sourceNumber)}${label ? `: ${label}` : ''}${flagged ? ', flagged' : ''}"><span>${esc(item.sourceNumber)}</span>${result === true ? '<small class="card-result">&#10003;</small>' : result === false ? '<small class="card-result">&#10005;</small>' : ''}</button>`;
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
      <article class="question-card" tabindex="-1"><div class="question-card-top"><div class="question-number">${esc(q.sourceNumber)}</div><div class="question-card-actions"><button type="button" class="copy-question-button flag-question-button ${isFlagged(q) ? 'is-flagged' : ''}" id="flag-question" aria-pressed="${isFlagged(q)}">${isFlagged(q) ? 'Flagged' : 'Flag for later'}</button><button type="button" class="copy-question-button" id="copy-question" aria-label="Copy question, choices, and exhibits">Copy all</button>${exhibits.length ? '<button type="button" class="copy-question-button" id="download-exhibits">Download exhibits</button>' : ''}</div></div><div class="question-text" id="question-prompt">${esc(q.text)}</div>
      ${exhibits.map((image, i) => `<img class="question-image" src="${esc(image)}" alt="${esc(q.imageAlts?.[i] || `Exhibit ${i + 1} for question ${q.sourceNumber}. Description not provided.`)}" decoding="async">`).join('')}
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
    $('#flag-question').onclick = () => toggleFlag(q);
    $('#copy-question').onclick = async () => {
      const copyText = [`Question ${q.sourceNumber}`, q.text, ...q.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`),
        ...exhibits.map((_, index) => `Exhibit ${index + 1}: attached image`), ...(q.imageRefs || []).map(ref => `Exhibit: ${ref} (not attached)`)].join('\n');
      const copyHtml = `<p><strong>Question ${esc(q.sourceNumber)}</strong></p><p>${esc(q.text).replace(/\n/g,'<br>')}</p>${q.options.length ? `<ol type="A">${q.options.map(option => `<li>${esc(option)}</li>`).join('')}</ol>` : ''}${exhibits.map((image,index) => `<p>Exhibit ${index + 1}</p><img src="${esc(image)}" alt="${esc(q.imageAlts?.[index] || `Exhibit ${index + 1}`)}">`).join('')}`;
      try {
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Rich clipboard unavailable');
        const formats = {'text/plain': new Blob([copyText], {type:'text/plain'}), 'text/html': new Blob([copyHtml], {type:'text/html'})};
        if (exhibits.length === 1 && /^data:image\/png;base64,/i.test(exhibits[0])) formats['image/png'] = await (await fetch(exhibits[0])).blob();
        await navigator.clipboard.write([new ClipboardItem(formats)]);
        toast(exhibits.length ? 'Question and exhibits copied for apps that support images.' : 'Question and choices copied.');
      } catch {
        try {
          if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(copyText);
          else { const field = document.createElement('textarea'); field.value = copyText; field.style.position='fixed'; field.style.opacity='0'; document.body.append(field); field.select(); const copied=document.execCommand('copy'); field.remove(); if (!copied) throw new Error('Clipboard unavailable'); }
          toast(exhibits.length ? 'Text copied. Use Download exhibits for the images.' : 'Question and choices copied.');
        } catch { toast('Could not copy automatically. Check clipboard permissions.'); }
      }
    };
    $('#download-exhibits')?.addEventListener('click', async () => {
      for (const [index, source] of exhibits.entries()) {
        try {
          const blob = await (await fetch(source)).blob();
          const url = URL.createObjectURL(blob), link = document.createElement('a');
          link.href = url; link.download = `question-${q.sourceNumber}-exhibit-${index + 1}.${blob.type.split('/')[1] || 'png'}`;
          link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch { window.open(source, '_blank', 'noopener,noreferrer'); }
      }
    });
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
    if (dontKnow || state.unknown.has(id)) recordHistory(question, 'unknown');
    else if (state.mode !== 'practice') recordHistory(question, state.results[id] === true ? 'correct' : state.results[id] === false ? 'incorrect' : 'unanswered');
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
    const sessionIds = state.sessionIds.length ? state.sessionIds : reviewer.questions.map((_, i) => i);
    const keyed = sessionIds.filter(i => reviewer.questions[i].correctAnswers.length || reviewer.questions[i].answer);
    const score = keyed.filter(i => state.results[i] === true).length;
    const outcomes = sessionIds.map(i => {
      const q = reviewer.questions[i];
      const hasKey = q.correctAnswers.length || q.answer;
      const correct = state.results[i] === true;
      const status = state.unknown.has(i) ? 'I don\'t know'
        : state.mode === 'practice' ? (state.answers[i]?.length || state.revealed.has(i) ? 'Practiced' : 'Not practiced')
          : !hasKey ? 'No key' : correct ? 'Correct' : state.results[i] === false ? 'Incorrect' : 'Not answered';
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
      ? `<p class="result-sub">Practice complete · ${sessionIds.length} cards</p>`
      : `<div class="result-score">${score}<span class="score-total"> / ${keyed.length}</span></div>
        <p class="result-sub">${keyed.length < sessionIds.length ? `${keyed.length} scored · ${sessionIds.length - keyed.length} without an answer key` : `${sessionIds.length} questions`}</p>`;
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
        : q.answer ? `Answer: ${q.answer}${(q.acceptedAnswers || []).length ? `\nAlso accepted: ${q.acceptedAnswers.join(' | ')}` : ''}` : ''}${refs.map((image,index) => `\nExhibit: ${image}${q.imageAlts?.[index] ? `\nAlt text ${index + 1}: ${q.imageAlts[index]}` : ''}`).join('')}`;
    }).join('\n\n');
  }
  function exportReviewer(reviewer) {
    const blob = new Blob([JSON.stringify(reviewer, null, 2)], {type:'application/json'});
    const a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = (reviewer.title.replace(/[^a-z0-9-_]+/gi, '-').slice(0, 60) || 'reviewer') + '.json';
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportLibraryBackup() {
    const payload = {format:'rev-backup-v2',exportedAt:new Date().toISOString(),reviewers:state.reviewers,flags:state.flags,history:state.history};
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
        ...item, id:/^[a-zA-Z0-9_-]{1,100}$/.test(String(item.id || '')) ? String(item.id) : crypto.randomUUID(), title:String(item.title || 'Imported reviewer').slice(0,70),
        questions:item.questions.map(RevCore.normalizeQuestion), updatedAt:Number(item.updatedAt) || Date.now()
      }));
      const previous = state.reviewers, merged = [...previous];
      for (const reviewer of restored) {
        const at = merged.findIndex(item => item.id === reviewer.id);
        if (at >= 0) merged[at] = reviewer; else merged.push(reviewer);
      }
      state.reviewers = merged;
      if (!saveReviewers()) { state.reviewers = previous; return; }
      if (data && !Array.isArray(data)) {
        for (const reviewer of restored) {
          if (Array.isArray(data.flags?.[reviewer.id])) state.flags[reviewer.id] = data.flags[reviewer.id].filter(value => typeof value === 'string');
          if (data.history?.[reviewer.id] && typeof data.history[reviewer.id] === 'object') state.history[reviewer.id] = data.history[reviewer.id];
        }
        put(scopedKey(FLAGS_KEY), JSON.stringify(state.flags));
        put(scopedKey(HISTORY_KEY), JSON.stringify(state.history));
      }
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
    state.sourceText = ''; state.selectedFiles = []; state.importBusy = false; state.importPreview = null;
    $('#reviewer-name').value = reviewer?.title || '';
    $('#paste-text').value = reviewer ? reviewerToText(reviewer) : '';
    $('#file-input').value = ''; $('#file-status').textContent = 'PDF text is extracted locally. Attach image files and reference each filename with Exhibit: filename.png.';
    $('#import-feedback').textContent = '';
    $('#import-preview').hidden = true; $('#import-submit').textContent = 'Preview questions';
    showImportTab('paste'); dialog.showModal(); $('#reviewer-name').focus();
  }
  function showImportTab(tab) {
    document.querySelectorAll('.import-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('#paste-pane').hidden = tab !== 'paste'; $('#file-pane').hidden = tab !== 'file';
    $('#import-feedback').textContent = '';
    state.importPreview = null; $('#import-preview').hidden = true; $('#import-submit').textContent = 'Preview questions';
  }
  function resetImportPreview() {
    state.importPreview = null; $('#import-preview').hidden = true;
    $('#import-submit').textContent = 'Preview questions'; feedback('');
  }
  function renderImportPreview(preview) {
    const questions = preview.parsed.questions;
    const keyed = questions.filter(q => q.correctAnswers.length || q.answer).length;
    const issues = questions.map(q => {
      const notes = [];
      if (q.options.length && q.options.length < 4 && q.type !== 'boolean') notes.push(`${q.options.length} choices`);
      if (!q.correctAnswers.length && !q.answer) notes.push('no answer key');
      if (q.imageRefs?.length) notes.push('missing exhibit');
      const imageCount = (q.images?.length || (q.image ? 1 : 0)) + (q.imageRefs?.length || 0);
      if (imageCount && (!q.imageAlts || q.imageAlts.length < imageCount || q.imageAlts.some(alt => /^(?:exhibit|image|diagram|figure)(?:\s+\d+)?$/i.test(alt)))) notes.push('image description needed');
      notes.push(...preview.parsed.warnings.filter(note => note.startsWith(`Question ${q.sourceNumber}:`)).map(note => note.replace(/^Question \d+:\s*/, '')));
      return {q, notes};
    });
    const duplicates = preview.parsed.warnings.filter(note => /duplicate/i.test(note)).length;
    const exhibits = questions.reduce((total,q) => total + (q.images?.length || 0), 0);
    $('#import-preview').innerHTML = `<h3>Import preview</h3><p>${questions.length} questions · ${keyed} answer keys · ${exhibits} attached exhibits · ${duplicates} duplicates removed</p>
      ${preview.resolved.unresolved.length ? `<p class="preview-warning">Attach: ${esc(preview.resolved.unresolved.join(', '))}</p>` : ''}
      ${preview.parsed.warnings.length ? `<p class="preview-warning">${preview.parsed.warnings.length} formatting notes. Review flagged questions below.</p>` : ''}
      ${preview.parsed.warnings.length ? `<details class="preview-notes"><summary>Formatting notes</summary><ul>${preview.parsed.warnings.map(note => `<li>${esc(note)}</li>`).join('')}</ul></details>` : ''}
      <div class="preview-list">${issues.map(({q,notes}) => `<button type="button" class="preview-row ${notes.length ? 'has-issue' : ''}" data-preview-question="${esc(q.sourceNumber)}" title="Edit question ${esc(q.sourceNumber)}">
        <strong>${esc(q.sourceNumber)}</strong><span>${esc(q.text.slice(0,110))}</span><small>${q.options.length ? `${q.options.length} choices` : 'Typed answer'}${notes.length ? ` · ${esc(notes.join(' · '))}` : ''}</small></button>`).join('')}</div>
      <p class="preview-help">Select a question to edit its source text. Preview again before saving.</p>`;
    $('#import-preview').hidden = false;
    $('#import-preview').querySelectorAll('[data-preview-question]').forEach(button => button.onclick = () => {
      const number = button.dataset.previewQuestion;
      $('#paste-text').value = preview.source;
      showImportTab('paste');
      const field = $('#paste-text');
      const match = new RegExp(`(?:Question|Q)\\s*#?\\s*${number.replace(/[^0-9]/g,'')}\\b`, 'i').exec(field.value);
      const at = match?.index ?? 0;
      field.focus(); field.setSelectionRange(at, at + (match?.[0].length || 0));
      field.scrollTop = Math.max(0, field.scrollHeight * at / Math.max(field.value.length, 1) - field.clientHeight / 3);
    });
  }
  function feedback(message, error = false) {
    const el = $('#import-feedback'); el.textContent = message; el.classList.toggle('error', error);
  }
  async function extractPdf(file) {
    if (!window.pdfjsLib) {
      pdfLoad ||= new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = 'vendor/pdf.min.js';
        script.onload = resolve; script.onerror = () => reject(Error('PDF reader could not load from this app.'));
        document.head.append(script);
      });
      await pdfLoad;
    }
    if (!window.pdfjsLib) throw Error('PDF reader is unavailable. Reload and try again.');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
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
      let source = state.importPreview?.source || $('#paste-text').value;
      if (!state.importPreview && tab === 'file' && file) source = /\.pdf$/i.test(file.name) ? await extractPdf(file) : await file.text();
      else if (tab === 'file' && !source.trim()) return feedback('Choose a reviewer file or paste text, then attach any exhibit images.', true);
      if (!source.trim()) return feedback('Paste questions or choose a file.', true);
      const parsed = state.importPreview?.parsed || RevCore.parseImport(source);
      if (!parsed.questions.length) return feedback('No questions found. Use Question 1 headings or the Import prompt.', true);
      const empty = parsed.questions.filter(q => !q.text);
      if (empty.length) return feedback(`${empty.length} question(s) have no question text. Check the formatting before saving.`, true);
      const imageFiles = [];
      if (!state.importPreview) for (const imageFile of exhibitFiles) imageFiles.push({name:imageFile.name,data:await fileToDataUrl(imageFile)});
      const editId = $('#import-dialog').dataset.editId;
      const previousReviewer = state.reviewers.find(item => item.id === editId);
      const fallbackQuestions = window.RECALL_STARTER_REVIEWER?.questions || [];
      const resolved = state.importPreview?.resolved || RevCore.resolveImageFiles(parsed.questions, imageFiles, fallbackQuestions, previousReviewer?.questions || []);
      if (!state.importPreview) {
        state.importPreview = {source, parsed, resolved};
        renderImportPreview(state.importPreview);
        $('#import-submit').textContent = 'Save reviewer';
        return feedback('Review the questions and choices, then save.');
      }
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
      state.importPreview = null;
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
      $('meta[name="theme-color"]').content = dark ? '#17181c' : '#f4f5f7';
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
    $('#data-link').addEventListener('click', () => setMobileNav(false));
    $('#reviewer-search').oninput = event => { state.reviewerSearch = event.target.value; renderLibrary(); };
    $('#reviewer-sort').onchange = event => { state.reviewerSort = event.target.value; renderLibrary(); };
    $('#backup-library').onclick = exportLibraryBackup;
    $('#restore-library').onclick = () => { setMobileNav(false); $('#backup-file').click(); };
    $('#backup-file').onchange = event => { if (event.target.files[0]) restoreLibraryBackup(event.target.files[0]); };
    $('#account-button').onclick = () => { setMobileNav(false); showAccountDialog(); };
    $('#account-switch').onclick = () => setAccountMode($('#account-dialog').dataset.mode === 'signup' ? 'signin' : 'signup');
    $('#account-guest').onclick = () => $('#account-dialog').close();
    $('#account-form').addEventListener('submit', submitAccount);
    $('#account-signout').onclick = async () => {
      if (!auth) return;
      const {error} = await auth.auth.signOut();
      if (error) return toast(error.message || 'Could not sign out.');
      switchAccount(null); setMobileNav(false); toast('Signed out.');
    };
    $('#cancel-import').onclick = () => $('#import-dialog').close();
    document.querySelectorAll('.import-tab').forEach(b => b.onclick = () => showImportTab(b.dataset.tab));
    $('#file-input').onchange = e => {
      state.selectedFiles = [...e.target.files];
      $('#file-status').textContent = state.selectedFiles.map(x => x.name).join(', ') || 'PDF text is extracted locally. Attach image files and reference them with Exhibit: filename.png.';
      resetImportPreview();
    };
    $('#paste-text').addEventListener('input', resetImportPreview);
    $('#import-submit').onclick = submitImport;
    window.addEventListener('hashchange', render);
    window.addEventListener('pagehide', saveSession);
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveSession(); });
    installKeyboardShortcuts();
    render();
    if (auth) {
      auth.auth.getUser().then(({data, error}) => {
        if (!error && data.user) switchAccount(data.user);
      });
      auth.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') queueMicrotask(() => switchAccount(null));
        if (event === 'SIGNED_IN' && session?.user) queueMicrotask(() => switchAccount(session.user));
      });
    }
  }
  initialize();
})();
