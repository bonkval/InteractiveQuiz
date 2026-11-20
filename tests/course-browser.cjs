// Run after npm run build. Uses a fixture API and never writes to a remote service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');
const root = path.resolve('dist');
const course = JSON.parse(fs.readFileSync('public/courses/it0204/course.json', 'utf8'));
const all = course.modules.flatMap(m => m.lessons);
const ids = new Set();
for (const l of all) {
  assert(!ids.has(l.id), 'Lesson IDs must be unique'); ids.add(l.id);
  assert(l.blocks.length && l.essentials.length && l.recall.answer && l.example.explanation);
  assert(l.check.correct >= 0 && l.check.correct < l.check.options.length);
  for (const s of l.sources) {
    const file = course.sources.find(f => f.id === s.id); assert(file);
    assert(fs.existsSync(path.resolve('public', '.' + file.url)));
    assert(s.pages[0] <= s.pages[1]);
  }
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(url.pathname === '/api/auth' ? {owner: false, configured: true} : {initialized: true, revision: 'v1', entries: []})); }
  const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', ({'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.pdf': 'application/pdf'})[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const executablePath = process.env.REV_BROWSER_EXECUTABLE;
  const browser = await chromium.launch({headless: true, ...(executablePath ? {executablePath} : {})});
  const url = `http://127.0.0.1:${server.address().port}`;
  const output = path.resolve('output/courses'); fs.mkdirSync(output, {recursive: true});
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
    const page = await context.newPage(); const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
    await page.goto(url);
    await page.getByRole('heading', {name: 'Your courses', exact: true}).waitFor();
    assert(!requests.some(r => r.endsWith('.pdf')), 'PDFs must not load on entry');
    assert(!requests.some(r => r.endsWith('course.json')), 'Lessons must load only when the course opens');
    await page.screenshot({path: path.join(output, 'library.png'), fullPage: true});
    await page.locator('.course-cover').click();
    await page.locator('.course-module').first().waitFor();
    assert.equal(await page.locator('.course-module').count(), 8);
    await page.screenshot({path: path.join(output, 'overview.png'), fullPage: true});
    await page.getByRole('link', {name: /Cybersecurity and privacy: connected/}).click();
    await page.getByRole('heading', {name: 'The essentials', exact: true}).waitFor();
    await page.getByRole('radio', {name: 'Turn on multi-factor authentication', exact: true}).check();
    await page.getByText('Not quite.', {exact: true}).waitFor();
    await page.getByRole('radio', {name: 'Stop asking for an unnecessary home address', exact: true}).check();
    await page.getByText('Correct.', {exact: true}).waitFor();
    await page.getByRole('button', {name: 'Save lesson', exact: true}).click();
    await page.getByLabel('Your notes', {exact: true}).fill('Privacy concerns purpose as well as access.');
    await page.getByRole('button', {name: 'I need another look', exact: true}).click();
    await page.getByRole('button', {name: 'Mark lesson complete', exact: true}).click();
    await page.reload();
    await page.getByRole('button', {name: '✓ Lesson completed', exact: true}).waitFor();
    assert.equal(await page.getByLabel('Your notes', {exact: true}).inputValue(), 'Privacy concerns purpose as well as access.');
    assert(await page.getByRole('radio', {name: 'Stop asking for an unnecessary home address', exact: true}).isChecked());
    await page.getByRole('button', {name: 'Quick review', exact: true}).click();
    assert.equal(await page.locator('.course-example').count(), 0);
    assert.equal(await page.locator('table').count(), 1);
    await page.getByRole('button', {name: 'Learn', exact: true}).click();
    await page.screenshot({path: path.join(output, 'lesson.png'), fullPage: true});
    await page.getByRole('link', {name: 'Next lesson', exact: true}).click();
    await page.getByRole('heading', {name: 'Why cyber laws developed', exact: true}).waitFor();
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    await page.goto(url + '/#courses/it0204');
    await page.getByLabel('Find a lesson').fill('STRIDE');
    assert.equal(await page.locator('#course-outline .course-module').count(), 1);
    await page.getByLabel('Find a lesson').fill('');
    await page.getByLabel('Show', {exact: true}).selectOption('saved');
    assert.equal(await page.locator('#course-outline li').count(), 1);
    await page.getByLabel('Show', {exact: true}).selectOption('all');
    await page.locator('[data-module-quiz="m1"]').click();
    await page.getByRole('button', {name: 'Check answers', exact: true}).click();
    await page.getByText('Answer each question before checking your results.', {exact: true}).waitFor();
    for (const l of course.modules[0].lessons) await page.locator(`input[name="${l.id}"][value="${l.check.correct}"]`).check();
    await page.getByRole('button', {name: 'Check answers', exact: true}).click();
    await page.getByRole('heading', {name: '4 / 4 correct', exact: true}).waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rev-courses-v1')).practice['it0204/m1'].score), 4);
    await page.getByRole('button', {name: 'Try again', exact: true}).click();
    assert.equal(await page.locator('input:checked').count(), 0);
    for (const l of all) {
      await page.goto(url + '/#courses/it0204/' + l.id);
      await page.getByRole('heading', {name: l.title, exact: true}).waitFor();
      assert.equal(await page.locator('.course-check input').count(), l.check.options.length);
    }
    assert(!requests.some(r => r.endsWith('.pdf')), 'Source PDFs are only fetched on explicit reference access');
    await page.goto(url + '/#courses');
    await page.getByText('Back up or restore course progress', {exact: true}).click();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', {name: 'Download backup', exact: true}).click();
    const downloaded = await downloadEvent;
    const backup = JSON.parse(fs.readFileSync(await downloaded.path(), 'utf8'));
    assert.equal(backup.lessons['it0204/m1-l1'].note, 'Privacy concerns purpose as well as access.');
    await page.locator('#course-restore').setInputFiles({name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}')});
    await page.getByText('This file does not contain valid Revvy course progress.', {exact: true}).waitFor();
    page.once('dialog', d => d.accept());
    await page.locator('#course-restore').setInputFiles({name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup))});
    await page.getByRole('heading', {name: 'Your courses', exact: true}).waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rev-courses-v1')).lessons['it0204/m1-l1'].done), true);
    await page.getByRole('button', {name: '+ New course', exact: true}).click();
    await page.getByLabel('Course name', {exact: true}).fill('Physics 2 <test>');
    await page.getByLabel('Description', {exact: true}).fill('Electricity and magnetism');
    await page.getByRole('button', {name: 'Create course', exact: true}).click();
    await page.getByRole('heading', {name: 'Physics 2 <test>', exact: true}).waitFor();
    assert.equal(await page.locator('test').count(), 0);
    await page.getByRole('button', {name: 'Delete empty course', exact: true}).click();
    await page.getByRole('heading', {name: 'Your courses', exact: true}).waitFor();
    await page.goto(url + '/#courses/missing');
    await page.getByRole('heading', {name: 'Could not open the course', exact: true}).waitFor();
    await context.close();
    for (const [name, width, dark, plain] of [['mobile', 390, false, false], ['narrow', 320, false, false], ['dark', 1440, true, false], ['simple', 390, false, true]]) {
      const ctx = await browser.newContext({viewport: {width, height: 900}, reducedMotion: 'reduce'});
      if (dark || plain) await ctx.addInitScript(({dark, plain}) => { if (dark) localStorage.setItem('rev-theme', 'dark'); if (plain) localStorage.setItem('rev-plain-mode', 'true'); }, {dark, plain});
      const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
      await p.goto(url + '/#courses/it0204/m1-l1');
      await p.getByRole('heading', {name: 'The essentials', exact: true}).waitFor();
      await p.screenshot({path: path.join(output, name + '.png'), fullPage: true});
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert(!overflow, name + ' should not overflow horizontally');
      await ctx.close();
    }
    assert.deepEqual(errors, []);
    console.log(`Verified ${all.length} lessons, 8 modules, persistence, checks, practice, search, filters, custom courses, error handling, lazy loading, and 4 display layouts.`);
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
