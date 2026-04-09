/* ─────────────────────────────────────────────────────────────
   TYPEX — script.js
   Typing speed test: WPM, RAW, Accuracy, Consistency, Time
   Quotes: Quotable.io (free, unlimited, no key)
   Storage: localStorage
   ───────────────────────────────────────────────────────────── */

'use strict';

/* ── STATE ──────────────────────────────────────────────────── */
const state = {
  text:         '',
  charStatus:   [],   /* 'pending' | 'correct' | 'wrong' per character */
  charIndex:    0,
  started:      false,
  finished:     false,
  startTime:    null,
  timer:        null,
  liveInterval: null,
  mode:         'auto',
  modeVal:      0,
  timeLeft:     0,

  /*
   * ACCURACY MODEL (fixed):
   *
   * totalAttempts  — increments every time a character is typed forward.
   *                  NEVER decremented by backspace. Backspace does not "undo" an attempt.
   *
   * totalCorrect   — increments when the char typed matches expected.
   *                  NEVER decremented by backspace. Fixing a mistake does not
   *                  retroactively turn a wrong attempt into a correct one.
   *
   * errorSet       — Set of char positions that were EVER typed wrong.
   *                  Used for "unique errors" display. Positions are never removed.
   *
   * correctKeys    — net correct chars at the cursor right now (used for WPM).
   *                  IS adjusted by backspace so live WPM stays accurate.
   *
   * Accuracy = totalCorrect / totalAttempts  (permanent record of every keypress)
   * WPM      = (correctKeys / 5) / elapsedMin  (reflects current cursor state)
   */
  totalAttempts: 0,
  totalCorrect:  0,
  correctKeys:   0,   /* net — adjusted by backspace, drives WPM */
  errorSet:      new Set(),
  wpmSamples:    [],
};

/* ── DOM REFS ────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const wordDisplay  = $('word-display');
const hiddenInput  = $('hidden-input');
const liveTimer    = $('live-timer');
const liveWpm      = $('live-wpm');
const liveRaw      = $('live-raw');
const progressFill = $('progress-fill');
const resultsPanel = $('results-panel');
const resultsGrid  = $('results-grid');
const historyPanel = $('history-panel');
const historyBody  = $('history-body');
const quoteAuthor  = $('quote-author');
const glyphCorner  = $('glyph-corner');
const glyphBar     = $('glyph-bar');
const themeLabel   = $('theme-label');

let caretLineOffset = 0;

/* ═══════════════════════════════════════════════════════════════
   QUOTES
═══════════════════════════════════════════════════════════════ */

