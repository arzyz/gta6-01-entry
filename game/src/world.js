// The simulation. Everything that *happens* in Coral Bay happens here or in the
// modules it drives: Marco on foot and behind the wheel, car theft and driving, the
// traffic and pedestrians of entities.js, the wanted heat and the police answer to
// it, fists and a pistol, pickups, and the mission state machine of missions.js.
//
// step(dt, input, aim) advances exactly one fixed step and reports what happened as
// EVENT_* bit flags. Sounds and screen-reader announcements are not played here —
// they are queued on the world for the main loop to drain — and nothing in this file
// draws or touches the DOM, which is what lets a headless test drive the same rules.
import { DRIVE, FOOT, POLICE, SAVE_KEY, WANTED, WORLD } from './config.js';
import { collideCircle, createCity, nearestRoadPoint, segmentBlocked } from './city.js';
import { knockDownPedestrian, parkedCarEntity, policeCarEntity, spawnOfficer, updateOfficers, updatePedestrians, updateTraffic } from './entities.js';
import { ACTION_ENTER_CAR, ACTION_PUNCH, ACTION_WEAPON_1, ACTION_WEAPON_2 } from './input.js';
import { createMissions, failMission, missionMarker, restoreMissions, updateMissions } from './missions.js';
import { chance, randRange } from './random.js';

export const EVENT_BUSTED = 1;
export const EVENT_WASTED = 2;
export const EVENT_ENTERED_CAR = 4;
export const EVENT_LEFT_CAR = 8;

export { SAVE_KEY };

/** Turn `current` toward `target` by at most `maxTurn` radians (shortest way round). */
function angleLerpTurn(current, target, maxTurn) {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + Math.max(-maxTurn, Math.min(maxTurn, diff));
}

