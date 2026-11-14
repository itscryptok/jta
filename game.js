'use strict';
/* =====================================================================
   JTA v2 — Two Lives. One City.
   3D third-person open-city game. Three.js (vendored, no CDN) + the v1
   simulation core: missions, wanted stars, police, traffic, peds, save.
   World sim runs in v1's 2D coordinates (x right, y down); the 3D layer
   maps them to metres with S = 0.1 (world 320m x 240m).
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
    color: '#e5484d', accent: '#22d3ee',      // figure: red body, cyan trim
    label: '#ff5d73',                          // floating name colour (pink/red)
    skin: '#e8b98a', hair: '#1c1410',
    sprint: 252, handling: 1.0,                // slightly faster sprint
    desc: 'Faster sprint'
  },
  doc: {
    name: 'DOC', fullName: 'Doc',
    tagline: 'Seen it all. Drives like it.',
    face: 'assets/doc-face.jpg', full: 'assets/doc-full.jpg',
    color: '#2b2f36', accent: '#f5c518',       // figure: dark grey/black, gold trim
    label: '#f5c518',                          // floating name colour (gold)
    skin: '#eec39a', hair: '#cfcfcf',
    sprint: 228, handling: 1.28,               // slightly better car handling
    desc: 'Better car handling'
  }
};
const CHAR_KEYS = ['nova', 'doc'];

/* ================= CONFIG ================= */
const WORLD = { w: 3200, h: 2400 };
const S = 0.1;                                   // sim units -> 3D metres
const ROAD_W = 170, ROAD_HALF = ROAD_W / 2;
const V_ROADS = [350, 950, 1550, 2150, 2750];    // vertical road centre x
const H_ROADS = [300, 850, 1400, 1950];          // horizontal road centre y
const WATER_Y = 2330;                            // waterfront: water below this y
const SAVE_KEY = 'jta-save-v1';                  // same key as v1: progress carries over
const WALK_SPEED = 150, CAR_MAX = 520, CAR_ACCEL = 430, CAR_REVERSE_MAX = 190;
const MISSION_RADIUS = 95;
const START_POS = { nova: { x: 1480, y: 1330 }, doc: { x: 1620, y: 1470 } };
const CRATE_SPOTS = [
  { x: 1150, y: 1050 }, { x: 2100, y: 1850 }, { x: 600, y: 350 }
];
const DROP_PAD = { x: 500, y: 2260, label: 'the drop pad' };
const PUNCH_RANGE = 62, PUNCH_ARC = 1.2, PUNCH_COOLDOWN = 0.45;
const HAUL_RANGE = 78;
const MAX_HEALTH = 100;

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
// 2D sim angle -> 3D yaw for a mesh built facing +Z.
const yawOf = a => Math.PI / 2 - a;
const wx = x => x * S, wz = y => y * S;

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
const buildings = [];   // {x,y,w,h,color,units:[{x,y,w,h}], h3 (3D height, set by the 3D builder)}
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
function buildingAt(x, y) {
  for (const b of buildings) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  return null;
}
function blockedAt(x, y) { // water + world edge
  return x < 8 || x > WORLD.w - 8 || y < 8 || y > WATER_Y - 6;
}

/* Park trees — deterministic positions (shared by 2D map + 3D city). */
const parkTrees = [];
(function () {
  const trng = mulberry32(777);
  const pb = blocks.find(b => b.park);
  for (let i = 0; i < 26; i++) {
    parkTrees.push({ x: pb.x + 24 + trng() * (pb.w - 48), y: pb.y + 24 + trng() * (pb.h - 48), r: 11 + trng() * 9 });
  }
})();

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
  // 1 in 3 random jobs is a cargo haul: grab a glowing crate, deliver it.
  if (rng() < 0.34) {
    return { cargo: true, text: 'Haul job: grab a glowing crate and deliver it', pay: randi(200, 350) };
  }
  const vx = V_ROADS[randi(0, V_ROADS.length - 1)], hy = H_ROADS[randi(0, H_ROADS.length - 1)];
  return { text: 'Delivery job: take the goods to the marked corner', point: null, x: vx, y: hy, pay: randi(100, 350) };
}
let randomJobState = randomJob();
function currentMission() {
  if (save.missionIndex < SCRIPTED_MISSIONS.length) {
    const m = SCRIPTED_MISSIONS[save.missionIndex];
    const p = MISSION_POINTS[m.point];
    return { text: m.text, x: p.x, y: p.y, pay: m.pay, scripted: true };
  }
  return randomJobState;
}

/* ================= dialogue (original one-liners) ================= */
const LINES = {
  greet: {
    nova: ['Night shift. Let’s roll.', 'City lights, my rules.'],
    doc: ['Alright. Keys in hand.', 'Back on the streets.']
  },
  swap: {
    nova: ['My turn. Hold on.', 'Back in my hands.'],
    doc: ['Alright, my turn.', 'Watch how a pro does it.']
  },
  mission: [
    'Clean run. Cash in hand.',
    'That’s how you get paid.',
    'Another one down. Next.'
  ],
  busted: [
    'Not like this…',
    'They finally got me.'
  ],
  wasted: [
    'Should’ve braked.',
    'That one hurt.'
  ],
  pickup: [
    'Got the goods.',
    'Crate secured. Move.'
  ],
  deliver: [
    'Delivered. Money talks.',
    'Cargo dropped, cash collected.'
  ],
  called: [
    'On my way.',
    'Coming to you.'
  ],
  arrived: [
    'I’m here. What’s the job?',
    'Made it. Let’s go.'
  ]
};
function pickLine(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* ================= entities ================= */
const CAR_COLORS = ['#c0392b', '#2980b9', '#f1c40f', '#7f8c8d', '#8e44ad', '#16a085', '#e67e22', '#ecf0f1', '#34495e', '#d35400'];
const PED_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#95a5a6'];

const chars = {};
const cars = [];   // {x,y,angle,speed,color,type,driver,road,roadIdx,dir,junctionKey,aiSpeed,mesh}
const peds = [];   // {x,y,angle,speed,heading,retarget,state,timer,color,mesh,walkPhase}
const crates = []; // {x,y,spot,available,respawnT,mesh,ring}
const G = {
  started: false, paused: false, mapOpen: false, busted: false, wasted: false, switching: false,
  active: 'nova', stars: 0, cleanTimer: 0, bustedTimer: 0,
  clock: 9 * 60, elapsed: 0, hornTimer: 0, hitCooldown: 0, crashCooldown: 0, punchCooldown: 0,
  health: MAX_HEALTH, lastDamageT: -99,
  waypoint: null, shake: 0, lastSave: 0,
  camYaw: 0, camPitch: 0, camYawOff: 0, camPitchOff: 0, lastDragT: -99,
  orbitA: 0
};
function activeChar() { return chars[G.active]; }
function otherChar() { return chars[G.active === 'nova' ? 'doc' : 'nova']; }

function makeChar(key) {
  const s = save.chars && save.chars[key];
  const p = s || START_POS[key];
  return {
    key, x: p.x, y: p.y, angle: (s && s.angle) || -Math.PI / 2, speed: 0,
    inCar: null, walkPhase: 0, punchT: 0, carrying: null, called: false,
    mesh: null, parts: null
  };
}
function makeCar(x, y, angle, color, type) {
  const car = { x, y, angle, speed: 0, color, type, driver: null, road: null, roadIdx: -1, dir: 1, junctionKey: '', aiSpeed: rand(170, 250), mesh: null, barL: null, barR: null };
  cars.push(car);
  return car;
}
function resetEntities() {
  cars.length = 0; peds.length = 0; crates.length = 0;
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
    peds.push({ x, y, angle: rand(0, Math.PI * 2), speed: rand(38, 62), heading: rand(0, Math.PI * 2), retarget: rand(1, 3), state: 'walk', timer: 0, color: PED_COLORS[i % PED_COLORS.length], mesh: null, body: null, walkPhase: rand(0, 6) });
  }
  // Cargo crates at fixed spots (glowing, haulable).
  CRATE_SPOTS.forEach((s, i) => crates.push({ x: s.x, y: s.y, spot: i, available: true, respawnT: 0, mesh: null, ring: null }));
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

/* Camera orbit: drag on the empty 3D view (not on controls) to look around.
   The camera drifts back behind the player a few seconds after you let go. */
const camDrag = { active: false, id: null, lx: 0, ly: 0 };
function initCameraDrag() {
  const cv = $('game');
  cv.addEventListener('pointerdown', e => {
    if (!G.started || G.paused) return;
    camDrag.active = true; camDrag.id = e.pointerId;
    camDrag.lx = e.clientX; camDrag.ly = e.clientY;
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
  });
  cv.addEventListener('pointermove', e => {
    if (!camDrag.active || e.pointerId !== camDrag.id) return;
    const dx = e.clientX - camDrag.lx, dy = e.clientY - camDrag.ly;
    camDrag.lx = e.clientX; camDrag.ly = e.clientY;
    G.camYawOff -= dx * 0.0052;
    G.camPitchOff = clamp(G.camPitchOff + dy * 0.0032, -0.12, 0.55);
    G.lastDragT = G.elapsed;
  });
  function endDrag(e) {
    if (e.pointerId !== camDrag.id) return;
    camDrag.active = false; camDrag.id = null;
    G.lastDragT = G.elapsed;
  }
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
}

/* Waypoint pin: tap the minimap (or the full map) to drop a pin; tap the
   pin itself to clear it. */
function setWaypointFromMap(clientX, clientY, canvasEl) {
  const r = canvasEl.getBoundingClientRect();
  const fx = (clientX - r.left) / r.width, fy = (clientY - r.top) / r.height;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
  const wx2 = fx * WORLD.w, wy2 = fy * WORLD.h;
  if (G.waypoint && dist(wx2, wy2, G.waypoint.x, G.waypoint.y) < 190) {
    G.waypoint = null;
    toast('Waypoint cleared');
  } else {
    G.waypoint = { x: wx2, y: wy2 };
    toast('Waypoint set');
  }
  updateHUD();
}
function initMapTaps() {
  $('minimap').addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    setWaypointFromMap(e.clientX, e.clientY, $('minimap'));
  });
  $('fullmap').addEventListener('pointerdown', e => {
    e.preventDefault();
    setWaypointFromMap(e.clientX, e.clientY, $('fullmap'));
    drawFullMap();
  });
}

