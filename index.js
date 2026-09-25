const instructionNames = [
  'LDA', 'STO', 'ADD', 'SUB', 'JMP', 'JGE', 'JNE', 'STP', 'AND', 'OR', 'XOR', 'ROL', 'LDR', 'LDI', 'STI', 'XPC'
];
const directiveNames = ['.org', 'defw'];
const addressInstructionNames = new Set([
  'LDA', 'STO', 'ADD', 'SUB', 'JMP', 'JGE', 'JNE', 'AND', 'OR', 'XOR', 'ROL', 'LDR', '.ORG'
]);
const opcodeMap = {
  LDA: 0x0,
  STO: 0x1,
  ADD: 0x2,
  SUB: 0x3,
  JMP: 0x4,
  JGE: 0x5,
  JNE: 0x6,
  STP: 0x7,
  AND: 0x8,
  OR: 0x9,
  XOR: 0xA,
  ROL: 0xB,
  LDR: 0xC,
  LDI: 0xD,
  STI: 0xE,
  XPC: 0xF,
};

function escapeHtml(value) {
  return value.replace(/[&<>"/]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '/': '&#x2F;'
  }[character] || character));
}

function validateLine(line) {
  const code = line.split(';')[0];
  const tokens = code.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  let label = '';
  let instructionToken = tokens[0];
  let operand = tokens[1];
  const firstToken = tokens[0].toUpperCase();
  const isDirective = directiveNames.includes(tokens[0].toLowerCase());
  const isInstruction = instructionNames.includes(firstToken);

  if (!isDirective && !isInstruction) {
    label = tokens[0];
    instructionToken = tokens[1];
    operand = tokens[2];
  }

  if (!instructionToken) return null;
  if (label && label.length > 8) {
    return { addressToken: label, error: `Label trop long : ${label} (8 caractères maximum).` };
  }

  const instruction = instructionToken.startsWith('.') ? instructionToken.toLowerCase() : instructionToken.toUpperCase();
  if (instruction === 'DEFW') {
    if (!label) {
      return { error: 'La directive defw doit être précédée par un label.' };
    }
    if (!operand) {
      return { error: 'Valeur manquante pour defw (mot 16 bits attendu).' };
    }
    const value = /^0x[0-9a-fA-F]{1,4}$/.test(operand)
      ? Number.parseInt(operand, 16)
      : /^\d+$/.test(operand)
        ? Number(operand)
        : Number.NaN;
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      return { addressToken: operand, error: `Valeur invalide : ${operand} (mot 16 bits attendu : 0 à 0xFFFF).` };
    }
    return null;
  }

  if (!addressInstructionNames.has(instruction)) {
    return null;
  }

  if (!operand) {
    return { error: 'Adresse manquante (format attendu : 0x000 à 0xFFF ou un label).' };
  }

  if (!/^0x[0-9a-fA-F]{3}$/.test(operand) && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(operand)) {
    return { addressToken: operand, error: `Adresse invalide : ${operand} (format attendu : 0x000 à 0xFFF ou un label).` };
  }

  return null;
}

function formatInstructionLine(line) {
  const commentIndex = line.indexOf(';');
  const code = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const comment = commentIndex >= 0 ? line.slice(commentIndex) : '';
  const tokens = code.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return line;

  const firstToken = tokens[0].toUpperCase();
  const hasLabel = !instructionNames.includes(firstToken) && !directiveNames.includes(tokens[0].toLowerCase());
  const instructionIndex = hasLabel ? 1 : 0;
  const instruction = tokens[instructionIndex];
  const isDefw = instruction && instruction.toLowerCase() === 'defw';
  if (!instruction || (!instructionNames.includes(instruction.toUpperCase()) && !isDefw)) {
    return line;
  }

  const normalizedInstruction = isDefw ? 'defw' : instruction.toUpperCase();
  const operands = tokens.slice(instructionIndex + 1).join(' ');
  const statement = operands ? `${normalizedInstruction} ${operands}` : normalizedInstruction;
  const formatted = hasLabel ? `${tokens[0].padEnd(8, ' ')} ${statement}` : `         ${statement}`;
  return `${formatted}${comment ? ` ${comment.trim()}` : ''}`;
}

