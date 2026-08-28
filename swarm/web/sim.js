/**
 * Canvas renderer + page wiring for the DarkSpot swarm-layer simulation.
 * All algorithmic work lives in ../src (DOM-free, tested); this file only draws.
 * Colours mirror @darkspot/ui tokens.ts `sim` (DESIGN c9fd80d).
 */
import { buildScenario, SimEngine } from '../src/engine.js';

const C = {
  bg: '#171A1F', grid: 'rgba(255,255,255,0.04)',
  bridge: '#62B4C0', relay: '#E6B24C', unit: '#63B77F', settlement: '#85817A',
  link: 'rgba(139,145,155,0.35)', linkStrong: 'rgba(139,145,155,0.8)',
  route: '#62B4C0', routeBase: '#8B919B', packet: '#FFFFFF', ferry: '#E477BF', label: '#F7F6F2',
  silence: ['#F3F1EC', '#DBD8E3', '#B9B2CF', '#918AB4', '#665D91', '#3E3568', '#1C1740'], silenceRing: '#8F959E',
  particle: 'rgba(230,178,76,0.25)', range: 'rgba(230,178,76,0.08)', flash: '#BFE3C9',
};
const silenceStep = (h) => { let s = 0; for (const e of [1, 3, 6, 12, 24, 48]) if (h >= e) s++; return Math.min(s, 6); };

const $ = (id) => document.getElementById(id);
const canvas = $('sim'); const ctx = canvas.getContext('2d');
const dpr = Math.min(2, window.devicePixelRatio || 1);
const W = 900, H = 560;
canvas.width = W * dpr; canvas.height = H * dpr; ctx.scale(dpr, dpr);

let engine, snap, running = false, tps = 2, lastTick = 0, flashUntil = new Map();
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function reset() {
  engine = new SimEngine(buildScenario({ seed: 7, width: W, height: H }));
  snap = engine.snapshot(); lastTick = performance.now(); flashUntil = new Map();
  running = false; $('btn-run').textContent = 'Run'; $('btn-run').setAttribute('aria-pressed', 'false');
  updatePanels();
}
function step() {
  snap = engine.step(); lastTick = performance.now();
  for (const c of snap.changes ?? []) flashUntil.set(c.unitId, performance.now() + 1200);
  updatePanels();
}

// ---------------------------------------------------------------- drawing
function node(n) { return engine.net ? engine.net.node(n) : null; }
function tri(x, y, r) { ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.9, y + r * 0.7); ctx.lineTo(x - r * 0.9, y + r * 0.7); ctx.closePath(); }
function label(text, x, y, color = C.label, align = 'left') {
  ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace'; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(15,17,20,0.75)'; const w = ctx.measureText(text).width;
  const lx = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  ctx.fillRect(lx - 3, y - 7, w + 6, 14); ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function polyline(points, { color, width = 1.5, dash = [], alpha = 1 }) {
  if (points.length < 2) return;
  ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y); for (const p of points.slice(1)) ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.restore();
}
function pointAlong(points, t) {
  let total = 0; const segs = [];
  for (let i = 1; i < points.length; i++) { const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y); segs.push(d); total += d; }
  let target = t * total;
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i] || i === segs.length - 1) { const u = segs[i] ? Math.min(1, target / segs[i]) : 1; return { x: points[i].x + (points[i + 1].x - points[i].x) * u, y: points[i].y + (points[i + 1].y - points[i].y) * u }; }
    target -= segs[i];
  }
  return points[points.length - 1];
}