/* Keyboard */
window.addEventListener('keydown', e => {
  if (e.code === 'Tab') { e.preventDefault(); switchCharacter(); return; }
  if (e.code === 'KeyM') { toggleMap(); return; }
  if (e.code === 'Escape' || e.code === 'KeyP') { togglePause(); return; }
  if (e.code === 'KeyE') { doAction(); return; }
  if (e.code === 'KeyH') { doHorn(); return; }
  if (e.code === 'KeyG' && !e.repeat) { doHaul(); return; }
  if (e.code === 'KeyC' && !e.repeat) { doCall(); return; }
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat && G.started && !activeChar().inCar) { doPunch(); return; }
    keys.add(e.code); // in a car: handbrake while held
    return;
  }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); hold.sprint = hold.gas = hold.brake = false; });

/* Stop page scroll / pull-to-refresh over the game area (mobile Safari). */
$('game-area').addEventListener('touchmove', e => e.preventDefault(), { passive: false });
$('game-area').addEventListener('contextmenu', e => e.preventDefault());

/* ================= UI wiring + actions ================= */
let toastTimer = null;
function toast(msg, ms) {
  const t = $('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 2800);
}

let dialogueTimer = null;
function showDialogue(text, speakerKey) {
  const d = $('dialogue');
  if (speakerKey && CHARACTERS[speakerKey]) {
    d.innerHTML = '';
    const who = document.createElement('span');
    who.className = 'dlg-who';
    who.style.color = CHARACTERS[speakerKey].label;
    who.textContent = CHARACTERS[speakerKey].name;
    d.appendChild(who);
    d.appendChild(document.createTextNode('  ' + text));
  } else {
    d.textContent = text;
  }
  d.classList.remove('hidden');
  clearTimeout(dialogueTimer);
  dialogueTimer = setTimeout(() => d.classList.add('hidden'), 3200);
}

function startGame(key) {
  G.active = key;
  G.started = true;
  $('start-screen').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('minimap').classList.remove('hidden');
  applyTouchVisibility();
  snapCamera = true;
  updateHUD();
  const m = currentMission();
  toast(CHARACTERS[key].name + ' — ' + m.text + '  •  $' + m.pay);
  showDialogue(pickLine(LINES.greet[key]), key);
}

function switchCharacter() {
  if (!G.started || G.paused || G.busted || G.wasted || G.switching || G.mapOpen) return;
  G.switching = true;
  const fade = $('fade');
  fade.classList.add('on');
  setTimeout(() => {
    G.active = G.active === 'nova' ? 'doc' : 'nova';
    const c = activeChar();
    c.called = false;
    G.camYawOff = 0; G.camPitchOff = 0;
    snapCamera = true;
    updateHUD();
    updateDriveMode();
    writeSave();
    showDialogue(pickLine(LINES.swap[G.active]), G.active);
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
  if (!G.started || G.busted || G.wasted) return;
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
  if (!G.started || G.paused || G.busted || G.wasted) return;
  G.mapOpen = !G.mapOpen;
  $('map-overlay').classList.toggle('hidden', !G.mapOpen);
  if (G.mapOpen) drawFullMap();
}

function doHorn() {
  if (!G.started || G.paused) return;
  G.hornTimer = 0.9;
  toast('HONK!');
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
  if (!G.started || G.paused || G.busted || G.wasted || G.mapOpen) return;
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

/* PUNCH: short-range melee swing. Knocks a nearby pedestrian down briefly
   (they get up; no gore) and earns a wanted star. */
function doPunch() {
  if (!G.started || G.paused || G.busted || G.wasted || G.mapOpen) return;
  const c = activeChar();
  if (c.inCar || G.punchCooldown > 0) return;
  G.punchCooldown = PUNCH_COOLDOWN;
  c.punchT = 0.35;
  let hit = false;
  for (const p of peds) {
    if (p.state === 'down') continue;
    const d = dist(c.x, c.y, p.x, p.y);
    if (d > PUNCH_RANGE) continue;
    const toPed = Math.atan2(p.y - c.y, p.x - c.x);
    if (Math.abs(angDiff(toPed, c.angle)) > PUNCH_ARC) continue;
    p.state = 'down'; p.timer = 2.5;
    hit = true;
  }
  if (hit) {
    if (G.hitCooldown <= 0) { addWanted(1); G.hitCooldown = 2; }
    G.shake = Math.min(8, G.shake + 3);
  }
}

/* HAUL: pick up a nearby glowing cargo crate (carried above the head). */
function nearestCrate(x, y, maxD) {
  let best = null, bd = maxD;
  for (const cr of crates) {
    if (!cr.available) continue;
    const d = dist(x, y, cr.x, cr.y);
    if (d < bd) { bd = d; best = cr; }
  }
  return best;
}
function doHaul() {
  if (!G.started || G.paused || G.busted || G.wasted || G.mapOpen) return;
  const c = activeChar();
  if (c.inCar) { toast('Get out of the car to haul a crate'); return; }
  if (c.carrying) { toast('Already carrying a crate — deliver it to the drop pad'); return; }
  const cr = nearestCrate(c.x, c.y, HAUL_RANGE);
  if (!cr) { toast('No crate nearby — glowing crates sit around the city'); return; }
  cr.available = false;
  c.carrying = cr;
  showDialogue(pickLine(LINES.pickup), c.key);
  updateHUD();
}
function dropCrate(c, respawnNow) {
  if (!c.carrying) return;
  const cr = c.carrying;
  c.carrying = null;
  if (respawnNow) { cr.available = true; cr.respawnT = 0; }
  else { cr.available = false; cr.respawnT = 20; }
}
function deliverCrate(c) {
  const cr = c.carrying;
  if (!cr) return;
  c.carrying = null;
  cr.available = false; cr.respawnT = 20;
  const m = currentMission();
  if (m.cargo) {
    // Cargo job complete: same accounting as any other mission.
    save.cash += m.pay;
    save.completed += 1;
    randomJobState = randomJob();
    const nm = currentMission();
    toast('Cargo delivered! +' + fmtCash(m.pay) + '  •  Next: ' + nm.text, 3600);
    showDialogue(pickLine(LINES.deliver), c.key);
  } else {
    save.cash += 200;
    toast('Cargo delivered! +$200');
    showDialogue(pickLine(LINES.deliver), c.key);
  }
  updateHUD(); writeSave();
}

/* CALL: the other character runs to your location. */
function doCall() {
  if (!G.started || G.paused || G.busted || G.wasted || G.mapOpen) return;
  const o = otherChar();
  if (o.called) return;
  if (o.inCar) exitCar(o);
  o.called = true;
  showDialogue(pickLine(LINES.called), o.key);
  toast(CHARACTERS[o.key].name + ' is on the way');
}

function damagePlayer(amount) {
  if (G.wasted || G.busted || !G.started) return;
  G.health = Math.max(0, G.health - amount);
  G.lastDamageT = G.elapsed;
  if (G.health <= 0) wastedSequence();
}

function removePolice() {
  for (let i = cars.length - 1; i >= 0; i--) {
    if (cars[i].type === 'police') {
      if (cars[i].mesh && cars[i].mesh.parent) cars[i].mesh.parent.remove(cars[i].mesh);
      cars.splice(i, 1);
    }
  }
}

function bustedSequence() {
  const loss = Math.round(save.cash * 0.10);
  save.cash -= loss;
  G.stars = 0; G.bustedTimer = 0; G.cleanTimer = 0;
  removePolice();
  const c = activeChar();
  dropCrate(c, true);
  if (c.inCar) { c.inCar.driver = null; c.inCar.type = 'parked'; c.inCar = null; }
  c.x = START_POS[c.key].x; c.y = START_POS[c.key].y; c.angle = -Math.PI / 2; c.speed = 0;
  snapCamera = true;
  G.busted = true;
  updateDriveMode(); updateHUD(); writeSave();
  $('busted-text').textContent = pickLine(LINES.busted) + ' The cops caught up with you. You lost ' + fmtCash(loss) + ' (10%).';
  $('busted-screen').classList.remove('hidden');
}

function wastedSequence() {
  const loss = Math.round(save.cash * 0.10);
  save.cash -= loss;
  G.stars = 0; G.bustedTimer = 0; G.cleanTimer = 0;
  removePolice();
  const c = activeChar();
  dropCrate(c, true);
  if (c.inCar) { c.inCar.driver = null; c.inCar.type = 'parked'; c.inCar = null; }
  c.x = START_POS[c.key].x; c.y = START_POS[c.key].y; c.angle = -Math.PI / 2; c.speed = 0;
  G.health = MAX_HEALTH;
  snapCamera = true;
  G.wasted = true;
  updateDriveMode(); updateHUD(); writeSave();
  $('wasted-text').textContent = pickLine(LINES.wasted) + ' You lost ' + fmtCash(loss) + ' (10%).';
  $('wasted-screen').classList.remove('hidden');
}

function restartRun() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  save = { cash: 0, missionIndex: 0, completed: 0, touch: save.touch, chars: null };
  randomJobState = randomJob();
  G.stars = 0; G.cleanTimer = 0; G.bustedTimer = 0;
  G.health = MAX_HEALTH; G.waypoint = null;
  for (const k of CHAR_KEYS) {
    const old = chars[k];
    chars[k] = makeChar(k);
    chars[k].mesh = old.mesh; chars[k].parts = old.parts; // keep 3D figures
  }
  clearCarMeshes();
  resetEntities();
  buildCarMeshes();
  buildPedMeshes();
  buildCrateMeshes();
  G.paused = false;
  $('pause-menu').classList.add('hidden');
  snapCamera = true;
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
  if (relSpeed > 120) damagePlayer(clamp(relSpeed * 0.045, 4, 30));
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
  c.punchT = Math.max(0, c.punchT - dt);
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
    // Camera-relative movement (GTA-style): stick/keyboard "up" moves away
    // from the camera, so the player always goes where the screen points.
    let moveA = c.angle;
    if (v.mag > 0.05) {
      const viewA = Math.atan2(wz(c.y) - camera.position.z, wx(c.x) - camera.position.x);
      moveA = viewA + Math.atan2(v.x, -v.y);
      c.angle += angDiff(moveA, c.angle) * Math.min(1, 14 * dt);
      c.walkPhase += spd * dt;
      // Axis-separated movement so the player slides along walls.
      c.x += Math.cos(moveA) * spd * dt;
      let push = collideBuildings(c.x, c.y, 13);
      if (push) c.x += push.x;
      c.y += Math.sin(moveA) * spd * dt;
      push = collideBuildings(c.x, c.y, 13);
      if (push) c.y += push.y;
      c.x = clamp(c.x, 10, WORLD.w - 10);
      c.y = clamp(c.y, 10, WATER_Y - 8);
    }
  }
}

/* The called partner runs to the active character (on foot, GTA style). */
function updatePartner(dt) {
  const o = otherChar();
  const c = activeChar();
  if (!o.called || o.inCar) return;
  const d = dist(o.x, o.y, c.x, c.y);
  if (d < 70) {
    o.called = false;
    o.speed = 0;
    showDialogue(pickLine(LINES.arrived), o.key);
    return;
  }
  const want = Math.atan2(c.y - o.y, c.x - o.x);
  o.angle += angDiff(want, o.angle) * Math.min(1, 10 * dt);
  const spd = CHARACTERS[o.key].sprint;
  o.speed = spd;
  o.walkPhase += spd * dt;
  o.x += Math.cos(o.angle) * spd * dt;
  let push = collideBuildings(o.x, o.y, 13);
  if (push) o.x += push.x;
  o.y += Math.sin(o.angle) * spd * dt;
  push = collideBuildings(o.x, o.y, 13);
  if (push) o.y += push.y;
  o.x = clamp(o.x, 10, WORLD.w - 10);
  o.y = clamp(o.y, 10, WATER_Y - 8);
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
  buildCarMesh(car);
  return car;
}

function updatePolice(dt) {
  const c = activeChar();
  const want = G.stars >= 3 ? Math.min(2, G.stars - 2) : 0;
  let have = 0;
  for (const car of cars) if (car.type === 'police') have++;
  while (have < want) { spawnPolice(); have++; }
  if (have > want) {
    // Remove the farthest police car(s) — mesh included.
    const cops = cars.filter(x => x.type === 'police').sort((a, b) => dist(b.x, b.y, c.x, c.y) - dist(a.x, a.y, c.x, c.y));
    for (let i = 0; i < have - want; i++) {
      const cop = cops[i];
      if (cop.mesh && cop.mesh.parent) cop.mesh.parent.remove(cop.mesh);
      cars.splice(cars.indexOf(cop), 1);
    }
  }
  for (const car of cars) {
    if (car.type !== 'police') continue;
    const desired = Math.atan2(c.y - car.y, c.x - car.x);
    let steer = clamp(angDiff(desired, car.angle) * 2.2, -1, 1);
    let throttle = true, brake = false;
    // Slow down on the approach so we can stop beside the player instead of
    // overshooting them at full speed; hold still once alongside.
    const dPlayer = dist(car.x, car.y, c.x, c.y);
    if (dPlayer < 260) {
      const wantSpeed = Math.max(0, (dPlayer - 45) * 2.2);
      if (dPlayer < 60 || car.speed > wantSpeed) {
        throttle = false;
        brake = car.speed > 60; // never brake below 60 — drag stops the car
      }
    }
    // Stuck detection only counts while the cop is trying to move and not already
    // reversing — a cop holding position beside the player is not stuck.
    if (car.reverseT <= 0 && throttle && Math.abs(car.speed) < 25) car.stuck += dt; else car.stuck = 0;
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
      p.walkPhase += 260 * dt;
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
    p.walkPhase += p.speed * dt;
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

/* The marker the game points at right now: the drop pad while carrying,
   otherwise the current mission point (a crate while a haul job needs one). */
function activeMarker() {
  const c = activeChar();
  if (c.carrying) return { x: DROP_PAD.x, y: DROP_PAD.y, kind: 'drop' };
  const m = currentMission();
  if (m.cargo) {
    const cr = nearestCrate(c.x, c.y, 1e9);
    if (cr) return { x: cr.x, y: cr.y, kind: 'crate' };
    // All crates busy — point at the first spot; one respawns within 20s.
    return { x: CRATE_SPOTS[0].x, y: CRATE_SPOTS[0].y, kind: 'crate' };
  }
  return { x: m.x, y: m.y, kind: 'mission' };
}

function updateMissions() {
  const c = activeChar();
  const m = currentMission();
  if (m.cargo && !c.carrying) return; // haul jobs complete on delivery, not on arrival
  if (dist(c.x, c.y, m.x, m.y) < MISSION_RADIUS) {
    save.cash += m.pay;
    save.completed += 1;
    if (m.scripted) save.missionIndex += 1; else randomJobState = randomJob();
    const nm = currentMission();
    toast('Mission complete! +' + fmtCash(m.pay) + '  •  Next: ' + nm.text, 3600);
    showDialogue(pickLine(LINES.mission), c.key);
    updateHUD(); writeSave();
  }
}

function updateCrates(dt) {
  const c = activeChar();
  for (const cr of crates) {
    if (!cr.available && !cr.respawnT) continue; // carried
    if (cr.respawnT > 0) {
      cr.respawnT -= dt;
      if (cr.respawnT <= 0) { cr.available = true; cr.respawnT = 0; }
    }
  }
  if (c.carrying && dist(c.x, c.y, DROP_PAD.x, DROP_PAD.y) < MISSION_RADIUS) {
    deliverCrate(c);
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

function updateHealth(dt) {
  if (G.health < MAX_HEALTH && G.elapsed - G.lastDamageT > 5) {
    G.health = Math.min(MAX_HEALTH, G.health + 3 * dt);
  }
}

function update(dt) {
  G.elapsed += dt;
  G.clock += dt; // 1 game minute per real second
  G.hitCooldown = Math.max(0, G.hitCooldown - dt);
  G.crashCooldown = Math.max(0, G.crashCooldown - dt);
  G.punchCooldown = Math.max(0, G.punchCooldown - dt);
  G.hornTimer = Math.max(0, G.hornTimer - dt);
  G.shake = Math.max(0, G.shake - dt * 14);
  updatePlayer(dt);
  updatePartner(dt);
  updateTraffic(dt);
  updatePolice(dt);
  updatePeds(dt);
  updateWanted(dt);
  updateMissions();
  updateCrates(dt);
  updateBusted(dt);
  updateHealth(dt);
  if (G.elapsed - G.lastSave > 10) { G.lastSave = G.elapsed; writeSave(); }
  updateHUD();
}

/* ================= 3D: renderer, lights, city ================= */
let scene, camera, renderer, clock3;
let carGroup, pedGroup, crateGroup;
let missionRing, missionBeam, missionDiamond, waypointBeam, waypointRing, dropRing, dropBeam;
let playerRing, headlight, waterTex;
let snapCamera = true;
const view = { w: 0, h: 0, dpr: 1 };

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/* Facade texture: dark face with a grid of windows; a matching emissive
   map carries only the lit windows so they glow at night. */
function makeFacadeTextures() {
  const W = 128, H = 256, cols = 6, rows = 12;
  const wins = [];
  const wr = mulberry32(4242);
  const litColors = ['#ffd76a', '#ffd76a', '#9fd8ff', '#ff9d5c', '#b8ff9d'];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = wr() < 0.42;
      wins.push({ r, c, lit, color: lit ? litColors[Math.floor(wr() * litColors.length)] : '#0a0e14' });
    }
  }
  const mapC = makeCanvas(W, H), mapX = mapC.getContext('2d');
  mapX.fillStyle = '#12161f'; mapX.fillRect(0, 0, W, H);
  const emC = makeCanvas(W, H), emX = emC.getContext('2d');
  emX.fillStyle = '#000000'; emX.fillRect(0, 0, W, H);
  const cw = W / cols, ch = H / rows;
  for (const w of wins) {
    const x = w.c * cw + 3, y = w.r * ch + 4, ww = cw - 6, hh = ch - 8;
    mapX.fillStyle = w.color; mapX.fillRect(x, y, ww, hh);
    if (w.lit) { emX.fillStyle = w.color; emX.fillRect(x, y, ww, hh); }
  }
  const map = new THREE.CanvasTexture(mapC);
  const emissiveMap = new THREE.CanvasTexture(emC);
  map.encoding = THREE.sRGBEncoding;
  return { map, emissiveMap };
}

function makeWaterTexture() {
  const c = makeCanvas(256, 64), x = c.getContext('2d');
  x.fillStyle = '#0d2f4d'; x.fillRect(0, 0, 256, 64);
  const wr = mulberry32(99);
  for (let i = 0; i < 40; i++) {
    x.strokeStyle = 'rgba(140,200,255,' + (0.12 + wr() * 0.25) + ')';
    x.lineWidth = 1 + wr() * 1.5;
    const y = wr() * 64, sx = wr() * 256;
    x.beginPath(); x.moveTo(sx, y); x.lineTo(sx + 20 + wr() * 40, y); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.repeat.set(10, 1);
  return t;
}

function makeLabelTexture(text, color) {
  const c = makeCanvas(256, 64), x = c.getContext('2d');
  x.font = '900 40px Arial, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 8; x.strokeStyle = 'rgba(0,0,0,0.85)';
  x.strokeText(text, 128, 34);
  x.fillStyle = color;
  x.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding;
  return t;
}

function makeNeonSignTexture(text, color) {
  const c = makeCanvas(512, 128), x = c.getContext('2d');
  x.clearRect(0, 0, 512, 128);
  x.font = '900 84px Arial, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = color; x.shadowBlur = 34;
  x.fillStyle = color;
  x.fillText(text, 256, 66);
  x.shadowBlur = 12;
  x.fillStyle = '#ffffff';
  x.font = '900 80px Arial, sans-serif';
  x.fillText(text, 256, 66);
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding;
  return t;
}

function buildCity3D() {
  const { map: facadeMap, emissiveMap: facadeEmissive } = makeFacadeTextures();

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.w * S, WORLD.h * S),
    new THREE.MeshLambertMaterial({ color: 0x0e1118 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(WORLD.w * S / 2, 0, WORLD.h * S / 2);
  scene.add(ground);

  // Water (animated streak texture) + promenade.
  waterTex = makeWaterTexture();
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.w * S, (WORLD.h - WATER_Y) * S),
    new THREE.MeshLambertMaterial({ map: waterTex, color: 0x9fc8e8, emissive: 0x0a2438, emissiveIntensity: 0.6 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(WORLD.w * S / 2, 0.01, (WATER_Y + (WORLD.h - WATER_Y) / 2) * S);
  scene.add(water);
  const prom = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.w * S, (WATER_Y - 2300) * S),
    new THREE.MeshLambertMaterial({ color: 0x2a2620 })
  );
  prom.rotation.x = -Math.PI / 2;
  prom.position.set(WORLD.w * S / 2, 0.03, (2300 + (WATER_Y - 2300) / 2) * S);
  scene.add(prom);
  // Neon strip along the waterfront edge.
  const neon = new THREE.Mesh(
    new THREE.BoxGeometry(WORLD.w * S, 0.18, 0.18),
    new THREE.MeshBasicMaterial({ color: 0xff2d78 })
  );
  neon.position.set(WORLD.w * S / 2, 0.35, 2300 * S);
  scene.add(neon);

  // Roads.
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x15181f });
  for (const x of V_ROADS) {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W * S, WATER_Y * S), roadMat);
    r.rotation.x = -Math.PI / 2;
    r.position.set(wx(x), 0.02, WATER_Y * S / 2);
    scene.add(r);
  }
  for (const y of H_ROADS) {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.w * S, ROAD_W * S), roadMat);
    r.rotation.x = -Math.PI / 2;
    r.position.set(WORLD.w * S / 2, 0.02, wz(y));
    scene.add(r);
  }

  // Blocks: sidewalk slabs + park.
  const walkMat = new THREE.MeshLambertMaterial({ color: 0x1d212b });
  const parkMat = new THREE.MeshLambertMaterial({ color: 0x14301a });
  for (const b of blocks) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(b.w * S, b.h * S), b.park ? parkMat : walkMat);
    p.rotation.x = -Math.PI / 2;
    p.position.set(wx(b.x + b.w / 2), 0.03, wz(b.y + b.h / 2));
    scene.add(p);
  }

  // Lane dashes (one instanced mesh).
  const dashGeo = new THREE.PlaneGeometry(0.35, 2.2);
  dashGeo.rotateX(-Math.PI / 2);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8b93a });
  const dashSpots = [];
  for (const x of V_ROADS) for (let y = 22; y < WATER_Y; y += 44) dashSpots.push({ x, y, rot: 0 });
  for (const y of H_ROADS) for (let x = 22; x < WORLD.w; x += 44) dashSpots.push({ x, y, rot: Math.PI / 2 });
  const dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashSpots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eul = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
  dashSpots.forEach((d, i) => {
    eul.set(0, d.rot, 0); q.setFromEuler(eul);
    pv.set(wx(d.x), 0.05, wz(d.y));
    m4.compose(pv, q, sc);
    dashes.setMatrixAt(i, m4);
  });
  dashes.instanceMatrix.needsUpdate = true;
  scene.add(dashes);

  // Buildings (one instanced mesh; heights deterministic, stored for the camera).
  const hr = mulberry32(31337);
  const bGeo = new THREE.BoxGeometry(1, 1, 1);
  bGeo.translate(0, 0.5, 0);
  const bMat = new THREE.MeshLambertMaterial({ map: facadeMap, emissive: 0xffffff, emissiveMap: facadeEmissive, emissiveIntensity: 0.85 });
  const bInst = new THREE.InstancedMesh(bGeo, bMat, buildings.length);
  const col = new THREE.Color();
  buildings.forEach((b, i) => {
    b.h3 = hr() < 0.12 ? 34 + hr() * 22 : 8 + hr() * 20; // a few towers
    eul.set(0, 0, 0); q.setFromEuler(eul);
    pv.set(wx(b.x + b.w / 2), 0.03, wz(b.y + b.h / 2));
    sc.set(b.w * S, b.h3, b.h * S);
    m4.compose(pv, q, sc);
    bInst.setMatrixAt(i, m4);
    col.set(b.color).multiplyScalar(0.5);
    bInst.setColorAt(i, col);
  });
  bInst.instanceMatrix.needsUpdate = true;
  if (bInst.instanceColor) bInst.instanceColor.needsUpdate = true;
  scene.add(bInst);

  // Park trees (instanced trunks + foliage).
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1.4, 5);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3421 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, parkTrees.length);
  const folGeo = new THREE.SphereGeometry(1, 7, 6);
  const folMat = new THREE.MeshLambertMaterial({ color: 0x1d4a24 });
  const fols = new THREE.InstancedMesh(folGeo, folMat, parkTrees.length);
  parkTrees.forEach((t, i) => {
    const s = t.r * S * 1.15;
    eul.set(0, 0, 0); q.setFromEuler(eul);
    pv.set(wx(t.x), 0.7, wz(t.y)); sc.set(1, 1, 1);
    m4.compose(pv, q, sc); trunks.setMatrixAt(i, m4);
    pv.set(wx(t.x), 1.4 + s * 0.8, wz(t.y)); sc.set(s, s, s);
    m4.compose(pv, q, sc); fols.setMatrixAt(i, m4);
  });
  trunks.instanceMatrix.needsUpdate = true;
  fols.instanceMatrix.needsUpdate = true;
  scene.add(trunks); scene.add(fols);

  // Streetlights (instanced poles + glowing heads).
  const lightSpots = [];
  for (const x of V_ROADS) for (let y = 150; y < WATER_Y; y += 300) lightSpots.push({ x: x + ((y / 300) % 2 < 1 ? 72 : -72), y });
  for (const y of H_ROADS) for (let x = 150; x < WORLD.w; x += 300) lightSpots.push({ x, y: y + ((x / 300) % 2 < 1 ? 72 : -72) });
  const poleGeo = new THREE.CylinderGeometry(0.1, 0.14, 6.5, 5);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2a2f3a });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lightSpots.length);
  const headGeo = new THREE.SphereGeometry(0.34, 8, 6);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffd76a });
  const heads = new THREE.InstancedMesh(headGeo, headMat, lightSpots.length);
  lightSpots.forEach((p, i) => {
    eul.set(0, 0, 0); q.setFromEuler(eul);
    pv.set(wx(p.x), 3.25, wz(p.y)); sc.set(1, 1, 1);
    m4.compose(pv, q, sc); poles.setMatrixAt(i, m4);
    pv.set(wx(p.x), 6.6, wz(p.y));
    m4.compose(pv, q, sc); heads.setMatrixAt(i, m4);
  });
  poles.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  scene.add(poles); scene.add(heads);

  // Stars + moon.
  const starCount = 420, starPos = new Float32Array(starCount * 3);
  const sr = mulberry32(555);
  for (let i = 0; i < starCount; i++) {
    const a = sr() * Math.PI * 2, el = 0.12 + sr() * 1.2, r = 380;
    starPos[i * 3] = Math.cos(a) * Math.cos(el) * r + WORLD.w * S / 2;
    starPos[i * 3 + 1] = Math.sin(el) * r;
    starPos[i * 3 + 2] = Math.sin(a) * Math.cos(el) * r + WORLD.h * S / 2;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xafc4e8, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.85, fog: false }));
  scene.add(stars);
  const moon = new THREE.Mesh(new THREE.CircleGeometry(14, 24), new THREE.MeshBasicMaterial({ color: 0xdfe6f2, fog: false }));
  moon.position.set(-120, 170, -180);
  moon.lookAt(WORLD.w * S / 2, 0, WORLD.h * S / 2);
  scene.add(moon);

  // Freestanding neon CASINO sign by the Casino Lot.
  const signTex = makeNeonSignTexture('CASINO', '#ff2d78');
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(13, 3.2),
    new THREE.MeshBasicMaterial({ map: signTex, transparent: true, side: THREE.DoubleSide, fog: false })
  );
  sign.position.set(wx(2400), 7.5, wz(800));
  scene.add(sign);
  const postMat = new THREE.MeshLambertMaterial({ color: 0x2a2f3a });
  for (const dx of [-5.5, 5.5]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 7.5, 6), postMat);
    post.position.set(wx(2400) + dx, 3.75, wz(800));
    scene.add(post);
  }

  // Mission marker: gold ring + rotating diamond + light beam.
  missionRing = new THREE.Mesh(
    new THREE.RingGeometry(2.6, 3.4, 40),
    new THREE.MeshBasicMaterial({ color: 0xf5c518, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  missionRing.rotation.x = -Math.PI / 2;
  missionRing.position.y = 0.12;
  scene.add(missionRing);
  missionDiamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.1),
    new THREE.MeshBasicMaterial({ color: 0xf5c518 })
  );
  missionDiamond.position.y = 3.2;
  scene.add(missionDiamond);
  missionBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.9, 30, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xf5c518, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  missionBeam.position.y = 15;
  scene.add(missionBeam);

  // Waypoint pin: cyan ring + beam.
  waypointRing = new THREE.Mesh(
    new THREE.RingGeometry(2.0, 2.6, 32),
    new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  waypointRing.rotation.x = -Math.PI / 2;
  waypointRing.position.y = 0.12;
  waypointRing.visible = false;
  scene.add(waypointRing);
  waypointBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.7, 26, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  waypointBeam.position.y = 13;
  waypointBeam.visible = false;
  scene.add(waypointBeam);

  // Drop pad: green ring + beam.
  dropRing = new THREE.Mesh(
    new THREE.RingGeometry(2.6, 3.4, 40),
    new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  dropRing.rotation.x = -Math.PI / 2;
  dropRing.position.set(wx(DROP_PAD.x), 0.12, wz(DROP_PAD.y));
  scene.add(dropRing);
  dropBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.9, 26, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  dropBeam.position.set(wx(DROP_PAD.x), 13, wz(DROP_PAD.y));
  scene.add(dropBeam);

  // White ring under the car the player is driving.
  playerRing = new THREE.Mesh(
    new THREE.RingGeometry(3.2, 3.6, 40),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
  );
  playerRing.rotation.x = -Math.PI / 2;
  playerRing.position.y = 0.1;
  playerRing.visible = false;
  scene.add(playerRing);

  // Headlight spotlight for the player's car.
  headlight = new THREE.SpotLight(0xfff2c0, 1.4, 55, 0.62, 0.6, 1.1);
  headlight.visible = false;
  scene.add(headlight);
  scene.add(headlight.target);
}

function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070f);
  scene.fog = new THREE.Fog(0x070b16, 55, 235);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 700);
  camera.position.set(160, 60, 220);

  renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;

  scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x1a1410, 0.6));
  const moonLight = new THREE.DirectionalLight(0xbcd0ff, 0.75);
  moonLight.position.set(-80, 140, -60);
  scene.add(moonLight);

  carGroup = new THREE.Group(); scene.add(carGroup);
  pedGroup = new THREE.Group(); scene.add(pedGroup);
  crateGroup = new THREE.Group(); scene.add(crateGroup);

  buildCity3D();
}

