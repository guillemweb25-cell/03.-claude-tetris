'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const resumeBtn = document.getElementById('resume-btn');
const controlsBtn = document.getElementById('controls-btn');
const controlsList = document.getElementById('controls-list');
const startLevelSel = document.getElementById('start-level');
const pauseOnly = document.querySelectorAll('.pause-only');

const INPUT_LOCK_MS = 200;
let startLevel = 1;
let gameStartLevel = 1;
let inputLockUntil = 0;
const recordsBox = document.getElementById('records-box');
const recordsList = document.getElementById('records-list');
const recordsStats = document.getElementById('records-stats');
const nameForm = document.getElementById('name-form');
const nameInput = document.getElementById('name-input');
const topMsg = document.getElementById('top-msg');
const resetRecordsBtn = document.getElementById('reset-records-btn');

const RECORDS_KEY = 'tetris.records';
const MAX_RECORDS = 5;

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let started = false, combo = 0, bestComboRun = 0, pendingScore = null;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  combo = cleared ? combo + 1 : 0;
  if (combo > bestComboRun) bestComboRun = combo;
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = gameStartLevel + Math.floor(lines / 10);
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = '#22222e';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

// ---- Records (localStorage) ----
function loadRecords() {
  const empty = { top: [], bestCombo: 0, maxLines: 0 };
  try {
    const d = JSON.parse(localStorage.getItem(RECORDS_KEY));
    if (!d || !Array.isArray(d.top)) return empty;
    return {
      top: d.top.filter(e => e && Number.isFinite(e.score))
        .map(e => ({ name: String(e.name ?? 'ANON').slice(0, 10), score: e.score })).sort((a, b) => b.score - a.score).slice(0, MAX_RECORDS),
      bestCombo: Number(d.bestCombo) || 0,
      maxLines: Number(d.maxLines) || 0,
    };
  } catch (e) { return empty; }
}

function saveRecords(rec) {
  try { localStorage.setItem(RECORDS_KEY, JSON.stringify(rec)); } catch (e) { /* ignorar */ }
}

function qualifies(sc, rec) {
  return sc > 0 && (rec.top.length < MAX_RECORDS || sc > rec.top[rec.top.length - 1].score);
}

// Inserta (tras los iguales) y devuelve el índice, o -1 si no entra.
function insertScore(rec, name, sc) {
  let i = rec.top.findIndex(e => e.score < sc);
  if (i === -1) i = rec.top.length;
  if (i >= MAX_RECORDS) return -1;
  rec.top.splice(i, 0, { name, score: sc });
  rec.top.length = Math.min(rec.top.length, MAX_RECORDS);
  return i;
}

function renderRecords(rec, hi, hiName) {
  const top = rec.top.slice();
  if (hi >= 0 && hiName !== undefined) top.splice(hi, 0, { name: hiName, score: score });
  recordsList.textContent = '';
  if (!top.length) {
    const li = document.createElement('li');
    li.textContent = 'Sin records todavía';
    li.className = 'empty';
    recordsList.appendChild(li);
  }
  top.slice(0, MAX_RECORDS).forEach((e, i) => {
    const li = document.createElement('li');
    if (i === hi) li.className = 'highlight';
    const n = document.createElement('span');
    n.textContent = `${i + 1}. ${e.name}`;
    const v = document.createElement('span');
    v.textContent = e.score.toLocaleString();
    li.append(n, v);
    recordsList.appendChild(li);
  });
  recordsStats.textContent = `Mejor combo: ${rec.bestCombo} · Máx. líneas: ${rec.maxLines}`;
  recordsBox.classList.remove('hidden');
}

function saveName(name) {
  if (pendingScore === null) return;
  const rec = loadRecords();
  const hi = insertScore(rec, (name || '').trim().slice(0, 10) || 'ANON', pendingScore);
  pendingScore = null;
  saveRecords(rec);
  nameForm.classList.add('hidden');
  if (overlayTitle.textContent === 'GAME OVER') renderRecords(rec, hi);
}

