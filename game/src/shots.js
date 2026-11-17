// The staged scenes behind ?shot=title|chase|drive|mission (with &seed=N).
//
// A scene is not a diorama: each one assembles a genuine gameplay state on a fresh
// seeded world — Marco's real car, the real police AI, a real mission in progress —
// and then lets the actual simulation run it forward for a fixed number of steps
// under a scripted driver. What the screenshot shows is the game itself, mid-play,
// and the same seed reproduces the same frame on any machine.
import { STEP } from './config.js';
import { roadCenterX, roadCenterY } from './city.js';
import { parkedCarEntity, policeCarEntity } from './entities.js';
import { MISSION_DELIVER, MISSION_ESCAPE } from './missions.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';

/** Hands off the controls: the world idles (traffic rolls, peds stroll) behind a panel. */
const IDLE_INPUT = {
  down: () => false,
  takeActions: () => 0,
  takeClick: () => false,
  firing: () => false,
};

/** Accelerator held to the floor: the staged driver for the chase and drive scenes. */
const DRIVER_INPUT = {
  down: (code) => code === 'KeyW',
  takeActions: () => 0,
  takeClick: () => false,
  firing: () => false,
};

/** Run the real world forward `seconds` of game time under the given input. */
function stepSeconds(world, input, seconds) {
  const aim = { x: world.player.x + 100, y: world.player.y };
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) world.step(STEP, input, aim);
}

/** Seat Marco in a fresh car at a chosen spot — already his, already rolling. */
function putPlayerInCar(world, x, y, angle, color, speed) {
  const car = parkedCarEntity({ x, y, angle, color, topSpeed: 430 });
  car.kind = 'free';
  car.driver = 'player';
  car.stolen = true;
  car.speed = speed;
  world.cars.push(car);
  world.player.inCar = car;
  world.player.x = x;
  world.player.y = y;
  world.player.angle = angle;
  world.camera.x = x;
  world.camera.y = y;
  return car;
}

/** Place a cruiser where a chase needs one: on Marco's tail, at speed. */
function putPoliceCar(world, x, y, angle, speed) {
  const car = policeCarEntity(world, x, y);
  car.angle = angle;
  car.speed = speed;
  world.cars.push(car);
  return car;
}

function stageTitle(world) {
  // Marco on the Marina Beach promenade, the cafe behind him, traffic rolling past.
  world.player.x = world.city.cafe.x - 84;
  world.player.y = world.city.cafe.y + 44;
  world.camera.x = world.player.x;
  world.camera.y = world.player.y;
  stepSeconds(world, IDLE_INPUT, 3);
  return SCREEN_TITLE;
}

function stageChase(world) {
  // Heat Check at its worst moment: four stars, three cruisers, Downtown flying by.
  const x = roadCenterX(4);
  const y = roadCenterY(3);
  putPlayerInCar(world, x, y, 0, '#9b59b6', 312);
  putPoliceCar(world, x - 128, y - 36, 0.06, 334);
  putPoliceCar(world, x - 218, y + 32, -0.05, 320);
  putPoliceCar(world, x - 318, y - 4, 0.02, 328);
  world.wanted.heat = 130;
  world.wanted.stars = 4;
  world.wanted.lastCrimeT = 0;
  world.missions.active = MISSION_ESCAPE;
  world.missions.stage = MISSION_ESCAPE;
  world.missions.objective = 'Reach the Harborlight Garage with the police on you — do not get caught.';
  for (const ped of world.peds) {
    if (Math.hypot(ped.x - x, ped.y - y) < 300) ped.state = 'flee';
  }
  stepSeconds(world, DRIVER_INPUT, 1.15);
  // The staged steps cool nothing (the crime clock was just set), but pin the heat so
  // the frame always shows the same four stars.
  world.wanted.heat = 130;
  world.wanted.stars = 4;
  return SCREEN_PLAY;
}

function stageDrive(world) {
  // Free roam down the beachfront coast road: palms, sand, traffic, zero stars.
  const x = roadCenterX(2) + 120;
  const y = roadCenterY(5);
  putPlayerInCar(world, x, y, 0, '#1abc9c', 258);
  world.missions.objective = 'Free roam — head to the Harborlight Garage (L on the map) when you want work.';
  stepSeconds(world, DRIVER_INPUT, 1.3);
  return SCREEN_PLAY;
}

function stageMission(world) {
  // First Run at the pickup: the Pier 9 beacon lit, Marco on foot, pistol ready.
  const spot = world.city.docksPickup;
  world.player.x = spot.x - 132;
  world.player.y = spot.y + 48;
  world.player.angle = 0.5;
  world.player.weapon = 'pistol';
  world.camera.x = world.player.x + 60;
  world.camera.y = world.player.y;
  world.missions.active = MISSION_DELIVER;
  world.missions.stage = MISSION_DELIVER;
  world.missions.phase = 0;
  world.missions.objective = 'Pick up the package at Pier 9 in the Portside Docks.';
  const car = parkedCarEntity({ x: spot.x - 236, y: spot.y + 92, angle: Math.PI / 2, color: '#e67e22', topSpeed: 384 });
  world.cars.push(car);
  stepSeconds(world, IDLE_INPUT, 1.6);
  return SCREEN_PLAY;
}

/**
 * Set `world` to the named scene and return which screen to draw over it. Unknown
 * names fall back to the title scene.
 */
export function stageShot(name, world) {
  if (name === 'chase') return stageChase(world);
  if (name === 'drive') return stageDrive(world);
  if (name === 'mission') return stageMission(world);
  return stageTitle(world);
}