/* ================= 3D: figures, cars, peds, crates ================= */
function clearGroup(gr) { while (gr.children.length) gr.remove(gr.children[0]); }

/* Low-poly blocky figure. The face photo is a texture on the FRONT (+Z)
   face of the head box only — sides/back/top are plain skin/hair colours,
   so there is no floating box and no texture on the wrong faces. */
function buildCharMesh(key) {
  const cfg = CHARACTERS[key];
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: cfg.color });
  const accentMat = new THREE.MeshLambertMaterial({ color: cfg.accent });
  const pantsMat = new THREE.MeshLambertMaterial({ color: 0x17191f });
  const skinMat = new THREE.MeshLambertMaterial({ color: cfg.skin });
  const hairMat = new THREE.MeshLambertMaterial({ color: cfg.hair });
  const faceTex = new THREE.TextureLoader().load(cfg.face);
  faceTex.encoding = THREE.sRGBEncoding;
  const faceMat = new THREE.MeshLambertMaterial({ map: faceTex });

  const legGeo = new THREE.BoxGeometry(0.28, 0.8, 0.32);
  legGeo.translate(0, -0.4, 0);
  const legL = new THREE.Mesh(legGeo, pantsMat); legL.position.set(-0.17, 0.82, 0);
  const legR = new THREE.Mesh(legGeo, pantsMat); legR.position.set(0.17, 0.82, 0);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.75, 0.45), bodyMat);
  torso.position.y = 1.2;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.87, 0.14, 0.47), accentMat);
  stripe.position.y = 1.02;

  const armGeo = new THREE.BoxGeometry(0.24, 0.72, 0.28);
  armGeo.translate(0, -0.33, 0);
  const armL = new THREE.Mesh(armGeo, bodyMat); armL.position.set(-0.57, 1.52, 0);
  const armR = new THREE.Mesh(armGeo, bodyMat); armR.position.set(0.57, 1.52, 0);

  // BoxGeometry material order: +x, -x, +y, -y, +z, -z — face on +z (index 4).
  const headMats = [skinMat, skinMat, hairMat, skinMat, faceMat, hairMat];
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.56, 0.56), headMats);
  head.position.y = 1.86;

  const label = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeLabelTexture(cfg.name, cfg.label), transparent: true, depthWrite: false
  }));
  label.scale.set(3.4, 0.85, 1);
  label.position.y = 2.95;

  const carry = new THREE.Group();
  carry.position.y = 2.62;

  g.add(legL, legR, torso, stripe, armL, armR, head, label, carry);
  g.scale.setScalar(0.92);
  scene.add(g);
  return { group: g, legL, legR, armL, armR, head, label, carry };
}