function formatProgram(source) {
  return source
    .split(/\r?\n/)
    .map((line) => formatInstructionLine(line))
    .join('\n');
}

function parseAddressToken(token, base = 10) {
  if (/^0x[0-9a-fA-F]+$/i.test(token)) {
    return Number.parseInt(token, 16);
  }
  if (/^\d+$/u.test(token)) {
    return Number.parseInt(token, base);
  }
  return Number.NaN;
}

function compileProgram(source) {
  const lines = source.split(/\r?\n/);
  const labels = new Map();
  const memory = new Map();
  const instructions = [];
  const fixups = [];
  let currentAddress = 0;
  const errors = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const code = rawLine.split(';')[0].trim();
    if (!code) continue;

    const tokens = code.split(/\s+/).filter(Boolean);
    const firstToken = tokens[0];
    const isDirective = directiveNames.includes(firstToken.toLowerCase());
    const isInstruction = instructionNames.includes(firstToken.toUpperCase());

    let label = '';
    let instruction = firstToken;
    let operand = tokens[1];

    if (!isDirective && !isInstruction) {
      label = firstToken;
      instruction = tokens[1] || '';
      operand = tokens[2];
    }

    if (label) {
      labels.set(label, currentAddress);
    }

    const normalizedInstruction = instruction.startsWith('.') ? instruction.toLowerCase() : instruction.toUpperCase();

    if (normalizedInstruction === '.org') {
      const value = parseAddressToken(operand || '', 10);
      if (!Number.isFinite(value) || value < 0 || value > 0xfff) {
        errors.push(`Ligne ${index + 1} : directive .org invalide.`);
        continue;
      }
      currentAddress = value;
      continue;
    }

    if (normalizedInstruction === 'DEFW') {
      if (!label) {
        errors.push(`Ligne ${index + 1} : la directive defw doit être précédée d'un label.`);
        continue;
      }
      const value = parseAddressToken(operand || '', 10);
      if (!Number.isFinite(value) || value < 0 || value > 0xffff) {
        errors.push(`Ligne ${index + 1} : valeur invalide pour defw.`);
        continue;
      }
      memory.set(currentAddress, value & 0xffff);
      currentAddress += 1;
      continue;
    }

    if (!normalizedInstruction || !opcodeMap[normalizedInstruction]) {
      if (!isDirective && !isInstruction) {
        errors.push(`Ligne ${index + 1} : instruction inconnue : ${instruction}`);
      }
      continue;
    }

    if (normalizedInstruction === 'STP' || normalizedInstruction === 'LDI' || normalizedInstruction === 'STI' || normalizedInstruction === 'XPC') {
      instructions.push((opcodeMap[normalizedInstruction] << 12) & 0xffff);
      currentAddress += 1;
      continue;
    }

    if (!operand) {
      errors.push(`Ligne ${index + 1} : adresse manquante pour ${normalizedInstruction}.`);
      continue;
    }

    const directValue = parseAddressToken(operand, 10);
    const resolvedValue = Number.isFinite(directValue) ? directValue & 0x0fff : null;
    const word = (opcodeMap[normalizedInstruction] << 12) | (resolvedValue ?? 0);
    instructions.push(word);

    if (!Number.isFinite(directValue) && /^(?:[A-Za-z_][A-Za-z0-9_]*)$/.test(operand)) {
      fixups.push({ index: instructions.length - 1, label: operand, field: 'address' });
    }

    currentAddress += 1;
  }

  for (const fixup of fixups) {
    const targetAddress = labels.get(fixup.label);
    if (targetAddress === undefined) {
      errors.push(`Libellé non défini : ${fixup.label}`);
      continue;
    }
    instructions[fixup.index] = ((instructions[fixup.index] & 0xf000) | (targetAddress & 0x0fff)) & 0xffff;
  }

  if (errors.length > 0) {
    return {
      ok: false,
      output: errors.join('\n'),
      memory,
      instructions,
    };
  }

  return {
    ok: true,
    output: `Compilation réussie. ${instructions.length} instruction(s) assemblée(s).\nMémoire allouée : ${Math.max(0, currentAddress)} mots.`,
    memory,
    instructions,
  };
}

