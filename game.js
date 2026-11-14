'use strict';
/* =====================================================================
   JTA — Two Lives. One City.
   Top-down 2D open-city game. Vanilla JS + canvas. No dependencies.
   ===================================================================== */

/* ================= CHARACTERS — rename here (one line each) ==========
   Provisional working names: NOVA and DOC. To rename a character, edit
   only the `name` / `fullName` fields below — every screen, the HUD and
   the pause menu read from this config. Do not edit names anywhere else.
   ===================================================================== */
const CHARACTERS = {
  nova: {
    name: 'NOVA', fullName: 'Nova',
    tagline: 'Half-cyborg. All trouble.',
    face: 'assets/nova-face.jpg', full: 'assets/nova-full.jpg',
    color: '#e5484d', accent: '#22d3ee',      // in-world sprite: red body, cyan trim
    sprint: 252, handling: 1.0,                // slightly faster sprint
    desc: 'Faster sprint'
  },
  doc: {
    name: 'DOC', fullName: 'Doc',
    tagline: 'Seen it all. Drives like it.',
    face: 'assets/doc-face.jpg', full: 'assets/doc-full.jpg',
    color: '#2b2f36', accent: '#f5c518',       // in-world sprite: dark grey/black, gold trim
    sprint: 228, handling: 1.28,               // slightly better car handling
    desc: 'Better car handling'
  }
};
const CHAR_KEYS = ['nova', 'doc'];

/* ================= CONFIG ================= */
const WORLD = { w: 3200, h: 2400 };
const ROAD_W = 170, ROAD_HALF = ROAD_W / 2;
const V_ROADS = [350, 950, 1550, 2150, 2750];   // vertical road centre x
const H_ROADS = [300, 850, 1400, 1950];         // horizontal road centre y
const WATER_Y = 2330;                            // waterfront: water below this y
const SAVE_KEY = 'jta-save-v1';
const WALK_SPEED = 150, CAR_MAX = 520, CAR_ACCEL = 430, CAR_REVERSE_MAX = 190;
const MISSION_RADIUS = 95;
const START_POS = { nova: { x: 1480, y: 1330 }, doc: { x: 1620, y: 1470 } };

/* ================= utils ================= */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261114); // seeded: same city every load
const rand = (a, b) => a + rng() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const fmtCash = n => '$' + Math.round(n).toLocaleString('en-US');
function $(id) { return document.getElementById(id); }

/* ================= save / load ================= */
let save = { cash: 0, missionIndex: 0, completed: 0, touch: 'auto', chars: null };
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) { const s = JSON.parse(raw); if (s && typeof s === 'object') save = Object.assign(save, s); }
  } catch (e) { /* private mode etc — play without saving */ }
}
function writeSave() {
  try {
    save.chars = {};
    for (const k of CHAR_KEYS) save.chars[k] = { x: chars[k].x, y: chars[k].y, angle: chars[k].angle };
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch (e) { /* ignore */ }
}

/* ================= world generation ================= */
const BUILDING_COLORS = ['#8a7f74', '#7a8ba0', '#a08a7a', '#6f7d6f', '#9a8fa0', '#b09a6a', '#7d7468', '#8694a6'];
const buildings = [];   // {x,y,w,h,color,units:[{x,y,w,h}]}
const blocks = [];      // {x,y,w,h,park}
const PARK = { col: 2, row: 2 }; // park block (0-based) in the grid

function buildWorld() {
  // Block columns = gaps between vertical roads; rows = gaps between horizontal roads.
  const xs = [0, ...V_ROADS.map(c => c - ROAD_HALF), ...V_ROADS.map(c => c + ROAD_HALF), WORLD.w].sort((a, b) => a - b);
  const ys = [0, ...H_ROADS.map(c => c - ROAD_HALF), ...H_ROADS.map(c => c + ROAD_HALF), WATER_Y].sort((a, b) => a - b);
  const cols = [], rows = [];
  for (let i = 0; i + 1 < xs.length; i += 2) cols.push([xs[i], xs[i + 1]]);
  for (let i = 0; i + 1 < ys.length; i += 2) rows.push([ys[i], ys[i + 1]]);
  rows[rows.length - 1][1] = 2300; // bottom row ends at the promenade

  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < cols.length; c++) {
      const [x0, x1] = cols[c], [y0, y1] = rows[r];
      const park = (c === PARK.col && r === PARK.row);
      blocks.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, park });
      if (park) continue;
      // Split the block into 1-2 columns x 1-2 rows of buildings.
      const nCols = (x1 - x0) > 350 ? 2 : 1, nRows = (y1 - y0) > 350 ? 2 : 1;
      const cw = (x1 - x0) / nCols, ch = (y1 - y0) / nRows;
      for (let br = 0; br < nRows; br++) {
        for (let bc = 0; bc < nCols; bc++) {
          if (rng() < 0.12) continue; // empty lot / parking
          const mx = rand(14, 26), my = rand(14, 26);
          const bx = x0 + bc * cw + mx, by = y0 + br * ch + my;
          const bw = cw - mx * 2, bh = ch - my * 2;
          if (bw < 40 || bh < 40) continue;
          const units = [];
          const nu = randi(1, 3);
          for (let u = 0; u < nu; u++) units.push({ x: bx + rand(8, Math.max(9, bw - 26)), y: by + rand(8, Math.max(9, bh - 26)), w: rand(10, 18), h: rand(10, 18) });
          buildings.push({ x: bx, y: by, w: bw, h: bh, color: BUILDING_COLORS[randi(0, BUILDING_COLORS.length - 1)], units });
        }
      }
    }
  }
}
buildWorld();

/* Collision: circle vs building rects. Returns push-out {x,y} or null. */
function collideBuildings(cx, cy, r) {
  for (const b of buildings) {
    const nx = clamp(cx, b.x, b.x + b.w), ny = clamp(cy, b.y, b.y + b.h);
    const dx = cx - nx, dy = cy - ny, d2 = dx * dx + dy * dy;
    if (d2 < r * r) {
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        return { x: (dx / d) * (r - d), y: (dy / d) * (r - d) };
      }
      // Centre inside the rect: push out along the shallowest axis.
      const l = cx - b.x, rr = b.x + b.w - cx, t = cy - b.y, bb = b.y + b.h - cy;
      const m = Math.min(l, rr, t, bb);
      if (m === l) return { x: -(l + r), y: 0 };
      if (m === rr) return { x: rr + r, y: 0 };
      if (m === t) return { x: 0, y: -(t + r) };
      return { x: 0, y: bb + r };
    }
  }
  return null;
}
function pointInBuilding(x, y) {
  for (const b of buildings) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
  return false;
}
function blockedAt(x, y) { // water + world edge
  return x < 8 || x > WORLD.w - 8 || y < 8 || y > WATER_Y - 6;
}

