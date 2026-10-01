/* Parsing and review rules shared by the browser and the checks in core.test.js. */
const RevCore = (() => {
  const normalize = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  const unique = values => [...new Set(values)];

  function cleanReadingText(value) {
    const lines = String(value ?? '').replace(/\r/g, '').split('\n');
    const codeLine = /^(?:\S+[>#]\s|interface\s|switchport\s|channel-group\s|ip\s+(?:address|route|helper|access-group)\b|router\s+\w|hostname\s|vlan\s+\d|spanning-tree\s|no\s+\S|shutdown\b|description\s|configure terminal\b|show\s+\S|line\s+vty\b|exit\s*$)/i;
    const cleanLine = line => line.trim().replace(/[\t ]+/g, ' ');
    if (lines.length > 1 && lines.some(line => codeLine.test(line.trim()))) {
      return lines.map(cleanLine).filter(Boolean).join('\n');
    }
    return lines.map(cleanLine).filter(Boolean).join(' ');
  }

  function normalizeQuestion(raw, index = 0) {
    const options = Array.isArray(raw?.options) ? raw.options.map(cleanReadingText) : [];
    const correctAnswers = unique(Array.isArray(raw?.correctAnswers) ? raw.correctAnswers.map(Number) : [])
      .filter(i => Number.isInteger(i) && i >= 0 && i < options.length);
    const answerValues = Array.isArray(raw?.answer) ? raw.answer : [raw?.answer, ...(Array.isArray(raw?.answers) ? raw.answers : [])];
    const answer = cleanReadingText(answerValues.find(value => String(value ?? '').trim()));
    const acceptedAnswers = unique([
      ...answerValues.slice(1).map(cleanReadingText),
      ...(Array.isArray(raw?.acceptedAnswers) ? raw.acceptedAnswers.map(cleanReadingText) : [])
    ].filter(value => value && normalize(value) !== normalize(answer)));
    return {
      sourceNumber: String(raw?.sourceNumber ?? index + 1),
      text: cleanReadingText(raw?.text),
      options,
      correctAnswers,
      answer,
      ...(raw?.explanation ? {explanation: cleanReadingText(raw.explanation)} : {}),
      ...(raw?.topic ? {topic: cleanReadingText(raw.topic)} : {}),
      ...(raw?.optionExplanations && typeof raw.optionExplanations === 'object' ? {optionExplanations: Object.fromEntries(Object.entries(raw.optionExplanations).map(([i, value]) => [i, cleanReadingText(value)]))} : {}),
      ...(acceptedAnswers.length ? {acceptedAnswers} : {}),
      type: options.length ? (options.length === 2 && options.every(x => /^(true|false)$/i.test(x)) ? 'boolean' : 'choice') : 'text',
      ...(raw?.image ? { image: String(raw.image) } : {}),
      ...(Array.isArray(raw?.images) ? { images: raw.images.map(x => String(x)).filter(Boolean) } : []),
      ...(Array.isArray(raw?.imageAlts) ? { imageAlts: raw.imageAlts.map(x => cleanReadingText(x)) } : []),
      ...(Array.isArray(raw?.imageRefs) || raw?.imageRef ? { imageRefs: [...(Array.isArray(raw?.imageRefs) ? raw.imageRefs : raw?.imageRefs ? [raw.imageRefs] : []), ...(raw?.imageRef ? [raw.imageRef] : [])].map(String) } : [])
    };
  }

  function imageSources(lines) {
    const images = [], imageRefs = [], imageAlts = [];
    for (const line of lines) {
      const altLine = line.match(/^\s*Alt text(?:\s+\d+)?\s*:\s*(.*?)\s*$/i);
      if (altLine) { imageAlts.push(cleanReadingText(altLine[1])); continue; }
      const marker = line.match(/^\s*(?:Exhibit|Image)\s*:\s*(.*?)\s*$/i);
      const markdown = line.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/);
      const source = (marker?.[1] || markdown?.[2] || '').trim();
      if (!source) continue;
      if (markdown?.[1]) imageAlts.push(cleanReadingText(markdown[1]));
      if (/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(source) || /^https?:\/\//i.test(source)) images.push(source);
      else imageRefs.push(source);
    }
    return {images, imageRefs, imageAlts};
  }

  function optionLine(line) {
    let text = line.trim(), correct = false, wrong = false, labeled = false;
    const scored = text.match(/^(.*?)\s*\((correct|wrong)\)\s*$/i);
    if (scored) {
      text = scored[1].replace(/^You Answered\s+/i, '').trim();
      correct = scored[2].toLowerCase() === 'correct';
      wrong = !correct;
    }
    const marker = text.match(/^(?:Correct!\s*|Correct:\s*|✓\s*|✅\s*)(.*)$/i);
    if (marker) { text = marker[1].trim(); correct = true; }
    const label = text.match(/^(?:(?:Choice|Option)\s+([A-Z])\s*[:.)-]|\(([A-Z])\)|([A-Z])[.):])\s*(.*)$/i);
    if (label) { text = label[4].replace(/^You Answered\s+/i, '').trim(); labeled = true; }
    return { text, correct, wrong, labeled, marked: correct || wrong };
  }

  function questionHeading(line, expectedNumber) {
    const explicit = line.match(/^\s*(?:#{1,6}\s*)?(?:Question|Q)\s*#?\s*(\d+)\s*(?:[.):\-]\s*)?(.*)$/i);
    if (explicit) return { number: explicit[1], text: explicit[2].trim() };
    const numeric = line.match(/^\s*(\d{1,4})[.)]\s+(.+)$/);
    if (numeric && (!expectedNumber || Number(numeric[1]) === expectedNumber)) {
      return { number: numeric[1], text: numeric[2].trim() };
    }
    return null;
  }

  function parseBlock(block, warnings) {
    const media = imageSources(block.lines);
    const lines = block.lines.filter(line => line && !/^\s*(?:(?:Exhibit|Image|Alt text(?:\s+\d+)?)\s*:|!\[[^\]]*\]\([^)]+\)\s*$)/i.test(line));
    if (!lines.length) return null;
    const explanationAt = lines.findIndex(line => /^ANSWER\s*\+\s*EXPLANATION(?:\s*\|\s*PAGE\s+\d+)?\s*$/i.test(line));
    if (explanationAt >= 0) {
      const sourceLines = lines.slice(0, explanationAt);
      const question = parseBlock({...block, lines:sourceLines}, []);
      const hasChoiceMarkers = sourceLines.some(line => optionLine(line).labeled || optionLine(line).marked);
      if (!hasChoiceMarkers && question.options.length) {
        question.options = []; question.correctAnswers = [];
        question.text = cleanReadingText([block.heading, ...sourceLines].filter(Boolean).join('\n'));
      }
      const notes = lines.slice(explanationAt + 1);
      const explicit = notes.find(line => /^(?:(?:Correct\s+)?Answers?|Best answer)\s*:/i.test(line));
      if (explicit) applyAnswerKey(question, explicit.replace(/^(?:(?:Correct\s+)?Answers?|Best answer)\s*:\s*/i, ''), warnings, block);
      const optionExplanations = Object.fromEntries(notes.map(line => { const match = line.match(/^Why\s+([A-Z])\s*:\s*(.+)$/i); return match ? [match[1].toUpperCase().charCodeAt(0)-65, cleanReadingText(match[2])] : null; }).filter(Boolean));
      if (Object.keys(optionExplanations).length) question.optionExplanations = optionExplanations;
      const rationale = notes.filter(line => line !== explicit && !/^Also accepted\s*:/i.test(line) && !/^Why\s+[A-Z]\s*:/i.test(line)).map(line => line.replace(/^Explanation\s*:\s*/i, '').trim()).filter(Boolean);
      question.explanation = cleanReadingText([question.explanation, ...rationale].filter(Boolean).join('\n'));
      if (!question.correctAnswers.length && !question.answer) {
        const stated = question.explanation.match(/(?:the\s+)?correct answer\s+(?:is\s+)?(?:Choice\s+)?([A-Z]|[^.!?]+?)(?=\s+(?:because|since|as)\b|[.!?]|$)/i);
        if (stated) {
          const token = stated[1].trim().replace(/["“”]/g, '');
          const index = /^[A-Z]$/i.test(token) ? token.toUpperCase().charCodeAt(0) - 65 : question.options.findIndex(option => normalize(option) === normalize(token));
          if (index >= 0 && index < question.options.length) question.correctAnswers = [index];
          else if (!/^[A-Z]$/i.test(token)) question.answer = token;
        }
        const correctedResult = question.explanation.match(/\bresult\s+is\s+([^.;!?]+)/i);
        const noListedAnswer = /no (?:correct )?(?:listed )?answer|no correct option|no listed answer/i.test(question.explanation);
        if (correctedResult && noListedAnswer && !question.answer) question.answer = cleanReadingText(correctedResult[1]);
        else if (!question.options.length && question.explanation && !question.answer) question.answer = question.explanation;
        else if (noListedAnswer && !question.answer) question.answer = question.explanation;
      }
      return attachImages(question, media);
    }
    const answerAt = lines.findIndex(line => /^(?:(?:Correct\s+)?Answers?|Best answer)\s*:\s*\S/i.test(line));
    if (answerAt >= 0) {
      const key = lines[answerAt].replace(/^(?:(?:Correct\s+)?Answers?|Best answer)\s*:\s*/i, '').trim();
      const acceptedAnswers = lines.slice(answerAt + 1)
        .filter(line => /^Also accepted\s*:/i.test(line))
        .flatMap(line => line.replace(/^Also accepted\s*:\s*/i, '').split(/\s*[|;]\s*/).map(value => value.trim()).filter(Boolean));
      if (lines.slice(0, answerAt).some(line => optionLine(line).labeled)) {
        const question = parseBlock({...block, lines: lines.slice(0, answerAt)}, []);
        applyAnswerKey(question, key, warnings, block);
        const notes = lines.slice(answerAt + 1), optionExplanations = Object.fromEntries(notes.map(line => { const match=line.match(/^Why\s+([A-Z])\s*:\s*(.+)$/i); return match ? [match[1].toUpperCase().charCodeAt(0)-65,cleanReadingText(match[2])] : null; }).filter(Boolean));
        if (Object.keys(optionExplanations).length) question.optionExplanations = optionExplanations;
        question.explanation = cleanReadingText([question.explanation, ...notes.filter(line => !/^Also accepted\s*:/i.test(line) && !/^Why\s+[A-Z]\s*:/i.test(line)).map(line => line.replace(/^Explanation\s*:\s*/i, ''))].filter(Boolean).join('\n'));
        return attachImages(question, media);
      }
      return attachImages(normalizeQuestion({ sourceNumber: block.number, text: [block.heading, ...lines.slice(0, answerAt)].filter(Boolean).join('\n'), answer: key, acceptedAnswers }), media);
    }
    const firstLabeled = lines.findIndex(line => optionLine(line).labeled);
    const firstMarked = lines.findIndex(line => optionLine(line).marked);
    let start = firstLabeled >= 0 ? firstLabeled : firstMarked;
    if (firstMarked >= 0 && (firstLabeled < 0 || firstMarked < firstLabeled)) {
      const preceding = lines.slice(0, firstMarked);
      const endOfQuestion = preceding.findLastIndex(line => /[?:]\s*$/.test(line));
      if (endOfQuestion >= 0) start = endOfQuestion + 1;
      else if (optionLine(lines[firstMarked]).wrong) start = firstMarked;
      else if (firstMarked > 1) {
        start = firstMarked - 1;
        warnings.push(`Question ${block.number}: check choices before the marked answer.`);
      }
    }
    if (start < 0) {
      const endOfQuestion = lines.findIndex(line => /[?:]\s*$/.test(line));
      start = endOfQuestion >= 0 ? endOfQuestion + 1 : Math.min(1, lines.length);
      if (lines.length > start) warnings.push(`Question ${block.number}: no answer key was found.`);
    }
    const text = [block.heading, ...lines.slice(0, start)].filter(Boolean).join('\n').trim();
    const optionRows = lines.slice(start);
    const labeled = optionRows.some(line => optionLine(line).labeled);
    const options = [], correctAnswers = [];
    for (const line of optionRows) {
      const option = optionLine(line);
      if (!option.text) continue;
      if (labeled && !option.labeled && !option.marked && options.length) {
        options[options.length - 1] += `\n${option.text}`;
      } else {
        options.push(option.text);
        if (option.correct) correctAnswers.push(options.length - 1);
      }
    }
    if (options.length && !correctAnswers.length && firstMarked < 0) {
      warnings.push(`Question ${block.number}: no answer key was found.`);
    }
    if (!text) warnings.push(`Question ${block.number}: question text is empty.`);
    return attachImages(normalizeQuestion({ sourceNumber: block.number, text, options, correctAnswers }), media);
  }

  function applyAnswerKey(question, rawKey, warnings, block) {
    const key = String(rawKey || '').trim();
    const letters = key.match(/^((?:Choice\s+)?[A-Z](?:\s*(?:,|and|&)\s*[A-Z])*)(?:\s*\([^)]*\))?(?:\s*[-–—:.]\s*(.*)|\s+(.+)|$)/i);
    const indices = letters ? [...letters[1].replace(/^Choice\s+/i, '').matchAll(/[A-Z]/gi)].map(([letter]) => letter.toUpperCase().charCodeAt(0) - 65) : [];
    const index = indices.length === 1 ? indices[0] : -1;
    const exactIndex = index < 0 && !indices.length ? question.options.findIndex(option => normalize(option) === normalize(key)) : -1;
    if (question.options.length && indices.length && indices.every(i => i >= 0 && i < question.options.length)) {
      question.correctAnswers = unique(indices);
      const rest = (letters[2] || letters[3] || '').trim();
      const firstOption = question.options[indices[0]] || '';
      question.explanation = rest && normalize(rest).startsWith(normalize(firstOption))
        ? rest.slice(firstOption.length).replace(/^[\s.\-–—:]+/, '').trim() : rest;
      return;
    }
    const matchedIndex = index >= 0 ? index : exactIndex;
    if (matchedIndex >= 0 && matchedIndex < question.options.length) {
      question.correctAnswers = [matchedIndex];
      const rest = (letters?.[2] || letters?.[3] || '').trim();
      const option = question.options[matchedIndex];
      question.explanation = rest && normalize(rest).startsWith(normalize(option))
        ? rest.slice(option.length).replace(/^[\s.\-–—:]+/, '').trim() : rest;
      return;
    }
    const text = (letters?.[2] || letters?.[3] || '').trim();
    if (!question.options.length) { question.answer = key; return; }
    const matchedText = text && question.options.findIndex(option => normalize(option) === normalize(text));
    if (matchedText >= 0) question.correctAnswers = [matchedText];
    else if (text) { question.answer = text; question.explanation = text; warnings.push(`Question ${block.number}: answer text did not match a choice; kept it as a written answer.`); }
    else warnings.push(`Question ${block.number}: answer key did not match a choice.`);
  }

  function attachImages(question, media) {
    if (media.images.length) question.images = [...(question.images || []), ...media.images];
    if (media.imageRefs.length) question.imageRefs = [...(question.imageRefs || []), ...media.imageRefs];
    if (media.imageAlts.length) question.imageAlts = media.imageAlts;
    if (question.images?.length === 1) question.image = question.images[0];
    return question;
  }

  function deduplicate(questions, warnings) {
    const result = [], byText = new Map();
    for (const q of questions) {
      const key = normalize(q.text);
      if (!key) continue;
      const prior = byText.get(key);
      if (prior === undefined) { byText.set(key, result.length); result.push(q); continue; }
      const existing = result[prior];
      const keyed = q.correctAnswers.length > 0 || !!q.answer;
      const existingKeyed = existing.correctAnswers.length > 0 || !!existing.answer;
      if (keyed && !existingKeyed) result[prior] = q;
      warnings.push(`Duplicate question ${q.sourceNumber} was removed.`);
    }
    return result;
  }

  function parseText(input) {
    const warnings = [], blocks = [];
    const text = String(input ?? '').replace(/\r/g, '').replace(/[\u200b\ufeff]/g, '')
      .replace(/^\s*```[^\n]*$/gm, '').replace(/\f/g, '\n');
    let block = null, expectedNumber = 1;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const heading = questionHeading(line, expectedNumber);
      if (heading) {
        if (block) blocks.push(block);
        block = { number: heading.number, heading: heading.text, lines: [] };
        expectedNumber = Number(heading.number) + 1;
      } else if (block) {
        // PDF page numbers are commonly a standalone line after the choices.
        if (/^\d{1,3}$/.test(line) && block.lines.some(x => optionLine(x).marked)) continue;
        block.lines.push(line);
      }
    }
    if (block) blocks.push(block);
    if (!blocks.length && text.trim()) {
      const parts = text.trim().split(/\n\s*\n+/);
      for (const part of parts) {
        const lines = part.split('\n').map(x => x.trim()).filter(Boolean);
        if (lines.length) blocks.push({ number: String(blocks.length + 1), heading: lines[0], lines: lines.slice(1) });
      }
    }
    const questions = deduplicate(blocks.map(block => parseBlock(block, warnings)).filter(Boolean), warnings);
    return { questions, warnings };
  }

  function parseImport(input) {
    const text = String(input ?? '').trim();
    if (!text) return { questions: [], warnings: [] };
    if (/^[\[{]/.test(text)) {
      try {
        const data = JSON.parse(text);
        const source = Array.isArray(data) ? data : data?.questions;
        if (Array.isArray(source)) {
          const warnings = [];
          const questions = deduplicate(source.map(normalizeQuestion), warnings);
          return { questions, warnings, title: !Array.isArray(data) ? String(data.title ?? '') : '' };
        }
      } catch { /* Continue as plain text. */ }
    }
    return parseText(text);
  }

  function formatPdfRows(pages) {
    const flat = pages.flatMap((rows, page) => rows.map(row => ({...row, page})));
    const headings = flat.filter(row => /^Question\s+\d+\s*$/i.test(row.text));
    if (!headings.length) {
      const questionPages = pages.map((rows, page) => {
        const text = rows.map(row => row.text).filter(line => !/^ANSWER\s*\+\s*EXPLANATION\s*\|\s*PAGE\s+\d+$/i.test(line)).join('\n');
        const lines = text.split('\n');
        const hasChoices = lines.some(line => /^(?:[A-H])[.)]\s*\S/.test(line.trim()));
        const hasExplanation = rows.some(row => /ANSWER\s*\+\s*EXPLANATION/i.test(row.text));
        return hasExplanation || hasChoices
          ? `Question ${page + 1}\n${rows.map(row => row.text).join('\n')}` : '';
      }).filter(Boolean);
      return questionPages.join('\n\n');
    }
    const baseX = Math.min(...headings.map(row => row.x));
    const indented = flat.filter(row => row.x > baseX + 8 && row.x < baseX + 80).length;
    if (indented < headings.length) return pages.map(rows => rows.map(row => row.text).join('\n')).join('\n');
    const output = [];
    let choice = 0, prior = null;
    for (const row of flat) {
      if (row.x > baseX + 100) continue;
      if (/^Question\s+\d+\s*$/i.test(row.text)) {
        output.push(row.text); choice = 0; prior = null; continue;
      }
      if (row.x <= baseX + 8) { output.push(row.text); prior = null; continue; }
      const newChoice = !prior || prior.page !== row.page || prior.y - row.y >= 17 || /^(?:Correct!|You Answered\s)/i.test(row.text);
      if (newChoice) {
        const scored = row.text.match(/^(?:You Answered\s+)?(.*?)\s*\((correct|wrong)\)$/i);
        const marked = row.text.match(/^Correct!\s*(.*)$/i);
        const correct = Boolean(marked || scored?.[2].toLowerCase() === 'correct');
        const content = marked?.[1] || scored?.[1] || row.text;
        const suffix = scored && !correct ? ' (wrong)' : '';
        output.push(`${correct ? 'Correct! ' : ''}Choice ${String.fromCharCode(65 + choice)}: ${content}${suffix}`);
        choice++;
      } else output[output.length - 1] += `\n${row.text}`;
      prior = row;
    }
    return output.join('\n');
  }

  function resolveImageFiles(questions, imageFiles = [], fallbackQuestions = [], previousQuestions = []) {
    const byName = new Map();
    for (const file of imageFiles) {
      const name = String(file.name).split(/[\\/]/).pop().toLocaleLowerCase();
      byName.set(name, file.data);
      byName.set(name.replace(/\.[^.]+$/, ''), file.data);
    }
    const unresolved = [];
    for (const question of questions) {
      const remainingRefs = [];
      for (const ref of question.imageRefs || []) {
        const name = String(ref).split(/[\\/]/).pop().toLocaleLowerCase();
        const image = byName.get(name) || byName.get(name.replace(/\.[^.]+$/, ''));
        if (image) question.images = [...(question.images || []), image];
        else if (name === 'missing') remainingRefs.push('missing');
        else if (name === 'attached') {
          const old = previousQuestions.find(item => item.sourceNumber === question.sourceNumber);
          if (old) question.images = [...(question.images || []), ...(old.images || []), ...(old.image ? [old.image] : [])];
          else unresolved.push(ref);
        } else unresolved.push(ref);
      }
      question.imageRefs = remainingRefs;
      const old = previousQuestions.find(item => item.sourceNumber === question.sourceNumber);
      const source = fallbackQuestions.find(item => normalize(item.text) === normalize(question.text));
      if (!question.images?.length && old) question.images = [...(old.images || []), ...(old.image ? [old.image] : [])];
      if (!question.images?.length && source?.images?.length) question.images = source.images;
      if (question.images?.length) question.images = unique(question.images);
      if (question.images?.length === 1) question.image = question.images[0];
      else delete question.image;
    }
    return { questions, unresolved: unique(unresolved) };
  }

  function isCorrect(question, answer) {
    if (!Array.isArray(answer) || !answer.length) return false;
    if (question.options.length) {
      return answer.length === question.correctAnswers.length && answer.every(i => question.correctAnswers.includes(i));
    }
    const cleanAnswer = value => normalize(value).replace(/[\s.,!?;:]+$/, '');
    return [question.answer, ...(question.acceptedAnswers || [])]
      .some(expected => !!expected && cleanAnswer(answer[0]) === cleanAnswer(expected));
  }

  return { parseImport, parseText, formatPdfRows, resolveImageFiles, normalizeQuestion, isCorrect, normalize };
})();

if (typeof module !== 'undefined') module.exports = RevCore;
if (typeof window !== 'undefined') window.RevCore = RevCore;
