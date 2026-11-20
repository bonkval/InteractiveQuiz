/* Subject-independent course reader. Authored content is loaded only when opened. */
(() => {
  const KEY = 'rev-courses-v1';
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rich = value => e(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  let saved;
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { saved = {}; }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  saved.custom = Array.isArray(saved.custom) ? saved.custom : [];
  saved.lessons = saved.lessons && typeof saved.lessons === 'object' && !Array.isArray(saved.lessons) ? saved.lessons : {};
  let catalog, request = 0, search = '', filter = 'all', mode = 'learn', quiz = null, lastRoute;
  const cache = new Map();
  function normalizeData(value) {
    if (!value || typeof value !== 'object' || !value.lessons || typeof value.lessons !== 'object' || Array.isArray(value.lessons)) throw Error('This file does not contain valid Revvy course progress.');
    const result = {lessons: {}, custom: [], last: {}, practice: {}};
    for (const [key, p] of Object.entries(value.lessons)) {
      if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(key) || !p || typeof p !== 'object') continue;
      result.lessons[key] = {done: p.done === true, saved: p.saved === true, confusing: p.confusing === true, correct: p.correct === true,
        ...(Number.isInteger(p.answer) && p.answer >= 0 && p.answer < 100 ? {answer: p.answer} : {}), note: typeof p.note === 'string' ? p.note.slice(0, 10000) : ''};
    }
    result.custom = Array.isArray(value.custom) ? value.custom.filter(c => c?.local === true && /^local-[a-zA-Z0-9-]+$/.test(c.id) && typeof c.title === 'string').map(c => ({id: c.id, title: c.title.slice(0, 100), description: String(c.description || '').slice(0, 280), local: true})).filter((c, i, all) => all.findIndex(v => v.id === c.id) === i) : [];
    for (const [key, id] of Object.entries(value.last || {})) if (/^[a-zA-Z0-9_-]+$/.test(key) && typeof id === 'string') Object.defineProperty(result.last, key, {value: id, enumerable: true, writable: true, configurable: true});
    for (const [key, p] of Object.entries(value.practice || {})) if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(key) && p && Number.isInteger(p.score) && Number.isInteger(p.total) && p.score >= 0 && p.total >= p.score) result.practice[key] = {score: p.score, total: p.total};
    return result;
  }
  saved = normalizeData(saved);
  const progress = (c, l) => saved.lessons[`${c}/${l}`] || {};
  function store() {
    try { localStorage.setItem(KEY, JSON.stringify(saved)); }
    catch { document.querySelector('#course-save-status')?.replaceChildren(document.createTextNode('Could not save on this device. Free some browser storage and try again.')); }
  }
  function update(c, l, change) { saved.lessons[`${c}/${l}`] = {...progress(c, l), ...change}; store(); }
  const lessons = course => course.modules.flatMap(m => m.lessons.map(l => ({...l, module: m})));
  const route = (c, l) => c ? `#courses/${encodeURIComponent(c)}${l ? `/${encodeURIComponent(l)}` : ''}` : '#courses';
  const safeUrl = url => /^(https:\/\/|\/courses\/)/.test(url || '') ? e(url) : '#';
  const button = (label, attr = '', primary = false) => `<button type="button" class="course-button${primary ? ' course-primary' : ''}" ${attr}>${label}</button>`;
  const link = (label, href, primary = false) => `<a class="course-button${primary ? ' course-primary' : ''}" href="${href}">${label}</a>`;
  function counts(c) { const all = lessons(c); return {all: all.length, done: all.filter(l => progress(c.id, l.id).done).length, checked: all.filter(l => progress(c.id, l.id).correct).length}; }
  function meter(done, total) { return `<progress max="${total || 1}" value="${done}" aria-label="${done} of ${total} lessons completed"></progress>`; }
  function block(b) {
    if (b.type === 'table') return `<section class="course-table-section"><h3>${e(b.title)}</h3><div class="course-table-wrap" role="region" aria-label="${e(b.title)}" tabindex="0"><table aria-label="${e(b.title)}"><thead><tr>${b.headers.map(h => `<th scope="col">${e(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(row => `<tr>${row.map((v, i) => `<${i ? 'td' : 'th scope="row"'}>${rich(v)}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
    if (b.type === 'flow') return `<section class="course-flow"><h3>${e(b.title)}</h3><ol>${b.steps.map(s => `<li>${rich(s)}</li>`).join('')}</ol></section>`;
    if (b.type === 'list') return `<section><h3>${e(b.title)}</h3><ul>${b.items.map(s => `<li>${rich(s)}</li>`).join('')}</ul></section>`;
    if (b.type === 'formula') return `<figure class="course-formula"><figcaption>${e(b.title)}</figcaption><pre>${e(b.text)}</pre></figure>`;
    if (b.type === 'image') return `<figure><img class="course-image" src="${safeUrl(b.src)}" alt="${e(b.alt)}" loading="lazy"><figcaption>${e(b.caption)}</figcaption></figure>`;
    return `<section><h3>${e(b.title)}</h3><p>${rich(b.text)}</p></section>`;
  }
  function sourceList(c, l) {
    return `<details class="course-sources"><summary>Sources and slide references</summary><p>Lessons are rewritten from your modules. Teaching examples and recall prompts are added by Revvy. Original slides are available for reference.</p>${l.sources.map(s => { const file = c.sources.find(f => f.id === s.id); return file ? `<p><a href="${safeUrl(file.url)}#page=${s.pages[0]}" target="_blank" rel="noopener">${e(file.title)}, slides ${s.pages.join('–')}</a></p>` : ''; }).join('')}${(l.references || []).map(r => `<p><a href="${safeUrl(r.url)}" target="_blank" rel="noopener">${e(r.title)}</a></p>`).join('')}</details>`;
  }
  async function getCatalog() {
    if (!catalog) { const r = await fetch('/courses/catalog.json'); if (!r.ok) throw Error('Course catalog could not load.'); catalog = await r.json(); }
    return [...catalog, ...saved.custom];
  }
  async function getCourse(id) {
    const entry = (await getCatalog()).find(c => c.id === id);
    if (!entry) throw Error('This course could not be found.');
    if (entry.local) return {...entry, modules: [], sources: []};
    if (!cache.has(id)) { const r = await fetch(entry.content); if (!r.ok) throw Error('Lessons could not load.'); const c = await r.json(); cache.set(id, c); }
    return cache.get(id);
  }
  function heading(title, subtitle, back = '') { return `${back}<header class="course-heading"><h1 tabindex="-1">${e(title)}</h1><p>${e(subtitle)}</p></header>`; }
  async function home(root) {
    const entries = await getCatalog();
    root.innerHTML = `<div class="course-shell">${heading('Your courses', 'Understand a little. Try it yourself. Come back stronger.')}<div class="course-home-tools">${button('+ New course', 'id="course-create"')}<span id="course-save-status" role="status">Progress is saved in this browser.</span></div><div class="course-catalog">${entries.map(c => {
      const loaded = cache.get(c.id), all = loaded ? lessons(loaded) : null;
      const done = all ? all.filter(l => progress(c.id, l.id).done).length : Object.entries(saved.lessons).filter(([k, v]) => k.startsWith(c.id + '/') && v.done).length;
      return `<a class="course-cover" href="${route(c.id)}"><div class="course-cover-art" aria-hidden="true"><span>${e(c.code || 'Revvy')}</span><svg viewBox="0 0 240 100"><path d="M10 80h40V55h40V30h40V10h40M90 85h40V60h40V35h50"/></svg></div><div class="course-cover-copy"><span class="course-subtle">${c.moduleCount || 0} modules${c.lessonCount ? ` · ${c.lessonCount} lessons` : ''}</span><h2>${e(c.title)}</h2><p>${e(c.description)}</p>${meter(done, all?.length || c.lessonCount || 0)}<span>${done} / ${all?.length || c.lessonCount || 0} lessons completed</span><strong>${done ? 'Continue learning' : c.local ? 'Open course' : 'Start learning'}</strong></div></a>`;
    }).join('')}</div><dialog id="course-create-dialog" class="course-dialog"><form id="course-create-form"><h2>Create a course</h2><p>Give your next subject a home. Share its PDFs with Codex to have lessons prepared and added here.</p><label>Course name<input name="title" maxlength="100" required placeholder="e.g. Physics 2"></label><label>Description<textarea name="description" maxlength="280" placeholder="What will you be learning?"></textarea></label><p class="course-subtle">New course folders are saved on this device. Prepared courses are included with the app.</p><div class="course-actions">${button('Cancel', 'id="course-create-cancel"')}<button class="course-button course-primary" type="submit">Create course</button></div></form></dialog></div>`;
    const dialog = root.querySelector('dialog');
    root.querySelector('#course-create').onclick = () => dialog.showModal();
    root.querySelector('#course-create-cancel').onclick = () => dialog.close();
    root.querySelector('form').onsubmit = event => { event.preventDefault(); const form = new FormData(event.target), title = String(form.get('title')).trim(); if (!title) return; const id = `local-${crypto.randomUUID()}`; saved.custom.push({id, title, description: String(form.get('description')).trim(), local: true}); store(); dialog.close(); location.hash = route(id); };
    const data = document.createElement('details'); data.className = 'course-about';
    data.innerHTML = `<summary>Back up or restore course progress</summary><p>Includes your lesson progress, notes, saved lessons, and empty course folders. Restoring replaces the course study data on this device.</p><div class="course-actions">${button('Download backup', 'id="course-backup"')}<label class="course-button">Choose backup<input id="course-restore" type="file" accept=".json,application/json" hidden></label></div><p id="course-data-status" role="status"></p>`;
    root.querySelector('.course-shell').append(data);
    data.querySelector('#course-backup').onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify({format: 'rev-course-progress-v1', ...saved}, null, 2)], {type: 'application/json'})); const a = document.createElement('a'); a.href = url; a.download = 'revvy-course-progress.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    data.querySelector('#course-restore').onchange = async event => { const file = event.target.files[0]; if (!file) return; try { if (file.size > 2000000) throw Error('This backup is too large. Choose a course progress backup under 2 MB.'); const value = normalizeData(JSON.parse(await file.text())); if (!confirm('Replace course progress and notes on this device with this backup?')) return; saved = value; store(); render(root); } catch (error) { data.querySelector('#course-data-status').textContent = error.message; } };
  }
  function overview(root, c) {
    const all = lessons(c), n = counts(c), resume = all.find(l => l.id === saved.last?.[c.id]) || all.find(l => !progress(c.id, l.id).done) || all[0];
    root.innerHTML = `<div class="course-shell">${heading(c.title, c.description, `<a class="course-back" href="#courses">All courses</a>`)}${!all.length ? `<section class="course-empty"><h2>Ready for your first module</h2><p>Send this subject’s PDFs to Codex. Once prepared lessons are added to Revvy, they’ll appear here.</p><p>No PDF upload or conversion is needed in the app.</p>${button('Delete empty course', 'id="course-delete"')}</section>` : `<section class="course-resume"><div><h2>${n.done === n.all ? 'Keep it fresh' : n.done ? 'Pick up where you left off' : 'Begin with the foundations'}</h2><p>${e(resume.title)}</p>${link(n.done ? 'Continue learning' : 'Start learning', route(c.id, resume.id), true)}</div><div class="course-progress-summary"><strong>${n.done}<span> / ${n.all}</span></strong><p>lessons completed</p>${meter(n.done, n.all)}<p>${n.checked} / ${n.all} lesson checks answered correctly</p></div></section><div class="course-outline-tools"><label class="course-search">Find a lesson<input id="course-search" type="search" value="${e(search)}" placeholder="Search concepts, examples, or lessons"></label><label>Show<select id="course-filter" aria-label="Show"><option value="all">All lessons</option><option value="saved" ${filter === 'saved' ? 'selected' : ''}>Saved lessons</option><option value="confusing" ${filter === 'confusing' ? 'selected' : ''}>Needs another look</option><option value="unfinished" ${filter === 'unfinished' ? 'selected' : ''}>Unfinished lessons</option></select></label></div><div id="course-outline"></div><details class="course-about"><summary>About this course</summary><p>${e(c.editorialNote)}</p><p>${c.sources.length} source decks, organized into ${c.modules.length} modules. Overlapping subtopic decks are combined in the lesson sequence.</p></details>`}</div>`;
    if (!all.length) { root.querySelector('#course-delete').onclick = () => { saved.custom = saved.custom.filter(v => v.id !== c.id); store(); location.hash = '#courses'; }; return; }
    function outline() {
      const term = search.trim().toLowerCase();
      const match = l => (!term || JSON.stringify(l).toLowerCase().includes(term)) && (filter === 'all' || filter === 'saved' && progress(c.id, l.id).saved || filter === 'confusing' && progress(c.id, l.id).confusing || filter === 'unfinished' && !progress(c.id, l.id).done);
      root.querySelector('#course-outline').innerHTML = c.modules.map((m, i) => { const found = m.lessons.filter(match); if (!found.length) return ''; const complete = m.lessons.filter(l => progress(c.id, l.id).done).length; return `<section class="course-module"><header><span class="course-module-number">${i + 1}</span><div><h2>${e(m.title)}</h2><p>${e(m.description)}</p></div><span class="course-subtle">${complete}/${m.lessons.length} complete</span></header><ol>${found.map(l => { const p = progress(c.id, l.id); return `<li><a href="${route(c.id, l.id)}"><span class="course-lesson-state" aria-label="${p.done ? 'Completed' : 'Not completed'}">${p.done ? '✓' : '○'}</span><span><strong>${e(l.title)}</strong><small>${e(l.goal)}</small></span><span class="course-lesson-meta">${p.confusing ? 'Revisit · ' : ''}${p.saved ? 'Saved · ' : ''}${l.minutes} min</span></a></li>`; }).join('')}</ol>${button('Practice this module', `data-module-quiz="${e(m.id)}"`)}</section>`; }).join('') || '<p class="course-empty">No lessons match. Try another search or filter.</p>';
      root.querySelectorAll('[data-module-quiz]').forEach(b => b.onclick = () => { quiz = {course: c.id, module: b.dataset.moduleQuiz, answers: {}}; location.hash = route(c.id, `practice-${quiz.module}`); });
    }
    root.querySelector('#course-search').oninput = event => { search = event.target.value; outline(); };
    root.querySelector('#course-filter').onchange = event => { filter = event.target.value; outline(); };
    outline();
  }
  function lesson(root, c, l) {
    const all = lessons(c), index = all.findIndex(v => v.id === l.id), p = progress(c.id, l.id);
    saved.last ||= {}; saved.last[c.id] = l.id; store();
    root.innerHTML = `<div class="course-shell course-lesson-shell"><nav class="course-breadcrumb" aria-label="Course navigation"><a href="#courses">Courses</a><span>/</span><a href="${route(c.id)}">${e(c.title)}</a></nav><div class="course-learning-layout"><aside class="course-lesson-outline"><details ${matchMedia('(min-width: 821px)').matches ? 'open' : ''}><summary>${e(l.module.title)}</summary><ol>${l.module.lessons.map(v => `<li><a href="${route(c.id, v.id)}" ${v.id === l.id ? 'aria-current="page"' : ''}><span>${progress(c.id, v.id).done ? '✓' : '○'}</span>${e(v.title)}</a></li>`).join('')}</ol><a href="${route(c.id)}">View all modules</a></details></aside><article class="course-article">${heading(l.title, l.goal)}<div class="course-lesson-toolbar"><div class="course-modes" role="group" aria-label="Lesson mode">${button('Learn', `data-mode="learn" aria-pressed="${mode === 'learn'}"`)}${button('Quick review', `data-mode="review" aria-pressed="${mode === 'review'}"`)}</div><span>${l.minutes} min</span>${button(p.saved ? 'Saved' : 'Save lesson', `id="course-save" aria-pressed="${Boolean(p.saved)}"`)}</div><section class="course-essentials"><h2>The essentials</h2><ul>${l.essentials.map(t => `<li>${rich(t)}</li>`).join('')}</ul></section>${mode === 'learn' ? `<div class="course-explanation">${l.blocks.map(block).join('')}</div><section class="course-example"><h2>Make it concrete</h2><span class="course-subtle">Teaching example</span><p>${rich(l.example.situation)}</p><p><strong>Think it through:</strong> ${rich(l.example.explanation)}</p></section>` : `<p class="course-review-note">A condensed pass through the key ideas. Switch to Learn for explanations and a worked example.</p>${l.blocks.filter(b => ['table','flow','formula','image'].includes(b.type)).map(block).join('')}`}<section class="course-recall"><h2>Explain it without looking</h2><p>${e(l.recall.prompt)}</p><details><summary>Compare with a model answer</summary><p>${rich(l.recall.answer)}</p></details></section><section class="course-check"><h2>Check your understanding</h2>${questionHtml(l.check, p.answer, p.answer !== undefined, 'lesson')}<div id="course-check-feedback" role="status">${p.answer !== undefined ? feedback(l.check, p.answer) : ''}</div></section>${l.correction ? `<aside class="course-correction"><h2>Source clarification</h2><p>${rich(l.correction)}</p><p class="course-subtle">Checked 21 November 2026. See the official references below.</p></aside>` : ''}<section class="course-notes"><label for="course-note">Your notes</label><textarea id="course-note" maxlength="10000" placeholder="Write the idea in your own words, or leave yourself a question.">${e(p.note || '')}</textarea><span id="course-save-status" role="status">Saved on this device.</span></section>${sourceList(c, l)}<div class="course-completion">${button(p.done ? '✓ Lesson completed' : 'Mark lesson complete', 'id="course-complete"', true)}${button(p.confusing ? 'Marked for another look' : 'I need another look', `id="course-confusing" aria-pressed="${Boolean(p.confusing)}"`)}<p>Completion tracks your reading. Check results track your understanding.</p></div><nav class="course-next" aria-label="Lesson sequence">${index ? link('Previous lesson', route(c.id, all[index - 1].id)) : link('Course overview', route(c.id))}${index < all.length - 1 ? link('Next lesson', route(c.id, all[index + 1].id), true) : link('Back to course', route(c.id), true)}</nav></article></div></div>`;
    root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; lesson(root, c, l); });
    root.querySelector('#course-save').onclick = event => { const value = !progress(c.id, l.id).saved; update(c.id, l.id, {saved: value}); event.target.textContent = value ? 'Saved' : 'Save lesson'; event.target.setAttribute('aria-pressed', String(value)); };
    root.querySelector('#course-confusing').onclick = event => { const value = !progress(c.id, l.id).confusing; update(c.id, l.id, {confusing: value}); event.target.textContent = value ? 'Marked for another look' : 'I need another look'; event.target.setAttribute('aria-pressed', String(value)); };
    root.querySelector('#course-complete').onclick = () => { update(c.id, l.id, {done: !progress(c.id, l.id).done}); lesson(root, c, l); root.querySelector('#course-complete').focus(); };
    root.querySelector('#course-note').oninput = event => update(c.id, l.id, {note: event.target.value});
    root.querySelectorAll('[name="lesson"]').forEach(input => input.onchange = () => { const answer = Number(input.value); update(c.id, l.id, {answer, correct: answer === l.check.correct}); root.querySelector('#course-check-feedback').innerHTML = feedback(l.check, answer); });
  }
  function questionHtml(q, answer, show, name) { return `<fieldset><legend>${e(q.prompt)}</legend>${q.options.map((o, i) => `<label class="course-answer${show && answer === i ? ' chosen' : ''}"><input type="radio" name="${name}" value="${i}" ${answer === i ? 'checked' : ''}><span>${e(o)}</span></label>`).join('')}</fieldset>`; }
  function feedback(q, answer) { return `<p class="course-feedback ${answer === q.correct ? 'is-correct' : 'is-incorrect'}"><strong>${answer === q.correct ? 'Correct.' : 'Not quite.'}</strong> ${e(q.explanation)}</p>`; }
  function practice(root, c, id) {
    const m = c.modules.find(m => `practice-${m.id}` === id);
    if (!m) throw Error('This practice set could not be found.');
    if (!quiz || quiz.course !== c.id || quiz.module !== m.id) quiz = {course: c.id, module: m.id, answers: {}};
    const submitted = Boolean(quiz.submitted), score = m.lessons.filter(l => quiz.answers[l.id] === l.check.correct).length;
    root.innerHTML = `<div class="course-shell course-practice">${heading(`Practice: ${m.title}`, 'Use this check to find which lessons need another pass.', `<a class="course-back" href="${route(c.id)}">Course overview</a>`)}${submitted ? `<div class="course-essentials" role="status"><h2>${score} / ${m.lessons.length} correct</h2><p>${score === m.lessons.length ? 'You connected the key ideas. Revisit these questions later to check your recall.' : 'Use the explanations and lesson links below to work on the gaps.'}</p></div>` : ''}<form id="course-practice-form">${m.lessons.map((l, i) => `<section class="course-check"><h2>Question ${i + 1}</h2>${questionHtml(l.check, quiz.answers[l.id], submitted, l.id)}${submitted ? `${feedback(l.check, quiz.answers[l.id])}<a href="${route(c.id, l.id)}">Revisit ${e(l.title)}</a>` : ''}</section>`).join('')}<p id="course-practice-status" role="status"></p>${submitted ? button('Try again', 'id="course-practice-again"', true) : '<button class="course-button course-primary" type="submit">Check answers</button>'}</form></div>`;
    root.querySelectorAll('input[type="radio"]').forEach(input => { input.disabled = submitted; input.onchange = () => quiz.answers[input.name] = Number(input.value); });
    root.querySelector('form').onsubmit = event => { event.preventDefault(); if (m.lessons.some(l => quiz.answers[l.id] === undefined)) { root.querySelector('#course-practice-status').textContent = 'Answer each question before checking your results.'; root.querySelector(`input[name="${m.lessons.find(l => quiz.answers[l.id] === undefined).id}"]`).focus(); return; } quiz.submitted = true; saved.practice ||= {}; saved.practice[`${c.id}/${m.id}`] = {score: m.lessons.filter(l => quiz.answers[l.id] === l.check.correct).length, total: m.lessons.length, date: Date.now()}; m.lessons.forEach(l => update(c.id, l.id, {answer: quiz.answers[l.id], correct: quiz.answers[l.id] === l.check.correct})); store(); practice(root, c, id); root.querySelector('h1').focus(); };
    root.querySelector('#course-practice-again')?.addEventListener('click', () => { quiz = null; practice(root, c, id); });
  }
  async function render(root) {
    const current = ++request;
    const changed = lastRoute !== location.hash; lastRoute = location.hash;
    root.innerHTML = '<div class="course-shell" role="status">Loading your courses…</div>';
    try {
      const parts = location.hash.replace(/^#courses\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
      if (!parts.length) { await getCatalog(); if (current === request) await home(root); }
      else {
      const c = await getCourse(parts[0]); if (current !== request || !location.hash.startsWith('#courses')) return;
      if (!parts[1]) overview(root, c);
      else if (parts[1].startsWith('practice-')) practice(root, c, parts[1]);
      else { const l = lessons(c).find(l => l.id === parts[1]); if (!l) throw Error('This lesson could not be found.'); lesson(root, c, l); }
      }
      if (changed && current === request) { root.querySelector('h1')?.focus({preventScroll: true}); window.scrollTo({top: 0, behavior: 'instant'}); }
    } catch (error) { if (current === request) { root.innerHTML = `<div class="course-shell">${heading('Could not open the course', error.message)}${link('All courses', '#courses')}${button('Try again', 'id="course-retry"')}</div>`; root.querySelector('#course-retry').onclick = () => render(root); } }
  }
  window.RevCourses = {render, cancel: () => { request++; }, clear: () => { saved = {custom: [], lessons: {}}; store(); }, export: () => saved,
    restore: value => { saved = normalizeData(value); store(); }
  };
})();