function buildCarMesh(car) {
  const g = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color: car.color });
  const glass = new THREE.MeshLambertMaterial({ color: 0x0e1420 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x0a0c10 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.75, 4.6), paint);
  body.position.y = 0.55;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, 2.2), glass);
  cabin.position.set(0, 1.2, -0.25);
  const axF = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.62), dark);
  axF.position.set(0, 0.28, 1.5);
  const axR = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.62), dark);
  axR.position.set(0, 0.28, -1.5);
  g.add(body, cabin, axF, axR);
  const hlMat = new THREE.MeshBasicMaterial({ color: 0xfff6c0 });
  const tlMat = new THREE.MeshBasicMaterial({ color: 0xff2d2d });
  for (const sx of [-0.8, 0.8]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.08), hlMat);
    hl.position.set(sx, 0.62, 2.31);
    g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), tlMat);
    tl.position.set(sx, 0.62, -2.31);
    g.add(tl);
  }
  if (car.type === 'police') {
    const barGeo = new THREE.BoxGeometry(0.55, 0.2, 0.34);
    car.barL = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: 0xff2d2d }));
    car.barL.position.set(-0.35, 1.62, -0.25);
    car.barR = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: 0x2d5bff }));
    car.barR.position.set(0.35, 1.62, -0.25);
    g.add(car.barL, car.barR);
  }
  carGroup.add(g);
  car.mesh = g;
  return g;
}
function clearCarMeshes() { clearGroup(carGroup); }
function buildCarMeshes() { for (const car of cars) buildCarMesh(car); }

