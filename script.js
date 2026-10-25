'use strict';
/* ===== DRIVE AHEAD — HTML/CSS/JS puro (online via WebRTC/PeerJS) ===== */
const $ = s => document.querySelector(s);
const W = 960, H = 540, PFX = 'driveahead-';
const COL = ['#3b82f6', '#ef4444', '#22c55e', '#facc15'];
const CN = ['Azul', 'Vermelho', 'Verde', 'Amarelo'];
const KEYS = [['a', 'd'], ['arrowleft', 'arrowright'], ['j', 'l'], [',', '.']];
const WH = [[-24, 16, 12], [24, 16, 12]], HEAD = [0, -15, 9], BODY = [0, 2, 12];
const SAWS = [[0, 110, 62], [W, 110, 62]];
const ground = x => 400 + Math.sin(x * .014) * 20 + Math.sin(x * .04 + 1) * 6 - Math.pow(Math.abs(x - W / 2) / (W / 2), 4) * 170;

const ICE = { config: { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
] } };
let role = 'local', peer = null, conns = [], hostConn = null, names = [], room = '', myIdx = 0, nSel = 2;
let G = { run: false, cars: [], stars: [], gone: [], ph: '', tm: 0, msg: '', n: 2, mt: 0 };
let inputs = [], parts = [], last = 0, acc = 0, looping = false, bt = 0;

/* ---------- Navegação ---------- */
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id)); }
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { cleanup(); show(b.dataset.go); });
$('#bOnline').onclick = () => { $('#onMsg').textContent = ''; show('online'); };
$('#bLocal').onclick = () => show('local');
document.querySelectorAll('#nsel .btn').forEach(b => b.onclick = () => {
  nSel = +b.dataset.n;
  document.querySelectorAll('#nsel .btn').forEach(x => x.classList.toggle('sel', x === b));
});
$('#bPlay').onclick = () => { cleanup(); role = 'local'; myIdx = 0; startGame(nSel); };
$('#bFull').onclick = () => { const d = document, e = d.documentElement; if (d.fullscreenElement) d.exitFullscreen(); else if (e.requestFullscreen) e.requestFullscreen().catch(() => {}); };
$('#bExit').onclick = () => { G.run = false; cleanup(); role = 'local'; show('menu'); };

/* ---------- Online (host autoritativo, clientes enviam inputs) ---------- */
function cleanup() {
  if (peer) { try { peer.destroy(); } catch (e) {} }
  peer = null; conns = []; hostConn = null; names = [];
}
const send = m => conns.forEach(c => c.open && c.send(m));

$('#bCreate').onclick = () => { cleanup(); $('#onMsg').textContent = 'Criando sala...'; mkRoom(); };
function mkRoom() {
  const code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random() * 24 | 0]).join('');
  if (peer) { try { peer.destroy(); } catch (e) {} }
  peer = new Peer(PFX + code, ICE);
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
  peer.on('error', e => {
    if (e.type === 'unavailable-id') mkRoom();
    else $('#onMsg').textContent = 'Erro de conexão: ' + e.type;
  });
  peer.on('open', () => {
    role = 'host'; myIdx = 0; room = code; names = ['Jogador 1'];
    renderLobby(); show('lobby');
  });
  peer.on('connection', c => {
    if (G.run || conns.length >= 3) {
      c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 400); });
      return;
    }
    c.on('open', () => {
      c._idx = names.length; names.push('Jogador ' + (names.length + 1)); conns.push(c);
      c.send({ t: 'hi', idx: c._idx }); lobbyUpdate();
    });
    c.on('data', d => { if (d.t === 'i') inputs[c._idx] = { l: d.l, r: d.r }; });
    c.on('close', () => drop(c));
  });
}
function drop(c) {
  if (c._idx === undefined) return;
  conns = conns.filter(x => x !== c);
  if (G.run) {
    G.gone[c._idx] = true; inputs[c._idx] = {};
    if (G.cars[c._idx]) G.cars[c._idx].alive = false;
  } else {
    names.splice(c._idx, 1);
    conns.forEach((x, i) => { x._idx = i + 1; x.send({ t: 'hi', idx: i + 1 }); });
    lobbyUpdate();
  }
}
function lobbyUpdate() { send({ t: 'lobby', names }); renderLobby(); }