function draw(now) {
  const sc = engine.sc;
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  const tickFrac = Math.min(1, (now - lastTick) / (1000 / tps));

  if (snap.phase === 'placing') {
    // particle cloud (all particles' relay positions) + current gbest relays with their radio discs
    const f = snap.psoFrame;
    if (f) {
      ctx.fillStyle = C.particle;
      for (const ps of f.particles) for (const p of ps) { ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill(); }
      for (const r of f.gbest) { ctx.fillStyle = C.range; ctx.beginPath(); ctx.arc(r.x, r.y, sc.range, 0, Math.PI * 2); ctx.fill(); }
      // links among gbest relays + bridge
      const rs = [sc.bridge, ...f.gbest];
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (Math.hypot(rs[i].x - rs[j].x, rs[i].y - rs[j].y) <= sc.range) polyline([rs[i], rs[j]], { color: C.linkStrong, width: 1.5 });
      for (const r of f.gbest) { ctx.fillStyle = C.relay; tri(r.x, r.y, 8); ctx.fill(); }
      label(`PSO iteration ${f.iter + 1}/${engine.psoFrames.length} · gbest fitness ${f.gbestFit.toFixed(3)} (0.7·SGC + 0.3·NCMC)`, 12, H - 16, C.label);
    }
  } else {
    const net = engine.net;
    // mesh links
    for (const n of net.nodes) for (const m of net.neighbors(n.id)) if (n.id < m) polyline([n, net.node(m)], { color: C.link, width: 1 });
    // AODV baseline paths (dashed grey) and AntHocNet paths (beacon) from this tick's packets
    const seen = new Set();
    for (const p of snap.packets) {
      const key = p.proto + p.path.join('>'); if (seen.has(key)) continue; seen.add(key);
      const pts = p.path.map((id) => net.node(id));
      if (p.proto === 'aodv') polyline(pts, { color: C.routeBase, width: 1.5, dash: [4, 5], alpha: 0.8 });
      else polyline(pts, { color: C.route, width: 2.5, alpha: p.delivered ? 0.9 : 0.35 });
    }
    // packets animating along AntHocNet paths
    for (const p of snap.packets) {
      if (p.proto !== 'ant' || p.path.length < 2) continue;
      const q = pointAlong(p.path.map((id) => net.node(id)), tickFrac);
      ctx.fillStyle = C.packet; ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    // ferry route — SIMULATION, dashed magenta, labelled on the canvas itself
    if (snap.ferry) {
      const pts = [sc.bridge, ...snap.ferry.waypoints.map((w) => ({ x: w.sim_xy[0], y: w.sim_xy[1] }))];
      polyline(pts, { color: C.ferry, width: 2, dash: [8, 6] });
      const last = pts[pts.length - 1], prev = pts[pts.length - 2]; label('UAV ferry route — SIMULATION', (last.x + prev.x) / 2, (last.y + prev.y) / 2 + 14, C.ferry, 'center');
    }
    // suggested pairings
    if (snap.alloc) for (const p of snap.alloc.suggested_pairings) {
      const u = snap.units.find((x) => x.id === p.unitId), t = sc.settlements.find((s) => s.id === p.taskId);
      if (!u || !t) continue;
      const flashing = (flashUntil.get(p.unitId) ?? 0) > now;
      polyline([u, t], { color: flashing ? C.flash : C.unit, width: flashing ? 3 : 1.5, dash: p.mode === 'auction' ? [2, 4] : [] });
      if (flashing) { ctx.strokeStyle = C.flash; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(t.x, t.y, 16 + 6 * Math.sin(now / 120), 0, Math.PI * 2); ctx.stroke(); }
    }
    // relays
    for (const r of engine.relays) {
      const n = net.node(r.id); const dead = net.neighbors(r.id).size === 0;
      ctx.fillStyle = dead ? '#5a4a2a' : C.relay; tri(n.x, n.y, 9); ctx.fill();
      if (n.queue > 0) { ctx.strokeStyle = '#EF8A66'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(n.x, n.y, 14, 0, Math.PI * 2); ctx.stroke(); label(`Q=${n.queue}`, n.x + 16, n.y - 10, '#EF8A66'); }
      if (dead) label('link loss', n.x + 12, n.y + 10, '#EF8A66');
      label(r.id, n.x + 12, n.y, C.relay);
    }
    // units
    for (const u of snap.units) { ctx.fillStyle = C.unit; ctx.beginPath(); ctx.arc(u.x, u.y, 7, 0, Math.PI * 2); ctx.fill(); label(u.id, u.x + 10, u.y, C.unit); }
  }
  // settlements (always)
  for (const s of sc.settlements) {
    const st = silenceStep(s.silenceHours);
    ctx.fillStyle = C.silence[st]; ctx.strokeStyle = st >= 4 ? C.silenceRing : C.settlement; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, 6 + Math.min(6, s.priority), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (s.hazard === 'high') { ctx.strokeStyle = '#EF8A66'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(s.x, s.y, 10 + Math.min(6, s.priority), 0, Math.PI * 2); ctx.stroke(); }
    label(`${s.id} ${s.silenceHours}h`, s.x + 14, s.y, '#B9B2CF');
  }
  // bridge
  ctx.fillStyle = C.bridge; ctx.fillRect(sc.bridge.x - 9, sc.bridge.y - 9, 18, 18); label('bridge', sc.bridge.x + 14, sc.bridge.y, C.bridge);
  // canvas-level simulation stamp (never removable)
  label('SIMULATION · synthetic seeded scenario · no aircraft, no instructions', W - 12, 16, C.ferry, 'right');
}

// ---------------------------------------------------------------- panels
function updatePanels() {
  $('tick').textContent = `tick ${snap.tick}`;
  $('phase').textContent = snap.phase === 'placing' ? 'phase: placing relays (PSO)' : 'phase: mesh formed · routing + allocation live';
  const st = $('stats'); st.innerHTML = '';
  const add = (k, v) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; st.append(dt, dd); };
  add('relay fitness', `${snap.psoFitness.toFixed(3)} · SGC ${snap.psoEval.sgc}/${engine.sc.relayCount} · covered ${snap.psoEval.ncmc}/${engine.sc.settlements.length}`);
  if (snap.metrics) {
    add('AntHocNet', `delivery ${(snap.metrics.ant.delivery * 100).toFixed(0)}% · delay ${snap.metrics.ant.meanDelayMs?.toFixed(1) ?? '—'} ms`);
    add('AODV baseline', `delivery ${(snap.metrics.aodv.delivery * 100).toFixed(0)}% · delay ${snap.metrics.aodv.meanDelayMs?.toFixed(1) ?? '—'} ms`);
    add('ant packets', `fwd ${engine.ant.stats.forwardAnts} · proactive ${engine.ant.stats.proactiveAnts} · repair ${engine.ant.stats.repairAnts}`);
  }
  if (snap.ferry) add('ferry (sim)', `${snap.ferry.waypoints.length} cut-off settlement(s) · route_id ${snap.ferry.route_id}`);
  const h = $('alloc-h'), a = $('alloc-a'); h.innerHTML = ''; a.innerHTML = '';
  if (snap.alloc) {
    for (const m of snap.alloc.modes) {
      const li = document.createElement('li');
      li.textContent = `#${m.component}: ${m.units} units · ${m.tasks} tasks${m.idle ? ' · idle' : m.cost != null ? ` · cost ${m.cost.toFixed(1)}` : ''}${m.rounds != null ? ` · ${m.rounds} rounds` : ''}`;
      (m.mode === 'hungarian' ? h : a).append(li);
    }
    for (const p of snap.alloc.suggested_pairings) { const li = document.createElement('li'); li.className = 'pair'; li.textContent = `  ${p.unitId} ↔ ${p.taskId} (cost ${p.cost.toFixed(1)})`; (p.mode === 'hungarian' ? h : a).append(li); }
    if (!h.children.length) h.innerHTML = '<li>—</li>'; if (!a.children.length) a.innerHTML = '<li>—</li>';
  }
  const log = $('log'); log.innerHTML = '';
  for (const e of snap.events.slice(0, 12)) { const li = document.createElement('li'); li.innerHTML = `<span class="t">t${e.tick}</span>`; li.append(e.msg); log.append(li); }
  $('canvas-desc').textContent = snap.phase === 'placing'
    ? `Placing ${engine.sc.relayCount} simulated relays by particle swarm optimisation, tick ${snap.tick}.`
    : `Mesh formed. ${snap.alloc?.suggested_pairings.length ?? 0} suggested unit–task pairings; ${snap.alloc?.unitsWithoutCommand.length ?? 0} unit(s) without a path to command. Simulation only.`;
}