/* ================= mission data ================= */
const MISSION_POINTS = {
  park:    { x: 1250, y: 1125, label: 'the Park' },
  docks:   { x: 300,  y: 2265, label: 'the Docks' },
  garage:  { x: 2750, y: 200,  label: 'the North Garage' },
  plaza:   { x: 1550, y: 1400, label: 'the Plaza' },
  hideout: { x: 650,  y: 1950, label: 'the Hideout' },
  casino:  { x: 2400, y: 850,  label: 'the Casino Lot' }
};
const SCRIPTED_MISSIONS = [
  { text: 'Head to the Park', point: 'park', pay: 150 },
  { text: 'Pick up the package at the Docks', point: 'docks', pay: 200 },
  { text: 'Deliver the package to the North Garage', point: 'garage', pay: 250 },
  { text: 'Meet up at the Plaza', point: 'plaza', pay: 200 },
  { text: 'Lay low — reach the Hideout', point: 'hideout', pay: 300 },
  { text: 'Final drop at the Casino Lot', point: 'casino', pay: 400 }
];
function randomJob() {
  const vx = V_ROADS[randi(0, V_ROADS.length - 1)], hy = H_ROADS[randi(0, H_ROADS.length - 1)];
  return { text: 'Delivery job: take the goods to the marked corner', point: null, x: vx, y: hy, pay: randi(100, 350) };
}
function currentMission() {
  if (save.missionIndex < SCRIPTED_MISSIONS.length) {
    const m = SCRIPTED_MISSIONS[save.missionIndex];
    const p = MISSION_POINTS[m.point];
    return { text: m.text, x: p.x, y: p.y, pay: m.pay, scripted: true };
  }
  return randomJobState;
}
let randomJobState = randomJob();

/* ================= entities ================= */
const CAR_COLORS = ['#c0392b', '#2980b9', '#f1c40f', '#7f8c8d', '#8e44ad', '#16a085', '#e67e22', '#ecf0f1', '#34495e', '#d35400'];
const PED_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#95a5a6'];

const chars = {};
const cars = [];   // {x,y,angle,speed,color,type,driver,road,roadIdx,dir,junctionKey,aiSpeed}
const peds = [];   // {x,y,angle,speed,heading,retarget,state,timer,color}
const G = {
  started: false, paused: false, mapOpen: false, busted: false, switching: false,
  active: 'nova', stars: 0, cleanTimer: 0, bustedTimer: 0,
  clock: 9 * 60, elapsed: 0, hornTimer: 0, hitCooldown: 0, crashCooldown: 0,
  cam: { x: 1600, y: 1200 }, shake: 0
};
function activeChar() { return chars[G.active]; }

