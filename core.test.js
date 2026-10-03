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

test('parses one-question-per-page reviewer with repeated matching answers and multi-select keys', () => {
  const source = `CCST NETWORKING REVIEWER
1
QUESTION 1 | SOURCE PAGE 17
Move each protocol to its characteristics. Options: SFTP, TFTP.
1. Uses SSH keys.
Answer: SFTP
2. Transfers files over port 22.
Answer: SFTP
3. Transfers small files over UDP.
Answer: TFTP
ANSWER + EXPLANATION
SFTP uses SSH. TFTP uses UDP.
CCST NETWORKING REVIEWER
2
QUESTION 2 | SOURCE PAGE 29
Choose two answers.
A. First
B. Second
C. Third
D. Fourth
ANSWER + EXPLANATION
Answers: B and D. These are correct.`;
  const parsed=core.parseImport(source);
  assert.equal(parsed.questions.length,2);
  assert.equal(parsed.questions[0].type,'matching');
  assert.equal(parsed.questions[0].sourcePage,'17');
  assert.deepEqual(parsed.questions[0].matches.map(pair=>pair.answer),['SFTP','SFTP','TFTP']);
  assert.equal(core.isCorrect(parsed.questions[0],['SFTP','SFTP','TFTP']),true);
  assert.deepEqual(parsed.questions[1].correctAnswers,[1,3]);
});

test('grades several written parts independently within one card', () => {
  const q=core.parseImport(JSON.stringify({questions:[{text:'Configure both interfaces.',type:'multi-text',parts:[{prompt:'First',answer:'up'},{prompt:'Second',answer:'down',acceptedAnswers:['shutdown']}]}]})).questions[0];
  assert.equal(q.type,'multi-text');
  assert.equal(core.isCorrect(q,['up','shutdown']),true);
  assert.equal(core.isCorrect(q,['up','up']),false);
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
  assert.equal(multiline.text, 'A flag signifies SLAAC without ending punctuation');
  assert.deepEqual(multiline.options, ['True', 'False']);
});

test('imports a multi-statement true-false question as one three-point card', () => {
  const parsed=core.parseImport('Question 1\nFor each statement about bandwidth and throughput, select True or False.\nF  High levels of network latency decreases network bandwidth.\nT  Low Bandwidth can increase network latency.\nT  You can increase throughput by decreasing network congestion.');
  assert.equal(parsed.questions.length,1);
  assert.equal(parsed.questions[0].type,'grouped-boolean');
  assert.equal(parsed.questions[0].statements.length,3);
  assert.deepEqual(parsed.questions[0].statementAnswers,['False','True','True']);
  assert.equal(core.isCorrect(parsed.questions[0],['False','True','True']),true);
  assert.equal(core.isCorrect(parsed.questions[0],['True','True','True']),false);
});

test('recognizes imported T/F assertion choices as one grouped true-false card',()=>{
  const q=core.parseImport(`Question 1
Review each firewall statement.
Choice A: T A firewall can block traffic to specific ports.
Choice B: T A firewall can direct web traffic using proxy rules.
Choice C: F A firewall can prevent an app from launching.`).questions[0];
  assert.equal(q.type,'grouped-boolean');
  assert.deepEqual(q.statements,['A firewall can block traffic to specific ports.','A firewall can direct web traffic using proxy rules.','A firewall can prevent an app from launching.']);
  assert.deepEqual(q.statementAnswers,['True','True','False']);
  assert.equal(core.isCorrect(q,['True','True','False']),true);
});

test('JSON import preserves grouped true-false and matching activity types', () => {
  const questions=core.parseImport(JSON.stringify({questions:[
    {text:'Choose true or false.',statements:['First statement','Second statement'],statementAnswers:['T','F']},
    {text:'Match each item.',answerTiles:['A','B'],matches:[{prompt:'First',answer:'A'},{prompt:'Second',answer:'B'}]}
  ]})).questions;
  assert.equal(questions[0].type,'grouped-boolean');
  assert.equal(questions[1].type,'matching');
});

test('imports answer-bank matching activities as one point-per-pair card',()=>{
  const imported=core.parseImport('Question 1: Move each cloud computing service model from the list on the left to the correct example. IaaS SaaS PaaS\nPAAS - A company develops an application using cloud-based resources and tools.\nIAAS - Virtual machines are connected by a virtual network in the cloud.\nSAAS - User accesses a web-based graphics design application for a monthly fee.');
  const q=imported.questions[0];
  assert.equal(q.type,'matching');
  assert.equal(q.matches.length,3);
  assert.equal(q.answerTiles.length,3);
  assert.equal(core.isCorrect(q,['PaaS','IaaS','SaaS']),true);
  assert.equal(core.isCorrect(q,['IaaS','IaaS','SaaS']),false);
});