// ---------------------------------------------------------------- wiring
$('btn-run').onclick = () => { running = !running; $('btn-run').textContent = running ? 'Pause' : 'Run'; $('btn-run').setAttribute('aria-pressed', String(running)); lastTick = performance.now(); };
$('btn-step').onclick = () => step();
$('btn-reset').onclick = () => reset();
$('speed').onchange = (e) => { tps = Number(e.target.value); };
// Pick the live relay carrying the most AntHocNet traffic this tick, so the reaction is visible.
// For a cut, skip relays whose loss would strand the bridge entirely (keeps the demo readable).
function pickRelay(forCut = false) {
  const net = engine.net; if (!net) return null;
  const use = new Map();
  for (const p of snap.packets ?? []) if (p.proto === 'ant') for (const id of p.path) if (id.startsWith('R')) use.set(id, (use.get(id) ?? 0) + 1);
  const live = engine.relays.filter((r) => net.neighbors(r.id).size > 0).sort((a, b) => (use.get(b.id) ?? 0) - (use.get(a.id) ?? 0));
  if (!forCut) return live[0]?.id ?? null;
  for (const r of live) {
    const ids = net.nodes.map((n) => n.id);
    const keep = new Set([...net.neighbors('bridge')].filter((n) => n !== r.id));
    // BFS from the bridge without r
    const seen = new Set(['bridge']); const q = [...keep]; keep.forEach((k) => seen.add(k));
    while (q.length) { const u = q.shift(); for (const v of net.neighbors(u)) if (v !== r.id && !seen.has(v)) { seen.add(v); q.push(v); } }
    if (seen.size > 1 + ids.length / 3) return r.id;
  }
  return live[0]?.id ?? null;
}
$('ev-congest').onclick = () => { const r = pickRelay(); if (r) engine.congest(r, 10); updatePanels(); };
$('ev-cut').onclick = () => { const r = pickRelay(true); if (r) engine.cutRelay(r); updatePanels(); };
$('ev-bump').onclick = () => {
  const assigned = new Set(engine.alloc?.suggested_pairings.map((p) => p.taskId));
  const comp = engine._components(engine.net), bc = comp.get('bridge');
  const s = engine.sc.settlements.filter((x) => !assigned.has(x.id) && comp.get(x.id) === bc).sort((a, b) => a.priority - b.priority)[0] ?? engine.sc.settlements[0];
  const top = Math.max(...engine.sc.settlements.map((x) => x.priority));
  engine.bumpPriority(s.id, (top * 2) / s.priority); updatePanels();
};
$('ev-restore').onclick = () => { engine.restore(); updatePanels(); };
if (reduced) { $('btn-step').focus(); }

reset();
// Reproducible headless verification: ?steps=N&perturb=cut|congest|bump (&steps2=M after the perturbation)
{
  const q = new URLSearchParams(location.search);
  const n = Number(q.get('steps') ?? 0); for (let i = 0; i < n; i++) step();
  const ev = q.get('perturb'); if (ev === 'cut') $('ev-cut').click(); else if (ev === 'congest') $('ev-congest').click(); else if (ev === 'bump') $('ev-bump').click();
  const n2 = Number(q.get('steps2') ?? 0); for (let i = 0; i < n2; i++) step();
  window.__sim = { get snap() { return snap; }, engine: () => engine };
}
let acc = 0, prev = performance.now();
function frame(now) {
  if (running) { acc += now - prev; const per = 1000 / tps; while (acc >= per) { step(); acc -= per; } }
  prev = now;
  draw(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
