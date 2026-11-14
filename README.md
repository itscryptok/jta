# JTA — Two Lives. One City.

A free 3D open-city game (GTA-style) that runs entirely in the browser.
Vanilla HTML + CSS + JS with Three.js **vendored locally** — no build
step, no CDN, no external dependencies. It serves as-is from any static
host (deployed at https://jta-f3v3.onrender.com).

## Play

- **Nova** — half-cyborg, faster sprint. **Doc** — older man with glasses,
  better car handling. Pick one to start; switch anytime (Tab / SWITCH).
  Each keeps their own position in the city.
- Drive: walk up to any car and press **E** / **ACTION** to get in.
  **WASD** steers and drives, **Space** brakes. The player's car has a
  working headlight at night.
- Missions: follow the yellow marker. Complete 6 scripted missions, then
  random delivery jobs keep coming — some are **cargo hauls** (pick up a
  glowing crate with **G** / **HAUL**, carry it on your head, deliver it
  to the green drop pad). Cash and progress save in localStorage.
- **Punch** (**Space** on foot / **PUNCH**): knocks a nearby pedestrian
  down briefly; +1 wanted star.
- **Call partner** (**C** / **CALL**): the other character runs to you.
- Wanted stars (0–5): punching, hitting pedestrians, or crashing raises
  them; they decay when you drive clean. At 3+ stars police chase you —
  get caught standing still and you're BUSTED (lose 10% cash).
- **Health**: crashing at speed costs health; it regens slowly otherwise.
  At 0 HP you're WASTED (respawn, lose 10% cash).
- **Camera**: drag the city to orbit around the player; it auto-follows
  otherwise. The camera pulls in rather than clipping through buildings.
- **Waypoint**: tap the minimap (or the full map) to drop a waypoint pin;
  a cyan beam marks it and an arrow points the way.
- On phones: left virtual joystick to move/steer, right buttons to drive,
  punch, haul, call, switch, open the map, and pause. Force touch controls
  on/off from the pause menu.

## The 3D night city (v2)

The v1 top-down 2D renderer was replaced with a Three.js third-person
view: dark sky, stars and a moon, buildings with lit windows, streetlights,
neon signs, a waterfront, and a casino. The simulation still runs in the
same 2D world coordinates as v1 (3200×2400 units, scale 0.1 = 320×240 m);
the 3D layer is purely a presentation of that sim, so the whole game loop
(missions, wanted system, traffic, peds, save) carried over untouched.

Characters are low-poly blocky figures with a limb-swing walk; the face
photos are textures on the **front face of the head box only**
(`assets/nova-face.jpg`, `assets/doc-face.jpg` — already cropped, no meme
text). Floating name labels sit above each head (NOVA pink/red, DOC gold).

Performance: instanced meshes for buildings, dashes, streetlights and
trees; one hemisphere + one directional light, no shadows; pixel ratio
capped at 2. The start screen renders the live 3D city behind the menu.

## Run locally

```bash
cd jta
python3 -m http.server 8000
# open http://localhost:8000
```

## Files

| File | What it is |
| --- | --- |
| `index.html` | Page shell, HUD, touch controls, menus, SEO baseline |
| `style.css` | All styling, incl. mobile layout + safe-area insets |
| `game.js` | The whole game (world, entities, AI, physics, 3D rendering) |
| `vendor/three.min.js` | Three.js r147, vendored (UMD build, plain `<script>` tag) |
| `assets/` | Character portraits (prepared crops — do not replace with the original uploads) |
| `favicon.svg` | "JTA" badge icon |
| `sitemap.xml`, `robots.txt` | SEO |

## Rename the characters

Character names live in **one place**: the `CHARACTERS` config at the top
of `game.js`. Edit only the `name` / `fullName` fields there (one line
each) — the start screen, HUD, pause menu, and in-world name tags all read
from it. The names are provisional working names ("NOVA" / "DOC").

## Testing

Smoke-tested with Playwright against a local server (headless Chromium,
WebGL via SwiftShader): start screen with live 3D city behind the menu;
walk, punch, haul + deliver, enter/exit/drive, character swap, mission
payout, police chase + BUSTED, WASTED, waypoint pin, partner call, full
map, pause — desktop and emulated iPhone. `window.__jta` exposes live game
state for testing. Note: SwiftShader runs the game at ~1 fps at high
resolution, so the test uses a small viewport for the timed flows; real
devices with GPU acceleration run it at full speed.

## Deploy

Static site, publish directory = repo root, no build command. Any static
host works (Render, Netlify, GitHub Pages).