test('parses PDF prompt matching blocks that map single-letter bank labels to answer tiles',()=>{
  const imported=core.parseImport(`Question 1
Move each protocol to its matching description.
Word: A - SFTP
Word: B - TFTP
Example 1: Uses SSH and port 22. | A
Example 2: Transfers small files over UDP port 69. | B
Explanation: SFTP uses SSH; TFTP uses UDP.`);
  const q=imported.questions[0];
  assert.equal(q.type,'matching');
  assert.deepEqual(q.answerTiles,['SFTP','TFTP']);
  assert.deepEqual(q.matches.map(match=>match.answer),['SFTP','TFTP']);
  assert.equal(core.isCorrect(q,['SFTP','TFTP']),true);
  assert.deepEqual(imported.warnings,[]);
});

test('deduplicates and prefers the copy with a key', () => {
  const input = 'Question 1\nSame question?\nChoice A: one\nChoice B: two\n\nQuestion 2\nSame question?\nCorrect! Choice A: one\nChoice B: two';
  const {questions} = core.parseImport(input);
  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0].correctAnswers, [0]);
});

test('deduplication keeps an available explanation with the retained answer key', () => {
  const input = 'Question 1\nSame question?\nChoice A: one\nChoice B: two\nExplanation: The second choice follows the rule.\nQuestion 2\nSame question?\nChoice A: one\nCorrect! Choice B: two';
  const {questions} = core.parseImport(input);
  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0].correctAnswers, [1]);
  assert.equal(questions[0].explanation, 'The second choice follows the rule.');
});

test('imports exported JSON', () => {
  const input = JSON.stringify({title:'My review',questions:[{text:'Name it',answer:'STP'}]});
  const result = core.parseImport(input);
  assert.equal(result.title, 'My review');
  assert.equal(result.questions[0].answer, 'STP');
});

test('identification grading accepts case, spacing, punctuation, and listed alternatives', () => {
  const question = core.parseImport('Question 1\nName the spanning-tree protocol.\nAnswer: STP\nAlso accepted: spanning tree protocol | spanning-tree protocol').questions[0];
  assert.equal(core.isCorrect(question, [' stp!!! ']), true);
  assert.equal(core.isCorrect(question, ['SPANNING   TREE PROTOCOL']), true);
  assert.equal(core.isCorrect(question, ['etherchannel']), false);
});

test('accepted answer alternatives survive JSON normalization and command blocks retain line breaks', () => {
  const q = core.normalizeQuestion({text:'Name the protocol',answer:'STP',acceptedAnswers:['Spanning Tree Protocol']});
  assert.equal(core.isCorrect(q, ['spanning tree protocol']), true);
  const config = core.normalizeQuestion({
    text:'Configure the channel:\nSW1# show running-config\ninterface GigabitEthernet0/1',
    options:['channel-group 1 mode active\nswitchport mode trunk']
  });
  assert.match(config.text, /show running-config\ninterface GigabitEthernet0\/1/);
  assert.equal(config.options[0], 'channel-group 1 mode active\nswitchport mode trunk');
});

test('matches a separate answer key to a labeled choice', () => {
  const input = 'Question 1\nWhich one?\nChoice A: first\nChoice B: second\nAnswer: B';
  const q = core.parseImport(input).questions[0];
  assert.deepEqual(q.options, ['first', 'second']);
  assert.deepEqual(q.correctAnswers, [1]);
});

test('matches true false text and multi-choice answer keys without treating words as letters', () => {
  const boolean = core.parseImport('Question 1\nIs the link up?\nChoice A: True\nChoice B: False\nAnswer: False\nExplanation: The interface is down.').questions[0];
  assert.deepEqual(boolean.correctAnswers, [1]);
  assert.equal(boolean.explanation, 'The interface is down.');
  const multiple = core.parseImport('Question 2\nChoose two.\nChoice A: One\nChoice B: Two\nChoice C: Three\nChoice D: Four\nAnswers: A and D. These are valid.').questions[0];
  assert.deepEqual(multiple.correctAnswers, [0, 3]);
  assert.equal(multiple.explanation, 'These are valid.');
  const described = core.parseImport('Question 3\nIs the link up?\nChoice A: True\nChoice B: False\nAnswer: False - The interface is down.').questions[0];
  assert.deepEqual(described.correctAnswers, [1]);
  assert.equal(described.explanation, 'The interface is down.');
});

test('keeps a corrected computed answer when no listed option is valid', () => {
  const q = core.parseImport('Question 1\nCompute the CIDR.\nChoice A: 1/20\nChoice B: 1/21\nANSWER + EXPLANATION\nNo listed answer is fully correct. The result is 1/22.').questions[0];
  assert.equal(q.answer, '1/22');
  assert.deepEqual(q.correctAnswers, []);
  assert.equal(core.isCorrect(q, ['1/22']), true);
  assert.equal(core.isCorrect(q, [0]), false);
});