const REAL_FALLBACK = [
  { content: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { content: "In the middle of every difficulty lies opportunity.", author: "Albert Einstein" },
  { content: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { content: "Life is what happens when you are busy making other plans.", author: "John Lennon" },
  { content: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
  { content: "Spread love everywhere you go. Let no one ever come to you without leaving happier.", author: "Mother Teresa" },
  { content: "When you reach the end of your rope, tie a knot in it and hang on.", author: "Franklin D. Roosevelt" },
  { content: "Do not go where the path may lead, go instead where there is no path and leave a trail.", author: "Ralph Waldo Emerson" },
  { content: "You will face many defeats in life, but never let yourself be defeated.", author: "Maya Angelou" },
  { content: "The greatest glory in living lies not in never falling, but in rising every time we fall.", author: "Nelson Mandela" },
  { content: "In the end it is not the years in your life that count. It is the life in your years.", author: "Abraham Lincoln" },
  { content: "Never let the fear of striking out keep you from playing the game.", author: "Babe Ruth" },
  { content: "Simplicity is the ultimate sophistication.", author: "Leonardo da Vinci" },
  { content: "Design is not just what it looks like and feels like. Design is how it works.", author: "Steve Jobs" },
  { content: "Everything should be made as simple as possible, but not simpler.", author: "Albert Einstein" },
  { content: "The details are not the details. They make the design.", author: "Charles Eames" },
];

let monkeytypeQuotes = null;

async function fetchQuote() {
  if (!monkeytypeQuotes) {
    try {
      const res = await fetch('https://raw.githubusercontent.com/monkeytypegame/monkeytype/master/frontend/static/quotes/english.json');
      if (!res.ok) throw new Error('api error');
      const data = await res.json();
      monkeytypeQuotes = data.quotes;
    } catch {
      monkeytypeQuotes = REAL_FALLBACK;
    }
  }

  const q = monkeytypeQuotes[Math.floor(Math.random() * monkeytypeQuotes.length)];
  quoteAuthor.textContent = '— ' + (q.source || q.author || '—');
  return cleanText(q.text || q.content);
}

function cleanText(raw) {
  return raw
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ═══════════════════════════════════════════════════════════════
   INIT / LOAD
═══════════════════════════════════════════════════════════════ */

async function loadNewQuote() {
  resetState();
  hidePanel(resultsPanel);
  hidePanel(historyPanel);
  wordDisplay.innerHTML = '<span class="loading-dots">loading</span>';

  const raw  = await fetchQuote();
  let words  = raw.split(' ');

  if (state.mode === 'words') {
    while (words.length < state.modeVal) words = [...words, ...raw.split(' ')];
    words = words.slice(0, state.modeVal);
  } else if (state.mode === 'auto') {
    // Approx 40 WPM gives generous time limit based on length
    state.modeVal = Math.max(10, Math.ceil(raw.length / 3.3));
    state.timeLeft = state.modeVal;
    liveTimer.textContent = state.modeVal;
  }

  state.text       = words.join(' ');
  state.charStatus = Array(state.text.length).fill('pending');

  renderText();
  focusInput();
}

/* ═══════════════════════════════════════════════════════════════
   RENDER TEXT
═══════════════════════════════════════════════════════════════ */

function renderText(skipAnim = false) {
  wordDisplay.innerHTML = '';
  wordDisplay.classList.remove('glitch-in');
  caretLineOffset = 0;
  wordDisplay.style.transform = 'translateY(0)';

  for (let i = 0; i < state.text.length; i++) {
    const ch   = state.text[i];
    const span = document.createElement('span');
    span.dataset.idx = i;

    if (ch === ' ') {
      span.className = 'char char-space';
      span.innerHTML = '&nbsp;';
    } else {
      span.className   = 'char';
      span.textContent = ch;
    }

    wordDisplay.appendChild(span);
  }

  // Create caret inside wordDisplay
  const caret = document.createElement('div');
  caret.id = 'caret';
  caret.className = 'caret';
  wordDisplay.appendChild(caret);

  if (!skipAnim) {
    const chars = wordDisplay.querySelectorAll('.char');
    chars.forEach((c, i) => { c.style.animationDelay = `${i * 5}ms`; });
    void wordDisplay.offsetWidth;
    wordDisplay.classList.add('glitch-in');
    setTimeout(() => {
      wordDisplay.classList.remove('glitch-in');
      chars.forEach(c => { c.style.animationDelay = ''; });
    }, 600);
  }

  updateProgress();
  refreshChars();
}

/* ═══════════════════════════════════════════════════════════════
   RESET
═══════════════════════════════════════════════════════════════ */

function resetState() {
  clearInterval(state.timer);
  clearInterval(state.liveInterval);

  state.charStatus    = [];
  state.charIndex     = 0;
  state.started       = false;
  state.finished      = false;
  state.startTime     = null;
  state.timer         = null;
  state.liveInterval  = null;
  state.totalAttempts = 0;
  state.totalCorrect  = 0;
  state.correctKeys   = 0;
  state.errorSet      = new Set();
  state.wpmSamples    = [];
  state.timeLeft      = state.modeVal;
  state.fetchingFree  = false;

  liveTimer.textContent    = (state.mode === 'time' || state.mode === 'auto') ? String(state.modeVal) : '—';
  liveTimer.classList.remove('urgent');
  liveWpm.textContent      = '—';
  liveRaw.textContent      = '—';
  progressFill.style.width = '0%';
  hiddenInput.value        = '';
}

function restartTest() {
  resetState();
  hidePanel(resultsPanel);
  state.charStatus = Array(state.text.length).fill('pending');
  renderText(true);
  focusInput();
}

/* ═══════════════════════════════════════════════════════════════
   INPUT — char-by-char with full backspace correction
═══════════════════════════════════════════════════════════════ */

function focusInput() {
  hiddenInput.focus();
}

hiddenInput.addEventListener('keydown', handleKeyDown);
hiddenInput.addEventListener('input',   handleInput);

function handleKeyDown(e) {
  if (state.finished) return;
  
  if (!state.started && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
     startTest();
  }

  if (e.key === 'Backspace') {
    e.preventDefault();
    if (e.ctrlKey || e.altKey) {
        handleCtrlBackspace();
    } else {
        handleBackspace();
    }
  } else if (e.key === ' ') {
    const expectedCh = state.text[state.charIndex];
    if (expectedCh !== ' ') {
      // Space typed but not expected -> skip to next word
      e.preventDefault();
      let nextSpaceIdx = state.text.indexOf(' ', state.charIndex);
      if (nextSpaceIdx === -1) {
        return; // End of quote, ignore space
      }
      
      // Mark skipped chars as wrong
      while (state.charIndex < nextSpaceIdx) {
        state.charStatus[state.charIndex] = 'wrong';
        state.errorSet.add(state.charIndex);
        state.totalAttempts++;
        state.charIndex++;
      }
      
      // Mark the space itself as correct to jump
      state.charStatus[state.charIndex] = 'correct';
      state.totalAttempts++;
      state.totalCorrect++;
      state.correctKeys++;
      state.charIndex++;

      hiddenInput.value = state.text.slice(0, state.charIndex);
      refreshChars();
      updateProgress();
      
      if (state.mode === 'words' && state.charIndex >= state.text.length) {
        finishTest();
      }
    }
  }
}

function handleCtrlBackspace() {
  if (state.charIndex === 0) return;
  
  let t = state.charIndex - 1;
  while (t > 0 && state.text[t] === ' ') t--; // skip spaces
  while (t > 0 && state.text[t] !== ' ') t--; // jump to word start
  if (t > 0) t++; // be ON the first char of the word
  
  while (state.charIndex > t) {
    state.charIndex--;
    if (state.charStatus[state.charIndex] === 'correct') {
      state.correctKeys--;
    }
    state.charStatus[state.charIndex] = 'pending';
  }
  
  hiddenInput.value = state.text.slice(0, state.charIndex);
  refreshChars();
  updateProgress();
}

function handleBackspace() {
  if (state.charIndex === 0) return;

  state.charIndex--;

  /*
   * Adjust correctKeys (net) for WPM accuracy —
   * but do NOT touch totalAttempts or totalCorrect.
   * The attempt already happened and is permanently recorded.
   */
  if (state.charStatus[state.charIndex] === 'correct') {
    state.correctKeys--;
  }
  /* wrong chars: correctKeys was never incremented, nothing to undo */

  state.charStatus[state.charIndex] = 'pending';
  hiddenInput.value = hiddenInput.value.slice(0, state.charIndex);

  refreshChars();
  updateProgress();
}

function handleInput() {
  if (state.finished) return;

  const val = hiddenInput.value;

  /* External deletion (mobile autocorrect, paste, etc.) */
  if (val.length < state.charIndex) {
    while (state.charIndex > val.length) {
      state.charIndex--;
      if (state.charStatus[state.charIndex] === 'correct') state.correctKeys--;
      state.charStatus[state.charIndex] = 'pending';
      /* totalAttempts / totalCorrect unchanged — past presses are permanent */
    }
    refreshChars();
    updateProgress();
    return;
  }

  /* Process each newly added character */
  while (state.charIndex < val.length && state.charIndex < state.text.length) {
    const typedCh    = val[state.charIndex];
    const expectedCh = state.text[state.charIndex];

    if (!state.started) startTest();

    /* Every forward keypress is a permanent attempt */
    state.totalAttempts++;

    if (typedCh === expectedCh) {
      state.charStatus[state.charIndex] = 'correct';
      state.totalCorrect++;
      state.correctKeys++;
    } else {
      state.charStatus[state.charIndex] = 'wrong';
      state.errorSet.add(state.charIndex); /* unique positions ever wrong */
      /* totalCorrect unchanged — wrong presses are permanently wrong */
    }

    state.charIndex++;
  }

  if (hiddenInput.value.length > state.text.length) {
    hiddenInput.value = hiddenInput.value.slice(0, state.text.length);
  }

  refreshChars();
  updateProgress();

  if (state.mode === 'words' && state.charIndex >= state.text.length) {
    finishTest();
  }

  if (state.mode === 'free' && state.text.length - state.charIndex < 40 && !state.fetchingFree) {
    state.fetchingFree = true;
    fetchQuote().then(q => {
      const oldLen = state.text.length;
      state.text += ' ' + q;
      state.charStatus.length = state.text.length;
      state.charStatus.fill('pending', oldLen);
      
      const caret = document.getElementById('caret');
      
      const sp = document.createElement('span');
      sp.dataset.idx = oldLen;
      sp.className = 'char char-space';
      sp.innerHTML = '&nbsp;';
      wordDisplay.insertBefore(sp, caret);
      
      for (let i = 0; i < q.length; i++) {
        const span = document.createElement('span');
        span.dataset.idx = oldLen + 1 + i;
        span.className = 'char';
        span.textContent = q[i];
        wordDisplay.insertBefore(span, caret);
      }
      
      state.fetchingFree = false;
    });
  }
}

/* ── REFRESH DISPLAY ─────────────────────────────────────────── */
function refreshChars() {
  const chars = wordDisplay.querySelectorAll('.char');
  if (!chars.length) return;

  chars.forEach((c, i) => {
    c.classList.remove('correct', 'wrong');
    if (i < state.charIndex) {
      c.classList.add(state.charStatus[i] === 'correct' ? 'correct' : 'wrong');
    }
  });

  const caret = $('caret');
  if (!caret) return;

  let activeChar;
  let isEOF = false;

  if (state.charIndex < chars.length) {
    activeChar = chars[state.charIndex];
  } else {
    activeChar = chars[chars.length - 1];
    isEOF = true;
  }

  const rT = activeChar.offsetTop;
  let rL = activeChar.offsetLeft;
  
  if (isEOF) {
    rL += activeChar.offsetWidth;
  }

  // Smooth Y Scrolling for Caret Line
  // Assuming line height ~45px. 1st line=0, 2nd=~45, 3rd=~90.
  if (rT > 60) {
    caretLineOffset = rT - 45; // keep visual caret on 2nd line
  } else if (rT < 20) {
    caretLineOffset = 0;       // reset to top
  }
  
  wordDisplay.style.transform = `translateY(-${caretLineOffset}px)`;
  
  caret.style.top = (rT + 4) + 'px'; // +4 to center slightly
  caret.style.left = rL + 'px';
  caret.classList.remove('d-none');
}

/* ═══════════════════════════════════════════════════════════════
   START TEST
═══════════════════════════════════════════════════════════════ */

function startTest() {
  state.started   = true;
  state.startTime = Date.now();

  if (state.mode === 'time' || state.mode === 'auto') {
    state.timeLeft = state.modeVal;
    state.timer = setInterval(() => {
      state.timeLeft--;
      liveTimer.textContent = String(state.timeLeft);
      if (state.timeLeft <= 5) liveTimer.classList.add('urgent');
      if (state.timeLeft <= 0) finishTest();
    }, 1000);
  } else {
    liveTimer.textContent = '∞';
  }

  state.liveInterval = setInterval(tickLiveStats, 500);
}

/* ═══════════════════════════════════════════════════════════════
   LIVE STATS
═══════════════════════════════════════════════════════════════ */

function tickLiveStats() {
  if (!state.started || !state.startTime) return;
  const elapsedMin = (Date.now() - state.startTime) / 60000;
  if (elapsedMin < 0.0005) return;

  /* WPM uses net correctKeys (backspace-aware) */
  const wpm = Math.round((state.correctKeys   / 5) / elapsedMin);
  /* RAW uses total attempts (never decremented) */
  const raw = Math.round((state.totalAttempts / 5) / elapsedMin);

  state.wpmSamples.push({ wpm });
  liveWpm.textContent = wpm > 0 ? wpm : '—';
  liveRaw.textContent = raw > 0 ? raw : '—';

  if (state.mode === 'time' || state.mode === 'auto') {
    const pct = ((state.modeVal - state.timeLeft) / state.modeVal) * 100;
    progressFill.style.width = Math.min(pct, 100) + '%';
  }
}

function updateProgress() {
  if (state.mode === 'words') {
    progressFill.style.width = Math.min((state.charIndex / state.text.length) * 100, 100) + '%';
  } else if ((state.mode === 'time' || state.mode === 'auto') && state.started) {
    const pct = ((state.modeVal - state.timeLeft) / state.modeVal) * 100;
    progressFill.style.width = Math.min(pct, 100) + '%';
  }
}

/* ═══════════════════════════════════════════════════════════════
   FINISH TEST
═══════════════════════════════════════════════════════════════ */

function finishTest() {
  if (state.finished) return;
  state.finished = true;

  clearInterval(state.timer);
  clearInterval(state.liveInterval);

  const elapsed    = (Date.now() - state.startTime) / 1000;
  const elapsedMin = elapsed / 60;

  const wpm = elapsedMin > 0 ? Math.round((state.correctKeys   / 5) / elapsedMin) : 0;
  const raw = elapsedMin > 0 ? Math.round((state.totalAttempts / 5) / elapsedMin) : 0;

  /*
   * Accuracy = totalCorrect / totalAttempts
   *
   * This reflects every keypress ever made, including ones that were
   * later fixed with backspace. If you typed 100 chars and got 10 wrong
   * before correcting them, accuracy is 90% — not 100%.
   */
  const accuracy = state.totalAttempts > 0
    ? Math.round((state.totalCorrect / state.totalAttempts) * 100)
    : 0;

  const consistency   = calcConsistency();
  const time          = (state.mode === 'time' || state.mode === 'auto') ? state.modeVal : Math.round(elapsed);
  const uniqueErrors  = state.errorSet.size;

  progressFill.style.width = '100%';
  showResults({ wpm, raw, accuracy, consistency, time, errors: uniqueErrors });
  saveHistory({
    wpm, raw, accuracy, consistency, time,
    errors: uniqueErrors,
    mode: state.mode + (state.modeVal || ''),
    date: todayStr()
  });
}

function calcConsistency() {
  const s = state.wpmSamples;
  if (s.length < 2) return 100;
  const vals     = s.map(x => x.wpm);
  const mean     = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  const cv       = mean > 0 ? (Math.sqrt(variance) / mean) * 100 : 0;
  return Math.max(0, Math.min(100, Math.round(100 - cv)));
}

/* ═══════════════════════════════════════════════════════════════
   SHOW RESULTS
═══════════════════════════════════════════════════════════════ */

function showResults({ wpm, raw, accuracy, consistency, time, errors }) {
  const cards = [
    { label: 'WPM',  value: wpm,               unit: 'words / min',  featured: true },
    { label: 'RAW',  value: raw,               unit: 'raw wpm'                      },
    { label: 'ACC',  value: accuracy + '%',    unit: 'accuracy'                     },
    { label: 'CONS', value: consistency + '%', unit: 'consistency'                  },
    { label: 'TIME', value: time + 's',        unit: 'duration'                     },
    { label: 'ERR',  value: errors,            unit: 'unique errors'                },
  ];

  resultsGrid.innerHTML = cards.map(c => `
    <div class="result-card ${c.featured ? 'featured' : ''}">
      <div class="result-label">${c.label}</div>
      <div class="result-value" data-val="${c.value}">${c.value}</div>
      <div class="result-unit">${c.unit}</div>
    </div>`).join('');

  showPanel(resultsPanel);

  resultsGrid.querySelectorAll('.result-value').forEach((el, i) => {
    setTimeout(() => el.classList.add('glitch-animate'), i * 70);
  });
}

/* ═══════════════════════════════════════════════════════════════
   HISTORY
═══════════════════════════════════════════════════════════════ */

const HISTORY_KEY = 'typex_v1_history';

function saveHistory(record) {
  const log = getHistory();
  log.unshift(record);
  if (log.length > 100) log.length = 100;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(log));
}

function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}

function clearHistory() {
  if (!confirm('Clear all test records?')) return;
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

function toggleHistory() {
  if (historyPanel.style.display === 'block') {
    hidePanel(historyPanel);
  } else {
    hidePanel(resultsPanel);
    renderHistory();
    showPanel(historyPanel);
  }
}

function renderHistory() {
  const log = getHistory();
  if (!log.length) {
    historyBody.innerHTML = '<div class="no-history">NO RECORDS YET</div>';
    return;
  }
  historyBody.innerHTML = `
    <table class="history-table">
      <thead><tr>
        <th>#</th><th>DATE</th><th>MODE</th>
        <th>WPM</th><th>RAW</th><th>ACC</th>
        <th>CONS</th><th>TIME</th><th>ERR</th>
      </tr></thead>
      <tbody>${log.map((r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${r.date || '—'}</td>
          <td>${r.mode || '—'}</td>
          <td class="wpm-cell">${r.wpm}</td>
          <td>${r.raw}</td>
          <td>${r.accuracy}%</td>
          <td>${r.consistency}%</td>
          <td>${r.time}s</td>
          <td>${r.errors}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ═══════════════════════════════════════════════════════════════
   MODE
═══════════════════════════════════════════════════════════════ */

function setMode(el, mode, val) {
  state.mode    = mode;
  state.modeVal = val;
  document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  loadNewQuote();
}

/* ═══════════════════════════════════════════════════════════════
   THEME
═══════════════════════════════════════════════════════════════ */

function toggleTheme() {
  const root   = document.documentElement;
  const isDark = root.dataset.theme === 'dark';
  root.dataset.theme     = isDark ? 'light' : 'dark';
  themeLabel.textContent = isDark ? 'DARK' : 'LIGHT';
  localStorage.setItem('typex_theme', root.dataset.theme);
}

(function restoreTheme() {
  const saved = localStorage.getItem('typex_theme');
  const root  = document.documentElement;
  if (saved) {
    root.dataset.theme = saved;
    if (themeLabel) themeLabel.textContent = saved === 'dark' ? 'LIGHT' : 'DARK';
  } else {
    root.dataset.theme = 'dark';
    if (themeLabel) themeLabel.textContent = 'LIGHT';
  }
})();

/* ═══════════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
═══════════════════════════════════════════════════════════════ */

document.addEventListener('keydown', e => {
  if (e.target === hiddenInput) return;
  if (e.key === 'Tab')    { e.preventDefault(); restartTest(); }
  if (e.key === 'Escape') { e.preventDefault(); loadNewQuote(); }
});

/* ═══════════════════════════════════════════════════════════════
   PIXEL NOISE CANVAS
═══════════════════════════════════════════════════════════════ */

(function initNoise() {
  const canvas = $('noise-canvas');
  const ctx    = canvas.getContext('2d');
  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);
  function draw() {
    const img = ctx.createImageData(canvas.width, canvas.height);
    const d   = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() > 0.5 ? 255 : 0;
      d[i] = d[i+1] = d[i+2] = v;
      d[i+3] = Math.floor(Math.random() * 35);
    }
    ctx.putImageData(img, 0, 0);
    requestAnimationFrame(draw);
  }
  draw();
})();

/* ═══════════════════════════════════════════════════════════════
   GLYPH CORNER
═══════════════════════════════════════════════════════════════ */

(function initGlyphCorner() {
  const G   = '█▓▒░▪◆■□▲▼◉○●';
  const rnd = n => Array.from({ length: n }, () => G[Math.floor(Math.random() * G.length)]).join('');
  const upd = () => { glyphCorner.textContent = rnd(7) + '\n' + rnd(5) + '\n' + rnd(3); };
  upd();
  setInterval(upd, 140);
})();

/* ═══════════════════════════════════════════════════════════════
   GLYPH BAR
═══════════════════════════════════════════════════════════════ */

(function initGlyphBar() {
  const P = [
    '█░░░░█░░░░█░░░░█░░░░█░░░░█░░░░█░░░░█░░░░█░░░░█',
    '▓▒░▒▓▒░▒▓▒░▒▓▒░▒▓▒░▒▓▒░▒▓▒░▒▓▒░▒▓▒░▒▓▒░▒▓',
    '◆ ◇ ◆ ◇ ◆ ◇ ◆ ◇ ◆ ◇ ◆ ◇ ◆ ◇ ◆ ◇ ◆ ◇ ◆ ◇',
    '■ □ ■ □ ■ □ ■ □ ■ □ ■ □ ■ □ ■ □ ■ □ ■ □ ■',
    '▲ △ ▲ △ ▲ △ ▲ △ ▲ △ ▲ △ ▲ △ ▲ △ ▲ △ ▲ △',
  ];
  let i = 0;
  setInterval(() => { i = (i + 1) % P.length; glyphBar.textContent = P[i]; }, 3000);
})();

/* ── HELPERS ─────────────────────────────────────────────────── */
function showPanel(el) { el.style.display = 'block'; el.setAttribute('aria-hidden', 'false'); }
function hidePanel(el) { el.style.display = 'none';  el.setAttribute('aria-hidden', 'true');  }
function todayStr()    { return new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }

/* ── BOOT ────────────────────────────────────────────────────── */
loadNewQuote();