function buildPedMesh(p) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.4), new THREE.MeshLambertMaterial({ color: p.color }));
  torso.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), new THREE.MeshLambertMaterial({ color: 0xe8b98a }));
  head.position.y = 1.68;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.62, 0.36), new THREE.MeshLambertMaterial({ color: 0x17191f }));
  legs.position.y = 0.33;
  body.add(torso, head, legs);
  g.add(body);
  pedGroup.add(g);
  p.mesh = g; p.body = body;
  return g;
}
function buildPedMeshes() {
  clearGroup(pedGroup);
  for (const p of peds) buildPedMesh(p);
}

function buildCrateMesh(cr) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.95, 0.95),
    new THREE.MeshLambertMaterial({ color: 0xb45309, emissive: 0x2a1200 })
  );
  box.position.y = 0.48;
  const edges = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 1.0, 1.0),
    new THREE.MeshBasicMaterial({ color: 0xffb020, wireframe: true, transparent: true, opacity: 0.65 })
  );
  edges.position.y = 0.48;
  g.add(box, edges);
  g.position.set(wx(cr.x), 0, wz(cr.y));
  crateGroup.add(g);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.25, 28),
    new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(wx(cr.x), 0.08, wz(cr.y));
  crateGroup.add(ring);
  cr.mesh = g; cr.ring = ring;
  return g;
}
function buildCrateMeshes() {
  clearGroup(crateGroup);
  for (const cr of crates) buildCrateMesh(cr);
}

