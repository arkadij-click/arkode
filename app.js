/*
 * Редактор авторской письменности. Без сборки и без сервера.
 *
 * Документ — последовательность токенов в порядке ввода:
 *   {type:'glyph', assetId}, {type:'space'}, {type:'linebreak'}
 * Раскладка (layout) одна для экрана, PNG и SVG: токен 0 внизу справа,
 * следующие левее, автоперенос по ширине на строку выше. Автопереносы
 * не сохраняются, ручные (linebreak) — сохраняются.
 * Глифы берутся из window.GLYPH_SET (glyphs.js); чтобы поменять графику,
 * достаточно пересобрать glyphs.js с теми же id.
 */
(() => {
  'use strict';

  const SCHEMA_VERSION = '0.1';
  const STORAGE_KEY = 'author-script-editor.v1';
  const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
  const SOURCE_UNIT = 100; // высота «типичной» ячейки исходника в px

  const set = window.GLYPH_SET;
  const glyphs = set.glyphs;
  const registry = Object.fromEntries(glyphs.map(g => [g.id, g]));
  const images = {};
  // начертание: 'font' — прорисовка, 'photo' — очищенное фото A16
  const face = g => g[settings.face] || g.font;

  const $ = id => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const scroller = $('editorScroll');

  let tokens = [];
  let cursor = 0;
  let undoStack = [];
  let redoStack = [];
  let settings = {size: 56, frames: false, face: 'font'};
  let lastLayout = null;

  // ---------- раскладка ----------

  function metrics(size) {
    const scale = size / SOURCE_UNIT;
    return {
      scale,
      lineHeight: Math.round(size * 1.3),
      gap: Math.max(2, Math.round(size * 0.08)),
      spaceAdvance: Math.round(size * 0.45),
      margin: Math.max(14, Math.round(size * 0.35)),
    };
  }

  /**
   * Возвращает координаты (верхний левый угол) для каждого токена и
   * позиции курсора. Строка 0 — нижняя.
   */
  function layout(toks, width, minHeight, size) {
    const m = metrics(size);
    const maxAdvance = Math.max(1, width - 2 * m.margin);
    const rows = [[]];
    const info = new Array(toks.length);
    let used = 0;

    toks.forEach((t, index) => {
      if (t.type === 'linebreak') {
        info[index] = {line: rows.length - 1, linebreak: true};
        rows.push([]);
        used = 0;
        return;
      }
      let advance, h = 0;
      if (t.type === 'space') advance = m.spaceAdvance;
      else {
        const g = registry[t.assetId];
        advance = g ? face(g).width * m.scale : m.lineHeight * 0.6;
        h = g ? face(g).height * m.scale : m.lineHeight * 0.8;
      }
      let row = rows[rows.length - 1];
      if (row.length && used + m.gap + advance > maxAdvance) {
        rows.push([]);
        used = 0;
        row = rows[rows.length - 1];
      }
      const lead = row.length ? m.gap : 0;
      row.push(index);
      info[index] = {line: rows.length - 1, advance, h, lead};
      used += lead + advance;
    });

    const height = Math.max(minHeight, 2 * m.margin + rows.length * m.lineHeight);
    const lineTop = line => height - m.margin - (line + 1) * m.lineHeight;
    const right = width - m.margin;

    rows.forEach((row, line) => {
      let pen = right;
      for (const index of row) {
        const it = info[index];
        pen -= it.lead + it.advance;
        it.x = pen;
        it.y = lineTop(line) + (m.lineHeight - it.h) / 2;
      }
    });

    // позиция курсора i — между токенами i-1 и i
    const carets = [];
    for (let i = 0; i <= toks.length; i++) {
      if (i === 0) { carets.push({x: right, line: 0}); continue; }
      const prev = info[i - 1];
      if (prev.linebreak) carets.push({x: right, line: prev.line + 1});
      else carets.push({x: prev.x - m.gap / 2, line: prev.line});
    }
    carets.forEach(c => { c.top = lineTop(c.line); });

    return {width, height, lineCount: rows.length, metrics: m, info, carets, lineTop};
  }

  // ---------- проверки (только структурные, без грамматики) ----------

  function validate(toks) {
    const issues = [];
    let lastGlyph = -1;
    toks.forEach((t, i) => { if (t.type === 'glyph') lastGlyph = i; });
    const ends = [];
    toks.forEach((t, i) => {
      if (t.type !== 'glyph') return;
      const g = registry[t.assetId];
      if (!g) { issues.push({index: i, text: `Неизвестный знак «${t.assetId}» (позиция ${i + 1}).`}); return; }
      if (g.endsText) {
        ends.push(i);
        if (i !== lastGlyph) issues.push({index: i, text: `Знак конца текста ${g.id} стоит не в конце (позиция ${i + 1}). Он не удалён — решите сами.`});
      }
    });
    if (ends.length > 1) issues.push({text: `В тексте ${ends.length} знака конца текста.`});
    return issues;
  }

  // ---------- рисование ----------

  function drawDoc(c, L, opts) {
    const m = L.metrics;
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, L.width, L.height);

    if (opts.guides) {
      c.strokeStyle = '#efebe3';
      c.lineWidth = 1;
      const lines = Math.ceil(L.height / m.lineHeight) + 1;
      for (let k = 0; k < lines; k++) {
        const y = Math.round(L.lineTop(k) + m.lineHeight) + 0.5;
        if (y < 0) break;
        c.beginPath(); c.moveTo(m.margin, y); c.lineTo(L.width - m.margin, y); c.stroke();
      }
    }

    const bad = new Set((opts.issues || []).filter(x => x.index != null).map(x => x.index));
    tokens.forEach((t, i) => {
      if (t.type !== 'glyph') return;
      const it = L.info[i];
      const img = images[settings.face][t.assetId];
      if (img && img.complete && img.naturalWidth) {
        c.drawImage(img, it.x, it.y, it.advance, it.h);
      } else {
        // диагностический missing-glyph, без подмены похожей буквой
        c.strokeStyle = '#b8442e'; c.lineWidth = 1.5;
        c.strokeRect(it.x + 1, it.y + 1, it.advance - 2, it.h - 2);
        c.beginPath(); c.moveTo(it.x, it.y); c.lineTo(it.x + it.advance, it.y + it.h); c.stroke();
      }
      if (settings.frames) {
        c.strokeStyle = '#8c8578'; c.lineWidth = 1;
        const top = L.lineTop(it.line) + m.lineHeight * 0.04;
        c.strokeRect(Math.round(it.x - m.gap / 2) + 0.5, Math.round(top) + 0.5,
          Math.round(it.advance + m.gap), Math.round(m.lineHeight * 0.92));
      }
      if (bad.has(i)) {
        c.strokeStyle = '#b8442e'; c.lineWidth = 2;
        const y = L.lineTop(it.line) + m.lineHeight - 3;
        c.beginPath(); c.moveTo(it.x, y); c.lineTo(it.x + it.advance, y); c.stroke();
      }
    });

    if (opts.caret) {
      const k = L.carets[cursor];
      c.fillStyle = '#3f6fb0';
      c.fillRect(Math.round(k.x) - 1, k.top + m.lineHeight * 0.1, 2, m.lineHeight * 0.8);
    }
  }

  function render() {
    const issues = validate(tokens);
    const width = scroller.clientWidth;
    const minHeight = scroller.clientHeight;
    const L = layout(tokens, width, minHeight, settings.size);
    lastLayout = L;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(L.width * dpr);
    canvas.height = Math.round(L.height * dpr);
    canvas.style.width = L.width + 'px';
    canvas.style.height = L.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawDoc(ctx, L, {guides: true, caret: true, issues});

    // держим курсор в поле зрения
    const k = L.carets[cursor];
    const top = k.top - L.metrics.lineHeight * 0.5;
    const bottom = k.top + L.metrics.lineHeight * 1.5;
    if (top < scroller.scrollTop) scroller.scrollTop = Math.max(0, top);
    else if (bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom - scroller.clientHeight;

    const msg = $('messages');
    msg.textContent = '';
    for (const it of issues) {
      const d = document.createElement('div');
      d.textContent = '⚠ ' + it.text;
      msg.appendChild(d);
    }
    const glyphCount = tokens.filter(t => t.type === 'glyph').length;
    $('foot').textContent = `Знаков: ${glyphCount} · токенов: ${tokens.length} · строк: ${L.lineCount} · курсор: ${cursor}` +
      ` · каталог ${set.catalogVersion}, графика: ${set.faces[settings.face]}`;
  }

  // ---------- правка с историей ----------

  function snapshot() { return {tokens: tokens.slice(), cursor}; }

  function edit(fn) {
    undoStack.push(snapshot());
    if (undoStack.length > 500) undoStack.shift();
    redoStack = [];
    fn();
    changed();
  }

  function changed() {
    render();
    autosave();
  }

  function insert(token) {
    edit(() => { tokens.splice(cursor, 0, token); cursor++; });
  }

  function backspace() {
    if (cursor === 0) return;
    edit(() => { tokens.splice(cursor - 1, 1); cursor--; });
  }

  function del() {
    if (cursor >= tokens.length) return;
    edit(() => { tokens.splice(cursor, 1); });
  }

  function clearAll() {
    if (!tokens.length) return;
    edit(() => { tokens = []; cursor = 0; });
    flash('Документ очищен. Ctrl+Z вернёт текст.');
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    ({tokens, cursor} = undoStack.pop());
    changed();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    ({tokens, cursor} = redoStack.pop());
    changed();
  }

  function moveCursor(to) {
    cursor = Math.max(0, Math.min(tokens.length, to));
    render();
  }

  function moveVertical(dir) {
    const L = lastLayout;
    const cur = L.carets[cursor];
    const target = cur.line + dir;
    if (target < 0 || target >= L.lineCount) return;
    moveCursor(nearestCaret(target, cur.x));
  }

  function nearestCaret(line, x) {
    const L = lastLayout;
    let best = -1, bestD = Infinity;
    L.carets.forEach((c, i) => {
      if (c.line !== line) return;
      const d = Math.abs(c.x - x);
      if (d < bestD || (d === bestD && i > best)) { best = i; bestD = d; }
    });
    return best;
  }

  function lineEdge(end) {
    const line = lastLayout.carets[cursor].line;
    const idx = lastLayout.carets.map((c, i) => c.line === line ? i : -1).filter(i => i >= 0);
    return end ? idx[idx.length - 1] : idx[0];
  }

  // ---------- хранение ----------

  function docJSON() {
    return {
      schemaVersion: SCHEMA_VERSION,
      catalogVersion: set.catalogVersion,
      documentKind: 'author-text',
      direction: {inline: 'rtl', lines: 'bottom-to-top'},
      mode: 'full',
      settings: {size: settings.size, frames: settings.frames, face: settings.face},
      tokens: tokens.map(t => t.type === 'glyph' ? {type: 'glyph', assetId: t.assetId} : {type: t.type}),
    };
  }

  /** Бросает Error с понятным текстом; текущий документ не трогает. */
  function parseDoc(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Файл не похож на документ.');
    if (data.schemaVersion !== SCHEMA_VERSION) throw new Error(`Неподдерживаемая версия схемы: ${data.schemaVersion}.`);
    if (!Array.isArray(data.tokens)) throw new Error('В документе нет списка tokens.');
    const out = [];
    data.tokens.forEach((t, i) => {
      if (!t || typeof t !== 'object') throw new Error(`Токен ${i + 1} повреждён.`);
      if (t.type === 'space' || t.type === 'linebreak') out.push({type: t.type});
      else if (t.type === 'glyph') {
        if (typeof t.assetId !== 'string' || !registry[t.assetId]) throw new Error(`Токен ${i + 1}: знака «${String(t.assetId)}» нет в каталоге.`);
        out.push({type: 'glyph', assetId: t.assetId});
      } else throw new Error(`Токен ${i + 1}: неизвестный тип «${String(t.type)}».`);
    });
    const s = data.settings || {};
    return {
      tokens: out,
      settings: {
        size: Number.isFinite(s.size) ? Math.min(120, Math.max(28, s.size)) : settings.size,
        frames: typeof s.frames === 'boolean' ? s.frames : settings.frames,
        face: s.face === 'photo' || s.face === 'font' ? s.face : settings.face,
      },
    };
  }

  function autosave() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({...docJSON(), cursor}));
      const t = new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'});
      $('saveStatus').textContent = `Черновик сохранён в браузере · ${t}`;
    } catch (e) {
      $('saveStatus').textContent = 'Черновик не сохраняется в браузере — сохраняйте JSON вручную.';
    }
  }

  function restore() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return; }
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      const doc = parseDoc(data);
      tokens = doc.tokens;
      settings = doc.settings;
      cursor = Number.isInteger(data.cursor) ? Math.min(tokens.length, Math.max(0, data.cursor)) : tokens.length;
      if (tokens.length) $('saveStatus').textContent = 'Восстановлен черновик из браузера.';
    } catch (e) {
      $('saveStatus').textContent = 'Черновик в браузере повреждён и не загружен: ' + e.message;
    }
  }

  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function saveJSON() {
    download(`текст_${stamp()}.json`, new Blob([JSON.stringify(docJSON(), null, 2)], {type: 'application/json'}));
  }

  function openJSON(file) {
    if (file.size > MAX_IMPORT_BYTES) { flash('Файл слишком большой для документа.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const doc = parseDoc(JSON.parse(reader.result));
        edit(() => { tokens = doc.tokens; cursor = tokens.length; settings = doc.settings; });
        syncSettingsUI();
        render();
        flash(`Открыт «${file.name}». Ctrl+Z вернёт прежний текст.`);
      } catch (e) {
        flash('Не удалось открыть: ' + (e instanceof SyntaxError ? 'файл не является JSON.' : e.message));
      }
    };
    reader.readAsText(file);
  }

  function exportLayout() {
    const width = Math.max(320, scroller.clientWidth);
    return layout(tokens, width, 0, settings.size);
  }

  function savePNG() {
    if (!tokens.length) { flash('Пустой документ — экспортировать нечего.'); return; }
    const L = exportLayout();
    const scale = 2;
    const c = document.createElement('canvas');
    c.width = Math.round(L.width * scale);
    c.height = Math.round(L.height * scale);
    const cx = c.getContext('2d');
    cx.setTransform(scale, 0, 0, scale, 0, 0);
    drawDoc(cx, L, {guides: false, caret: false});
    c.toBlob(b => download(`текст_${stamp()}.png`, b), 'image/png');
  }

  function saveSVG() {
    if (!tokens.length) { flash('Пустой документ — экспортировать нечего.'); return; }
    const L = exportLayout();
    const m = L.metrics;
    const r = n => Math.round(n * 100) / 100;
    const used = [...new Set(tokens.filter(t => t.type === 'glyph').map(t => t.assetId))];
    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}">`,
      `<rect width="100%" height="100%" fill="#fff"/>`,
      '<defs>',
      ...used.map(id => { const f = face(registry[id]); return `<image id="g${id}" width="${f.width}" height="${f.height}" href="${f.src}"/>`; }),
      '</defs>',
    ];
    tokens.forEach((t, i) => {
      if (t.type !== 'glyph') return;
      const it = L.info[i];
      parts.push(`<use href="#g${t.assetId}" data-index="${i}" transform="translate(${r(it.x)} ${r(it.y)}) scale(${r(m.scale * 1000) / 1000})"/>`);
      if (settings.frames) {
        parts.push(`<rect x="${r(it.x - m.gap / 2)}" y="${r(L.lineTop(it.line) + m.lineHeight * 0.04)}" width="${r(it.advance + m.gap)}" height="${r(m.lineHeight * 0.92)}" fill="none" stroke="#8c8578"/>`);
      }
    });
    parts.push('</svg>');
    download(`текст_${stamp()}.svg`, new Blob([parts.join('\n')], {type: 'image/svg+xml'}));
  }

  // ---------- интерфейс ----------

  let flashTimer = 0;
  function flash(text) {
    const s = $('saveStatus');
    s.textContent = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => autosave(), 5000);
  }

  const STATUS_RU = {
    author_confirmed: 'подтверждено автором',
    table_read: 'прочитано по таблице',
    inference: 'предположение',
    unresolved: 'не установлено',
  };

  function showInfo(g) {
    const box = $('info');
    box.textContent = '';
    const img = document.createElement('img');
    img.src = face(g).src; img.alt = '';
    const text = document.createElement('div');
    const title = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = `${g.id} · ${g.name}`;
    const badge = document.createElement('span');
    badge.className = 'badge ' + g.status;
    badge.textContent = STATUS_RU[g.status] || g.status;
    title.append(b, badge);
    const p = document.createElement('div');
    p.className = 'muted';
    p.textContent = g.meaning + (g.variantOf ? ` Вероятный повтор ${g.variantOf}.` : '');
    text.append(title, p);
    box.append(img, text);
  }

  function buildKeyboard() {
    // одна панель со своей прокруткой; повторные образцы (variant) на клавиатуру не выводятся,
    // но остаются в каталоге, чтобы открывались старые документы
    const order = {letter: 0, punctuation: 1};
    const list = glyphs.filter(g => g.kind in order).sort((a, b) => order[a.kind] - order[b.kind]);
    const grid = document.createElement('div');
    grid.className = 'keys';
    for (const g of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'key' + (g.endsText ? ' end' : '');
      btn.title = `${g.id} · ${g.name}`;
      btn.setAttribute('aria-label', `Знак ${g.id}, ${g.name}`);
      const img = document.createElement('img');
      img.src = face(g).src; img.alt = '';
      img.dataset.glyph = g.id;
      const small = document.createElement('small');
      small.textContent = g.id;
      btn.append(img, small);
      // фокус остаётся в редакторе, чтобы клавиатура продолжала работать
      btn.addEventListener('pointerdown', e => e.preventDefault());
      btn.addEventListener('click', () => { insert({type: 'glyph', assetId: g.id}); showInfo(g); buzz(); scroller.focus({preventScroll: true}); });
      btn.addEventListener('mouseenter', () => showInfo(g));
      btn.addEventListener('focus', () => showInfo(g));
      grid.appendChild(btn);
    }
    $('keyboard').appendChild(grid);
  }

  function buzz() {
    if (navigator.vibrate && matchMedia('(pointer: coarse)').matches) navigator.vibrate(8);
  }

  function setMenu(open) {
    $('toolbar').classList.toggle('open', open);
    $('menuBtn').setAttribute('aria-expanded', String(open));
  }

  function syncSettingsUI() {
    $('sizeInput').value = settings.size;
    $('framesInput').checked = settings.frames;
    $('faceInput').value = settings.face;
  }

  const actions = {
    undo, redo, clear: clearAll, save: saveJSON, png: savePNG, svg: saveSVG,
    open: () => $('fileInput').click(),
    space: () => insert({type: 'space'}),
    linebreak: () => insert({type: 'linebreak'}),
    backspace,
  };

  function bind() {
    document.querySelectorAll('[data-action]').forEach(b => {
      b.addEventListener('pointerdown', e => { if (b.classList.contains('ctl')) e.preventDefault(); });
      b.addEventListener('click', () => {
        actions[b.dataset.action]();
        if (b.classList.contains('ctl')) { buzz(); scroller.focus({preventScroll: true}); }
        else setMenu(false);
      });
    });
    $('menuBtn').addEventListener('click', () => setMenu(!$('toolbar').classList.contains('open')));
    $('fileInput').addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) openJSON(f);
      e.target.value = '';
    });
    $('sizeInput').addEventListener('input', e => { settings.size = +e.target.value; changed(); });
    $('framesInput').addEventListener('change', e => { settings.frames = e.target.checked; changed(); });
    $('faceInput').addEventListener('change', e => {
      settings.face = e.target.value;
      document.querySelectorAll('img[data-glyph]').forEach(img => { img.src = face(registry[img.dataset.glyph]).src; });
      changed();
    });

    scroller.addEventListener('focus', () => scroller.classList.add('focused'));
    scroller.addEventListener('blur', () => scroller.classList.remove('focused'));
    canvas.addEventListener('click', e => {
      const L = lastLayout;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      let line = Math.floor((L.height - L.metrics.margin - y) / L.metrics.lineHeight);
      line = Math.max(0, Math.min(L.lineCount - 1, line));
      moveCursor(nearestCaret(line, x));
    });

    scroller.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;
      let handled = true;
      if (mod && (key === 'z' || key === 'Z' || key === 'я' || key === 'Я')) e.shiftKey ? redo() : undo();
      else if (mod && (key === 'y' || key === 'Y' || key === 'н' || key === 'Н')) redo();
      else if (mod) handled = false;
      else if (key === 'Backspace') backspace();
      else if (key === 'Delete') del();
      else if (key === 'Enter') insert({type: 'linebreak'});
      else if (key === ' ') insert({type: 'space'});
      else if (key === 'ArrowLeft') moveCursor(cursor + 1);
      else if (key === 'ArrowRight') moveCursor(cursor - 1);
      else if (key === 'ArrowUp') moveVertical(1);
      else if (key === 'ArrowDown') moveVertical(-1);
      else if (key === 'Home') moveCursor(lineEdge(false));
      else if (key === 'End') moveCursor(lineEdge(true));
      else handled = false;
      if (handled) e.preventDefault();
    });

    // редактор меняет размер вместе с раскладкой (поворот, меню, предупреждения)
    let lastSize = '';
    new ResizeObserver(() => {
      const size = scroller.clientWidth + 'x' + scroller.clientHeight;
      if (size !== lastSize) { lastSize = size; requestAnimationFrame(render); }
    }).observe(scroller);
  }

  function loadImages() {
    return Promise.all(Object.keys(set.faces).flatMap(name => {
      images[name] = {};
      return glyphs.map(g => new Promise(resolve => {
        const img = new Image();
        img.onload = img.onerror = () => resolve();
        img.src = g[name].src;
        images[name][g.id] = img;
      }));
    }));
  }

  if (window.innerWidth < 600) settings.size = 44;
  restore();
  syncSettingsUI();
  buildKeyboard();
  bind();
  loadImages().then(() => { render(); if (!$('saveStatus').textContent) autosave(); scroller.focus({preventScroll: true}); });
  render();
})();
