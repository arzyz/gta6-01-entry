// Boot, screens and the one game loop.
//
// The loop's shape: read input once per animation frame, advance the world in fixed
// 1/60 s steps (as many as the elapsed time calls for, capped so a backgrounded tab
// doesn't fast-forward on return), then paint. Screens — title, play, paused,
// busted, wasted — are decided here; the world itself only reports events (entered
// a car, got busted, got wasted) as flags on its step return.
//
// Progress (cash, mission stage, gear) persists in localStorage between visits.
// ?seed=N pins the city's random stream. ?shot=title|chase|drive|mission&seed=N
// skips the loop entirely: it stages that scene, paints it twice and raises
// window.__shotReady for the screenshot tooling.
import { SAVE_KEY, STEP, VIEW } from './config.js';
import { createRandom } from './random.js';
import { createWorld, EVENT_BUSTED, EVENT_ENTERED_CAR, EVENT_WASTED } from './world.js';
import { ACTION_CONFIRM, ACTION_CONTINUE, ACTION_ENTER_CAR, ACTION_MUTE, ACTION_PAUSE, ACTION_PUNCH, ACTION_WEAPON_1, ACTION_WEAPON_2, createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_BUSTED, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WASTED } from './render.js';
import { failMission } from './missions.js';
import { stageShot } from './shots.js';

/** Longest frame the loop will simulate at once (a hidden tab returning, say). */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const renderer = createRenderer(canvas);
const audio = createAudio();

/** An input nobody touches, for the title backdrop's idle city. */
const IDLE_INPUT = {
  down: () => false,
  takeActions: () => 0,
  takeClick: () => false,
  firing: () => false,
};

function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeSave(data) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Storage can be unavailable (private windows): progress then lasts the visit.
  }
}

function freshWorld() {
  const world = createWorld(createRandom(Math.floor(Math.random() * 4294967296)));
  world.onSave = writeSave;
  return world;
}

/** Mouse position converted into the game's 1280x720 logical space (letterboxed). */
function mouseLogical(input) {
  const m = input.mouse();
  const scale = Math.min(window.innerWidth / VIEW.width, window.innerHeight / VIEW.height);
  const ox = (window.innerWidth - VIEW.width * scale) / 2;
  const oy = (window.innerHeight - VIEW.height * scale) / 2;
  return { x: (m.x - ox) / scale, y: (m.y - oy) / scale };
}

/** Is a cruiser close enough, while Marco is wanted, for its siren to be heard? */
function sirenAudible(world) {
  if (world.wanted.stars < 1) return false;
  for (const car of world.cars) {
    if (car.kind === 'police' && Math.hypot(car.x - world.player.x, car.y - world.player.y) < 720) return true;
  }
  return false;
}