/* ================= 3D sync + camera ================= */
function sync3D(dt) {
  // Characters: position, facing, walk/punch animation.
  for (const k of CHAR_KEYS) {
    const c = chars[k];
    const p = c.parts;
    if (!p) continue;
    const g = p.group;
    g.visible = !c.inCar;
    if (!g.visible) continue;
    g.position.set(wx(c.x), 0, wz(c.y));
    g.rotation.y = yawOf(c.angle);
    // Lift the name label above a carried crate so the crate never covers it.
    p.label.position.y = c.carrying ? 3.75 : 2.95;
    c._amp = c._amp || 0;
    const targetAmp = c.speed > 5 ? 0.55 : 0;
    c._amp += (targetAmp - c._amp) * Math.min(1, 10 * dt);
    const sw = Math.sin(c.walkPhase * 0.09) * c._amp;
    p.legL.rotation.x = sw;
    p.legR.rotation.x = -sw;
    p.armL.rotation.x = -sw * 0.8;
    p.armR.rotation.x = sw * 0.8;
    if (c.punchT > 0) {
      const prog = 1 - c.punchT / 0.35;
      p.armR.rotation.x = -2.1 * Math.sin(prog * Math.PI);
    }
  }
  // Cars: position, facing, police light flash.
  for (const car of cars) {
    if (!car.mesh) continue;
    car.mesh.position.set(wx(car.x), 0, wz(car.y));
    car.mesh.rotation.y = yawOf(car.angle);
    if (car.barL) {
      const f = Math.floor(G.elapsed * 6) % 2 === 0;
      car.barL.material.color.setHex(f ? 0xff2d2d : 0x2d5bff);
      car.barR.material.color.setHex(f ? 0x2d5bff : 0xff2d2d);
    }
  }
  // Player car ring + headlight spotlight.
  const ac = activeChar();
  if (ac.inCar) {
    playerRing.visible = true;
    playerRing.position.set(wx(ac.inCar.x), 0.1, wz(ac.inCar.y));
    headlight.visible = true;
    headlight.position.set(wx(ac.inCar.x), 1.4, wz(ac.inCar.y));
    headlight.target.position.set(
      wx(ac.inCar.x) + Math.cos(ac.inCar.angle) * 18, 0,
      wz(ac.inCar.y) + Math.sin(ac.inCar.angle) * 18
    );
  } else {
    playerRing.visible = false;
    headlight.visible = false;
  }
  // Pedestrians: position, facing, bob, lie-down when knocked out.
  for (const p of peds) {
    if (!p.mesh) continue;
    p.mesh.position.set(wx(p.x), 0, wz(p.y));
    p.mesh.rotation.y = yawOf(p.angle);
    p._lie = p._lie || 0;
    const lieTarget = p.state === 'down' ? 1 : 0;
    p._lie += (lieTarget - p._lie) * Math.min(1, 12 * dt);
    p.body.rotation.z = p._lie * Math.PI / 2;
    p.body.position.y = p._lie * 0.42;
    p.body.rotation.x = p.state === 'dive' ? -0.5 : 0;
    if (p.state === 'walk') p.mesh.position.y = Math.abs(Math.sin(p.walkPhase * 0.09)) * 0.06;
  }
  // Crates: on the ground, carried above a head, or hidden while respawning.
  for (const cr of crates) {
    if (!cr.mesh) continue;
    let carrier = null;
    for (const k of CHAR_KEYS) if (chars[k].carrying === cr) carrier = chars[k];
    if (carrier) {
      if (cr.mesh.parent !== carrier.parts.carry) {
        carrier.parts.carry.add(cr.mesh);
        cr.mesh.position.set(0, 0, 0);
        cr.mesh.rotation.set(0, 0, 0);
      }
      cr.mesh.visible = !carrier.inCar;
      cr.ring.visible = false;
    } else if (cr.available) {
      if (cr.mesh.parent !== crateGroup) {
        crateGroup.add(cr.mesh);
        cr.mesh.position.set(wx(cr.x), 0, wz(cr.y));
        cr.mesh.rotation.set(0, 0, 0);
      }
      cr.mesh.visible = true;
      cr.ring.visible = true;
      const pulse = 1 + Math.sin(G.elapsed * 4 + cr.spot) * 0.14;
      cr.ring.scale.set(pulse, pulse, 1);
    } else {
      cr.mesh.visible = false;
      cr.ring.visible = false;
    }
  }
  // Markers.
  const mk = activeMarker();
  if (mk.kind === 'drop') {
    missionRing.visible = missionBeam.visible = missionDiamond.visible = false;
  } else {
    missionRing.visible = missionBeam.visible = missionDiamond.visible = true;
    const colHex = mk.kind === 'crate' ? 0xff9d2e : 0xf5c518;
    missionRing.material.color.setHex(colHex);
    missionBeam.material.color.setHex(colHex);
    missionDiamond.material.color.setHex(colHex);
    missionRing.position.set(wx(mk.x), 0.12, wz(mk.y));
    missionBeam.position.set(wx(mk.x), 15, wz(mk.y));
    missionDiamond.position.set(wx(mk.x), 3.2 + Math.sin(G.elapsed * 2) * 0.3, wz(mk.y));
    missionDiamond.rotation.y += dt * 2;
    const pulse = 1 + Math.sin(G.elapsed * 4) * 0.13;
    missionRing.scale.set(pulse, pulse, 1);
  }
  if (G.waypoint) {
    waypointRing.visible = waypointBeam.visible = true;
    waypointRing.position.set(wx(G.waypoint.x), 0.12, wz(G.waypoint.y));
    waypointBeam.position.set(wx(G.waypoint.x), 13, wz(G.waypoint.y));
  } else {
    waypointRing.visible = waypointBeam.visible = false;
  }
  const dp = 1 + Math.sin(G.elapsed * 3) * 0.08;
  dropRing.scale.set(dp, dp, 1);
  if (waterTex) waterTex.offset.x = (G.elapsed * 0.02) % 1;
}