function makeChar(key) {
  const s = save.chars && save.chars[key];
  const p = s || START_POS[key];
  return { key, x: p.x, y: p.y, angle: (s && s.angle) || -Math.PI / 2, speed: 0, inCar: null, walkPhase: 0 };
}
function makeCar(x, y, angle, color, type) {
  const car = { x, y, angle, speed: 0, color, type, driver: null, road: null, roadIdx: -1, dir: 1, junctionKey: '', aiSpeed: rand(170, 250) };
  cars.push(car);
  return car;
}
function resetEntities() {
  cars.length = 0; peds.length = 0;
  // Parked cars along road shoulders (enterable).
  const parked = [
    [1010, 600, Math.PI / 2], [1490, 1000, -Math.PI / 2], [2210, 1700, Math.PI / 2],
    [600, 1340, 0], [1800, 1460, Math.PI], [290, 1100, Math.PI / 2], [2690, 400, -Math.PI / 2],
    [1200, 790, 0], [2400, 2010, Math.PI], [400, 360, 0]
  ];
  parked.forEach((p, i) => makeCar(p[0], p[1], p[2], CAR_COLORS[i % CAR_COLORS.length], 'parked'));
  // Traffic cars on roads.
  for (let i = 0; i < 10; i++) {
    const vertical = rng() < 0.5;
    const idx = randi(0, vertical ? V_ROADS.length - 1 : H_ROADS.length - 1);
    const dir = rng() < 0.5 ? 1 : -1;
    const car = makeCar(0, 0, 0, CAR_COLORS[randi(0, CAR_COLORS.length - 1)], 'traffic');
    car.driver = 'ai'; car.road = vertical ? 'v' : 'h'; car.roadIdx = idx; car.dir = dir;
    if (vertical) { car.x = V_ROADS[idx] - dir * 40; car.y = rand(100, WATER_Y - 200); car.angle = dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
    else { car.y = H_ROADS[idx] + dir * 40; car.x = rand(100, WORLD.w - 100); car.angle = dir > 0 ? 0 : Math.PI; }
    car.speed = car.aiSpeed;
  }
  // Pedestrians wandering the sidewalks.
  for (let i = 0; i < 12; i++) {
    const b = blocks[randi(0, blocks.length - 1)];
    let x = rand(b.x + 6, b.x + b.w - 6), y = rand(b.y + 6, b.y + b.h - 6);
    let guard = 0;
    while (pointInBuilding(x, y) && guard++ < 20) { x = rand(b.x + 6, b.x + b.w - 6); y = rand(b.y + 6, b.y + b.h - 6); }
    peds.push({ x, y, angle: rand(0, Math.PI * 2), speed: rand(38, 62), heading: rand(0, Math.PI * 2), retarget: rand(1, 3), state: 'walk', timer: 0, color: PED_COLORS[i % PED_COLORS.length] });
  }
}

/* ================= input ================= */
const keys = new Set();
const joy = { active: false, id: null, dx: 0, dy: 0 };
const hold = { sprint: false, gas: false, brake: false };

function isTouchDevice() {
  return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
}
function touchControlsOn() {
  if (save.touch === 'on') return true;
  if (save.touch === 'off') return false;
  return isTouchDevice();
}
function applyTouchVisibility() {
  const on = touchControlsOn();
  $('touch-controls').classList.toggle('hidden', !on || !G.started);
  $('keys-hint').classList.toggle('hidden', on || !G.started);
}

function bindHoldButton(id, prop) {
  const el = $(id);
  const on = e => { e.preventDefault(); hold[prop] = true; el.classList.add('held'); };
  const off = e => { e.preventDefault(); hold[prop] = false; el.classList.remove('held'); };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
}
function bindTapButton(id, fn) {
  const el = $(id);
  el.addEventListener('pointerdown', e => { e.preventDefault(); fn(); });
}

/* Virtual joystick: pointer events cover touch AND mouse drag. */
function initJoystick() {
  const base = $('joystick'), knob = $('joy-knob');
  const R = 44;
  function setKnob(dx, dy) { knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; }
  base.addEventListener('pointerdown', e => {
    e.preventDefault();
    joy.active = true; joy.id = e.pointerId;
    try { base.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
  });
  base.addEventListener('pointermove', e => {
    if (!joy.active || e.pointerId !== joy.id) return;
    e.preventDefault();
    const r = base.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    joy.dx = dx / R; joy.dy = dy / R;
    setKnob(dx, dy);
  });
  function endJoy(e) {
    if (e.pointerId !== joy.id) return;
    joy.active = false; joy.id = null; joy.dx = 0; joy.dy = 0;
    setKnob(0, 0);
  }
  base.addEventListener('pointerup', endJoy);
  base.addEventListener('pointercancel', endJoy);
}

/* Keyboard */
window.addEventListener('keydown', e => {
  if (e.code === 'Tab') { e.preventDefault(); switchCharacter(); return; }
  if (e.code === 'KeyM') { toggleMap(); return; }
  if (e.code === 'Escape' || e.code === 'KeyP') { togglePause(); return; }
  if (e.code === 'KeyE') { doAction(); return; }
  if (e.code === 'KeyH') { doHorn(); return; }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); hold.sprint = hold.gas = hold.brake = false; });

/* Stop page scroll / pull-to-refresh over the game area (mobile Safari). */
$('game-area').addEventListener('touchmove', e => e.preventDefault(), { passive: false });
$('game-area').addEventListener('contextmenu', e => e.preventDefault());

/* ================= UI wiring ================= */
let toastTimer = null;
function toast(msg, ms) {
  const t = $('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 2800);
}

function startGame(key) {
  G.active = key;
  G.started = true;
  $('start-screen').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('minimap').classList.remove('hidden');
  applyTouchVisibility();
  const c = activeChar();
  G.cam.x = c.x; G.cam.y = c.y;
  updateHUD();
  const m = currentMission();
  toast(CHARACTERS[key].name + ' — ' + m.text + '  •  $' + m.pay);
}

function switchCharacter() {
  if (!G.started || G.paused || G.busted || G.switching || G.mapOpen) return;
  G.switching = true;
  const fade = $('fade');
  fade.classList.add('on');
  setTimeout(() => {
    G.active = G.active === 'nova' ? 'doc' : 'nova';
    const c = activeChar();
    G.cam.x = c.x; G.cam.y = c.y;
    updateHUD();
    updateDriveMode();
    writeSave();
    fade.classList.remove('on');
    setTimeout(() => { G.switching = false; }, 240);
  }, 230);
}

function updateDriveMode() {
  const c = activeChar();
  const tc = $('touch-controls');
  tc.classList.toggle('driving', !!c.inCar);
  tc.classList.toggle('foot', !c.inCar);
  $('hud-speed').classList.toggle('hidden', !c.inCar);
}

function togglePause(force) {
  if (!G.started || G.busted) return;
  const want = typeof force === 'boolean' ? force : !G.paused;
  if (want === G.paused) return;
  G.paused = want;
  $('pause-menu').classList.toggle('hidden', !G.paused);
  if (G.paused) {
    const c = CHARACTERS[G.active];
    $('pause-portrait').src = c.face;
    $('pause-name').textContent = c.name;
    $('pause-cash').textContent = fmtCash(save.cash);
  }
}

function toggleMap() {
  if (!G.started || G.paused || G.busted) return;
  G.mapOpen = !G.mapOpen;
  $('map-overlay').classList.toggle('hidden', !G.mapOpen);
  if (G.mapOpen) drawFullMap();
}

function doHorn() {
  if (!G.started || G.paused) return;
  G.hornTimer = 0.9;
}

function nearestCar(x, y, maxD) {
  let best = null, bd = maxD;
  for (const car of cars) {
    if (car.type === 'police') continue;
    const d = dist(x, y, car.x, car.y);
    if (d < bd) { bd = d; best = car; }
  }
  return best;
}

function doAction() {
  if (!G.started || G.paused || G.busted || G.mapOpen) return;
  const c = activeChar();
  if (c.inCar) { exitCar(c); return; }
  const car = nearestCar(c.x, c.y, 78);
  if (car) {
    c.inCar = car; car.driver = 'player';
    updateDriveMode();
  }
}
function exitCar(c) {
  const car = c.inCar;
  if (!car) return;
  c.inCar = null;
  car.driver = null; car.type = 'parked';
  // Step out to the left side of the car.
  const sx = c.x, sy = c.y;
  c.x = car.x + Math.cos(car.angle + Math.PI / 2) * 34;
  c.y = car.y + Math.sin(car.angle + Math.PI / 2) * 34;
  if (pointInBuilding(c.x, c.y) || blockedAt(c.x, c.y)) { c.x = sx; c.y = sy; }
  c.angle = car.angle;
  updateDriveMode();
}

function bustedSequence() {
  const loss = Math.round(save.cash * 0.10);
  save.cash -= loss;
  G.stars = 0; G.bustedTimer = 0; G.cleanTimer = 0;
  // Remove police.
  for (let i = cars.length - 1; i >= 0; i--) if (cars[i].type === 'police') cars.splice(i, 1);
  const c = activeChar();
  if (c.inCar) { c.inCar.driver = null; c.inCar.type = 'parked'; c.inCar = null; }
  c.x = START_POS[c.key].x; c.y = START_POS[c.key].y; c.angle = -Math.PI / 2; c.speed = 0;
  G.cam.x = c.x; G.cam.y = c.y;
  G.busted = true;
  updateDriveMode(); updateHUD(); writeSave();
  $('busted-text').textContent = 'The cops caught up with you. You lost ' + fmtCash(loss) + ' (10%).';
  $('busted-screen').classList.remove('hidden');
}

function restartRun() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  save = { cash: 0, missionIndex: 0, completed: 0, touch: save.touch, chars: null };
  randomJobState = randomJob();
  G.stars = 0; G.cleanTimer = 0; G.bustedTimer = 0;
  for (const k of CHAR_KEYS) {
    chars[k] = makeChar(k);
  }
  resetEntities();
  G.paused = false;
  $('pause-menu').classList.add('hidden');
  const c = activeChar();
  G.cam.x = c.x; G.cam.y = c.y;
  updateDriveMode(); updateHUD();
  toast('New run started — ' + currentMission().text);
}

/* ================= gameplay update ================= */
function inputVector() {
  let x = 0, y = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
  if (joy.active) { x += joy.dx; y += joy.dy; }
  const m = Math.hypot(x, y);
  if (m > 1) { x /= m; y /= m; }
  return { x, y, mag: Math.min(1, m) };
}

function addWanted(n) {
  G.stars = clamp(G.stars + n, 0, 5);
  G.cleanTimer = 0;
  updateHUD();
}
function onCrash(relSpeed) {
  if (relSpeed > 150 && G.crashCooldown <= 0) {
    addWanted(1);
    G.crashCooldown = 3;
  }
  G.shake = Math.min(8, G.shake + 3);
}

/* Shared car physics: integrate, collide with buildings/bounds/other cars. */
function moveCar(car, dt) {
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  if (car.x < 20) { car.x = 20; car.speed *= 0.5; }
  if (car.x > WORLD.w - 20) { car.x = WORLD.w - 20; car.speed *= 0.5; }
  if (car.y < 20) { car.y = 20; car.speed *= 0.5; }
  if (car.y > WATER_Y - 16) { car.y = WATER_Y - 16; car.speed *= 0.5; }
  // Two-circle body vs buildings (front + rear) for decent cornering feel.
  for (const off of [-15, 15]) {
    const fx = car.x + Math.cos(car.angle) * off, fy = car.y + Math.sin(car.angle) * off;
    const push = collideBuildings(fx, fy, 15);
    if (push) {
      car.x += push.x; car.y += push.y;
      if (Math.abs(car.speed) > 60) {
        if (car.driver === 'player') onCrash(Math.abs(car.speed));
        car.speed *= 0.45;
      } else car.speed *= 0.8;
    }
  }
  // Car vs car: always push apart positionally, but only damp speed on a
  // fresh impact (per-car cooldown) so cars don't glue into a slow push.
  for (const o of cars) {
    if (o === car) continue;
    const d = dist(car.x, car.y, o.x, o.y);
    if (d < 40 && d > 0.01) {
      const nx = (car.x - o.x) / d, ny = (car.y - o.y) / d, overlap = (40 - d) / 2;
      car.x += nx * overlap; car.y += ny * overlap;
      o.x -= nx * overlap; o.y -= ny * overlap;
      const now = G.elapsed;
      if (now - (car._touch || 0) > 0.25 && now - (o._touch || 0) > 0.25) {
        car._touch = now; o._touch = now;
        const rel = Math.abs(car.speed - o.speed);
        if (rel > 120 && (car.driver === 'player' || o.driver === 'player')) onCrash(rel);
        car.speed *= 0.75; o.speed *= 0.75;
      }
    }
  }
}

function driveCar(car, steer, throttle, brake, handbrake, dt, handling, maxSpeed) {
  if (throttle) car.speed += CAR_ACCEL * dt;
  if (brake) {
    if (car.speed > 5) car.speed -= CAR_ACCEL * 1.7 * dt;
    else car.speed -= CAR_ACCEL * 0.7 * dt;
  }
  if (handbrake && Math.abs(car.speed) > 1) car.speed -= Math.sign(car.speed) * 720 * dt;
  car.speed -= car.speed * 0.32 * dt;                 // rolling drag
  if (!throttle && !brake) car.speed -= car.speed * 0.55 * dt;
  car.speed = clamp(car.speed, -CAR_REVERSE_MAX, maxSpeed || CAR_MAX);
  if (Math.abs(car.speed) < 2 && !throttle && !brake) car.speed = 0;
  const spdF = Math.min(1, Math.abs(car.speed) / 140);
  car.angle += steer * 2.3 * handling * spdF * dt * (car.speed >= 0 ? 1 : -1);
  moveCar(car, dt);
}

function updatePlayer(dt) {
  const c = activeChar();
  const cfg = CHARACTERS[c.key];
  if (c.inCar) {
    const car = c.inCar;
    let steer = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) steer -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) steer += 1;
    if (joy.active) steer += joy.dx;
    steer = clamp(steer, -1, 1);
    const throttle = keys.has('KeyW') || keys.has('ArrowUp') || hold.gas;
    const brake = keys.has('KeyS') || keys.has('ArrowDown') || hold.brake;
    const handbrake = keys.has('Space');
    driveCar(car, steer, throttle, brake, handbrake, dt, cfg.handling, CAR_MAX);
    c.x = car.x; c.y = car.y; c.angle = car.angle;
    c.speed = Math.abs(car.speed);
  } else {
    const v = inputVector();
    const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight') || hold.sprint;
    const spd = (sprinting ? cfg.sprint : WALK_SPEED) * v.mag;
    c.speed = spd;
    if (v.mag > 0.05) {
      c.angle += angDiff(Math.atan2(v.y, v.x), c.angle) * Math.min(1, 14 * dt);
      c.walkPhase += spd * dt;
    }
    // Axis-separated movement so the player slides along walls.
    c.x += v.x * spd * dt;
    let push = collideBuildings(c.x, c.y, 13);
    if (push) c.x += push.x;
    c.y += v.y * spd * dt;
    push = collideBuildings(c.x, c.y, 13);
    if (push) c.y += push.y;
    c.x = clamp(c.x, 10, WORLD.w - 10);
    c.y = clamp(c.y, 10, WATER_Y - 8);
  }
}

