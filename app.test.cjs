const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');

function openApp() {
  const html = fs.readFileSync('index.html', 'utf8');
  const dom = new JSDOM(html, {url:'http://localhost/', runScripts:'outside-only', pretendToBeVisual:true});
  const {window} = dom;
  window.matchMedia = query => ({matches:query.includes('prefers-reduced-motion'), addEventListener(){}});
  window.HTMLElement.prototype.scrollIntoView = function() {};
  window.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  window.HTMLDialogElement.prototype.close = function() { this.open = false; };
  window.confirm = () => true;
  window.eval(fs.readFileSync('reviewer-data.js', 'utf8'));
  window.eval(fs.readFileSync('core.js', 'utf8'));
  window.eval(fs.readFileSync('study-app.js', 'utf8'));
  return dom;
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
  const history = JSON.parse(localStorage.getItem('rev-question-history-v1'));
  assert.equal(Object.values(history['reviewer-s2-it0015'])[0], 'correct');
  document.querySelector('#exit-quiz').click();
  const filter = document.querySelector('#study-filter');
  filter.value = 'flagged';
  document.querySelector('#start-quiz').click();
  assert.equal(document.querySelectorAll('.question-index-card').length, 1);
  dom.window.close();
});

test('import previews before saving and local deletion clears the library', async () => {
  const dom = openApp(), {document, localStorage} = dom.window;
  document.querySelector('#new-reviewer').click();
  document.querySelector('#paste-text').value = 'Question 1\nWhich choice is right?\nChoice A: one\nCorrect! Choice B: two\nChoice C: three\nChoice D: four';
  document.querySelector('#import-submit').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(document.querySelector('#import-preview').hidden, false);
  assert.match(document.querySelector('#import-preview').textContent, /4 choices/);
  document.querySelector('#import-submit').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(JSON.parse(localStorage.getItem('recall-reviewers-v1')).length, 2);
  dom.window.location.hash = '#data';
  dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));
  document.querySelector('#delete-local-data').click();
  assert.deepEqual(JSON.parse(localStorage.getItem('recall-reviewers-v1')), []);
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

test('sign-up asks for terms acknowledgement and guest access remains available', () => {
  const dom = openApp(), {document} = dom.window;
  document.querySelector('#account-button').click();
  document.querySelector('#account-switch').click();
  assert.equal(document.querySelector('#account-consent-row').hidden, false);
  assert.equal(document.querySelector('#account-consent').required, true);
  document.querySelector('#account-guest').click();
  assert.equal(document.querySelector('#account-dialog').open, false);
  dom.window.close();
});

test('copy fallback includes every exhibit reference', async () => {
  const dom = openApp(), {document, navigator} = dom.window;
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