function updateCamera3D(dt) {
  if (!G.started) {
    // Slow orbit around the city centre behind the start screen.
    G.orbitA += dt * 0.045;
    const cx = WORLD.w * S / 2, cz = WORLD.h * S / 2;
    camera.position.set(cx + Math.cos(G.orbitA) * 135, 62, cz + Math.sin(G.orbitA) * 135);
    camera.lookAt(cx, 0, cz);
    return;
  }
  const c = activeChar();
  const px = wx(c.x), pz = wz(c.y);
  // Orbit offsets drift back to zero a few seconds after the last drag.
  if (!camDrag.active && G.elapsed - G.lastDragT > 2.5) {
    G.camYawOff += (0 - G.camYawOff) * Math.min(1, 1.6 * dt);
    G.camPitchOff += (0 - G.camPitchOff) * Math.min(1, 1.6 * dt);
  }
  const driving = !!c.inCar;
  const dist3 = driving ? 18 : 14;
  const height = driving ? 10 : 8.5;
  // Camera sits behind the player's facing, rotated by the orbit offset.
  const back = c.angle + Math.PI + G.camYawOff;
  let tx = px + Math.cos(back) * dist3;
  let tz = pz + Math.sin(back) * dist3;
  let ty = height + G.camPitchOff * 14;
  // Pull the camera in if a building blocks the line of sight to the player:
  // sample the player->camera segment and stop just before the first wall.
  for (let i = 1; i <= 14; i++) {
    const t = i / 14;
    const sx = c.x + (tx / S - c.x) * t, sz = c.y + (tz / S - c.y) * t;
    if (buildingAt(sx, sz)) {
      const t2 = Math.max(0.06, (i - 1) / 14);
      tx = wx(c.x + (tx / S - c.x) * t2);
      tz = wz(c.y + (tz / S - c.y) * t2);
      break;
    }
  }
  // Lift the camera out of any building it would sit inside.
  const b = buildingAt(tx / S, tz / S);
  if (b && b.h3) ty = Math.max(ty, b.h3 + 4);
  ty = clamp(ty, 2.5, 70);
  const txc = clamp(tx, 4, WORLD.w * S - 4), tzc = clamp(tz, 4, WORLD.h * S - 4);
  // Snap (don't lerp) after a big jump — respawn, swap, or a long flight —
  // so the camera never travels through buildings to reach the player.
  const camD2 = (camera.position.x - txc) ** 2 + (camera.position.z - tzc) ** 2;
  if (snapCamera || camD2 > 50 * 50) {
    camera.position.set(txc, ty, tzc);
    snapCamera = false;
  } else {
    const k = 1 - Math.exp(-6 * dt);
    camera.position.x += (txc - camera.position.x) * k;
    camera.position.y += (ty - camera.position.y) * k;
    camera.position.z += (tzc - camera.position.z) * k;
  }
  // Safety net: never leave the camera inside a building, even mid-lerp.
  const cb = buildingAt(camera.position.x / S, camera.position.z / S);
  if (cb && cb.h3 && camera.position.y < cb.h3 + 4) camera.position.y = cb.h3 + 4;
  // Look ahead of the player, with a shake offset.
  const lx = px + Math.cos(c.angle) * 5, lz = pz + Math.sin(c.angle) * 5;
  const shx = G.shake ? (Math.random() - 0.5) * G.shake * 0.12 : 0;
  const shy = G.shake ? (Math.random() - 0.5) * G.shake * 0.08 : 0;
  camera.lookAt(lx + shx, 1.6 + shy, lz);
}