function updateTraffic(dt) {
  for (const car of cars) {
    if (car.driver !== 'ai') continue;
    if (car.road === 'v') {
      const laneX = V_ROADS[car.roadIdx] - car.dir * 40;
      car.x += (laneX - car.x) * Math.min(1, 2.5 * dt);
      for (let i = 0; i < H_ROADS.length; i++) {
        const key = 'v' + car.roadIdx + 'x' + i;
        if (Math.abs(car.y - H_ROADS[i]) < 26 && car.junctionKey !== key) {
          car.junctionKey = key;
          if (rng() < 0.22) { // turn onto the crossing road
            car.road = 'h'; car.roadIdx = i; car.dir = rng() < 0.5 ? 1 : -1;
            car.angle = car.dir > 0 ? 0 : Math.PI;
          }
          break;
        }
      }
      if (car.y < 70 && car.dir < 0) { car.dir = 1; car.angle = Math.PI / 2; }
      if (car.y > WATER_Y - 90 && car.dir > 0) { car.dir = -1; car.angle = -Math.PI / 2; }
    } else {
      const laneY = H_ROADS[car.roadIdx] + car.dir * 40;
      car.y += (laneY - car.y) * Math.min(1, 2.5 * dt);
      for (let i = 0; i < V_ROADS.length; i++) {
        const key = 'h' + car.roadIdx + 'x' + i;
        if (Math.abs(car.x - V_ROADS[i]) < 26 && car.junctionKey !== key) {
          car.junctionKey = key;
          if (rng() < 0.22) {
            car.road = 'v'; car.roadIdx = i; car.dir = rng() < 0.5 ? 1 : -1;
            car.angle = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
          }
          break;
        }
      }
      if (car.x < 70 && car.dir < 0) { car.dir = 1; car.angle = 0; }
      if (car.x > WORLD.w - 70 && car.dir > 0) { car.dir = -1; car.angle = Math.PI; }
    }
    // Slow/stop for a car directly ahead.
    let target = car.aiSpeed;
    const hx = Math.cos(car.angle), hy = Math.sin(car.angle);
    for (const o of cars) {
      if (o === car) continue;
      const dx = o.x - car.x, dy = o.y - car.y;
      const ahead = dx * hx + dy * hy, side = Math.abs(-dx * hy + dy * hx);
      if (ahead > 0 && ahead < 85 && side < 26) { target = 0; break; }
    }
    car.speed += clamp(target - car.speed, -520 * dt, 260 * dt);
    moveCar(car, dt);
  }
}

