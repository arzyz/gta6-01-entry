// Lena's three jobs — the story spine of Harbor Vice.
//
// Lena Ortiz fixes cars and problems out of the Harborlight Garage, and Marco Vale,
// fresh in Coral Bay, is her new driver. The jobs run in a fixed order with free
// roaming before, between and after:
//   1. First Run  — fetch a package from Pier 9 and deliver it across town to
//      Cafe Del Mar, against the clock once it's on board.
//   2. Heat Check — the drop was watched; the police arrive tipped off and hot, and
//      the only safe ground is the garage Marco just left.
//   3. Cash Trail — three rival cash stashes to lift around the city, each grab
//      tripping an alarm that brings more heat than the last.
// This module is the state machine only: which job is offered, where its marker is,
// what the objective line says, when it pays out or fails. Consequences — wanted
// levels, cash, police spawns — belong to the world; this file decides, it doesn't act.
import { WANTED } from './config.js';

export const MISSION_NONE = 0;
export const MISSION_DELIVER = 1;
export const MISSION_ESCAPE = 2;
export const MISSION_STASHES = 3;
export const MISSION_DONE = 4;

/** How close Marco must get to a marker for it to count (world px). */
export const MARKER_RADIUS = 46;

/** Cash in hand for each stash lifted during Cash Trail (the job reward is separate). */
const STASH_PAY = 60;

/** Seconds on the delivery clock once the package is on board in First Run. */
const DELIVERY_SECONDS = 205;

/** The three jobs, in order: title, Lena's briefing, and the completion reward. */
export const MISSION_INFO = {
  [MISSION_DELIVER]: {
    title: 'First Run',
    brief: 'Lena: "A package is waiting at Pier 9 in the Docks. Pick it up and bring it to Cafe Del Mar on the beachfront. Quick and clean, Marco."',
    reward: 250,
  },
  [MISSION_ESCAPE]: {
    title: 'Heat Check',
    brief: 'Lena: "That cafe drop was watched — the police have your description and they are coming. Lose them the only sure way: get back to my garage. Now."',
    reward: 200,
  },
  [MISSION_STASHES]: {
    title: 'Cash Trail',
    brief: 'Lena: "A rival crew stashes cash around Coral Bay. Three drops, marked on your map. Lift all three. Every grab will bring more heat — keep moving."',
    reward: 400,
  },
};

/**
 * Fresh mission state:
 *   stage     — the next job Lena will offer (or the one currently running);
 *   active    — the running job, or MISSION_NONE while free roaming;
 *   phase     — a step counter inside a job (delivery: 0 fetch, 1 deliver;
 *               escape: 0 get clear of the garage, 1 get back to it);
 *   stashes   — how many Cash Trail drops have been lifted;
 *   timeLeft  — the delivery clock, once the package is on board;
 *   banner*   — the last result line the HUD is still showing, and for how long.
 */
export function createMissions() {
  return {
    stage: MISSION_DELIVER,
    active: MISSION_NONE,
    phase: 0,
    stashes: 0,
    timeLeft: 0,
    storyDone: false,
    offerReady: true,
    banner: '',
    bannerKind: '',
    bannerT: 0,
    objective: 'Free roam — head to the Harborlight Garage (L on the map) when you want work.',
  };
}

/** Restore progress from a save: pick up the story at the next unplayed job. */
export function restoreMissions(missions, stage, storyDone) {
  missions.stage = stage;
  missions.storyDone = storyDone;
  missions.active = MISSION_NONE;
  missions.phase = 0;
  missions.stashes = 0;
  missions.offerReady = true;
  if (storyDone) missions.objective = 'The city is yours, Marco. Free roam — the garage still pays for stunt driving and clean getaways.';
}

/** Where the game is currently pointing Marco: the job's target, or the garage when a job waits there. */
export function missionMarker(world) {
  const m = world.missions;
  const city = world.city;
  if (m.active === MISSION_DELIVER) return m.phase === 0 ? city.docksPickup : city.cafe;
  if (m.active === MISSION_ESCAPE) return city.garage;
  if (m.active === MISSION_STASHES) {
    const spot = city.stashSpots[m.stashes];
    return spot === undefined ? city.garage : spot;
  }
  if (m.stage <= MISSION_STASHES && !m.storyDone) return city.garage;
  return null;
}

/** Begin the offered job. Called by the world when Marco steps into the garage marker. */
export function startMission(world) {
  const m = world.missions;
  if (m.active !== MISSION_NONE || m.storyDone || m.stage > MISSION_STASHES) return false;
  m.active = m.stage;
  m.phase = 0;
  m.stashes = 0;
  m.offerReady = false;
  if (m.active === MISSION_DELIVER) {
    m.timeLeft = DELIVERY_SECONDS;
    m.objective = 'Pick up the package at Pier 9 in the Portside Docks.';
  } else if (m.active === MISSION_ESCAPE) {
    world.addHeat(WANTED.heatPerStar * 3 - world.wanted.heat, 'The police have your description.');
    m.objective = 'The police are coming — get clear of the garage first, then lead them back to it.';
  } else if (m.active === MISSION_STASHES) {
    m.objective = 'Lift the cash stash at the old lighthouse path (1 of 3).';
  }
  m.banner = MISSION_INFO[m.active].title;
  m.bannerKind = 'start';
  m.bannerT = 3.2;
  world.queueSound('jingle');
  return true;
}