function showStart() {
  overlayTitle.textContent = 'TETRIS';
  overlayTitle.className = 'start';
  overlayScore.textContent = '';
  restartBtn.textContent = 'Jugar';
  nameForm.classList.add('hidden');
  topMsg.textContent = '';
  pauseOnly.forEach(el => el.classList.add('hidden'));
  controlsList.classList.add('hidden');
  renderRecords(loadRecords(), -1);
  overlay.classList.remove('hidden');
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  const rec = loadRecords();
  rec.bestCombo = Math.max(rec.bestCombo, bestComboRun);
  rec.maxLines = Math.max(rec.maxLines, lines);
  saveRecords(rec);
  overlayTitle.textContent = 'GAME OVER';
  overlayTitle.className = '';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  pauseOnly.forEach(el => el.classList.add('hidden'));
  controlsList.classList.add('hidden');
  restartBtn.textContent = 'Reiniciar';
  if (qualifies(score, rec)) {
    pendingScore = score;
    const hi = insertScore({ top: rec.top.slice(), bestCombo: 0, maxLines: 0 }, '', score);
    topMsg.textContent = '¡Entras en el top 5!';
    nameForm.classList.remove('hidden');
    nameInput.value = '';
    renderRecords(rec, hi, '...');
    setTimeout(() => { if (gameOver && pendingScore !== null) nameInput.focus(); }, 400);
  } else {
    pendingScore = null;
    topMsg.textContent = '';
    nameForm.classList.add('hidden');
    renderRecords(rec, -1);
  }
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver || !started) return;
  paused = !paused;
  if (!paused) {
    overlay.classList.add('hidden');
    controlsList.classList.add('hidden');
    if (document.activeElement) document.activeElement.blur();
    inputLockUntil = performance.now() + INPUT_LOCK_MS;
    cancelAnimationFrame(animId);
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    pauseOnly.forEach(el => el.classList.remove('hidden'));
    overlayTitle.className = '';
    restartBtn.textContent = 'Reiniciar';
    recordsBox.classList.add('hidden');
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function resetState() {
  board = createBoard();
  score = 0;
  lines = 0;
  gameStartLevel = startLevel;
  level = gameStartLevel;
  paused = false;
  gameOver = false;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);
  dropAccum = 0;
  combo = 0;
  bestComboRun = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
}

function init() {
  if (pendingScore !== null) saveName('ANON');
  resetState();
  started = true;
  overlay.classList.add('hidden');
  controlsList.classList.add('hidden');
  if (document.activeElement) document.activeElement.blur();
  recordsBox.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  const tag = e.target && e.target.tagName;
  if (tag === 'SELECT' || tag === 'INPUT') {
    if ((e.code === 'Escape' || e.code === 'KeyP') && paused && !e.repeat) togglePause();
    return;
  }
  if (e.repeat && (e.code === 'KeyP' || e.code === 'Escape')) return;
  if (e.code === 'KeyP' || e.code === 'Escape') { togglePause(); return; }
  if (!started) return;
  if (paused || gameOver || performance.now() < inputLockUntil) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);
resumeBtn.addEventListener('click', () => { if (paused) togglePause(); });
controlsBtn.addEventListener('click', () => controlsList.classList.toggle('hidden'));
startLevelSel.addEventListener('change', () => { startLevel = parseInt(startLevelSel.value, 10) || 1; });
nameForm.addEventListener('submit', e => { e.preventDefault(); saveName(nameInput.value); });
resetRecordsBtn.addEventListener('click', () => {
  if (!confirm('¿Borrar todos los records?')) return;
  try { localStorage.removeItem(RECORDS_KEY); } catch (e) { /* ignorar */ }
  const rec = loadRecords();
  if (pendingScore !== null) renderRecords(rec, 0, '...');
  else renderRecords(rec, -1);
});

resetState();
draw();
showStart();
