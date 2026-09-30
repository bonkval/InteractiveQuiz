/* Parsing and review rules shared by the browser and the checks in core.test.js. */
const RevCore = (() => {
  const normalize = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  const unique = values => [...new Set(values)];

  function normalizeQuestion(raw, index = 0) {
    const options = Array.isArray(raw?.options) ? raw.options.map(x => String(x).trim()) : [];
    const correctAnswers = unique(Array.isArray(raw?.correctAnswers) ? raw.correctAnswers.map(Number) : [])
      .filter(i => Number.isInteger(i) && i >= 0 && i < options.length);
    const answer = String(raw?.answer ?? '').trim();
    return {
      sourceNumber: String(raw?.sourceNumber ?? index + 1),
      text: String(raw?.text ?? '').trim(),
      options,
      correctAnswers,
      answer,
      type: options.length ? (options.length === 2 && options.every(x => /^(true|false)$/i.test(x)) ? 'boolean' : 'choice') : 'text',
      ...(raw?.image ? { image: String(raw.image) } : {})
    };
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
    const lines = block.lines.filter(Boolean);
    if (!lines.length) return null;
    const answerAt = lines.findIndex(line => /^Answer\s*:\s*\S/i.test(line));
    if (answerAt >= 0) {
      const key = lines[answerAt].replace(/^Answer\s*:\s*/i, '').trim();
      if (lines.slice(0, answerAt).some(line => optionLine(line).labeled)) {
        const question = parseBlock({...block, lines: lines.slice(0, answerAt)}, []);
        const letter = key.match(/^(?:Choice\s+)?([A-Z])\s*[.)]?$/i);
        const index = letter ? letter[1].toUpperCase().charCodeAt(0) - 65
          : question.options.findIndex(option => normalize(option) === normalize(key));
        if (index >= 0 && index < question.options.length) question.correctAnswers = [index];
        else warnings.push(`Question ${block.number}: answer key did not match a choice.`);
        return question;
      }
      return normalizeQuestion({ sourceNumber: block.number, text: [block.heading, ...lines.slice(0, answerAt)].filter(Boolean).join('\n'), answer: key });
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
    return normalizeQuestion({ sourceNumber: block.number, text, options, correctAnswers });
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
    if (!headings.length) return pages.map(rows => rows.map(row => row.text).join('\n')).join('\n');
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

  function isCorrect(question, answer) {
    if (!Array.isArray(answer) || !answer.length) return false;
    if (question.options.length) {
      return answer.length === question.correctAnswers.length && answer.every(i => question.correctAnswers.includes(i));
    }
    return !!question.answer && normalize(answer[0]).replace(/[.,!?;:]$/, '') === normalize(question.answer).replace(/[.,!?;:]$/, '');
  }

  return { parseImport, parseText, formatPdfRows, normalizeQuestion, isCorrect, normalize };
})();

if (typeof module !== 'undefined') module.exports = RevCore;
if (typeof window !== 'undefined') window.RevCore = RevCore;
