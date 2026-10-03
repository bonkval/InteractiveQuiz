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
      ...(raw?.sourcePage ? {sourcePage:String(raw.sourcePage)} : {}),
      text: cleanReadingText(raw?.text),
      ...(Array.isArray(raw?.statements) ? {statements:raw.statements.map(cleanReadingText),statementAnswers:Array.isArray(raw?.statementAnswers)?raw.statementAnswers.map(value=>/^(?:T|True)$/i.test(String(value))?'True':'False'):[]} : {}),
      ...(Array.isArray(raw?.matches) ? {matches:raw.matches.map(pair=>({answer:cleanReadingText(pair.answer),prompt:cleanReadingText(pair.prompt),correct:Boolean(pair.correct)})),answerTiles:Array.isArray(raw?.answerTiles)?raw.answerTiles.map(cleanReadingText):[]} : {}),
      ...(Array.isArray(raw?.parts) ? {parts:raw.parts.map(part=>({prompt:cleanReadingText(part.prompt),answer:cleanReadingText(part.answer),acceptedAnswers:Array.isArray(part.acceptedAnswers)?part.acceptedAnswers.map(cleanReadingText):[]}))} : {}),
      options,
      correctAnswers,
      answer,
      ...(raw?.explanation ? {explanation: cleanReadingText(raw.explanation)} : {}),
      ...(raw?.topic ? {topic: cleanReadingText(raw.topic)} : {}),
      ...(raw?.optionExplanations && typeof raw.optionExplanations === 'object' ? {optionExplanations: Object.fromEntries(Object.entries(raw.optionExplanations).map(([i, value]) => [i, cleanReadingText(value)]))} : {}),
      ...(acceptedAnswers.length ? {acceptedAnswers} : {}),
      type: Array.isArray(raw?.parts) ? 'multi-text' : Array.isArray(raw?.statements) ? 'grouped-boolean' : Array.isArray(raw?.matches) ? 'matching' : options.length ? (options.length === 2 && options.every(x => /^(true|false)$/i.test(x)) ? 'boolean' : 'choice') : 'text',
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
      const embedded = source.match(/^data:image\/(png|jpe?g|webp|gif);base64,([a-z0-9+/=\s]+)$/i);
      if (embedded) images.push(`data:image/${embedded[1].toLowerCase().replace('jpg','jpeg')};base64,${embedded[2].replace(/\s/g,'')}`);
      else if (/^https?:\/\//i.test(source)) images.push(source);
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

  function attachExplanationNotes(question, notes, warnings, block) {
    if (!question || !notes?.length) return question;
    const rationale = [], optionExplanations = {...(question.optionExplanations || {})};
    let destination = null;
    for (const raw of notes) {
      const line = String(raw || '').trim();
      if (!line) continue;
      const answer = line.match(/^(?:(?:Correct\s+)?Answers?|Best answer)\s*:\s*(.+)$/i);
      if (answer) {
        if (!question.correctAnswers.length && !question.answer && !isUnknownAnswer(answer[1])) {
          if (question.options.length) applyAnswerKey(question, answer[1], warnings, block);
          else question.answer = cleanReadingText(answer[1]);
        }
        destination = null;
        continue;
      }
      const why = line.match(/^(?:Why|Choice|Option)\s+([A-H])\s*(?:is\s+correct\s*)?:\s*(.+)$/i);
      if (why) {
        const index = why[1].toUpperCase().charCodeAt(0) - 65;
        optionExplanations[index] = cleanReadingText([optionExplanations[index], why[2]].filter(Boolean).join(' '));
        destination = {type:'option', index};
        continue;
      }
      const explanation = line.match(/^(?:Explanation|Rationale|Reasoning|Solution|How\s+(?:the\s+)?answer\s+(?:was\s+)?(?:gotten|calculated|derived))\s*:\s*(.*)$/i);
      if (explanation) {
        if (explanation[1]) rationale.push(explanation[1]);
        destination = {type:'explanation'};
        continue;
      }
      if (destination?.type === 'option') {
        optionExplanations[destination.index] = cleanReadingText([optionExplanations[destination.index], line].filter(Boolean).join(' '));
      } else {
        rationale.push(line);
        destination = {type:'explanation'};
      }
    }
    question.explanation = cleanReadingText([question.explanation, ...rationale].filter(Boolean).join('\n'));
    if (Object.keys(optionExplanations).length) question.optionExplanations = optionExplanations;
    inferAnswerFromExplanation(question);
    return question;
  }

  function isUnknownAnswer(value) {
    return /^(?:not stated|unknown|not provided|cannot be determined|could not be determined)(?:\b|\s*\()/i.test(String(value || '').trim());
  }

  function inferAnswerFromExplanation(question) {
    if (!question?.explanation || question.correctAnswers.length || question.answer) return question;
    const explanation = question.explanation;
    const noListedChoice = /no (?:fully )?(?:correct |listed )?(?:answer|option)|no listed answer/i.test(explanation);
    if (noListedChoice) {
      const corrected = explanation.match(/\b(?:result|correct(?:ed)? answer)\s+(?:is|was|=)\s+(.+?)(?=\.(?:\s|$)|[!?]|$)/i);
      if (corrected) question.answer = cleanReadingText(corrected[1]);
      return question;
    }
    const multiLetter = explanation.match(/\b(?:correct\s+answers?|answers?)\s*(?:are|is|were|was|=|:)\s*((?:Choice\s+)?[A-H](?:\s*(?:,|and|&)\s*[A-H])+)(?=$|[\s.):\-–—])/i);
    if (multiLetter && question.options.length) {
      const indices = multiLetter[1].replace(/^Choice\s+/i, '').split(/\s*(?:,|and|&)\s*/i)
        .map(letter => letter.toUpperCase().charCodeAt(0) - 65);
      if (indices.every(i => i >= 0 && i < question.options.length)) question.correctAnswers = unique(indices);
    }
    if (question.correctAnswers.length) return question;
    const labeled = explanation.match(/(?:correct\s+answer|answer|result|computed\s+answer)\s*(?:is|was|=|:)?\s*(?:Choice\s+)?([A-H])(?:\b|\s*[:.)-])/i);
    if (labeled && question.options.length) {
      const index = labeled[1].toUpperCase().charCodeAt(0) - 65;
      if (index >= 0 && index < question.options.length) question.correctAnswers = [index];
    }
    const identified = explanation.match(/(?:Choice|option)\s+([A-H])\s+(?:is|would be)\s+(?:the\s+)?correct\b|\b([A-H])\s+is\s+correct\b/i);
    const identifiedLetter = identified?.[1] || identified?.[2];
    if (!question.correctAnswers.length && question.options.length && identifiedLetter) {
      const index=identifiedLetter.toUpperCase().charCodeAt(0)-65;
      if(index>=0&&index<question.options.length) question.correctAnswers=[index];
    }
    if (question.correctAnswers.length) return question;
    const statement = explanation.match(/(?:the\s+)?(?:correct\s+)?(?:answer|result)\s+(?:is|was|=)\s+(.+?)(?=\s+(?:because|since|as)\b|[.!?](?:\s|$)|$)/i);
    if (statement) {
      const value = cleanReadingText(statement[1].replace(/^Choice\s+/i, '').replace(/^['"“”]|['"“”]$/g, ''));
      const option = question.options.findIndex(choice => normalize(choice) === normalize(value));
      if (option >= 0) question.correctAnswers = [option];
      else if (!question.options.length) question.answer = value;
    }
    const computed = explanation.match(/(?:computed|calculated)\s+answer\s*(?:is|=|:)?\s*([^.;\n]+)/i);
    if (!question.answer && !question.correctAnswers.length && !question.options.length && computed) question.answer = cleanReadingText(computed[1]);
    return question;
  }

  function warnIfUnkeyed(question, warnings, block) {
    if (question && !question.correctAnswers.length && !question.answer && question.explanation) {
      warnings.push(`Question ${block.number}: explanation found, but no single answer could be identified. Split multi-part questions or add an Answer: line.`);
    }
  }

  function parseBlock(block, warnings) {
    const media = imageSources(block.lines);
    let lines = block.lines.filter(line => line && !/^\s*(?:(?:Exhibit|Image|Alt text(?:\s+\d+)?)\s*:|!\[[^\]]*\]\([^)]+\)\s*$)/i.test(line));
    const noteAt = lines.findIndex(line => /^(?:Explanation|Rationale|Reasoning|Solution|How\s+(?:the\s+)?answer\s+(?:was\s+)?(?:gotten|calculated|derived)|Why\s+[A-H])\s*:/i.test(line));
    const inlineNotes = noteAt >= 0 ? lines.slice(noteAt) : [];
    if (noteAt >= 0) lines = lines.slice(0, noteAt);
    const groupedHeading = /(?:each|following)\s+statements?|select\s+true\s+or\s+false|true\s+or\s+false\s+for\s+each/i.test([block.heading,...lines].join(' '));
    const groupedRows = lines.map(line => {
      const match=line.match(/^(?:(?:[?*\-]\s*)|(?:\d+[.)]\s*))?(?:(?:\(([TF])\)|([TF])\s+(?=[A-Z]))\s*)?(.+?)\s*$/i);
      if(!match) return null;
      const explicit=match[1]||match[2];
      const tail=match[3].match(/\s*[-??:]\s*(True|False|T|F)\s*$/i);
      const result=explicit || tail?.[1]?.[0];
      const statement=tail ? match[3].slice(0,tail.index).trim() : match[3].trim();
      return statement && result ? {statement,answer:/^(?:T|True)$/i.test(result)?'True':'False'} : null;
    }).filter(Boolean);
    if(groupedHeading && groupedRows.length>=2) {
      const rationale=inlineNotes.filter(line=>/^(?:Explanation|Rationale|Reasoning|Solution)\s*:/i.test(line)).map(line=>line.replace(/^(?:Explanation|Rationale|Reasoning|Solution)\s*:\s*/i,''));
      return attachImages({sourceNumber:String(block.number),text:cleanReadingText([block.heading,...groupedRows.map((row,i)=>`${i+1}. ${row.statement}`)].join('\n')),options:[],correctAnswers:[],answer:'',type:'grouped-boolean',statements:groupedRows.map(row=>row.statement),statementAnswers:groupedRows.map(row=>row.answer),explanation:cleanReadingText(rationale.join('\n')),...media},media);
    }
    const matchingText=[block.heading,...lines].join(' ');
    const matchingHeading=/\b(?:move|drag|match|connect|pair|list\s+on\s+the\s+left)\b.*\b(?:correct|appropriate|respective|example|item|description|right)\b/i.test(matchingText)||/\b(?:move|drag|match|connect|pair)\b/i.test(matchingText)&&/\b(?:example|item|description|model|term|service)\b/i.test(matchingText);
    const answerTiles=[],matchRows=[],tileLabels=new Map();
    const addTiles=value=>String(value||'').split(/[,;|]/).map(item=>cleanReadingText(item.replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu,''))).filter(item=>item&&item.length<45).forEach(item=>{if(!answerTiles.some(tile=>normalize(tile)===normalize(item)))answerTiles.push(item);});
    const labels=[];
    for(const line of lines){
      const labeledTile=line.match(/^(?:Word|Term|Model|Service|Answer|Choice|Option)\s*:\s*([A-Z][A-Z0-9_-]{0,15})\s*[-.)]\s*(.+)$/i);
      if(labeledTile){const label=cleanReadingText(labeledTile[1]),tile=cleanReadingText(labeledTile[2]);tileLabels.set(normalize(label),tile);addTiles(tile);continue;}
      const tile=line.match(/^(?:Word|Term|Model|Service|Answer|Choices?|Word\s+bank)\s*:\s*(.+)$/i);
      if(tile){addTiles(tile[1]);continue;}
      const labeled=line.match(/^(?:Example|Item|Match|Description)\s*\d*\s*[:.)-]\s*(.+?)\s*[|:]\s*([A-Z][A-Z0-9_-]{0,15})\s*$/i);
      if(labeled){const label=cleanReadingText(labeled[2]);matchRows.push({prompt:cleanReadingText(labeled[1]),answer:tileLabels.get(normalize(label))||label});labels.push(label);continue;}
      const row=line.match(/^([A-Z][A-Z0-9_-]{1,15})\s+(.+?)\s*$/);
      if(row){const prompt=row[2].replace(/^[^\p{L}\p{N}]+/u,'').trim();if(prompt.length>8){matchRows.push({prompt:cleanReadingText(prompt),answer:tileLabels.get(normalize(row[1]))||cleanReadingText(row[1])});labels.push(row[1]);}}
    }
    if(matchingHeading&&!answerTiles.length){const source=`${block.heading} ${lines.join(' ')}`;const words=source.match(/\b[A-Z][A-Z0-9_-]{1,15}\b/g)||[];addTiles(words.filter(word=>labels.some(label=>normalize(label)===normalize(word))));}
    if(matchingHeading&&answerTiles.length>=2&&matchRows.length>=2){
      const matches=matchRows.map(row=>({prompt:row.prompt,answer:row.answer,correct:true}));
      const matchingPrompt=block.heading||lines.find(line=>! /^(?:Word|Term|Model|Service|Answer|Choices?|Word\s+bank|Example|Item|Match|Description)\s*[:\d]/i.test(line))||'Match each item to its correct description.';
      return attachImages({sourceNumber:String(block.number),text:cleanReadingText(matchingPrompt),options:[],correctAnswers:[],answer:'',type:'matching',matches,answerTiles,explanation:cleanReadingText(inlineNotes.map(line=>line.replace(/^(?:Explanation|Rationale|Reasoning|Solution)\s*:\s*/i,'')).join('\n')),...media},media);
    }

    if (!lines.length) return null;
    const explanationAt = lines.findIndex(line => /^ANSWER\s*(?:\+|AND)\s*EXPLANATION(?:\s*\|\s*PAGE\s+\d+)?\s*$/i.test(line));
    if (explanationAt >= 0) {
      const sourceLines = lines.slice(0, explanationAt);
      const question = parseBlock({...block, lines:sourceLines}, []) || normalizeQuestion({sourceNumber:block.number,text:block.heading});
      const hasChoiceMarkers = sourceLines.some(line => optionLine(line).labeled || optionLine(line).marked);
      if (!hasChoiceMarkers && question.options.length) {
        question.options = []; question.correctAnswers = [];
        question.type = 'text';
        question.text = cleanReadingText([block.heading, ...sourceLines].filter(Boolean).join('\n'));
      }
      attachExplanationNotes(question, lines.slice(explanationAt + 1), warnings, block);
      attachExplanationNotes(question, inlineNotes, warnings, block);
      warnIfUnkeyed(question, warnings, block);
      return attachImages(question, media);
    }
    const answerAt = lines.findIndex(line => /^(?:(?:Correct\s+)?Answers?|Best answer)\s*:\s*\S/i.test(line));
    if (answerAt >= 0) {
      const key = lines[answerAt].replace(/^(?:(?:Correct\s+)?Answers?|Best answer)\s*:\s*/i, '').trim();
      const acceptedAnswers = lines.slice(answerAt + 1)
        .filter(line => /^Also accepted\s*:/i.test(line))
        .flatMap(line => line.replace(/^Also accepted\s*:\s*/i, '').split(/\s*[|;]\s*/).map(value => value.trim()).filter(Boolean));
      if (lines.slice(0, answerAt).some(line => optionLine(line).labeled || optionLine(line).marked)) {
        const question = parseBlock({...block, lines:lines.slice(0, answerAt)}, []);
        if (!isUnknownAnswer(key)) applyAnswerKey(question, key, warnings, block);
        attachExplanationNotes(question, lines.slice(answerAt + 1).filter(line=>!/^Also accepted\s*:/i.test(line)), warnings, block);
        attachExplanationNotes(question, inlineNotes, warnings, block);
        warnIfUnkeyed(question, warnings, block);
        return attachImages(question, media);
      }
      const question = normalizeQuestion({sourceNumber:block.number,text:[block.heading,...lines.slice(0,answerAt)].filter(Boolean).join('\n'),answer:isUnknownAnswer(key)?'':key,acceptedAnswers});
      attachExplanationNotes(question, lines.slice(answerAt + 1).filter(line=>!/^Also accepted\s*:/i.test(line)), warnings, block);
      attachExplanationNotes(question, inlineNotes, warnings, block);
      warnIfUnkeyed(question, warnings, block);
      return attachImages(question, media);
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
    const text = [block.heading,...lines.slice(0,start)].filter(Boolean).join('\n').trim();
    const optionRows = lines.slice(start), labeled = optionRows.some(line=>optionLine(line).labeled);
    const options=[], correctAnswers=[];
    for (const line of optionRows) {
      const option=optionLine(line);
      if (!option.text) continue;
      if (labeled && !option.labeled && !option.marked && options.length) options[options.length-1] += `\n${option.text}`;
      else { options.push(option.text); if(option.correct) correctAnswers.push(options.length-1); }
    }
    if(options.length>=2&&options.every(option=>/^[TF]\s+\S/i.test(option))){
      const statements=options.map(option=>option.replace(/^[TF]\s+/i,''));
      const statementAnswers=options.map(option=>/^T\s/i.test(option)?'True':'False');
      const question=normalizeQuestion({sourceNumber:block.number,text,statements,statementAnswers,explanation:cleanReadingText(inlineNotes.map(line=>line.replace(/^(?:Explanation|Rationale|Reasoning|Solution)\s*:\s*/i,'')).join('\n')),...media});
      return attachImages(question,media);
    }
    if (options.length && !correctAnswers.length && firstMarked < 0) warnings.push(`Question ${block.number}: no answer key was found.`);
    if (!text) warnings.push(`Question ${block.number}: question text is empty.`);
    const question=normalizeQuestion({sourceNumber:block.number,text,options,correctAnswers});
    attachExplanationNotes(question,inlineNotes,warnings,block);
    warnIfUnkeyed(question, warnings, block);
    return attachImages(question,media);
  }

  function applyAnswerKey(question, rawKey, warnings, block) {
    const key = String(rawKey || '').trim();
    if (!question.options.length) { question.answer = key; return; }
    const exactIndex = question.options.findIndex(option => normalize(option) === normalize(key));
    if (exactIndex >= 0) { question.correctAnswers = [exactIndex]; return; }
    const letterKey = key.match(/^(?:(?:Choice|Option)\s+)?([A-H](?:\s*(?:,|and|&)\s*[A-H])*)(?=$|[\s.):\-–—])(?:\s*\([^)]*\))?(?:\s*[-–—:.]\s*(.*)|\s+(.+)|$)/i);
    if (letterKey) {
      const indices = letterKey[1].split(/\s*(?:,|and|&)\s*/i).map(letter => letter.toUpperCase().charCodeAt(0) - 65);
      if (indices.every(i => i >= 0 && i < question.options.length)) {
        question.correctAnswers = unique(indices);
        const rest = (letterKey[2] || letterKey[3] || '').trim();
        const firstOption = question.options[indices[0]];
        const rationale = rest && normalize(rest).startsWith(normalize(firstOption))
          ? rest.slice(firstOption.length).replace(/^[\s.\-–—:]+/, '').trim() : rest;
        if (rationale) question.explanation = cleanReadingText([question.explanation, rationale].filter(Boolean).join('\n'));
        return;
      }
    }
    const prefixedOption = question.options.findIndex(option => {
      const suffix = key.slice(option.length);
      return key.slice(0, option.length).toLocaleLowerCase() === option.toLocaleLowerCase() &&
        /^(?:\s*[-–—:.]\s*|\s+because\b)/i.test(suffix);
    });
    if (prefixedOption >= 0) {
      question.correctAnswers = [prefixedOption];
      const rationale = key.slice(question.options[prefixedOption].length).replace(/^[\s.\-–—:]+/, '').trim();
      if (rationale) question.explanation = cleanReadingText([question.explanation, rationale].filter(Boolean).join('\n'));
      return;
    }
    const matchedText = question.options.findIndex(option => normalize(option) === normalize(key.replace(/^["“”]|["“”]$/g, '')));
    if (matchedText >= 0) { question.correctAnswers = [matchedText]; return; }
    question.answer = key;
    warnings.push(`Question ${block.number}: answer text did not match a choice; kept it as a written answer.`);
  }

  function attachImages(question, media) {
    if (media.images.length) question.images = [...(question.images || []), ...media.images];
    if (media.imageRefs.length) question.imageRefs = [...(question.imageRefs || []), ...media.imageRefs];
    if (media.imageAlts.length) question.imageAlts = media.imageAlts;
    if (question.images?.length === 1) question.image = question.images[0];
    return question;
  }

  function deduplicate(questions, warnings, preserveSourcePages = false) {
    const result = [], byText = new Map();
    for (const q of questions) {
      const key = JSON.stringify([normalize(q.text),q.options.map(normalize),q.statements?.map(normalize),q.matches?.map(pair=>normalize(pair.prompt)),q.parts?.map(part=>normalize(part.prompt)),preserveSourcePages ? q.sourcePage || null : null]);
      if (!key) continue;
      const prior = byText.get(key);
      if (prior === undefined) { byText.set(key, result.length); result.push(q); continue; }
      const existing = result[prior];
      const keyed = q.correctAnswers.length > 0 || !!q.answer || q.statementAnswers?.length > 0 || q.matches?.length > 0 || q.parts?.some(part=>part.answer);
      const existingKeyed = existing.correctAnswers.length > 0 || !!existing.answer || existing.statementAnswers?.length > 0 || existing.matches?.length > 0 || existing.parts?.some(part=>part.answer);
      const preferred = keyed && !existingKeyed ? q : existing;
      const alternate = preferred === q ? existing : q;
      const sameKey = !keyed || !existingKeyed ||
        (normalize(existing.answer) === normalize(q.answer) &&
          existing.correctAnswers.join(',') === q.correctAnswers.join(',') &&
          JSON.stringify(existing.statementAnswers||[])===JSON.stringify(q.statementAnswers||[]) &&
          JSON.stringify(existing.matches?.map(pair=>pair.answer)||[])===JSON.stringify(q.matches?.map(pair=>pair.answer)||[]) &&
          JSON.stringify(existing.parts?.map(part=>part.answer)||[])===JSON.stringify(q.parts?.map(part=>part.answer)||[]));
      if (sameKey) {
        if (!preferred.explanation && alternate.explanation) preferred.explanation = alternate.explanation;
        if (!preferred.optionExplanations && alternate.optionExplanations) preferred.optionExplanations = alternate.optionExplanations;
        if (!preferred.images?.length && alternate.images?.length) preferred.images = [...alternate.images];
        if (!preferred.imageAlts?.length && alternate.imageAlts?.length) preferred.imageAlts = [...alternate.imageAlts];
        if (!preferred.imageRefs?.length && alternate.imageRefs?.length) preferred.imageRefs = [...alternate.imageRefs];
      } else warnings.push(`Question ${q.sourceNumber}: duplicate has a conflicting answer; check the retained key.`);
      result[prior] = preferred;
      warnings.push(`Duplicate question ${q.sourceNumber} was removed.`);
    }
    return result;
  }

  function parseText(input) {
    const warnings = [], blocks = [];
    const text = String(input ?? '').replace(/\r/g, '').replace(/[\u200b\ufeff]/g, '')
      .replace(/^\s*```[^\n]*$/gm, '').replace(/\f/g, '\n');
    if (/^QUESTION\s+\d+\s*\|\s*SOURCE PAGE\s+\d+/im.test(text)) return parsePageReviewer(text);
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

  // Reviewers with one question per page and a worked answer section, such as
  // Start_Completed.pdf, need their subquestions kept together as one activity.
  function parsePageReviewer(text) {
    const warnings = [], questions = [];
    const parts = text.split(/(?=^QUESTION\s+\d+\s*\|\s*SOURCE PAGE\s+\d+)/im);
    for (const part of parts) {
      const heading = part.match(/^QUESTION\s+(\d+)\s*\|\s*SOURCE PAGE\s+(\d+)/im);
      if (!heading) continue;
      const number = heading[1], sourcePage = heading[2];
      const rawLines = part.slice(heading.index + heading[0].length).split('\n').map(x => x.trim()).filter(Boolean);
      const lines = rawLines.filter(line => !/^CCST NETWORKING REVIEWER$/i.test(line) && !/^\d{1,3}$/.test(line));
      const split = lines.findIndex(line => /^ANSWER\s*(?:\+|AND)\s*EXPLANATION$/i.test(line));
      const body = split < 0 ? lines : lines.slice(0, split);
      const notes = split < 0 ? [] : lines.slice(split + 1);
      const explanation = cleanReadingText(notes.join('\n'));
      const base = {sourceNumber:number,sourcePage,text:'',options:[],correctAnswers:[],answer:'',explanation};
      const choiceStart = body.findIndex(line => /^A[.)]\s+/.test(line));
      if (choiceStart >= 0) {
        const options = [];
        for (const line of body.slice(choiceStart)) {
          const option = line.match(/^([A-Z])[.)]\s+(.+)$/);
          if (option) options.push(option[2]);
          else if (options.length) options[options.length-1] += ` ${line}`;
        }
        base.text = cleanReadingText(body.slice(0,choiceStart).join('\n'));
        base.options = options.map(cleanReadingText);
        const key = explanation.match(/\bAnswers?\s*:\s*((?:[A-Z](?:\s*(?:,|and|&)\s*[A-Z])*))(?:\b|\s*[-.])/i);
        if (key) base.correctAnswers = [...new Set(key[1].split(/\s*(?:,|and|&)\s*/i).map(letter=>letter.toUpperCase().charCodeAt(0)-65))].filter(i=>i>=0&&i<options.length);
        if (/no listed answer is fully correct/i.test(explanation)) {
          base.correctAnswers = [];
          base.answer = cleanReadingText((explanation.match(/\bresult is\s+([\w.:/-]+)/i)?.[1] || '').replace(/\.$/,''));
          warnings.push(`Question ${number}: source choices contain no fully correct answer; use the written answer.`);
        }
        if (!base.correctAnswers.length && !base.answer) warnings.push(`Question ${number}: check the answer key.`);
      } else {
        const rows = [], prompt = [];
        let row = null;
        for (const line of body) {
          const numbered = line.match(/^(\d+)[.)]\s+(.+)$/);
          const answer = line.match(/^Answer\s*:\s*(.*)$/i);
          if (numbered) { if (row) rows.push(row); row={prompt:numbered[2],answer:''}; }
          else if (answer && row) row.answer=answer[1];
          else if (row && !row.answer) row.prompt += ` ${line}`;
          else if (!row) prompt.push(line);
        }
        if (row) rows.push(row);
        base.text = cleanReadingText(prompt.join('\n'));
        if (rows.length >= 2 && /(?:true or false|select true|select false)/i.test(base.text)) {
          base.statements = rows.map(x=>cleanReadingText(x.prompt));
          base.statementAnswers = rows.map(x=>x.answer);
          if (rows.some(x=>!/^(true|false)$/i.test(x.answer))) warnings.push(`Question ${number}: some true/false answers need review.`);
        } else if (rows.length >= 2) {
          base.matches = rows.map(x=>({prompt:cleanReadingText(x.prompt),answer:cleanReadingText(x.answer)}));
          const bank = base.text.match(/\bOptions(?: as printed)?\s*:\s*([\s\S]+?)(?:\.\s*$|$)/i)?.[1];
          const tiles=new Map();
          for(const value of [...(bank ? bank.split(/,\s*/) : []),...rows.map(x=>x.answer)]) {
            const tile=cleanReadingText(value);if(tile)tiles.set(normalize(tile),tile);
          }
          base.answerTiles=[...tiles.values()];
          if (rows.some(x=>!x.answer)) warnings.push(`Question ${number}: some matching answers need review.`);
        } else {
          const answerLine = body.find(line=>/^Answer\s*:/i.test(line));
          base.answer = cleanReadingText(answerLine?.replace(/^Answer\s*:\s*/i,'') || explanation.match(/\bAnswer\s*:\s*([^.;]+)/i)?.[1] || '');
          base.text = cleanReadingText(body.filter(line=>line!==answerLine).join('\n'));
          if (!base.answer) warnings.push(`Question ${number}: no answer key was found.`);
        }
      }
      if (!base.text) warnings.push(`Question ${number}: question text is empty.`);
      if (/cut off|missing word|cannot determine|unreliable|uncertain/i.test(explanation)) warnings.push(`Question ${number}: source explanation reports an incomplete or uncertain answer.`);
      questions.push(normalizeQuestion(base));
    }
    return {questions,warnings};
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
          const questions = deduplicate(source.map(normalizeQuestion), warnings, true);
          return { questions, warnings, title: !Array.isArray(data) ? String(data.title ?? '') : '' };
        }
      } catch { /* Continue as plain text. */ }
    }
    return parseText(text);
  }

  function formatPdfRows(pages) {
    const flat = pages.flatMap((rows, page) => rows.map(row => ({...row, page})));
    if(flat.some(row=>/^QUESTION\s+\d+\s*\|\s*SOURCE PAGE\s+\d+/i.test(row.text)))
      return pages.map(rows=>rows.map(row=>row.text).join('\n')).join('\n');
    const headings = flat.filter(row => /^Question\s+\d+\s*$/i.test(row.text));
    if (!headings.length) {
      const questionPages = pages.map((rows, page) => {
        const text = rows.map(row => row.text).filter(line => !/^ANSWER\s*(?:\+|AND)\s*EXPLANATION\s*\|\s*PAGE\s+\d+$/i.test(line)).join('\n');
        const lines = text.split('\n');
        const hasChoices = lines.some(line => /^(?:(?:[A-H])[.)]\s*|(?:Choice|Option)\s+[A-H]\s*[:.)-]|Correct!\s*|You Answered\s+)/i.test(line.trim()));
        const hasExplanation = rows.some(row => /ANSWER\s*(?:\+|AND)\s*EXPLANATION/i.test(row.text));
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
        const candidate = name.replace(/\.[^.]+$/, '').trim();
        if (/^(?:missing|unavailable|not available|not provided|none|attached)(?:\b|\s|[-_:])/i.test(candidate)) continue;
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
    if(question.type==='grouped-boolean') return answer.length===question.statements.length&&answer.every((value,index)=>normalize(value)===normalize(question.statementAnswers[index]));
    if(question.type==='matching') return answer.length===question.matches.length&&answer.every((value,index)=>normalize(value)===normalize(question.matches[index].answer));
    if(question.type==='multi-text') return answer.length===question.parts.length&&answer.every((value,index)=>[question.parts[index].answer,...question.parts[index].acceptedAnswers].some(expected=>expected&&normalize(value)===normalize(expected)));
    if (question.options.length && question.correctAnswers.length) {
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