function executeProgram(source) {
  const compiled = compileProgram(source);
  if (!compiled.ok) {
    return {
      output: `Erreur de compilation\n${compiled.output}`,
      acc: 0,
      pc: 0,
      r: 0,
    };
  }

  const memory = new Uint16Array(4096);
  for (const [address, value] of compiled.memory.entries()) {
    memory[address & 0xfff] = value & 0xffff;
  }

  const program = compiled.instructions;
  let pc = 0;
  let acc = 0;
  let r = 0;
  let step = 0;
  const trace = [];

  while (step < 256) {
    const instructionWord = program[pc] ?? 0;
    const opcode = (instructionWord >>> 12) & 0xf;
    const operand = instructionWord & 0xfff;
    trace.push(`pc=${pc.toString(16).padStart(3, '0')} op=${opcode.toString(16).toUpperCase()} arg=${operand.toString(16).padStart(3, '0')} acc=${acc.toString(16).padStart(4, '0')}`);

    switch (opcode) {
      case 0x0:
        acc = memory[operand];
        pc += 1;
        break;
      case 0x1:
        memory[operand] = acc;
        pc += 1;
        break;
      case 0x2:
        acc = (acc + memory[operand]) & 0xffff;
        pc += 1;
        break;
      case 0x3:
        acc = (acc - memory[operand]) & 0xffff;
        pc += 1;
        break;
      case 0x4:
        pc = operand;
        break;
      case 0x5: {
        const signed = (acc & 0x8000) ? acc - 0x10000 : acc;
        pc = signed >= 0 ? operand : pc + 1;
        break;
      }
      case 0x6:
        pc = acc !== 0 ? operand : pc + 1;
        break;
      case 0x7:
        pc = 0;
        step = 256;
        break;
      case 0x8:
        acc = acc & memory[operand];
        pc += 1;
        break;
      case 0x9:
        acc = acc | memory[operand];
        pc += 1;
        break;
      case 0xA:
        acc = acc ^ memory[operand];
        pc += 1;
        break;
      case 0xB: {
        const amount = memory[operand] & 0xf;
        acc = (((acc << amount) | (acc >>> (16 - amount))) & 0xffff) >>> 0;
        pc += 1;
        break;
      }
      case 0xC:
        r = operand;
        pc += 1;
        break;
      case 0xD:
        acc = memory[r];
        r = (r + 1) & 0xffff;
        pc += 1;
        break;
      case 0xE:
        r = (r - 1) & 0xffff;
        memory[r] = acc;
        pc += 1;
        break;
      case 0xF: {
        const previousPc = pc;
        pc = acc;
        acc = previousPc;
        break;
      }
      default:
        pc += 1;
    }

    if (opcode === 0x7) break;
    if (pc < 0 || pc >= program.length) break;
    step += 1;
  }

  const output = [
    'Exécution terminée.',
    `ACC = 0x${acc.toString(16).padStart(4, '0')}`,
    `PC = 0x${pc.toString(16).padStart(3, '0')}`,
    `R = 0x${r.toString(16).padStart(4, '0')}`,
    ...trace,
  ].join('\n');

  return { output, acc, pc, r };
}

function normalizeInstructions(code) {
  return code
    .split(/\r?\n/)
    .map((line) => line.replace(/^([ \t]*)([A-Za-z_][A-Za-z0-9_]*)\b/, (match, indentation, typedName) => {
      const instruction = instructionNames.find((name) => name === typedName.toUpperCase());
      return instruction ? `${indentation}${instruction}` : match;
    }))
    .join('\n');
}

function updateLineNumbers(codeInput, lineNumbersElement) {
  const lineCount = codeInput.value.split(/\r?\n/).length;
  lineNumbersElement.textContent = Array.from({ length: lineCount }, (_, index) => index + 1).join('\n');
}

