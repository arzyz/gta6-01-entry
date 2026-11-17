// Harbor Vice — the hand-in program for the make.fun gta6-01 entry.
//
// The game itself is the game/ folder beside this file: plain static files
// (index.html plus its ES modules — no build step, no libraries, nothing fetched)
// that a desktop browser plays offline. This program's whole job is to hand that
// game in: copy game/ and screenshots/ into the output directory and write
// dossier.json there, the summary the judge reads, built by the vendored make.fun
// library (vendor/makefun-game.ts, used as-is).
//
// About the game: Harbor Vice is an original top-down open-world crime game set in
// Coral Bay, a sunny coastal city. Marco Vale, a wheelman newly in town, works for
// fixer Lena Ortiz of the Harborlight Garage: steal and drive the city's cars, run
// her three-job story (a cross-town delivery, a police escape, a cash-stash round),
// fight with fists and a mouse-aimed pistol, and manage a five-star wanted level
// against police who pursue by car and on foot — with living traffic, pedestrians,
// a minimap HUD, synthesized WebAudio sound and localStorage saves rounding it out.
//
// Play it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

/** Title and one-line description of the entry, for the hand-in log line. */
const GAME_TITLE = 'Harbor Vice';
const GAME_DESCRIPTION = 'An original top-down open-world crime game in the browser: Coral Bay, its cars, its police and Lena Ortiz’s three jobs.';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

console.log(`Handing in ${GAME_TITLE}: ${GAME_DESCRIPTION}`);
mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