test('infers multiple correct choices when only the explanation gives their letters', () => {
  const q = core.parseImport('Question 1\nChoose two.\nChoice A: one\nChoice B: two\nChoice C: three\nChoice D: four\nExplanation: The correct answers are A and D because both meet the rule.').questions[0];
  assert.deepEqual(q.correctAnswers, [0, 3]);
});

test('explanation-only PDF blocks do not retain a choice question type', () => {
  const parsed = core.parseImport('Question 1\nMatch the items.\nAlpha\nBeta\nANSWER + EXPLANATION\nAlpha: first. Beta: second.');
  const q = parsed.questions[0];
  assert.equal(q.type, 'text');
  assert.deepEqual(q.options, []);
  assert.match(q.explanation, /Alpha: first/);
  assert.ok(parsed.warnings.some(warning => /no single answer/.test(warning)));
});

test('keeps exhibit references with the question and accepts embedded image data', () => {
  const linked = core.parseImport('Question 1\nRefer to the exhibit. What is shown?\nExhibit: topology.png\nAlt text: Two switches connected by a trunk.\nChoice A: one\nCorrect! Choice B: two').questions[0];
  assert.equal(linked.text, 'Refer to the exhibit. What is shown?');
  assert.deepEqual(linked.imageRefs, ['topology.png']);
  assert.deepEqual(linked.imageAlts, ['Two switches connected by a trunk.']);
  assert.equal(linked.options.length, 2);
  const embedded = core.parseImport('Question 2\nRead the diagram.\nExhibit: data:image/png;base64,aGVsbG8=\nAnswer: diagram').questions[0];
  assert.deepEqual(embedded.images, ['data:image/png;base64,aGVsbG8=']);
  const markdown = core.parseImport('Question 3\nWhat does this show?\n![Exhibit](https://example.com/figure.png)\nAnswer: example').questions[0];
  assert.deepEqual(markdown.images, ['https://example.com/figure.png']);
  assert.deepEqual(markdown.imageAlts, ['Exhibit']);
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
  assert.deepEqual(questions[3].imageRefs,[]);
});

test('imports the source PDF style with unlabeled choices', () => {
  const input = 'Question 2\nWhich statement describes a characteristic of EtherChannel?\nIt can combine up to a maximum of 4 physical links.\nIt consists of multiple parallel links\nCorrect! It is made by combining multiple physical links that are seen as one link\nIt can bundle mixed types of 100 Mb/s and 1Gb/s Ethernet links.';
  const {questions} = core.parseImport(input);
  assert.equal(questions[0].options.length, 4);
  assert.deepEqual(questions[0].correctAnswers, [2]);
});

test('joins PDF-wrapped choice lines into readable phrases', () => {
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
  assert.deepEqual(q.options, ['First choice spans two lines','Second choice','Third choice','Fourth choice']);
  assert.deepEqual(q.correctAnswers, [1]);
});

test('keeps pages with unlabeled marked PDF choices when no question headings exist', () => {
  const pages = [[
    {x:40,y:720,text:'Which link is active?'},
    {x:40,y:700,text:'The first link'},
    {x:40,y:680,text:'Correct! The second link'},
    {x:40,y:660,text:'The third link'}
  ]];
  const questions = core.parseImport(core.formatPdfRows(pages)).questions;
  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0].correctAnswers, [1]);
});

test('imports parser companion format without conflicting duplicate answer keys', () => {
  const input = 'Question 1\nSelect two interfaces.\nCorrect! Choice A: Gi0/1\nChoice B: Gi0/2\nCorrect! Choice C: Gi0/3\nExplanation: Both marked interfaces match the configuration.';
  const {questions, warnings} = core.parseImport(input);
  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0].options, ['Gi0/1','Gi0/2','Gi0/3']);
  assert.deepEqual(questions[0].correctAnswers, [0,2]);
  assert.equal(questions[0].explanation, 'Both marked interfaces match the configuration.');
  assert.deepEqual(warnings, []);
});

test('parses exhibit only when marker uses its exact attached image filename', () => {
  const input = 'Question 1\nRefer to the diagram.\nExhibit: q001-diagram.png\nAlt text: A router connected to a switch.';
  const question = core.parseImport(input).questions[0];
  const resolved = core.resolveImageFiles([question], [{name:'q001-diagram.png',data:'data:image/png;base64,ZmFrZQ=='}]);
  assert.deepEqual(resolved.unresolved, []);
  assert.equal(question.images[0], 'data:image/png;base64,ZmFrZQ==');
});

test('ignores descriptive missing-exhibit placeholders without treating them as filenames', () => {
  const question = core.parseImport('Question 1\nWhat does the unavailable figure show?\nExhibit: Missing from source page 59.\nAlt text: The figure was not present in the source.').questions[0];
  const resolved = core.resolveImageFiles([question]);
  assert.deepEqual(resolved.unresolved, []);
  assert.deepEqual(question.imageRefs, []);
  assert.equal((question.images || []).length, 0);
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