$('#bJoin').onclick = () => {
  const code = $('#code').value.trim().toUpperCase();
  if (code.length < 4) { $('#onMsg').textContent = 'Digite o código de 4 letras.'; return; }
  cleanup(); $('#onMsg').textContent = 'Conectando...';
  peer = new Peer(ICE);
  peer.on('error', e => { $('#onMsg').textContent = e.type === 'peer-unavailable' ? 'Sala não encontrada.' : 'Erro de conexão: ' + e.type; });
  peer.on('open', () => {
    const c = hostConn = peer.connect(PFX + code, { reliable: true });
    room = code;
    c.on('open', () => { role = 'client'; });
    c.on('data', onData);
    c.on('close', () => {
      if (role !== 'client') return;
      G.run = false; cleanup(); role = 'local';
      $('#onMsg').textContent = 'A sala foi encerrada.'; show('online');
    });
  });
};
function onData(d) {
  if (d.t === 'hi') myIdx = d.idx;
  else if (d.t === 'lobby') { G.run = false; names = d.names; renderLobby(); show('lobby'); }
  else if (d.t === 'start') startGame(d.n);
  else if (d.t === 's') applySnap(d);
  else if (d.t === 'full') { $('#onMsg').textContent = 'Sala cheia ou partida em andamento.'; cleanup(); show('online'); }
}
function renderLobby() {
  $('#roomCode').textContent = room;
  $('#plist').innerHTML = names.map((n, i) =>
    `<li><i style="background:${COL[i]}"></i>${n} (${CN[i]})${i === myIdx ? ' — você' : ''}</li>`).join('');
  const host = role === 'host';
  $('#bStart').style.display = host ? '' : 'none';
  $('#bStart').disabled = names.length < 2;
  $('#lobMsg').textContent = host ? (names.length < 2 ? 'Aguardando mais jogadores (mínimo 2)...' : 'Tudo pronto!') : 'Aguardando o host iniciar...';
}
$('#bStart').onclick = () => { if (names.length < 2) return; send({ t: 'start', n: names.length }); startGame(names.length); };
$('#bLeave').onclick = () => { cleanup(); role = 'local'; show('online'); };

/* ---------- Física ---------- */
function circ(c) {
  const co = Math.cos(c.a), si = Math.sin(c.a);
  return [WH[0], WH[1], HEAD, BODY].map((p, i) => ({ x: c.x + p[0] * co - p[1] * si, y: c.y + p[0] * si + p[1] * co, r: p[2], h: i === 2 }));
}
function phys(c, inp) {
  const dir = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
  c.vy += .35;
  const co = Math.cos(c.a), si = Math.sin(c.a); let gr = 0;
  for (const w of WH) {
    const rx = w[0] * co - w[1] * si, ry = w[0] * si + w[1] * co, px = c.x + rx, py = c.y + ry;
    const pen = py + w[2] - ground(px);
    if (pen > 0) {
      gr++;
      const s = (ground(px + 1) - ground(px - 1)) / 2, l = Math.hypot(s, 1), nx = s / l, ny = -1 / l;
      const vx = c.vx - c.w * ry, vy = c.vy + c.w * rx, vn = vx * nx + vy * ny;
      const f = Math.max(0, Math.min(pen, 8) * .14 - vn * .22);
      c.vx += nx * f; c.vy += ny * f; c.w += (rx * ny * f - ry * nx * f) / 700;
      const tx = -ny, ty = nx;
      c.vx += tx * dir * .16; c.vy += ty * dir * .16;
      const vt = c.vx * tx + c.vy * ty; c.vx -= tx * vt * .015; c.vy -= ty * vt * .015;
    }
  }
  c.w += gr ? -dir * .0012 : dir * .0035;
  const sp = Math.hypot(c.vx, c.vy); if (sp > 12) { c.vx *= 12 / sp; c.vy *= 12 / sp; }
  c.w = Math.max(-.15, Math.min(.15, c.w)) * .99;
  c.x += c.vx; c.y += c.vy; c.a += c.w;
  if (c.x < 22) { c.x = 22; c.vx = Math.abs(c.vx) * .4; }
  if (c.x > W - 22) { c.x = W - 22; c.vx = -Math.abs(c.vx) * .4; }
  if (c.y < 20) { c.y = 20; c.vy = Math.abs(c.vy) * .3; }
}
function kill(c) { if (!c.alive) return; c.alive = false; c.vy -= 3; boom(c.x, c.y - 10); }
function collide() {
  const cs = G.cars;
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    const a = cs[i], b = cs[j]; if (!a.alive && !b.alive) continue;
    const ca = circ(a), cb = circ(b);
    for (const p of ca) for (const q of cb) {
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy), m = p.r + q.r;
      if (d >= m || d < .01) continue;
      const nx = dx / d, ny = dy / d, rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny, ov = (m - d) / 2;
      a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
      if (rv < 0) {
        const jv = -rv * .65;
        a.vx -= nx * jv; a.vy -= ny * jv; b.vx += nx * jv; b.vy += ny * jv;
        if (-rv > 2.2) { if (p.h) kill(a); if (q.h) kill(b); }
      }
    }
  }
}
function hazards() {
  for (const c of G.cars) {
    if (!c.alive) continue;
    const k = circ(c), h = k[2];
    if (h.y + h.r > ground(h.x) || SAWS.some(s => k.some(q => Math.hypot(q.x - s[0], q.y - s[1]) < q.r + s[2] - 6))) kill(c);
  }
}