/** Pay the reward, close the job, and point Marco at free roam (or Lena's next offer). */
function completeMission(world) {
  const m = world.missions;
  const info = MISSION_INFO[m.active];
  world.player.cash += info.reward;
  m.banner = `${info.title} complete — $${info.reward}`;
  m.bannerKind = 'complete';
  m.bannerT = 4;
  world.queueSound('cash');
  world.queueSound('jingle');
  m.stage = m.active + 1;
  m.active = MISSION_NONE;
  m.phase = 0;
  m.offerReady = false;
  if (m.stage > MISSION_STASHES) {
    m.storyDone = true;
    m.objective = 'Story complete. The city is yours, Marco — free roam.';
    m.banner = 'Story complete — Coral Bay is yours';
  } else {
    m.objective = `Free roam — Lena has more work at the Harborlight Garage: "${MISSION_INFO[m.stage].title}".`;
  }
  world.saveGame();
}

/** Fail the running job (busted, wasted, or the cafe stopped waiting): Lena offers it again. */
export function failMission(world, reason) {
  const m = world.missions;
  if (m.active === MISSION_NONE) return;
  m.banner = `${MISSION_INFO[m.active].title} failed — ${reason}`;
  m.bannerKind = 'failed';
  m.bannerT = 4;
  m.active = MISSION_NONE;
  m.phase = 0;
  m.stashes = 0;
  m.offerReady = false;
  m.objective = 'Free roam — the job is still on offer at the Harborlight Garage.';
  world.queueSound('fail');
}

/**
 * Advance the mission logic one step: age the banner, watch for Marco reaching the
 * garage offer or the active job's marker, and run the delivery clock. The world
 * calls this every step; all the branching of the three jobs lives here.
 */
export function updateMissions(world, dt) {
  const m = world.missions;
  if (m.bannerT > 0) m.bannerT -= dt;
  const p = world.player;
  if (m.active === MISSION_NONE) {
    // Jobs are offered at the garage marker, once per visit: stepping in starts the
    // job, and the offer only re-arms after Marco has left the neighbourhood — so a
    // job that ends at the garage can never chain straight into the next one.
    const g = world.city.garage;
    const dist = Math.hypot(p.x - g.x, p.y - g.y);
    if (!m.offerReady && dist > MARKER_RADIUS + 60) m.offerReady = true;
    if (m.offerReady && !m.storyDone && m.stage <= MISSION_STASHES && dist < MARKER_RADIUS) startMission(world);
    return;
  }
  const marker = missionMarker(world);
  if (m.active === MISSION_DELIVER) {
    if (m.phase === 0 && marker !== null && Math.hypot(p.x - marker.x, p.y - marker.y) < MARKER_RADIUS) {
      m.phase = 1;
      m.objective = 'Package on board. Deliver it to Cafe Del Mar on the beachfront — the clock is running.';
      m.banner = 'Package picked up';
      m.bannerKind = 'start';
      m.bannerT = 2.4;
      world.queueSound('pickup');
    } else if (m.phase === 1) {
      m.timeLeft -= dt;
      if (m.timeLeft <= 0) {
        failMission(world, 'the cafe stopped waiting.');
        return;
      }
      if (marker !== null && Math.hypot(p.x - marker.x, p.y - marker.y) < MARKER_RADIUS) completeMission(world);
    }
    return;
  }
  if (m.active === MISSION_ESCAPE) {
    // The job starts at the very garage it must end at, so it runs in two beats:
    // first get properly clear of the place (phase 0), then fight back to it with
    // the heat still on (phase 1). Reaching it in phase 1 lays the heat to rest.
    const dist = marker !== null ? Math.hypot(p.x - marker.x, p.y - marker.y) : 0;
    if (m.phase === 0 && dist > 330) {
      m.phase = 1;
      m.objective = 'Now — get back to the Harborlight Garage with the police on you. Do not get caught.';
      m.banner = 'Now get back to the garage';
      m.bannerKind = 'start';
      m.bannerT = 2.4;
    } else if (m.phase === 1 && dist < MARKER_RADIUS) {
      world.clearWanted('You made it to the garage. Lena lays low until the heat dies.');
      completeMission(world);
    }
    return;
  }
  if (m.active === MISSION_STASHES) {
    if (marker !== null && Math.hypot(p.x - marker.x, p.y - marker.y) < MARKER_RADIUS) {
      m.stashes += 1;
      p.cash += STASH_PAY;
      world.queueSound('cash');
      world.addHeat(WANTED.heatPerStar, 'A stash alarm trips somewhere across town.');
      if (m.stashes >= 3) {
        completeMission(world);
      } else {
        const next = world.city.stashSpots[m.stashes];
        m.objective = `Stash lifted. Next: ${next.name} (${m.stashes + 1} of 3). The heat is climbing.`;
        m.banner = `Stash ${m.stashes} of 3 — +$${STASH_PAY}`;
        m.bannerKind = 'start';
        m.bannerT = 2.4;
      }
    }
  }
}
