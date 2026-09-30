const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./core');

test('imports labeled choices and keeps their positions', () => {
  const input = 'Question 1\nWhat is X?\nChoice A: alpha\nCorrect! Choice B: beta\nChoice C: gamma\nChoice D: delta';
  const {questions} = core.parseImport(input);
  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0].options, ['alpha', 'beta', 'gamma', 'delta']);
  assert.deepEqual(questions[0].correctAnswers, [1]);
});

test('imports multiple correct choices', () => {
  const input = 'Question 1\nSelect both:\nCorrect! Choice A: alpha\nChoice B: beta\nCorrect! Choice C: gamma\nChoice D: delta';
  const {questions} = core.parseImport(input);
  assert.deepEqual(questions[0].correctAnswers, [0, 2]);
  assert.equal(core.isCorrect(questions[0], [0, 2]), true);
  assert.equal(core.isCorrect(questions[0], [0]), false);
});

test('imports identification answers and true or false with a wrong student response', () => {
  const identification = core.parseImport('Question 1\nName the protocol.\nAnswer: STP').questions[0];
  assert.equal(identification.answer, 'STP');
  assert.equal(core.isCorrect(identification, ['stp']), true);
  const boolean = core.parseImport('Question 1\nIs it true?\nYou Answered True (wrong)\nFalse (correct)').questions[0];
  assert.deepEqual(boolean.options, ['True', 'False']);
  assert.deepEqual(boolean.correctAnswers, [1]);
  assert.equal(boolean.type, 'boolean');
  const multiline = core.parseImport('Question 1\nA flag signifies SLAAC\nwithout ending punctuation\nYou Answered True (wrong)\nFalse (correct)').questions[0];
  assert.equal(multiline.text, 'A flag signifies SLAAC\nwithout ending punctuation');
  assert.deepEqual(multiline.options, ['True', 'False']);
});

test('deduplicates and prefers the copy with a key', () => {
  const input = 'Question 1\nSame question?\nChoice A: one\nChoice B: two\n\nQuestion 2\nSame question?\nCorrect! Choice A: one\nChoice B: two';
  const {questions} = core.parseImport(input);
  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0].correctAnswers, [0]);
});

test('imports exported JSON', () => {
  const input = JSON.stringify({title:'My review',questions:[{text:'Name it',answer:'STP'}]});
  const result = core.parseImport(input);
  assert.equal(result.title, 'My review');
  assert.equal(result.questions[0].answer, 'STP');
});

test('matches a separate answer key to a labeled choice', () => {
  const input = 'Question 1\nWhich one?\nChoice A: first\nChoice B: second\nAnswer: B';
  const q = core.parseImport(input).questions[0];
  assert.deepEqual(q.options, ['first', 'second']);
  assert.deepEqual(q.correctAnswers, [1]);
});

test('keeps exhibit references with the question and accepts embedded image data', () => {
  const linked = core.parseImport('Question 1\nRefer to the exhibit. What is shown?\nExhibit: topology.png\nChoice A: one\nCorrect! Choice B: two').questions[0];
  assert.equal(linked.text, 'Refer to the exhibit. What is shown?');
  assert.deepEqual(linked.imageRefs, ['topology.png']);
  const embedded = core.parseImport('Question 2\nRead the diagram.\nExhibit: data:image/png;base64,aGVsbG8=\nAnswer: diagram').questions[0];
  assert.deepEqual(embedded.images, ['data:image/png;base64,aGVsbG8=']);
  const markdown = core.parseImport('Question 3\nWhat does this show?\n![Exhibit](https://example.com/figure.png)\nAnswer: example').questions[0];
  assert.deepEqual(markdown.images, ['https://example.com/figure.png']);
});

test('attaches image files by filename and preserves old or bundled exhibits', () => {
  const questions = [
    {sourceNumber:'1',text:'Question one',imageRefs:['topology.png']},
    {sourceNumber:'2',text:'Question two',imageRefs:['attached']},
    {sourceNumber:'3',text:'Refer to this exhibit',imageRefs:[]},
    {sourceNumber:'4',text:'Question four',imageRefs:['missing']}
  ];
  const old = [{sourceNumber:'2',text:'Question two',images:['data:image/png;base64,b2xk']}];
  const bundled = [{sourceNumber:'3',text:'Refer to this exhibit',images:['data:image/png;base64,cGRm']}];
  const result = core.resolveImageFiles(questions,[{name:'Topology.PNG',data:'data:image/png;base64,bG9jYWw='}],bundled,old);
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(questions[0].images,['data:image/png;base64,bG9jYWw=']);
  assert.deepEqual(questions[1].images,['data:image/png;base64,b2xk']);
  assert.deepEqual(questions[2].images,['data:image/png;base64,cGRm']);
  assert.deepEqual(questions[3].imageRefs,['missing']);
});

test('imports the source PDF style with unlabeled choices', () => {
  const input = 'Question 2\nWhich statement describes a characteristic of EtherChannel?\nIt can combine up to a maximum of 4 physical links.\nIt consists of multiple parallel links\nCorrect! It is made by combining multiple physical links that are seen as one link\nIt can bundle mixed types of 100 Mb/s and 1Gb/s Ethernet links.';
  const {questions} = core.parseImport(input);
  assert.equal(questions[0].options.length, 4);
  assert.deepEqual(questions[0].correctAnswers, [2]);
});

test('uses PDF indentation and spacing to keep wrapped choices intact', () => {
  const pages = [[
    {x:68,y:728,text:'Question 1'},
    {x:68,y:706,text:'Which choice is correct?'},
    {x:85,y:686,text:'First choice spans'},
    {x:85,y:672,text:'two lines'},
    {x:85,y:653,text:'Correct! Second choice'},
    {x:85,y:634,text:'Third choice'},
    {x:85,y:615,text:'Fourth choice'},
    {x:540,y:30,text:'1'}
  ]];
  const q = core.parseImport(core.formatPdfRows(pages)).questions[0];
  assert.deepEqual(q.options, ['First choice spans\ntwo lines','Second choice','Third choice','Fourth choice']);
  assert.deepEqual(q.correctAnswers, [1]);
});

test('bundled reviewer has complete questions and answer keys', () => {
  global.window = {};
  require('./reviewer-data');
  const questions = window.RECALL_STARTER_REVIEWER.questions;
  assert.equal(questions.length, 170);
  assert.equal(questions.filter(q => q.options.length === 4).length, 147);
  assert.equal(questions.filter(q => q.options.length === 2).length, 23);
  assert.ok(questions.every(q => q.text && q.correctAnswers.length === 1));
  assert.equal(questions.filter(q => q.images?.length).length, 21);
  assert.deepEqual(questions.filter(q => q.images?.length).map(q => Number(q.sourceNumber)), [6,12,16,24,30,34,43,48,54,87,89,99,112,113,120,143,144,148,153,156,164]);
  assert.ok(questions.filter(q => q.images?.length).every(q => /exhibit/i.test(q.text)));
  assert.equal(new Set(questions.map(q => core.normalize(q.text))).size, 170);
});