/* ---------- Partida ---------- */
function newRound() {
  G.cars = [];
  for (let i = 0; i < G.n; i++) {
    const x = W * (i + 1) / (G.n + 1);
    G.cars.push({ x, y: ground(x) - 45, a: 0, vx: 0, vy: 0, w: 0, alive: !G.gone[i] });
  }
  G.ph = 'count'; G.tm = 150; parts = [];
}
function startGame(n) {
  G = { run: true, n, cars: [], stars: Array(n).fill(0), gone: [], ph: '', tm: 0, msg: '', mt: 0 };
  inputs = []; newRound(); buildPad(); show('game');
  last = performance.now(); acc = 0;
  if (!looping) { looping = true; requestAnimationFrame(loop); }
}
function tick() {
  const cs = G.cars;
  if (G.ph === 'count') {
    G.tm--; G.msg = String(Math.ceil(G.tm / 50));
    if (G.tm <= 0) { G.ph = 'play'; G.msg = 'VAI!'; G.mt = 50; }
  } else if (G.ph === 'play' && G.mt > 0) { if (--G.mt <= 0) G.msg = ''; }
  const act = G.ph === 'play' || G.ph === 'over';
  cs.forEach((c, i) => phys(c, act && c.alive ? (inputs[i] || {}) : {}));
  if (G.ph === 'play') {
    collide(); hazards();
    const al = cs.filter(c => c.alive);
    if (al.length <= 1) {
      const w = al[0] ? cs.indexOf(al[0]) : -1;
      if (w >= 0) G.stars[w]++;
      G.ph = 'over'; G.tm = 130;
      G.msg = w < 0 ? 'Empate!' : 'Jogador ' + (w + 1) + ' (' + CN[w] + ') pontuou!';
      if (w >= 0 && G.stars[w] >= 3) { G.ph = 'end'; G.tm = 300; G.msg = '🏆 Jogador ' + (w + 1) + ' é o campeão!'; }
    }
  } else if (G.ph === 'over') { if (--G.tm <= 0) newRound(); }
  else if (G.ph === 'end') { if (--G.tm <= 0) endMatch(); }
  if (role === 'host') broadcast();
}
function endMatch() {
  G.run = false;
  if (role === 'local') { show('menu'); return; }
  names = names.filter((_, i) => !G.gone[i]);
  conns.forEach((x, i) => { x._idx = i + 1; x.send({ t: 'hi', idx: i + 1 }); });
  lobbyUpdate(); show('lobby');
}
function broadcast() {
  if (++bt % 2) return;
  send({ t: 's', c: G.cars.map(c => [+c.x.toFixed(1), +c.y.toFixed(1), +c.a.toFixed(3), c.alive ? 1 : 0]), st: G.stars, ph: G.ph, m: G.msg });
}
function applySnap(d) {
  if (!G.run) return;
  d.c.forEach((a, i) => {
    const c = G.cars[i] || (G.cars[i] = {});
    if (c.alive && !a[3]) boom(a[0], a[1] - 10);
    if (c.x === undefined || Math.hypot(c.x - a[0], c.y - a[1]) > 80) { c.x = a[0]; c.y = a[1]; c.a = a[2]; }
    c.tx = a[0]; c.ty = a[1]; c.ta = a[2]; c.alive = !!a[3];
  });
  if (G.ph !== d.ph && d.ph === 'count') parts = [];
  G.stars = d.st; G.ph = d.ph; G.msg = d.m;
}
function loop(t) {
  if (!G.run) { looping = false; return; }
  if (role !== 'client') {
    acc += Math.min(t - last, 100);
    while (acc >= 1000 / 60 && G.run) { tick(); acc -= 1000 / 60; }
  }
  if (role === 'client') G.cars.forEach(c => { if (c && c.tx !== undefined) { c.x += (c.tx - c.x) * .45; c.y += (c.ty - c.y) * .45; c.a += (c.ta - c.a) * .45; } });
  last = t; draw(t);
  requestAnimationFrame(loop);
}