function runShot(name) {
  const world = createWorld(createRandom(seed));
  const screen = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world, screen, {});
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let world = createWorld(createRandom(seed));
  world.onSave = writeSave;
  let screen = SCREEN_TITLE;
  let accumulator = 0;
  let last = performance.now();

  // A handle for automated play-tests (and for curious players in the console).
  window.__harborVice = {
    world: () => world,
    screen: () => screen,
  };

  function announce(message) {
    status.textContent = message;
  }

  function startNewGame() {
    world = freshWorld();
    screen = SCREEN_PLAY;
    audio.unlock();
    audio.click();
    announce('Harbor Vice. Marco Vale, Coral Bay. WASD to move; Lena is waiting at the Harborlight Garage.');
  }

  function continueGame() {
    const save = readSave();
    world = freshWorld();
    if (save !== null) world.applySave(save);
    screen = SCREEN_PLAY;
    audio.unlock();
    audio.click();
    announce('Welcome back to Coral Bay.');
  }

  /** A run ends: the fine or the bill comes out of Marco's cash, the job fails, we save. */
  function endRun(kind) {
    if (kind === 'busted') {
      const fine = Math.min(150, world.player.cash);
      world.player.cash -= fine;
      failMission(world, 'the police got their man.');
      screen = SCREEN_BUSTED;
      audio.setSiren(false);
      audio.busted();
      announce(`Busted. $${fine} fine. Press Enter to continue.`);
    } else {
      const bill = Math.min(100, world.player.cash);
      world.player.cash -= bill;
      failMission(world, 'Marco woke up in hospital.');
      screen = SCREEN_WASTED;
      audio.setSiren(false);
      audio.fail();
      announce(`Wasted. $${bill} hospital bill. Press Enter to continue.`);
    }
    world.saveGame();
  }

  /** Play the sounds and speak the announcements the world queued during its steps. */
  function drainWorld() {
    for (const name of world.sounds) {
      if (typeof audio[name] === 'function') audio[name]();
    }
    world.sounds.length = 0;
    for (const message of world.announcements) announce(message);
    world.announcements.length = 0;
  }

  // Audio unlocks on the first gesture, whatever it was for.
  window.addEventListener('pointerdown', () => audio.unlock());
  window.addEventListener('keydown', () => audio.unlock());

  function handleActions(actions) {
    if (actions & ACTION_MUTE) {
      audio.unlock();
      const muted = audio.toggleMute();
      announce(muted ? 'Sound off.' : 'Sound on.');
    }
    if (screen === SCREEN_TITLE) {
      if (actions & ACTION_CONFIRM) startNewGame();
      else if ((actions & ACTION_CONTINUE) && readSave() !== null) continueGame();
      return;
    }
    if (screen === SCREEN_BUSTED || screen === SCREEN_WASTED) {
      if (actions & ACTION_CONFIRM) {
        world.respawn();
        screen = SCREEN_PLAY;
        audio.click();
        announce('Back on the street.');
      }
      return;
    }
    if (actions & ACTION_PAUSE) {
      if (screen === SCREEN_PLAY) {
        screen = SCREEN_PAUSED;
        audio.setSiren(false);
        announce('Paused.');
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    // The one-shot queue is drained exactly once per frame, here. The screens take
    // their share in handleActions; the world's share (enter car, punch, weapon
    // swap) is forwarded to the first simulation step below. If both sides drained
    // the queue directly, half of all presses would vanish into the wrong reader.
    const actions = input.takeActions();
    handleActions(actions);
    // A click on the title screen starts a new game, like Enter does.
    if (screen === SCREEN_TITLE && input.takeClick()) startNewGame();
    const worldActions = actions & (ACTION_ENTER_CAR | ACTION_PUNCH | ACTION_WEAPON_1 | ACTION_WEAPON_2);
    let firstStep = true;
    const worldInput = {
      down: (code) => input.down(code),
      takeActions: () => {
        if (!firstStep) return 0;
        firstStep = false;
        return worldActions;
      },
      takeClick: () => input.takeClick(),
      firing: () => input.firing(),
    };

    if (screen === SCREEN_TITLE) {
      // The city lives behind the title panel: traffic rolls, peds stroll, nobody plays.
      while (accumulator >= STEP) {
        world.step(STEP, IDLE_INPUT, { x: world.player.x + 100, y: world.player.y });
        accumulator -= STEP;
      }
      drainWorld();
    } else if (screen === SCREEN_PLAY) {
      const logical = mouseLogical(input);
      const aim = {
        x: world.camera.x + (logical.x - VIEW.width / 2),
        y: world.camera.y + (logical.y - VIEW.height / 2),
      };
      while (accumulator >= STEP && screen === SCREEN_PLAY) {
        const events = world.step(STEP, worldInput, aim);
        accumulator -= STEP;
        if (events & EVENT_ENTERED_CAR) announce('Driving.');
        if (events & EVENT_BUSTED) { endRun('busted'); break; }
        if (events & EVENT_WASTED) { endRun('wasted'); break; }
      }
      drainWorld();
      audio.setSiren(sirenAudible(world));
    } else {
      // Paused / busted / wasted: freeze the world, and swallow any click so it
      // can't surface as a punch the moment play resumes.
      accumulator = 0;
      input.takeClick();
    }

    const save = readSave();
    renderer.draw(world, screen, {
      hasSave: save !== null,
      saveCash: save?.cash ?? 0,
      saveStage: save?.storyDone ? 'story complete' : `job ${save?.stage ?? 1} of 3`,
    });
  }

  // Losing the tab mid-chase pauses the game rather than letting it run blind.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      audio.setSiren(false);
      announce('Paused.');
    }
  });

  announce('Harbor Vice. Press Enter to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
