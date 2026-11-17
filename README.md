# Harbor Vice

![make.fun gta6-01](https://make.fun/badge/gta6-01.svg)
![rank](https://make.fun/badge/gta6-01/arzyz/gta6-01-entry/rank.svg)
![reward](https://make.fun/badge/gta6-01/arzyz/gta6-01-entry/reward.svg)

**Harbor Vice** is an original top-down open-world crime game that plays start to
finish in a desktop browser from static files — no build step, no libraries, no
network requests. It is an entry in the make.fun bounty
[“Make GTA 6” (gta6-01)](https://make.fun/bounty/gta6-01).

## Welcome to Coral Bay

Coral Bay is a sun-soaked coastal city: a palm-lined beachfront promenade, the pastel
houses of Palm Heights, a Downtown of windowed towers, and the warehouses and quays
of the Portside Docks. You are **Marco Vale**, a wheelman new in town, and your work
comes from **Lena Ortiz**, the fixer who runs the Harborlight Garage.

- **A living city.** A full road grid with self-driving traffic that keeps to its
  lane, brakes for trouble, lights its brake lamps and honks when it's held up.
  Pedestrians stroll the sidewalks, pause at corners, and scatter from speeding
  cars, punches and gunfire. Beach umbrellas, planters, palms, lamps and benches
  dress the streets; the harbour water sparkles along the shore.
- **Cars are for taking.** Parked cars and moving traffic alike can be entered with
  one key. Driving has real throttle, brake, reverse and handbrake feel, a camera
  that leans into your speed, tyre smoke on hard handbrake turns — and consequences:
  hit a wall too fast and the car is a wreck.
- **Wanted & police.** Crimes — theft, hit-and-runs, gunfire, ramming, the missions
  themselves — build heat on a 0–5 star wanted level. Cruisers hunt and ram;
  officers pile out to chase on foot and, at three stars, they shoot. Get cornered
  and the bust meter fills: **BUSTED** costs a $150 fine, while losing your health
  means **WASTED** and a $100 hospital bill. Stay unseen and the heat bleeds away.
- **Combat.** Fists for close work (victims sometimes drop cash) and a pistol aimed
  with the mouse, fed by ammo pickups at Coral Arms and off fallen officers.
- **A three-job story.** *First Run* — a timed package delivery from Pier 9 to
  Cafe Del Mar. *Heat Check* — the drop was watched; get back to the garage with
  the police tipped off. *Cash Trail* — lift three rival cash stashes while every
  alarm brings more heat. Free roam before, between and after, for as long as you
  like.
- **HUD & minimap.** Health, a speedometer while driving, cash, wanted stars, the
  current objective, weapon and ammo — plus a live minimap with the mission
  marker, the garage, the gun shop, the cafe and blinking police blips.
- **Sound, synthesized.** Sirens, gunshots, horns, punches, crashes, pickups and
  mission jingles are all generated with WebAudio. There are no audio files.
- **Saving.** Cash, story progress and gear persist in `localStorage`; the title
  screen offers Continue.

## Play it

```
node serve.ts        # serves game/ at http://localhost:8080
```

Then open http://localhost:8080 in a desktop browser.

| Keys | Action |
| --- | --- |
| WASD / arrows | Move on foot · drive |
| Shift | Sprint |
| E | Enter / exit a car |
| Mouse | Aim the pistol |
| Click | Shoot (pistol) · punch (fists) · start (title screen) |
| F | Punch |
| Space | Handbrake |
| 1 / 2 | Fists / pistol |
| P or Esc | Pause |
| C | Continue a saved game (title screen) |
| M | Mute |

Jobs start at the Harborlight Garage — follow the yellow marker. The screenshots
in `screenshots/` are genuine frames of the simulation, staged through the game's
own deterministic scene hooks (`?shot=chase&seed=1` and friends, listed in
`shots.json`) and captured headlessly.

## Layout

- `main.ts` — the hand-in program: copies `game/` and `screenshots/` to the
  output directory and writes `dossier.json` using the vendored `buildDossier`.
- `serve.ts` — a small static file server for playing the game locally.
- `game/` — the game itself: `index.html` and ES modules under `src/` —
  `config` (all tuning and colour), `random` (the seeded stream), `city` (Coral
  Bay's layout and collision), `entities` (traffic, pedestrians, officers),
  `world` (the simulation), `missions` (Lena's three jobs), `render` (canvas
  drawing and HUD), `audio` (synthesized sound), `input`, `shots` (the staged
  screenshot scenes) and `main` (boot and the game loop).
- `vendor/makefun-game.ts` — the kit's library, unchanged.