/* ---------- Controles ---------- */
function setIn(i, s, v) {
  const o = inputs[i] || (inputs[i] = {});
  if (!!o[s] === v) return;
  o[s] = v;
  if (role === 'client' && hostConn && hostConn.open) hostConn.send({ t: 'i', l: !!o.l, r: !!o.r });
}
function key(e, v) {
  if (!G.run) return;
  const k = e.key.toLowerCase();
  if (role === 'local') {
    KEYS.slice(0, G.n).forEach((p, i) => {
      if (k === p[0]) { setIn(i, 'l', v); e.preventDefault(); }
      if (k === p[1]) { setIn(i, 'r', v); e.preventDefault(); }
    });
  } else {
    if (k === 'a' || k === 'arrowleft') { setIn(myIdx, 'l', v); e.preventDefault(); }
    if (k === 'd' || k === 'arrowright') { setIn(myIdx, 'r', v); e.preventDefault(); }
  }
}
addEventListener('keydown', e => key(e, true));
addEventListener('keyup', e => key(e, false));
function buildPad() {
  const p = $('#pad'); p.innerHTML = '';
  const list = role === 'local' ? [...Array(G.n).keys()] : [myIdx];
  p.classList.toggle('solo', role !== 'local');
  list.forEach(i => {
    const g = document.createElement('div'); g.className = 'grp';
    ['l', 'r'].forEach(s => {
      const b = document.createElement('button');
      b.textContent = s === 'l' ? '◀' : '▶'; b.style.borderColor = b.style.color = COL[i];
      b.addEventListener('pointerdown', e => { e.preventDefault(); setIn(i, s, true); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, e => { e.preventDefault(); setIn(i, s, false); }));
      b.addEventListener('contextmenu', e => e.preventDefault());
      g.appendChild(b);
    });
    p.appendChild(g);
  });
}