export function createWorld(random) {
  const city = createCity(random);
  // Marco starts on the street in front of the garage — on the asphalt, a short walk
  // from its marker — and respawns there after every bust and hospital visit.
  const spawnPoint = nearestRoadPoint(city.garage.x - 130, city.garage.y);
  const world = {
    random,
    city,
    carColors: ['#e74c3c', '#f39c12', '#f7f7f7', '#3498db', '#9b59b6', '#1abc9c', '#e67e22', '#fd79a8', '#00cec9', '#6c5ce7'],
    time: 0,
    player: {
      x: spawnPoint.x, y: spawnPoint.y, angle: -Math.PI / 2,
      health: FOOT.health, cash: 120, inCar: null,
      weapon: 'fist', hasPistol: true, ammo: 24,
      punchCd: 0, fireCd: 0, hurtT: -99,
    },
    cars: [],
    peds: [],
    officers: [],
    tracers: [],
    particles: [],
    pickups: [],
    wanted: { stars: 0, heat: 0, lastCrimeT: -99 },
    bustMeter: 0,
    missions: createMissions(),
    camera: { x: spawnPoint.x, y: spawnPoint.y },
    spawnPoint,
    sounds: [],
    announcements: [],
    lastShotT: -99,
    lastShotX: 0,
    lastShotY: 0,
    lastPunchT: -99,
    over: null,
    policeSpawnT: 0,
    officerSpawnT: 0,
    ammoPickupT: 0,
    onSave: null,
  };

  for (const spec of city.parkedCars) world.cars.push(parkedCarEntity(spec));
  world.pickups.push({ x: city.gunShop.x, y: city.gunShop.y, kind: 'ammo', amount: 12 });
  world.pickups.push({ x: city.cafe.x + 30, y: city.cafe.y, kind: 'health', amount: 30 });

  // -- callbacks the other modules use -------------------------------------------

  world.queueSound = (name) => { world.sounds.push(name); };
  world.announce = (message) => { world.announcements.push(message); };

  /** Add wanted heat for a crime, capped at the five-star ceiling. */
  world.addHeat = (amount, why) => {
    if (amount <= 0 || world.over !== null) return;
    world.wanted.heat = Math.min(WANTED.heatPerStar * WANTED.max, world.wanted.heat + amount);
    world.wanted.lastCrimeT = world.time;
    world.wanted.stars = Math.min(WANTED.max, Math.floor(world.wanted.heat / WANTED.heatPerStar));
    if (why) world.announce(why);
  };

  /** Wipe the wanted level entirely (the garage's protection, a respawn). */
  world.clearWanted = (why) => {
    world.wanted.heat = 0;
    world.wanted.stars = 0;
    world.bustMeter = 0;
    if (why) world.announce(why);
  };

  /** Hurt Marco. A car soaks up over half of any hit; zero health ends the run. */
  world.damagePlayer = (amount) => {
    const p = world.player;
    if (world.over !== null) return;
    if (p.inCar !== null) amount *= 0.45;
    p.health -= amount;
    p.hurtT = world.time;
    if (p.health <= 0) {
      p.health = 0;
      world.over = 'wasted';
    }
  };

  world.saveGame = () => { if (world.onSave !== null) world.onSave(world.serializeSave()); };

  world.serializeSave = () => ({
    cash: world.player.cash,
    stage: world.missions.stage,
    storyDone: world.missions.storyDone,
    hasPistol: world.player.hasPistol,
    ammo: world.player.ammo,
  });

  world.applySave = (data) => {
    if (data === null || typeof data !== 'object') return;
    world.player.cash = Number.isFinite(data.cash) ? data.cash : world.player.cash;
    world.player.hasPistol = data.hasPistol !== false;
    world.player.ammo = Number.isFinite(data.ammo) ? data.ammo : world.player.ammo;
    restoreMissions(world.missions, Number.isFinite(data.stage) ? data.stage : 1, data.storyDone === true);
  };

  /** After a bust or a hospital visit: back at the garage, healthy, heat gone, poorer. */
  world.respawn = () => {
    const p = world.player;
    p.inCar = null;
    p.x = world.spawnPoint.x;
    p.y = world.spawnPoint.y;
    p.health = FOOT.health;
    world.over = null;
    world.clearWanted('');
    world.officers = [];
    world.cars = world.cars.filter((car) => car.kind !== 'police');
    world.camera.x = p.x;
    world.camera.y = p.y;
  };

  // -- crime -----------------------------------------------------------------------

  /** Was anyone in a position to see a crime at (x, y)? Most street crime needs a witness. */
  function anyWitness(x, y, range) {
    for (const ped of world.peds) if (ped.state !== 'down' && Math.hypot(ped.x - x, ped.y - y) < range) return true;
    for (const car of world.cars) if (car.kind === 'police' && Math.hypot(car.x - x, car.y - y) < range) return true;
    return world.officers.length > 0;
  }

  function commitCrime(amount, why) {
    world.addHeat(amount, why);
  }

  // -- getting in and out of cars ----------------------------------------------------

  function nearestEnterableCar() {
    const p = world.player;
    let best = null;
    let bestDist = 52;
    for (const car of world.cars) {
      if (car.wrecked) continue;
      if (car.driver === 'ai' && Math.abs(car.speed) > 70) continue;
      const d = Math.hypot(car.x - p.x, car.y - p.y);
      if (d < bestDist) { bestDist = d; best = car; }
    }
    return best;
  }

  function enterCar(car) {
    const p = world.player;
    if (car.driver === 'ai' && car.kind === 'traffic') {
      // Carjacked drivers don't argue: they bail out and run for it.
      const ped = { x: car.x + 20, y: car.y + 10, angle: world.random() * 6.28, speed: 74, color: '#feca57', skin: '#e0ac69', state: 'flee', bi: 0, bj: 0, corner: 0, tx: car.x + 300, ty: car.y, panicT: 3, downT: 0, waitT: 0, dead: false };
      world.peds.push(ped);
    }
    if (!car.stolen) {
      car.stolen = true;
      if (car.kind === 'police') commitCrime(WANTED.theft * 2, 'You stole a police cruiser. Bold.');
      else commitCrime(WANTED.theft, 'Vehicle theft reported.');
    }
    if (car.kind === 'traffic') car.kind = 'free';
    car.driver = 'player';
    p.inCar = car;
    world.queueSound('door');
    world.queueSound('engine');
    world.announce('Driving. WASD to drive, E to get out, Space for the handbrake.');
    return EVENT_ENTERED_CAR;
  }

  function exitCar() {
    const p = world.player;
    const car = p.inCar;
    if (car === null) return 0;
    car.driver = null;
    car.speed = 0;
    p.inCar = null;
    const side = { x: car.x - Math.sin(car.angle) * 30, y: car.y + Math.cos(car.angle) * 30 };
    p.x = side.x;
    p.y = side.y;
    collideCircle(city, p, FOOT.radius);
    world.queueSound('door');
    return EVENT_LEFT_CAR;
  }

  // -- combat --------------------------------------------------------------------------

  /** A burst of short-lived spark/smoke particles at a point. Pure decoration. */
  function sparks(x, y, count, color) {
    for (let i = 0; i < count; i += 1) {
      const a = world.random() * Math.PI * 2;
      const s = randRange(world.random, 40, 190);
      world.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: randRange(world.random, 0.2, 0.5), color, size: randRange(world.random, 1.5, 3.2) });
    }
  }
  world.sparks = sparks;

  function punch() {
    const p = world.player;
    if (p.punchCd > 0 || p.inCar !== null) return;
    p.punchCd = FOOT.punchCooldown;
    world.lastPunchT = world.time;
    world.queueSound('punch');
    const fx = p.x + Math.cos(p.angle) * FOOT.punchRange;
    const fy = p.y + Math.sin(p.angle) * FOOT.punchRange;
    for (const ped of world.peds) {
      if (ped.state === 'down') continue;
      if (Math.hypot(ped.x - fx, ped.y - fy) < 30 || Math.hypot(ped.x - p.x, ped.y - p.y) < 30) {
        knockDownPedestrian(ped, false);
        if (chance(world.random, 0.42)) world.pickups.push({ x: ped.x + 8, y: ped.y, kind: 'cash', amount: randRange(world.random, 10, 32) | 0 });
        if (anyWitness(p.x, p.y, 330)) commitCrime(WANTED.hitPed * 0.6, 'Assault witnessed.');
        return;
      }
    }
    for (const officer of world.officers) {
      if (Math.hypot(officer.x - fx, officer.y - fy) < 30) {
        officer.state = 'gone';
        commitCrime(WANTED.shotOfficer, 'You decked a police officer.');
        return;
      }
    }
  }

  function shoot(aim) {
    const p = world.player;
    if (p.fireCd > 0 || p.inCar !== null) return;
    if (p.ammo <= 0) {
      p.fireCd = 0.3;
      world.queueSound('dryFire');
      return;
    }
    p.fireCd = FOOT.fireCooldown;
    p.ammo -= 1;
    world.queueSound('gunshot');
    world.lastShotT = world.time;
    world.lastShotX = p.x;
    world.lastShotY = p.y;
    const angle = Math.atan2(aim.y - p.y, aim.x - p.x);
    p.angle = angle;
    if (anyWitness(p.x, p.y, 430)) commitCrime(WANTED.shotFired, 'Shots fired.');
    // Walk the bullet's ray out to the first building; nothing beyond it can be hit.
    let endX = p.x + Math.cos(angle) * FOOT.bulletRange;
    let endY = p.y + Math.sin(angle) * FOOT.bulletRange;
    let hitT = FOOT.bulletRange;
    for (let d = 12; d < FOOT.bulletRange; d += 10) {
      const x = p.x + Math.cos(angle) * d;
      const y = p.y + Math.sin(angle) * d;
      let blocked = false;
      for (const b of city.buildings) {
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { blocked = true; break; }
      }
      if (blocked) { hitT = d; endX = x; endY = y; break; }
    }
    // Perpendicular distance of a point from the ray, or -1 if it isn't along it.
    function rayDist(px, py) {
      const dx = px - p.x;
      const dy = py - p.y;
      const along = dx * Math.cos(angle) + dy * Math.sin(angle);
      if (along < 0 || along > hitT) return -1;
      const across = Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle));
      return across;
    }
    let victim = null;
    let victimKind = '';
    for (const ped of world.peds) {
      if (ped.state === 'down') continue;
      const across = rayDist(ped.x, ped.y);
      if (across >= 0 && across < 15) { victim = ped; victimKind = 'ped'; break; }
    }
    if (victim === null) {
      for (const officer of world.officers) {
        const across = rayDist(officer.x, officer.y);
        if (across >= 0 && across < 15) { victim = officer; victimKind = 'officer'; break; }
      }
    }
    if (victim === null) {
      for (const car of world.cars) {
        if (car === p.inCar) continue;
        const across = rayDist(car.x, car.y);
        if (across >= 0 && across < 24) { victim = car; victimKind = 'car'; break; }
      }
    }
    if (victimKind === 'ped') {
      knockDownPedestrian(victim, true);
      commitCrime(WANTED.killPed, 'A pedestrian is down.');
      endX = victim.x;
      endY = victim.y;
    } else if (victimKind === 'officer') {
      victim.state = 'gone';
      commitCrime(WANTED.shotOfficer, 'Officer down.');
      if (chance(world.random, 0.6)) world.pickups.push({ x: victim.x, y: victim.y, kind: 'ammo', amount: 6 });
      endX = victim.x;
      endY = victim.y;
    } else if (victimKind === 'car') {
      endX = victim.x;
      endY = victim.y;
      sparks(endX, endY, 6, '#ffd23f');
    } else if (hitT < FOOT.bulletRange) {
      sparks(endX, endY, 4, '#cfc8bb');
    }
    world.tracers.push({ x1: p.x + Math.cos(angle) * 18, y1: p.y + Math.sin(angle) * 18, x2: endX, y2: endY, t: 0.06, hostile: false });
  }

  // -- police ----------------------------------------------------------------------------

  function policeTargetCount() {
    return Math.min(POLICE.maxCars, world.wanted.stars * POLICE.carsPerStar);
  }

  /** Spawn a cruiser on a road a good distance out, already facing Marco. */
  function spawnPoliceCar() {
    const p = world.player;
    for (let tries = 0; tries < 14; tries += 1) {
      const a = world.random() * Math.PI * 2;
      const d = POLICE.spawnDistance + randRange(world.random, -60, 120);
      const at = nearestRoadPoint(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d);
      if (at.x < 30 || at.y < 30 || at.x > WORLD.width - 30 || at.y > WORLD.height - 30) continue;
      if (Math.hypot(at.x - p.x, at.y - p.y) < 560) continue;
      const car = policeCarEntity(world, at.x, at.y);
      car.angle = Math.atan2(p.y - at.y, p.x - at.x);
      world.cars.push(car);
      return;
    }
  }

  function updatePolice(worldRef, dt) {
    const p = world.player;
    const stars = world.wanted.stars;
    let policeCars = 0;
    for (const car of world.cars) if (car.kind === 'police' && car.driver !== 'player') policeCars += 1;
    world.policeSpawnT -= dt;
    if (stars >= 1 && policeCars < policeTargetCount() && world.policeSpawnT <= 0) {
      spawnPoliceCar();
      world.policeSpawnT = 1.4;
    }
    // Officers pile out of nearby cruisers when Marco is on foot.
    world.officerSpawnT -= dt;
    if (p.inCar === null && stars >= 1 && world.officerSpawnT <= 0) {
      const wanted = Math.min(3, stars);
      if (world.officers.length < wanted) {
        for (const car of world.cars) {
          if (car.kind === 'police' && Math.hypot(car.x - p.x, car.y - p.y) < 170) {
            spawnOfficer(world, car);
            world.officerSpawnT = 3.5;
            break;
          }
        }
      }
    }
    // Pursuit: steer straight at Marco, ease off when close, ram when in reach. A
    // cruiser that loses its nerve at high speed into a wall is a wreck.
    for (const car of world.cars) {
      if (car.kind !== 'police' || car.driver !== 'ai') continue;
      if (car.wrecked) { car.speed = 0; continue; }
      const tx = p.inCar !== null ? p.inCar.x : p.x;
      const ty = p.inCar !== null ? p.inCar.y : p.y;
      const dist = Math.hypot(tx - car.x, ty - car.y);
      if (stars === 0 && dist > 500) { car.dead = true; continue; }
      const wanted = Math.atan2(ty - car.y, tx - car.x);
      car.angle = angleLerpTurn(car.angle, wanted, 3.1 * dt);
      const goal = dist > 70 ? POLICE.speed : POLICE.speed * 0.45;
      car.braking = goal < car.speed - 6;
      car.speed += Math.max(-460 * dt, Math.min(240 * dt, goal - car.speed));
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      const hitWall = collideCircle(city, car, DRIVE.radius);
      if (hitWall) {
        if (car.speed > 285) { car.wrecked = true; world.queueSound('crash'); sparks(car.x, car.y, 12, '#ffb347'); }
        car.speed *= 0.35;
      }
      // A ram connects: Marco's ride takes damage and a speed cut, on a per-car cooldown.
      if (p.inCar !== null && Math.hypot(p.inCar.x - car.x, p.inCar.y - car.y) < 37) {
        if (Math.abs(car.speed) > 130 && world.time - (car.ramT ?? -9) > 0.8) {
          car.ramT = world.time;
          world.damagePlayer(4);
          p.inCar.speed *= 0.55;
          world.queueSound('crash');
          sparks(p.inCar.x, p.inCar.y, 8, '#ffd23f');
        }
      }
    }
    world.cars = world.cars.filter((car) => !car.dead);
    updateOfficers(world, dt);
  }

  // -- the bust ----------------------------------------------------------------------------

  /**
   * The bust meter fills while police have Marco effectively cornered — an officer at
   * arm's length, a cruiser on top of him on foot, or cruisers around a stationary
   * car — and drains whenever he has room to run. Full meter: busted.
   */
  function updateBust(dt) {
    const p = world.player;
    if (world.wanted.stars === 0 || world.over !== null) {
      world.bustMeter = Math.max(0, world.bustMeter - POLICE.bustDrain * dt);
      return;
    }
    let pressure = false;
    if (p.inCar === null) {
      for (const officer of world.officers) {
        if (Math.hypot(officer.x - p.x, officer.y - p.y) < POLICE.bustRangeFoot) { pressure = true; break; }
      }
      if (!pressure) {
        for (const car of world.cars) {
          if (car.kind === 'police' && Math.hypot(car.x - p.x, car.y - p.y) < 60) { pressure = true; break; }
        }
      }
    } else if (Math.abs(p.inCar.speed) < 26) {
      for (const car of world.cars) {
        if (car.kind === 'police' && Math.hypot(car.x - p.inCar.x, car.y - p.inCar.y) < POLICE.bustRangeCar) { pressure = true; break; }
      }
    }
    if (pressure) world.bustMeter += POLICE.bustFill * dt;
    else world.bustMeter = Math.max(0, world.bustMeter - POLICE.bustDrain * dt);
    if (world.bustMeter >= 1) {
      world.over = 'busted';
    }
  }

  // -- Marco's movement -----------------------------------------------------------------------

  function updateOnFoot(dt, input, aim) {
    const p = world.player;
    let mx = 0;
    let my = 0;
    if (input.down('KeyW') || input.down('ArrowUp')) my -= 1;
    if (input.down('KeyS') || input.down('ArrowDown')) my += 1;
    if (input.down('KeyA') || input.down('ArrowLeft')) mx -= 1;
    if (input.down('KeyD') || input.down('ArrowRight')) mx += 1;
    const moving = mx !== 0 || my !== 0;
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const speed = sprint ? FOOT.sprint : FOOT.walk;
    if (moving) {
      const len = Math.hypot(mx, my);
      p.x += (mx / len) * speed * dt;
      p.y += (my / len) * speed * dt;
      if (p.weapon !== 'pistol') p.angle = Math.atan2(my, mx);
    }
    if (p.weapon === 'pistol') p.angle = Math.atan2(aim.y - p.y, aim.x - p.x);
    collideCircle(city, p, FOOT.radius);
    // Shouldering through a crowd: pedestrians get shoved aside, gently.
    for (const ped of world.peds) {
      if (ped.state === 'down') continue;
      const d = Math.hypot(ped.x - p.x, ped.y - p.y);
      if (d > 0.01 && d < 24) {
        ped.x += ((ped.x - p.x) / d) * (24 - d);
        ped.y += ((ped.y - p.y) / d) * (24 - d);
      }
    }
  }

  function updateDriving(dt, input) {
    const p = world.player;
    const car = p.inCar;
    const fwd = input.down('KeyW') || input.down('ArrowUp');
    const back = input.down('KeyS') || input.down('ArrowDown');
    const left = input.down('KeyA') || input.down('ArrowLeft');
    const right = input.down('KeyD') || input.down('ArrowRight');
    const hand = input.down('Space');
    if (fwd) car.speed += DRIVE.accel * dt;
    else if (back) car.speed -= (car.speed > 4 ? DRIVE.brake : DRIVE.accel * 0.7) * dt;
    // Drag settles the car at its top speed under power, or at rest without it.
    car.speed -= car.speed * DRIVE.drag * dt * (fwd || back ? 0.25 : 1);
    if (hand) car.speed -= car.speed * 2.4 * dt;
    car.speed = Math.max(-DRIVE.reverseMax, Math.min(car.topSpeed, car.speed));
    if (!fwd && !back && Math.abs(car.speed) < 3) car.speed = 0;
    car.braking = back || hand;
    const steerInput = (left ? -1 : 0) + (right ? 1 : 0);
    if (steerInput !== 0 && car.speed !== 0) {
      const grip = Math.min(1, Math.abs(car.speed) / 130);
      car.angle += steerInput * DRIVE.steer * grip * dt * Math.sign(car.speed) * (hand ? 1.5 : 1);
    }
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    // A hard handbrake turn lays down a little tyre smoke.
    if (hand && Math.abs(car.speed) > 150 && chance(world.random, 0.55)) {
      const rearX = car.x - Math.cos(car.angle) * 20;
      const rearY = car.y - Math.sin(car.angle) * 20;
      world.particles.push({ x: rearX, y: rearY, vx: randRange(world.random, -24, 24), vy: randRange(world.random, -24, 24), t: 0, life: randRange(world.random, 0.3, 0.6), color: '#3a3f47', size: randRange(world.random, 3, 5.5) });
    }
    const hitWall = collideCircle(city, car, DRIVE.radius);
    if (hitWall) {
      if (Math.abs(car.speed) > 250) {
        car.wrecked = true;
        world.damagePlayer(9);
        world.queueSound('crash');
        sparks(car.x, car.y, 16, '#ffb347');
        world.announce('Wrecked. Get out and find another ride.');
      } else if (Math.abs(car.speed) > 60) {
        world.queueSound('crash');
        sparks(car.x, car.y, 5, '#ffd23f');
      }
      car.speed *= -0.22;
    }
    // Car-on-car: shove apart; a fast hit crunches, sparks, and counts as a crime.
    for (const other of world.cars) {
      if (other === car) continue;
      const d = Math.hypot(other.x - car.x, other.y - car.y);
      if (d > 0.01 && d < 37) {
        const push = (37 - d) / 2;
        const nx = (other.x - car.x) / d;
        const ny = (other.y - car.y) / d;
        other.x += nx * push;
        other.y += ny * push;
        car.x -= nx * push;
        car.y -= ny * push;
        if (Math.abs(car.speed) > 120) {
          other.speed = car.speed * 0.35;
          car.speed *= 0.6;
          world.queueSound('crash');
          sparks(other.x, other.y, 7, '#ffd23f');
          if (anyWitness(car.x, car.y, 380)) commitCrime(WANTED.carRam, 'Hit and run.');
          if (other.kind === 'police') commitCrime(WANTED.carRam * 2, 'You rammed a police cruiser.');
        }
      }
    }
    // Pedestrians in the road: clipped under ~235 px/s, run down above it.
    for (const ped of world.peds) {
      if (ped.state === 'down') continue;
      const d = Math.hypot(ped.x - car.x, ped.y - car.y);
      if (d < 27 && Math.abs(car.speed) > 42) {
        const fatal = Math.abs(car.speed) > 235;
        knockDownPedestrian(ped, fatal);
        commitCrime(fatal ? WANTED.killPed : WANTED.hitPed, fatal ? 'You ran someone down.' : 'You clipped a pedestrian.');
        car.speed *= 0.82;
        world.queueSound('crash');
      }
    }
    for (const officer of world.officers) {
      const d = Math.hypot(officer.x - car.x, officer.y - car.y);
      if (d < 27 && Math.abs(car.speed) > 42) {
        officer.state = 'gone';
        commitCrime(WANTED.shotOfficer + 20, 'You ran down a police officer.');
        car.speed *= 0.85;
      }
    }
    p.x = car.x;
    p.y = car.y;
    p.angle = car.angle;
  }

  // -- pickups --------------------------------------------------------------------------------

  /**
   * Pickups are walked (or driven) over: ammo at Coral Arms (restocked on a timer),
   * a first-aid kit at the cafe (restocked after use), and cash dropped by the
   * occasional mugging victim. Health only collects when Marco is actually hurt.
   */
  function updatePickups(dt) {
    const p = world.player;
    world.ammoPickupT -= dt;
    const hasAmmo = world.pickups.some((pk) => pk.kind === 'ammo');
    if (!hasAmmo && world.ammoPickupT <= 0) {
      world.pickups.push({ x: city.gunShop.x, y: city.gunShop.y, kind: 'ammo', amount: 12 });
      world.ammoPickupT = 40;
    }
    const px = p.inCar !== null ? p.inCar.x : p.x;
    const py = p.inCar !== null ? p.inCar.y : p.y;
    const respawns = [];
    world.pickups = world.pickups.filter((pk) => {
      if (Math.hypot(pk.x - px, pk.y - py) > 27) return true;
      if (pk.kind === 'ammo') {
        p.ammo += pk.amount;
        p.hasPistol = true;
        world.announce(`Picked up ${pk.amount} pistol rounds.`);
        world.queueSound('pickup');
      } else if (pk.kind === 'cash') {
        p.cash += pk.amount;
        world.announce(`Picked up $${pk.amount}.`);
        world.queueSound('cash');
      } else if (pk.kind === 'health') {
        if (p.health >= FOOT.health) return true;
        p.health = Math.min(FOOT.health, p.health + pk.amount);
        world.announce('Ate well. Health restored.');
        world.queueSound('pickup');
        respawns.push({ x: city.cafe.x + 30, y: city.cafe.y, kind: 'health', amount: 30 });
      }
      return false;
    });
    for (const pk of respawns) world.pickups.push(pk);
  }

  // -- one step ---------------------------------------------------------------------------------

  function step(dt, input, aim) {
    let events = 0;
    if (world.over !== null) return events;
    world.time += dt;
    const p = world.player;
    p.punchCd = Math.max(0, p.punchCd - dt);
    p.fireCd = Math.max(0, p.fireCd - dt);

    const actions = input.takeActions();
    if (actions & ACTION_WEAPON_1) { p.weapon = 'fist'; world.queueSound('click'); }
    if (actions & ACTION_WEAPON_2 && p.hasPistol) { p.weapon = 'pistol'; world.queueSound('click'); }
    if (actions & ACTION_ENTER_CAR) {
      if (p.inCar !== null) events |= exitCar();
      else {
        const car = nearestEnterableCar();
        if (car !== null) events |= enterCar(car);
      }
    }
    if (p.inCar === null && (actions & ACTION_PUNCH || (input.takeClick() && p.weapon === 'fist'))) punch();
    if (p.inCar === null && p.weapon === 'pistol' && input.firing()) shoot(aim);

    if (p.inCar !== null) updateDriving(dt, input);
    else updateOnFoot(dt, input, aim);

    updateTraffic(world, dt);
    updatePedestrians(world, dt);
    updatePolice(world, dt);
    updateBust(dt);
    updatePickups(dt);

    // Cooling off: heat only drains after a quiet spell with no police eyes nearby.
    const w = world.wanted;
    if (w.heat > 0 && world.time - w.lastCrimeT > WANTED.coolDelay) {
      let seen = false;
      for (const car of world.cars) {
        if (car.kind === 'police' && Math.hypot(car.x - p.x, car.y - p.y) < 520) { seen = true; break; }
      }
      if (!seen) for (const officer of world.officers) if (Math.hypot(officer.x - p.x, officer.y - p.y) < 520) { seen = true; break; }
      if (!seen) {
        w.heat = Math.max(0, w.heat - WANTED.coolRate * dt);
        w.stars = Math.min(WANTED.max, Math.floor(w.heat / WANTED.heatPerStar));
        if (w.heat === 0) world.bustMeter = 0;
      }
    }
    // Slow recovery once the shooting has stopped for a while.
    if (p.health > 0 && p.health < FOOT.health && world.time - p.hurtT > 7) {
      p.health = Math.min(FOOT.health, p.health + 2.2 * dt);
    }

    updateMissions(world, dt);

    // Tracers and particles: short-lived decoration, aged and swept here.
    for (const t of world.tracers) t.t -= dt;
    world.tracers = world.tracers.filter((t) => t.t > 0);
    for (const pt of world.particles) {
      pt.t += dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.9;
      pt.vy *= 0.9;
    }
    world.particles = world.particles.filter((pt) => pt.t < pt.life);

    // The camera chases Marco — and leans into his velocity while he drives, so the
    // road ahead gets more of the screen than the road behind. The lean is capped so
    // it reads as anticipation, not drift.
    const focus = p.inCar !== null ? p.inCar : p;
    let targetX = focus.x;
    let targetY = focus.y;
    if (p.inCar !== null) {
      const lead = 0.38;
      let leadX = Math.cos(p.inCar.angle) * p.inCar.speed * lead;
      let leadY = Math.sin(p.inCar.angle) * p.inCar.speed * lead;
      const leadLen = Math.hypot(leadX, leadY);
      if (leadLen > 130) {
        leadX = (leadX / leadLen) * 130;
        leadY = (leadY / leadLen) * 130;
      }
      targetX += leadX;
      targetY += leadY;
    }
    const k = Math.min(1, 5.5 * dt);
    world.camera.x += (targetX - world.camera.x) * k;
    world.camera.y += (targetY - world.camera.y) * k;

    if (world.over === 'busted') events |= EVENT_BUSTED;
    if (world.over === 'wasted') events |= EVENT_WASTED;
    return events;
  }

  world.step = step;
  world.missionMarker = () => missionMarker(world);
  return world;
}