function spawnPolice() {
  const c = activeChar();
  const a = rand(0, Math.PI * 2);
  let x = clamp(c.x + Math.cos(a) * 480, 60, WORLD.w - 60);
  let y = clamp(c.y + Math.sin(a) * 480, 60, WATER_Y - 60);
  for (let i = 0; i < 8 && pointInBuilding(x, y); i++) { x = clamp(x + rand(-90, 90), 60, WORLD.w - 60); y = clamp(y + rand(-90, 90), 60, WATER_Y - 60); }
  const car = makeCar(x, y, Math.atan2(c.y - y, c.x - x), '#1e3a8a', 'police');
  car.driver = 'police'; car.stuck = 0; car.reverseT = 0;
  return car;
}

function updatePolice(dt) {
  const c = activeChar();
  const want = G.stars >= 3 ? Math.min(2, G.stars - 2) : 0;
  let have = 0;
  for (const car of cars) if (car.type === 'police') have++;
  while (have < want) { spawnPolice(); have++; }
  if (have > want) {
    // Remove the farthest police car(s).
    const cops = cars.filter(x => x.type === 'police').sort((a, b) => dist(b.x, b.y, c.x, c.y) - dist(a.x, a.y, c.x, c.y));
    for (let i = 0; i < have - want; i++) cars.splice(cars.indexOf(cops[i]), 1);
  }
  for (const car of cars) {
    if (car.type !== 'police') continue;
    const desired = Math.atan2(c.y - car.y, c.x - car.x);
    let steer = clamp(angDiff(desired, car.angle) * 2.2, -1, 1);
    let throttle = true, brake = false;
    if (Math.abs(car.speed) < 25 && car.speed > -5) car.stuck += dt; else car.stuck = 0;
    if (car.stuck > 1.2) { car.reverseT = 0.9; car.stuck = 0; }
    if (car.reverseT > 0) { car.reverseT -= dt; throttle = false; brake = true; steer = -steer; }
    driveCar(car, steer, throttle, brake, false, dt, 1.15, 580);
  }
}

function resolvePed(p) {
  p.x = clamp(p.x, 10, WORLD.w - 10);
  p.y = clamp(p.y, 10, WATER_Y - 8);
  const push = collideBuildings(p.x, p.y, 12);
  if (push) { p.x += push.x; p.y += push.y; p.heading = rand(0, Math.PI * 2); }
}