function updateHighlight(codeInput, highlightElement) {
  const lines = codeInput.value.split(/\r?\n/);
  const highlighted = lines
    .map((line) => {
      const validation = validateLine(line);
      const tokenPattern = /(;.*$|\.(?:org)\b|\bdefw\b|\b(?:LDA|STO|ADD|SUB|JMP|JGE|JNE|STP|AND|OR|XOR|ROL|LDR|LDI|STI|XPC)\b|\b[A-Za-z_][A-Za-z0-9_]*\b|\b(?:0x[0-9a-fA-F]+|\d+)\b)/g;
      let html = '';
      let lastIndex = 0;
      let match;
      const firstTokenIndex = line.search(/\S/);
      const labelMatch = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s+(?=(?:defw|LDA|STO|ADD|SUB|JMP|JGE|JNE|STP|AND|OR|XOR|ROL|LDR|LDI|STI|XPC)\b)/i);
      const labelIndex = labelMatch ? line.indexOf(labelMatch[1], firstTokenIndex) : -1;

      while ((match = tokenPattern.exec(line)) !== null) {
        html += escapeHtml(line.slice(lastIndex, match.index));
        const token = match[0];
        const isFirstToken = match.index === firstTokenIndex;
        const isLabel = match.index === labelIndex;
        const isOperand = /^(?:0x[0-9a-fA-F]+|\d+)$/.test(token);
        const isSymbolicOperand = /^[A-Za-z_][A-Za-z0-9_]*$/.test(token)
          && !isFirstToken
          && !instructionNames.includes(token.toUpperCase())
          && !directiveNames.includes(token.toLowerCase());
        const isInvalidAddress = validation && validation.addressToken === token;
        const className = token.startsWith(';')
          ? 'syntax-comment'
          : directiveNames.includes(token.toLowerCase())
            ? 'syntax-directive'
            : isLabel || isSymbolicOperand
              ? 'syntax-label'
              : instructionNames.includes(token.toUpperCase())
                ? 'syntax-instruction'
                : isInvalidAddress
                  ? 'syntax-invalid'
                  : isOperand
                    ? 'syntax-operand'
                    : isFirstToken
                      ? 'syntax-invalid'
                      : '';
        html += className ? `<span class="${className}">${escapeHtml(token)}</span>` : escapeHtml(token);
        lastIndex = tokenPattern.lastIndex;
      }

      html += escapeHtml(line.slice(lastIndex));
      return html;
    })
    .join('\n');

  highlightElement.innerHTML = highlighted;
}

function updateSuggestions(codeInput, suggestionsElement) {
  const cursor = codeInput.selectionStart;
  const beforeCursor = codeInput.value.slice(0, cursor);
  const currentLine = beforeCursor.slice(beforeCursor.lastIndexOf('\n') + 1);
  const match = currentLine.match(/^\s*(\.[A-Za-z]*|[A-Za-z]*)$/);
  const prefix = match ? match[1] : '';
  const availableNames = [...instructionNames, ...directiveNames];
  const matches = prefix
    ? availableNames.filter((name) => name.toUpperCase().startsWith(prefix.toUpperCase()))
    : [];

  suggestionsElement.innerHTML = '';
  suggestionsElement.hidden = matches.length === 0;

  matches.forEach((instruction) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestion';
    button.textContent = instruction;
    button.addEventListener('click', () => {
      const insertAt = codeInput.selectionStart;
      const before = codeInput.value.slice(0, insertAt);
      const lineStart = before.lastIndexOf('\n') + 1;
      const current = before.slice(lineStart);
      const wordStart = lineStart + current.search(/[A-Za-z]*$/);
      codeInput.setRangeText(`${instruction} `, wordStart, insertAt, 'end');
      codeInput.focus();
      updateEditor();
    });
    suggestionsElement.appendChild(button);
  });
}

function updateValidation(editorStatusElement, code) {
  const errors = code
    .split(/\r?\n/)
    .map((line, index) => ({ index: index + 1, validation: validateLine(line) }))
    .filter((item) => item.validation);

  editorStatusElement.classList.toggle('has-error', errors.length > 0);
  editorStatusElement.textContent = errors.length
    ? errors.map((item) => `Ligne ${item.index} : ${item.validation.error}`).join(' ')
    : 'Adresses : 0x000 à 0xFFF | Données ACC : 16 bits, 0x0000 à 0xFFFF.';
}