/* ---------- Gráficos ---------- */
const cv = $('#cv'), ctx = cv.getContext('2d');
const bg = document.createElement('canvas'); bg.width = W; bg.height = H;
(function () {
  const g = bg.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#04051a'); gr.addColorStop(.6, '#150a3a'); gr.addColorStop(1, '#2a0f55');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const cc = ['#22d3ee66', '#a855f766', '#f472b666', '#ffffff40'];
  for (let i = 0; i < 1100; i++) { g.fillStyle = cc[i % 4]; g.fillRect((Math.random() * W) | 0, (80 + Math.random() * 300) | 0, 3, 3); }
  g.strokeStyle = '#22d3ee1a'; g.lineWidth = 1;
  for (let x = 0; x <= W; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y <= H; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  [['#22d3ee', 120, 320], ['#f472b6', 340, 440], ['#f472b6', 520, 620], ['#22d3ee', 640, 840]].forEach(s => {
    g.shadowColor = s[0]; g.shadowBlur = 18; g.fillStyle = s[0]; g.fillRect(s[1], 70, s[2] - s[1], 5);
  });
  g.fillStyle = '#050816'; g.fillRect(400, 10, 160, 96);
  g.shadowColor = '#22d3ee'; g.shadowBlur = 16; g.strokeStyle = '#22d3ee'; g.lineWidth = 3; g.strokeRect(400, 10, 160, 96);
  g.shadowBlur = 0; g.fillStyle = '#22d3ee'; g.font = 'bold 15px monospace'; g.textAlign = 'center'; g.fillText('DRIVE AHEAD', 480, 54);
  g.fillStyle = '#f472b6'; g.fillText('// ARENA 01', 480, 80);
  g.beginPath(); g.moveTo(0, 490);
  for (let x = 0; x <= W; x += 4) g.lineTo(x, ground(x));
  g.lineTo(W, 490); g.closePath();
  const gg = g.createLinearGradient(0, 230, 0, 490); gg.addColorStop(0, '#12224a'); gg.addColorStop(1, '#050816');
  g.fillStyle = gg; g.fill();
  g.save(); g.clip(); g.strokeStyle = '#22d3ee33'; g.lineWidth = 1;
  for (let x = 0; x <= W; x += 30) { g.beginPath(); g.moveTo(x, 200); g.lineTo(x, 490); g.stroke(); }
  for (let y = 200; y <= 490; y += 30) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.restore();
  g.beginPath(); for (let x = 0; x <= W; x += 4) g[x ? 'lineTo' : 'moveTo'](x, ground(x));
  g.shadowColor = '#22d3ee'; g.shadowBlur = 16; g.strokeStyle = '#67e8f9'; g.lineWidth = 4; g.stroke(); g.shadowBlur = 0;
  g.fillStyle = '#0b1226'; g.fillRect(0, 490, W, 50);
  g.strokeStyle = '#8b5cf655'; g.lineWidth = 3;
  for (let x = -40; x < W; x += 50) { g.beginPath(); g.moveTo(x, 540); g.lineTo(x + 50, 490); g.stroke(); }
  g.fillStyle = '#22d3ee'; g.fillRect(0, 489, W, 2);
  g.fillStyle = '#00000026'; for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
})();

function boom(x, y) {
  for (let i = 0; i < 34; i++) {
    const a = Math.random() * 6.283, s = 1 + Math.random() * 6;
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, l: 25 + Math.random() * 25, c: ['#ffffff', '#22d3ee', '#f472b6', '#facc15'][i % 4] });
  }
}
function saw(s, t) {
  ctx.save(); ctx.translate(s[0], s[1]); ctx.rotate(t / 260 * (s[0] ? -1 : 1));
  ctx.beginPath();
  for (let k = 0; k < 28; k++) { const r = k % 2 ? s[2] : s[2] - 12, a = k / 28 * 6.283; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  ctx.closePath(); ctx.fillStyle = '#0b1226'; ctx.fill();
  ctx.shadowColor = '#f472b6'; ctx.shadowBlur = 14; ctx.strokeStyle = '#f472b6'; ctx.lineWidth = 3; ctx.stroke();
  ctx.shadowBlur = 0; ctx.strokeStyle = '#f472b655'; ctx.beginPath(); ctx.arc(0, 0, s[2] - 24, 0, 7); ctx.stroke();
  ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.arc(0, 0, 12, 0, 7); ctx.fill();
  ctx.restore();
}
function drawCar(c, i) {
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
  const col = c.alive ? COL[i] : '#4b5563';
  ctx.shadowColor = col; ctx.shadowBlur = c.alive ? 12 : 0;
  ctx.fillStyle = col; ctx.fillRect(-32, -4, 64, 20); ctx.fillRect(-16, -18, 30, 16);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#0007'; ctx.fillRect(-32, 10, 64, 6);
  ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 2; ctx.strokeRect(-32, -4, 64, 20);
  ctx.fillStyle = c.alive ? '#a5f3fc' : '#9ca3af'; ctx.fillRect(-12, -15, 22, 9);
  ctx.fillStyle = c.alive ? '#ffd2a8' : '#b8b8a0'; ctx.beginPath(); ctx.arc(0, -15, 8, 0, 7); ctx.fill();
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, -15, 8, 3.14, 6.283); ctx.fill();
  for (const w of WH) {
    ctx.save(); ctx.translate(w[0], w[1]); ctx.rotate(c.x / 12);
    ctx.fillStyle = '#05060f'; ctx.beginPath(); ctx.arc(0, 0, w[2], 0, 7); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.fill();
    ctx.strokeStyle = '#9ca3af'; ctx.beginPath(); ctx.moveTo(-w[2] + 3, 0); ctx.lineTo(w[2] - 3, 0); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
  ctx.fillStyle = c.alive ? '#fff' : '#9ca3af'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
  ctx.fillText('J' + (i + 1), c.x, c.y - 38);
}
function draw(t) {
  ctx.drawImage(bg, 0, 0);
  SAWS.forEach(s => saw(s, t));
  G.cars.forEach((c, i) => c && c.x !== undefined && drawCar(c, i));
  parts = parts.filter(p => p.l > 0);
  for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += .15; p.l--; ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, 6, 6); }
  for (let i = 0; i < G.n; i++) {
    const left = i % 2 === 0, bw = 150, x = left ? 12 : W - bw - 12, y = 12 + (i >> 1) * 50;
    ctx.fillStyle = '#050816cc'; ctx.fillRect(x, y, bw, 42);
    ctx.strokeStyle = COL[i]; ctx.lineWidth = 2; ctx.strokeRect(x, y, bw, 42);
    ctx.fillStyle = COL[i]; ctx.font = 'bold 15px monospace'; ctx.textAlign = 'left'; ctx.fillText('J' + (i + 1) + (G.gone[i] ? ' ✕' : ''), x + 8, y + 26);
    ctx.font = '24px sans-serif';
    for (let k = 0; k < 3; k++) { ctx.fillStyle = k < (G.stars[i] || 0) ? COL[i] : '#334155'; ctx.fillText('★', x + 48 + k * 30, y + 31); }
  }
  if (G.msg) {
    ctx.textAlign = 'center'; ctx.font = 'bold 52px "Orbitron",monospace';
    ctx.shadowColor = '#22d3ee'; ctx.shadowBlur = 22; ctx.fillStyle = '#fff';
    ctx.fillText(G.msg, W / 2, 250); ctx.shadowBlur = 0;
  }
}