/* Off-screen edge arrows (HTML): point toward the mission marker / waypoint. */
const _proj = new THREE.Vector3();
function updateEdgeArrow(el, tx2, ty2) {
  _proj.set(wx(tx2), 1, wz(ty2)).project(camera);
  let sx = (_proj.x * 0.5 + 0.5) * view.w;
  let sy = (-_proj.y * 0.5 + 0.5) * view.h;
  const behind = _proj.z > 1;
  if (behind) { sx = view.w - sx; sy = view.h - sy; }
  const m = 56;
  const inside = !behind && sx > m && sx < view.w - m && sy > m + 40 && sy < view.h - m;
  if (inside) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const ax = clamp(sx, m, view.w - m), ay = clamp(sy, m + 40, view.h - m);
  const ang = Math.atan2(sy - view.h / 2, sx - view.w / 2);
  el.style.transform = 'translate(' + (ax - 18) + 'px,' + (ay - 18) + 'px) rotate(' + ang + 'rad)';
}
function updateEdgeArrows() {
  const show = G.started && !G.paused && !G.busted && !G.wasted && !G.mapOpen;
  if (!show) {
    $('arrow-mission').classList.add('hidden');
    $('arrow-pin').classList.add('hidden');
    return;
  }
  const mk = activeMarker();
  updateEdgeArrow($('arrow-mission'), mk.x, mk.y);
  if (G.waypoint) updateEdgeArrow($('arrow-pin'), G.waypoint.x, G.waypoint.y);
  else $('arrow-pin').classList.add('hidden');
}

/* ================= minimap + full map (2D canvases) ================= */
const mmap = $('minimap'), mctx = mmap.getContext('2d');
const fmap = $('fullmap'), fctx = fmap.getContext('2d');
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
  // Drop pad.
  mc.strokeStyle = '#22c55e';
  mc.lineWidth = 2;
  mc.beginPath(); mc.arc(DROP_PAD.x * sx, DROP_PAD.y * sy, 5, 0, Math.PI * 2); mc.stroke();
  // Available crates.
  mc.fillStyle = '#ff9d2e';
  for (const cr of crates) {
    if (!cr.available) continue;
    mc.fillRect(cr.x * sx - 2.5, cr.y * sy - 2.5, 5, 5);
  }
  // Mission / active marker.
  const mk = activeMarker();
  const pulse = 3 + Math.sin(G.elapsed * 5) * 1.5;
  mc.fillStyle = mk.kind === 'drop' ? '#22c55e' : mk.kind === 'crate' ? '#ff9d2e' : '#f5c518';
  mc.beginPath(); mc.arc(mk.x * sx, mk.y * sy, pulse + 2, 0, Math.PI * 2); mc.fill();
  // Waypoint pin.
  if (G.waypoint) {
    mc.save();
    mc.translate(G.waypoint.x * sx, G.waypoint.y * sy);
    mc.rotate(Math.PI / 4);
    mc.fillStyle = '#22d3ee';
    mc.fillRect(-4, -4, 8, 8);
    mc.restore();
  }
  for (const car of cars) {
    mc.fillStyle = car.type === 'police' ? '#3b82f6' : '#9aa3ad';
    mc.fillRect(car.x * sx - 1.5, car.y * sy - 1.5, 3, 3);
  }
  const other = otherChar();
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
  let objText, subText;
  if (c.carrying) {
    const d = Math.round(dist(c.x, c.y, DROP_PAD.x, DROP_PAD.y) / 10);
    objText = '📦 Deliver the crate to the drop pad  (' + d + 'm)';
    subText = 'Missions: ' + save.completed + '  •  Crate pay $200' + (m.cargo ? ' (job)' : '');
  } else if (m.cargo) {
    const cr = nearestCrate(c.x, c.y, 1e9);
    const d = cr ? Math.round(dist(c.x, c.y, cr.x, cr.y) / 10) : 0;
    objText = '📦 Haul job: grab a glowing crate  (' + d + 'm)';
    subText = 'Missions: ' + save.completed + '  •  Job pay $' + m.pay;
  } else {
    const d = Math.round(dist(c.x, c.y, m.x, m.y) / 10);
    objText = '📍 ' + m.text + '  (' + d + 'm)';
    subText = 'Missions: ' + save.completed + '  •  Next pay $' + m.pay;
  }
  if (G.waypoint) {
    const wd = Math.round(dist(c.x, c.y, G.waypoint.x, G.waypoint.y) / 10);
    subText += '  •  📌 ' + wd + 'm';
  }
  setText('hud-objective', objText);
  setText('hud-sub', subText);
  setText('hud-stars', '★'.repeat(G.stars) + '☆'.repeat(5 - G.stars));
  const hh = String(Math.floor(G.clock / 60) % 24).padStart(2, '0');
  const mm = String(Math.floor(G.clock % 60)).padStart(2, '0');
  setText('hud-clock', hh + ':' + mm);
  if (c.inCar) setText('hud-speed', Math.round(Math.abs(c.inCar.speed) * 0.22) + ' mph');
  const hf = $('health-fill');
  hf.style.width = Math.max(0, Math.round(G.health)) + '%';
  hf.style.background = G.health > 50 ? '#7ee787' : G.health > 25 ? '#f5c518' : '#e5484d';
  // Warn as soon as a cop is closing in — not only once the bust countdown runs.
  let copNear = G.bustedTimer > 0;
  if (!copNear) {
    for (const car of cars) {
      if (car.type === 'police' && dist(c.x, c.y, car.x, car.y) < 300) { copNear = true; break; }
    }
  }
  $('cop-warning').classList.toggle('hidden', !(copNear && !G.busted));
}

/* ================= main loop + init ================= */
function resize() {
  view.dpr = Math.min(2, window.devicePixelRatio || 1);
  view.w = window.innerWidth; view.h = window.innerHeight;
  if (renderer) {
    renderer.setPixelRatio(view.dpr);
    renderer.setSize(view.w, view.h);
  }
  if (camera) {
    camera.aspect = view.w / view.h;
    camera.updateProjectionMatrix();
  }
}
window.addEventListener('resize', resize);

let lastT = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;
  if (G.started && !G.paused && !G.busted && !G.wasted) {
    update(dt);
  } else if (!G.started) {
    // Living city behind the start screen.
    G.elapsed += dt;
    updateTraffic(dt);
    updatePeds(dt);
  }
  sync3D(dt);
  updateCamera3D(dt);
  renderer.render(scene, camera);
  updateEdgeArrows();
  if (G.mapOpen) drawFullMap();
  renderMinimap();
}

function init() {
  loadSave();
  for (const k of CHAR_KEYS) chars[k] = makeChar(k);
  resetEntities();
  G.lastSave = 0;
  try {
    initThree();
  } catch (err) {
    $('nogl').classList.remove('hidden');
    return;
  }
  for (const k of CHAR_KEYS) {
    const p = buildCharMesh(k);
    chars[k].mesh = p.group;
    chars[k].parts = p;
  }
  buildCarMeshes();
  buildPedMeshes();
  buildCrateMeshes();
  resize();
  initJoystick();
  initCameraDrag();
  initMapTaps();
  bindHoldButton('btn-sprint', 'sprint');
  bindHoldButton('btn-gas', 'gas');
  bindHoldButton('btn-brake', 'brake');
  bindTapButton('btn-action', doAction);
  bindTapButton('btn-exit', () => { const c = activeChar(); exitCar(c); });
  bindTapButton('btn-switch', switchCharacter);
  bindTapButton('btn-map', toggleMap);
  bindTapButton('btn-pause', () => togglePause());
  bindTapButton('btn-horn', doHorn);
  bindTapButton('btn-punch', doPunch);
  bindTapButton('btn-haul', doHaul);
  bindTapButton('btn-call', doCall);
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
  $('btn-wasted-ok').addEventListener('click', () => {
    G.wasted = false;
    $('wasted-screen').classList.add('hidden');
    toast('Patched up. Back on the streets.');
  });
  const tm = $('touch-mode');
  tm.value = save.touch || 'auto';
  tm.addEventListener('change', () => { save.touch = tm.value; writeSave(); applyTouchVisibility(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.started && !G.busted && !G.wasted) togglePause(true);
  });
  updateDriveMode();
  requestAnimationFrame(loop);
}
init();

/* Test/debug handle: live state for smoke tests (window.__jta). */
window.__jta = {
  G, chars, cars, peds, crates, renderer, camera, buildingAt,
  get save() { return save; },
  currentMission, activeMarker, damagePlayer, addWanted
};