function syncEditorScroll(codeInput, lineNumbersElement, highlightElement) {
  lineNumbersElement.scrollTop = codeInput.scrollTop;
  highlightElement.scrollTop = codeInput.scrollTop;
  highlightElement.scrollLeft = codeInput.scrollLeft;
}

function updateEditor() {
  const codeInput = document.querySelector('.code-input');
  const lineNumbersElement = document.querySelector('.line-numbers');
  const highlightElement = document.querySelector('.code-highlight');
  const editorStatusElement = document.querySelector('#editor-status');
  const suggestionsElement = document.querySelector('#suggestions');

  if (!codeInput || !lineNumbersElement || !highlightElement || !editorStatusElement || !suggestionsElement) {
    return;
  }

  const previousSelectionStart = codeInput.selectionStart;
  const previousSelectionEnd = codeInput.selectionEnd;
  const normalized = normalizeInstructions(codeInput.value);
  if (normalized !== codeInput.value) {
    codeInput.value = normalized;
    codeInput.setSelectionRange(previousSelectionStart, previousSelectionEnd);
  }

  updateLineNumbers(codeInput, lineNumbersElement);
  updateHighlight(codeInput, highlightElement);
  updateValidation(editorStatusElement, codeInput.value);
  syncEditorScroll(codeInput, lineNumbersElement, highlightElement);
  updateSuggestions(codeInput, suggestionsElement);
}

function boot() {
  const codeInput = document.querySelector('.code-input');
  const compileOutput = document.querySelector('#compile-output');
  const executionOutput = document.querySelector('#execution-output');
  const suggestionsElement = document.querySelector('#suggestions');
  const compileButton = document.querySelector('#compile-button');
  const runButton = document.querySelector('#run-button');

  if (!codeInput || !compileOutput || !executionOutput || !suggestionsElement || !compileButton || !runButton) {
    return;
  }

  codeInput.addEventListener('input', updateEditor);
  codeInput.addEventListener('click', () => updateSuggestions(codeInput, suggestionsElement));
  codeInput.addEventListener('keyup', updateEditor);
  codeInput.addEventListener('change', updateEditor);
  codeInput.addEventListener('blur', () => {
    codeInput.value = formatProgram(codeInput.value);
    updateEditor();
  });
  codeInput.addEventListener('scroll', () => {
    const lineNumbersElement = document.querySelector('.line-numbers');
    const highlightElement = document.querySelector('.code-highlight');
    if (lineNumbersElement && highlightElement) {
      syncEditorScroll(codeInput, lineNumbersElement, highlightElement);
    }
  });

  codeInput.addEventListener('keydown', (event) => {
    const availableSuggestions = suggestionsElement.querySelectorAll('.suggestion');
    if (suggestionsElement.hidden || availableSuggestions.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const currentIndex = Number(suggestionsElement.dataset.index || '0');
      const nextIndex = (currentIndex + 1) % availableSuggestions.length;
      suggestionsElement.dataset.index = String(nextIndex);
      availableSuggestions[nextIndex]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const currentIndex = Number(suggestionsElement.dataset.index || '0');
      const nextIndex = (currentIndex - 1 + availableSuggestions.length) % availableSuggestions.length;
      suggestionsElement.dataset.index = String(nextIndex);
      availableSuggestions[nextIndex]?.focus();
    } else if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault();
      const activeIndex = Number(suggestionsElement.dataset.index || '0');
      availableSuggestions[activeIndex]?.click();
    } else if (event.key === 'Escape') {
      suggestionsElement.hidden = true;
    }
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((button) => {
        button.setAttribute('aria-selected', button === tab ? 'true' : 'false');
      });
      document.querySelectorAll('.panel').forEach((panel) => {
        panel.hidden = panel.id !== tab.dataset.panel;
      });
    });
  });

  compileButton.addEventListener('click', () => {
    const result = compileProgram(codeInput.value);
    compileOutput.textContent = result.output;
  });

  runButton.addEventListener('click', () => {
    const result = executeProgram(codeInput.value);
    executionOutput.textContent = result.output;
  });

  updateEditor();
}

boot();
