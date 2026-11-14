# JTA — Two Lives. One City.

A free top-down 2D open-city game (GTA-style) that runs entirely in the
browser. Vanilla HTML + CSS + JS, no build step, no external dependencies —
it serves as-is from any static host (deployed at https://jta.onrender.com).

## Play

- **Nova** — half-cyborg, faster sprint. **Doc** — older man with glasses,
  better car handling. Pick one to start; switch anytime (Tab / SWITCH).
- Drive: walk up to any car and press **E** / **ACTION** to get in.
  **WASD** steers and drives, **Space** brakes.
- Missions: follow the yellow marker. Complete 6 scripted missions, then
  random delivery jobs keep coming. Cash and progress save in localStorage.
- Wanted stars (0–5): hitting pedestrians or crashing raises them; they
  decay when you drive clean. At 3+ stars police chase you — get caught
  standing still and you're BUSTED (lose 10% cash).
- On phones: left virtual joystick to move/steer, right buttons to drive,
  act, switch, open the map, and pause. Force touch controls on/off from
  the pause menu.

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
| `game.js` | The whole game (world, entities, AI, physics, rendering) |
| `assets/` | Character portraits (prepared crops — do not replace with the original uploads) |
| `favicon.svg` | "JTA" badge icon |
| `sitemap.xml`, `robots.txt` | SEO |

## Rename the characters

Character names live in **one place**: the `CHARACTERS` config at the top
of `game.js`. Edit only the `name` / `fullName` fields there (one line
each) — the start screen, HUD, pause menu, and in-world name tags all read
from it. The names are provisional working names ("NOVA" / "DOC").

## Deploy

Static site, publish directory = repo root, no build command. Any static
host works (Render, Netlify, GitHub Pages).