function updatePeds(dt) {
  for (const p of peds) {
    if (p.state === 'down') { p.timer -= dt; if (p.timer <= 0) p.state = 'walk'; continue; }
    if (p.state === 'dive') {
      p.timer -= dt;
      p.x += Math.cos(p.heading) * 260 * dt;
      p.y += Math.sin(p.heading) * 260 * dt;
      resolvePed(p);
      if (p.timer <= 0) p.state = 'walk';
      continue;
    }
    // Dive away from an approaching fast car.
    for (const car of cars) {
      if (Math.abs(car.speed) < 90) continue;
      const d = dist(p.x, p.y, car.x, car.y);
      if (d < 130) {
        const hx = Math.cos(car.angle), hy = Math.sin(car.angle);
        const toward = ((p.x - car.x) * hx + (p.y - car.y) * hy) / Math.max(1, d);
        if (toward > 0.6) {
          p.state = 'dive'; p.timer = 0.55;
          p.heading = car.angle + (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
          break;
        }
      }
    }
    if (p.state !== 'walk') continue;
    p.retarget -= dt;
    if (p.retarget <= 0) { p.heading = rand(0, Math.PI * 2); p.retarget = rand(2, 5); }
    p.x += Math.cos(p.heading) * p.speed * dt;
    p.y += Math.sin(p.heading) * p.speed * dt;
    p.angle = p.heading;
    resolvePed(p);
    // Hit by a fast car: knocked down (no gore), wanted rises if it was the player.
    for (const car of cars) {
      if (Math.abs(car.speed) < 110) continue;
      if (dist(p.x, p.y, car.x, car.y) < 30) {
        p.state = 'down'; p.timer = 2.5;
        if (car.driver === 'player' && G.hitCooldown <= 0) {
          addWanted(1); G.hitCooldown = 2; G.shake = Math.min(8, G.shake + 4);
        }
        break;
      }
    }
  }
}

function updateWanted(dt) {
  if (G.stars > 0) {
    G.cleanTimer += dt;
    if (G.cleanTimer > 20) { G.stars--; G.cleanTimer = 0; updateHUD(); }
  }
}

function updateMissions() {
  const c = activeChar();
  const m = currentMission();
  if (dist(c.x, c.y, m.x, m.y) < MISSION_RADIUS) {
    save.cash += m.pay;
    save.completed += 1;
    if (m.scripted) save.missionIndex += 1; else randomJobState = randomJob();
    const nm = currentMission();
    toast('Mission complete! +' + fmtCash(m.pay) + '  •  Next: ' + nm.text, 3600);
    updateHUD(); writeSave();
  }
}

function updateBusted(dt) {
  const c = activeChar();
  let near = false;
  for (const car of cars) {
    if (car.type === 'police' && dist(car.x, car.y, c.x, c.y) < 85) { near = true; break; }
  }
  if (near && c.speed < 18) {
    G.bustedTimer += dt;
    if (G.bustedTimer > 3) bustedSequence();
  } else {
    G.bustedTimer = Math.max(0, G.bustedTimer - dt * 2);
  }
}

function updateCamera(dt) {
  const c = activeChar();
  const tx = c.inCar ? c.inCar.x : c.x, ty = c.inCar ? c.inCar.y : c.y;
  const k = Math.min(1, 5 * dt);
  G.cam.x += (tx - G.cam.x) * k;
  G.cam.y += (ty - G.cam.y) * k;
  const vw = view.w / 2, vh = view.h / 2;
  G.cam.x = WORLD.w > view.w ? clamp(G.cam.x, vw, WORLD.w - vw) : WORLD.w / 2;
  G.cam.y = WORLD.h > view.h ? clamp(G.cam.y, vh, WORLD.h - vh) : WORLD.h / 2;
}

function update(dt) {
  G.elapsed += dt;
  G.clock += dt; // 1 game minute per real second
  G.hitCooldown = Math.max(0, G.hitCooldown - dt);
  G.crashCooldown = Math.max(0, G.crashCooldown - dt);
  G.hornTimer = Math.max(0, G.hornTimer - dt);
  G.shake = Math.max(0, G.shake - dt * 14);
  updatePlayer(dt);
  updateTraffic(dt);
  updatePolice(dt);
  updatePeds(dt);
  updateWanted(dt);
  updateMissions();
  updateBusted(dt);
  updateCamera(dt);
  if (G.elapsed - G.lastSave > 10) { G.lastSave = G.elapsed; writeSave(); }
  updateHUD();
}

/* ================= rendering ================= */
const canvas = $('game'), ctx = canvas.getContext('2d');
const mmap = $('minimap'), mctx = mmap.getContext('2d');
const fmap = $('fullmap'), fctx = fmap.getContext('2d');
const view = { w: 0, h: 0, dpr: 1 };

function resize() {
  view.dpr = Math.min(2, window.devicePixelRatio || 1);
  view.w = window.innerWidth; view.h = window.innerHeight;
  canvas.width = Math.round(view.w * view.dpr);
  canvas.height = Math.round(view.h * view.dpr);
  canvas.style.width = view.w + 'px';
  canvas.style.height = view.h + 'px';
}
window.addEventListener('resize', resize);

/* Park trees — deterministic positions. */
const parkTrees = [];
(function () {
  const trng = mulberry32(777);
  const pb = blocks.find(b => b.park);
  for (let i = 0; i < 26; i++) {
    parkTrees.push({ x: pb.x + 24 + trng() * (pb.w - 48), y: pb.y + 24 + trng() * (pb.h - 48), r: 11 + trng() * 9 });
  }
})();

function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function render() {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(0, 0, view.w, view.h);
  const shx = G.shake ? rand(-G.shake, G.shake) : 0;
  const shy = G.shake ? rand(-G.shake, G.shake) : 0;
  const ox = view.w / 2 - G.cam.x + shx, oy = view.h / 2 - G.cam.y + shy;
  ctx.save();
  ctx.translate(ox, oy);
  const vx0 = G.cam.x - view.w / 2 - 60, vx1 = G.cam.x + view.w / 2 + 60;
  const vy0 = G.cam.y - view.h / 2 - 60, vy1 = G.cam.y + view.h / 2 + 60;

  // Ground.
  ctx.fillStyle = '#4e5158';
  ctx.fillRect(0, 0, WORLD.w, WORLD.h);
  // Promenade + water.
  ctx.fillStyle = '#c2b49a';
  ctx.fillRect(0, 2300, WORLD.w, WATER_Y - 2300);
  ctx.fillStyle = '#1d4e89';
  ctx.fillRect(0, WATER_Y, WORLD.w, WORLD.h - WATER_Y);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  for (let wx = 0; wx < WORLD.w; wx += 160) {
    const wy = WATER_Y + 22 + Math.sin(G.elapsed * 1.2 + wx * 0.01) * 4;
    ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + 70, wy); ctx.stroke();
  }
  // Roads.
  ctx.fillStyle = '#232529';
  for (const x of V_ROADS) ctx.fillRect(x - ROAD_HALF, 0, ROAD_W, WATER_Y);
  for (const y of H_ROADS) ctx.fillRect(0, y - ROAD_HALF, WORLD.w, ROAD_W);
  // Lane markings (only the visible stretch).
  ctx.fillStyle = '#e8c33c';
  for (const x of V_ROADS) {
    if (x < vx0 || x > vx1) continue;
    for (let y = Math.max(0, Math.floor(vy0 / 44) * 44); y < Math.min(WATER_Y, vy1); y += 44) ctx.fillRect(x - 2, y, 4, 22);
  }
  for (const y of H_ROADS) {
    if (y < vy0 || y > vy1) continue;
    for (let x = Math.max(0, Math.floor(vx0 / 44) * 44); x < Math.min(WORLD.w, vx1); x += 44) ctx.fillRect(x, y - 2, 22, 4);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (const x of V_ROADS) {
    if (x < vx0 || x > vx1) continue;
    ctx.fillRect(x - ROAD_HALF + 5, Math.max(0, vy0), 2, Math.min(WATER_Y, vy1) - Math.max(0, vy0));
    ctx.fillRect(x + ROAD_HALF - 7, Math.max(0, vy0), 2, Math.min(WATER_Y, vy1) - Math.max(0, vy0));
  }
  for (const y of H_ROADS) {
    if (y < vy0 || y > vy1) continue;
    ctx.fillRect(Math.max(0, vx0), y - ROAD_HALF + 5, Math.min(WORLD.w, vx1) - Math.max(0, vx0), 2);
    ctx.fillRect(Math.max(0, vx0), y + ROAD_HALF - 7, Math.min(WORLD.w, vx1) - Math.max(0, vx0), 2);
  }
  // Blocks (sidewalk) + park.
  for (const b of blocks) {
    if (b.x + b.w < vx0 || b.x > vx1 || b.y + b.h < vy0 || b.y > vy1) continue;
    ctx.fillStyle = b.park ? '#3f7a3a' : '#7d8087';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    if (b.park) {
      ctx.fillStyle = '#356b31';
      ctx.fillRect(b.x + b.w / 2 - 8, b.y, 16, b.h); // path
      ctx.fillRect(b.x, b.y + b.h / 2 - 8, b.w, 16);
    }
  }
  // Buildings.
  for (const b of buildings) {
    if (b.x + b.w < vx0 || b.x > vx1 || b.y + b.h < vy0 || b.y > vy1) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(b.x + 5, b.y + 6, b.w, b.h);
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(b.x + 8, b.y + 8, b.w - 16, b.h - 16);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (const u of b.units) ctx.fillRect(u.x, u.y, u.w, u.h);
  }
  // Trees.
  for (const t of parkTrees) {
    if (t.x < vx0 || t.x > vx1 || t.y < vy0 || t.y > vy1) continue;
    ctx.fillStyle = '#2c5a28';
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4c8a44';
    ctx.beginPath(); ctx.arc(t.x - 2, t.y - 2, t.r * 0.6, 0, Math.PI * 2); ctx.fill();
  }
  // Mission marker: pulsing rings.
  const m = currentMission();
  const pulse = 1 + Math.sin(G.elapsed * 4) * 0.15;
  ctx.strokeStyle = '#f5c518';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(m.x, m.y, 34 * pulse, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(245,197,24,0.25)';
  ctx.beginPath(); ctx.arc(m.x, m.y, 30 * pulse, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f5c518';
  ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(Math.PI / 4 + G.elapsed);
  ctx.fillRect(-8, -8, 16, 16); ctx.restore();

  // Pedestrians.
  for (const p of peds) {
    if (p.x < vx0 || p.x > vx1 || p.y < vy0 || p.y > vy1) continue;
    ctx.save(); ctx.translate(p.x, p.y);
    if (p.state === 'down') {
      ctx.rotate(p.angle + Math.PI / 2);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.ellipse(0, 0, 14, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e8b98a';
      ctx.beginPath(); ctx.arc(14, 0, 6, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e8b98a';
      ctx.beginPath(); ctx.arc(3, 0, 6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  // Cars.
  for (const car of cars) {
    if (car.x < vx0 - 40 || car.x > vx1 + 40 || car.y < vy0 - 40 || car.y > vy1 + 40) continue;
    drawCar(car);
  }
  // Characters (inactive first, then active if on foot).
  const other = chars[G.active === 'nova' ? 'doc' : 'nova'];
  if (!other.inCar) drawChar(other, false);
  const c = activeChar();
  if (!c.inCar) drawChar(c, true);
  // Horn bubble.
  if (G.hornTimer > 0 && c.inCar) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('HONK!', c.x, c.y - 34);
  }
  ctx.restore();

  // Off-screen mission arrow.
  if (G.started) {
    const sx = m.x - G.cam.x + view.w / 2, sy = m.y - G.cam.y + view.h / 2;
    if (sx < 0 || sx > view.w || sy < 0 || sy > view.h) {
      const ax = clamp(sx, 40, view.w - 40), ay = clamp(sy, 90, view.h - 40);
      const a = Math.atan2(sy - view.h / 2, sx - view.w / 2);
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(a);
      ctx.fillStyle = '#f5c518';
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -10); ctx.lineTo(-8, 10); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
  // Busted warning.
  if (G.bustedTimer > 0.4 && !G.busted) {
    ctx.fillStyle = 'rgba(229,72,77,0.9)';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('COPS ARE ON YOU — MOVE!', view.w / 2, 120);
  }
}

function drawCar(car) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  rr(ctx, -21, -9, 46, 24, 6); ctx.fill();
  ctx.fillStyle = car.color;
  rr(ctx, -23, -12, 46, 24, 6); ctx.fill();
  ctx.fillStyle = '#10141c';
  ctx.fillRect(8, -9, 5, 18);    // windshield
  ctx.fillRect(-14, -9, 4, 18);  // rear window
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  rr(ctx, -6, -9, 13, 18, 3); ctx.fill(); // roof
  ctx.fillStyle = '#fff8c0';
  ctx.fillRect(21, -9, 3, 5); ctx.fillRect(21, 4, 3, 5); // headlights
  if (car.type === 'police') {
    const flash = Math.floor(G.elapsed * 6) % 2 === 0;
    ctx.fillStyle = flash ? '#ff2d2d' : '#2d5bff';
    ctx.fillRect(-4, -11, 8, 5);
    ctx.fillStyle = flash ? '#2d5bff' : '#ff2d2d';
    ctx.fillRect(-4, 6, 8, 5);
  }
  ctx.restore();
  if (car.driver === 'player') {
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(car.x, car.y, 32, 0, Math.PI * 2); ctx.stroke();
  }
}

function drawChar(c, isActive) {
  const cfg = CHARACTERS[c.key];
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(2, 5, 13, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(c.angle);
  const s = Math.sin(c.walkPhase * 0.09) * 3;
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(3, -6 + s * 0.4, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(3, 6 - s * 0.4, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = cfg.color;
  ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = cfg.accent;
  ctx.beginPath(); ctx.arc(6, 0, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8b98a';
  ctx.beginPath(); ctx.arc(1, 0, 6.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (!isActive) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(cfg.name, c.x, c.y - 22);
  }
}

/* ================= minimap + full map ================= */
function drawMapOn(mc, w, h, detail) {
  const sx = w / WORLD.w, sy = h / WORLD.h;
  mc.fillStyle = '#10141c';
  mc.fillRect(0, 0, w, h);
  mc.fillStyle = '#1d4e89';
  mc.fillRect(0, WATER_Y * sy, w, (WORLD.h - WATER_Y) * sy);
  const pb = blocks.find(b => b.park);
  mc.fillStyle = '#3f7a3a';
  mc.fillRect(pb.x * sx, pb.y * sy, pb.w * sx, pb.h * sy);
  mc.strokeStyle = '#4a4e55';
  mc.lineWidth = Math.max(2, ROAD_W * sx * 0.9);
  for (const x of V_ROADS) { mc.beginPath(); mc.moveTo(x * sx, 0); mc.lineTo(x * sx, WATER_Y * sy); mc.stroke(); }
  for (const y of H_ROADS) { mc.beginPath(); mc.moveTo(0, y * sy); mc.lineTo(w, y * sy); mc.stroke(); }
  if (detail) {
    mc.fillStyle = '#6b6f76';
    for (const b of buildings) mc.fillRect(b.x * sx, b.y * sy, Math.max(1, b.w * sx), Math.max(1, b.h * sy));
  }
  const m = currentMission();
  const pulse = 3 + Math.sin(G.elapsed * 5) * 1.5;
  mc.fillStyle = '#f5c518';
  mc.beginPath(); mc.arc(m.x * sx, m.y * sy, pulse + 2, 0, Math.PI * 2); mc.fill();
  for (const car of cars) {
    mc.fillStyle = car.type === 'police' ? '#3b82f6' : '#9aa3ad';
    mc.fillRect(car.x * sx - 1.5, car.y * sy - 1.5, 3, 3);
  }
  const other = chars[G.active === 'nova' ? 'doc' : 'nova'];
  mc.fillStyle = '#22d3ee';
  mc.beginPath(); mc.arc(other.x * sx, other.y * sy, 3.5, 0, Math.PI * 2); mc.fill();
  const c = activeChar();
  mc.save(); mc.translate(c.x * sx, c.y * sy); mc.rotate(c.angle);
  mc.fillStyle = '#fff';
  mc.beginPath(); mc.moveTo(6, 0); mc.lineTo(-4, -4.5); mc.lineTo(-4, 4.5); mc.closePath(); mc.fill();
  mc.restore();
}
function renderMinimap() {
  if (!G.started) return;
  drawMapOn(mctx, mmap.width, mmap.height, false);
}
function drawFullMap() {
  drawMapOn(fctx, fmap.width, fmap.height, true);
}

/* ================= HUD ================= */
const hudCache = {};
function setText(id, val) {
  if (hudCache[id] !== val) { hudCache[id] = val; $(id).textContent = val; }
}
function updateHUD() {
  if (!G.started) return;
  const cfg = CHARACTERS[G.active];
  const portrait = $('hud-portrait');
  if (portrait.getAttribute('src') !== cfg.face) portrait.src = cfg.face;
  setText('hud-name', cfg.name);
  setText('hud-cash', fmtCash(save.cash));
  const m = currentMission();
  const c = activeChar();
  const d = Math.round(dist(c.x, c.y, m.x, m.y) / 10);
  setText('hud-objective', '📍 ' + m.text + '  (' + d + 'm)');
  setText('hud-sub', 'Missions: ' + save.completed + '  •  Next pay $' + m.pay);
  setText('hud-stars', '★'.repeat(G.stars) + '☆'.repeat(5 - G.stars));
  const hh = String(Math.floor(G.clock / 60) % 24).padStart(2, '0');
  const mm = String(Math.floor(G.clock % 60)).padStart(2, '0');
  setText('hud-clock', hh + ':' + mm);
  if (c.inCar) setText('hud-speed', Math.round(Math.abs(c.inCar.speed) * 0.22) + ' mph');
}

/* ================= main loop + init ================= */
let lastT = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;
  if (G.started && !G.paused && !G.busted) {
    update(dt);
  } else if (!G.started) {
    // Living city behind the start screen.
    G.elapsed += dt;
    updateTraffic(dt);
    updatePeds(dt);
  }
  render();
  if (G.mapOpen) drawFullMap();
  renderMinimap();
}

function init() {
  loadSave();
  for (const k of CHAR_KEYS) chars[k] = makeChar(k);
  resetEntities();
  G.lastSave = 0;
  resize();
  initJoystick();
  bindHoldButton('btn-sprint', 'sprint');
  bindHoldButton('btn-gas', 'gas');
  bindHoldButton('btn-brake', 'brake');
  bindTapButton('btn-action', doAction);
  bindTapButton('btn-exit', () => { const c = activeChar(); exitCar(c); });
  bindTapButton('btn-switch', switchCharacter);
  bindTapButton('btn-map', toggleMap);
  bindTapButton('btn-pause', () => togglePause());
  bindTapButton('btn-horn', doHorn);
  $('pick-nova').addEventListener('click', () => startGame('nova'));
  $('pick-doc').addEventListener('click', () => startGame('doc'));
  $('btn-resume').addEventListener('click', () => togglePause(false));
  $('btn-restart').addEventListener('click', restartRun);
  $('btn-map-close').addEventListener('click', toggleMap);
  $('btn-busted-ok').addEventListener('click', () => {
    G.busted = false;
    $('busted-screen').classList.add('hidden');
    toast('Back on the streets. Stay clean.');
  });
  const tm = $('touch-mode');
  tm.value = save.touch || 'auto';
  tm.addEventListener('change', () => { save.touch = tm.value; writeSave(); applyTouchVisibility(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.started && !G.busted) togglePause(true);
  });
  updateDriveMode();
  requestAnimationFrame(loop);
}
init();
