// The city's moving population.
//
// Three kinds of AI live here:
//   - traffic cars, which drive the road grid on the correct (right-hand) side,
//     choose their turns at intersections, brake for anything solid ahead of them,
//     light their brake lamps while slowing, and honk if they're stuck too long;
//   - pedestrians, who walk the sidewalk loop around their block, sometimes pause at
//     a corner to check the street, and scatter from fast cars, gunfire and punches;
//   - foot officers, who climb out of cruisers to run Marco down, keep a body's width
//     between each other instead of stacking into one sprite, fall back to their cars
//     when he drives off, and open fire at three stars or more with a clear line.
// Everything operates on the world object owned by world.js; nothing here draws or
// touches the DOM.
import { DRIVE, FOOT, PEDS, PITCH, POLICE, ROAD_W, TRAFFIC, WORLD } from './config.js';
import { collideCircle, isOnRoad, roadCenterX, roadCenterY, segmentBlocked, ROAD_COLS, ROAD_ROWS } from './city.js';
import { chance, pick, randRange } from './random.js';

const LANE = 30;
const PED_COLORS = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#f368e0', '#ff9f43', '#54a0ff', '#5f27cd', '#c8d6e5', '#fd79a8'];
const SKIN_TONES = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];

/** Lane offset for a heading: right-hand traffic, in screen space. */
function laneOffset(dx, dy) {
  return { x: -dy * LANE, y: dx * LANE };
}

function makeCar(x, y, angle, color, topSpeed, kind) {
  // The light-bar phase derives from the spawn point, never from Math.random: the
  // seeded stream is the simulation's only source of chance, which is what makes a
  // staged screenshot scene come out identical every time.
  return {
    x, y, angle, speed: 0, color, topSpeed, kind, driver: null,
    gx: 0, gy: 0, dx: 1, dy: 0, tx: x, ty: y, cruise: TRAFFIC.speed,
    lightPhase: (x * 0.01 + y * 0.013) % 6, wrecked: false,
    braking: false, blockT: 0, honkT: 0,
  };
}

/** Spawn a traffic car at an intersection a comfortable distance from the player. */
export function spawnTrafficCar(world) {
  const { random, player } = world;
  for (let tries = 0; tries < 12; tries += 1) {
    const i = Math.floor(random() * ROAD_COLS);
    const j = Math.floor(random() * ROAD_ROWS);
    const cx = roadCenterX(i);
    const cy = roadCenterY(j);
    const dist = Math.hypot(cx - player.x, cy - player.y);
    if (dist < 470 || dist > 920) continue;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => i + dx >= 0 && i + dx < ROAD_COLS && j + dy >= 0 && j + dy < ROAD_ROWS);
    if (dirs.length === 0) continue;
    const [dx, dy] = pick(random, dirs);
    const off = laneOffset(dx, dy);
    const car = makeCar(cx + off.x, cy + off.y, Math.atan2(dy, dx), pick(random, world.carColors), randRange(random, 320, 400), 'traffic');
    car.driver = 'ai';
    car.gx = i;
    car.gy = j;
    car.dx = dx;
    car.dy = dy;
    const target = trafficTarget(car);
    car.tx = target.x;
    car.ty = target.y;
    car.cruise = TRAFFIC.speed * randRange(random, 0.85, 1.15);
    world.cars.push(car);
    return car;
  }
  return null;
}

/** The next intersection centre (with this car's lane offset) a traffic car aims for. */
function trafficTarget(car) {
  const off = laneOffset(car.dx, car.dy);
  return { x: roadCenterX(car.gx + car.dx) + off.x, y: roadCenterY(car.gy + car.dy) + off.y };
}

/** At an intersection: mostly straight on, sometimes a turn; a U-turn only at the edge. */
function chooseTrafficDirection(world, car) {
  const options = [];
  const straight = { dx: car.dx, dy: car.dy, w: 0.55 };
  const left = { dx: car.dy, dy: -car.dx, w: 0.225 };
  const right = { dx: -car.dy, dy: car.dx, w: 0.225 };
  for (const o of [straight, left, right]) {
    const gi = car.gx + o.dx;
    const gj = car.gy + o.dy;
    if (gi >= 0 && gi < ROAD_COLS && gj >= 0 && gj < ROAD_ROWS) options.push(o);
  }
  if (options.length === 0) {
    car.dx = -car.dx;
    car.dy = -car.dy;
    return;
  }
  let roll = world.random() * options.reduce((sum, o) => sum + o.w, 0);
  for (const o of options) {
    roll -= o.w;
    if (roll <= 0) {
      car.dx = o.dx;
      car.dy = o.dy;
      return;
    }
  }
  car.dx = options[0].dx;
  car.dy = options[0].dy;
}

/** Is anything solid in this car's path — another car, Marco on foot, a pedestrian? */
function trafficBlocked(world, car) {
  const fx = car.x + Math.cos(car.angle) * (DRIVE.radius + 30);
  const fy = car.y + Math.sin(car.angle) * (DRIVE.radius + 30);
  for (const other of world.cars) {
    if (other === car) continue;
    if (Math.hypot(other.x - fx, other.y - fy) < 34) return true;
  }
  const p = world.player;
  if (p.inCar === null && Math.hypot(p.x - fx, p.y - fy) < 30) return true;
  for (const ped of world.peds) {
    if (ped.state !== 'down' && Math.hypot(ped.x - fx, ped.y - fy) < 30) return true;
  }
  return false;
}

/**
 * Step every AI traffic car: steer toward the lane target, ease toward cruise speed
 * or a full stop, and keep the brake-lamp flag honest for the renderer. A car held up
 * for a while leans on its horn (a queued sound — the world decides what plays).
 */
export function updateTraffic(world, dt) {
  for (const car of world.cars) {
    if (car.driver !== 'ai' || car.kind !== 'traffic') continue;
    const dist = Math.hypot(car.tx - car.x, car.ty - car.y);
    if (dist < 34) {
      car.gx += car.dx;
      car.gy += car.dy;
      chooseTrafficDirection(world, car);
      const target = trafficTarget(car);
      car.tx = target.x;
      car.ty = target.y;
    }
    const wanted = Math.atan2(car.ty - car.y, car.tx - car.x);
    let diff = wanted - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    car.angle += Math.max(-2.4 * dt, Math.min(2.4 * dt, diff));
    const blocked = trafficBlocked(world, car);
    const goal = blocked ? 0 : car.cruise;
    car.braking = goal < car.speed - 6;
    car.speed += Math.max(-420 * dt, Math.min(190 * dt, goal - car.speed));
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    // Impatience, audibly: stuck behind something for a stretch earns one honk.
    car.honkT = Math.max(0, car.honkT - dt);
    if (blocked && car.speed < 12) {
      car.blockT += dt;
      if (car.blockT > 1.7 && car.honkT <= 0) {
        world.queueSound('honk');
        car.honkT = randRange(world.random, 3, 6);
        car.blockT = 0.6;
      }
    } else {
      car.blockT = 0;
    }
  }
  // The population is maintained around the player; distant traffic quietly despawns.
  const p = world.player;
  world.cars = world.cars.filter((car) => car.kind !== 'traffic' || Math.hypot(car.x - p.x, car.y - p.y) < 1150 || car.driver === 'player');
  let trafficCount = 0;
  for (const car of world.cars) if (car.kind === 'traffic') trafficCount += 1;
  if (trafficCount < TRAFFIC.count) spawnTrafficCar(world);
}

/** One corner of a block's sidewalk loop (pedestrians walk the loop in order). */
function blockCorner(bi, bj, corner) {
  const x0 = ROAD_W + bi * PITCH + 8;
  const y0 = ROAD_W + bj * PITCH + 8;
  const s = 280 - 16;
  const corners = [{ x: x0, y: y0 }, { x: x0 + s, y: y0 }, { x: x0 + s, y: y0 + s }, { x: x0, y: y0 + s }];
  return corners[corner % 4];
}

/** Spawn a pedestrian on a block near the player, already walking its loop. */
export function spawnPedestrian(world) {
  const { random, player } = world;
  const bi = Math.max(0, Math.min(ROAD_COLS - 2, Math.floor((player.x + randRange(random, -560, 560)) / PITCH)));
  const bj = Math.max(0, Math.min(ROAD_ROWS - 2, Math.floor((player.y + randRange(random, -560, 560)) / PITCH)));
  const corner = Math.floor(random() * 4);
  const at = blockCorner(bi, bj, corner);
  const ped = {
    x: at.x, y: at.y, angle: random() * Math.PI * 2, speed: PEDS.walk * randRange(random, 0.8, 1.2),
    color: pick(random, PED_COLORS), skin: pick(random, SKIN_TONES),
    state: 'wander', bi, bj, corner, tx: at.x, ty: at.y, panicT: 0, downT: 0, waitT: 0, dead: false,
  };
  const next = blockCorner(bi, bj, corner + 1);
  ped.tx = next.x;
  ped.ty = next.y;
  world.peds.push(ped);
  return ped;
}

/** Knock a pedestrian down (fist, bullet or bumper). The world decides if it's a crime. */
export function knockDownPedestrian(ped, fatal) {
  ped.state = 'down';
  ped.downT = fatal ? 14 : 7;
  ped.dead = fatal;
}

/** What would frighten this pedestrian right now, if anything? */
function pedestrianThreat(world, ped) {
  const p = world.player;
  if (p.inCar !== null && Math.abs(p.inCar.speed) > 190 && Math.hypot(p.inCar.x - ped.x, p.inCar.y - ped.y) < 110) {
    return { x: p.inCar.x, y: p.inCar.y };
  }
  if (world.time - world.lastShotT < 0.4 && Math.hypot(world.lastShotX - ped.x, world.lastShotY - ped.y) < 300) {
    return { x: world.lastShotX, y: world.lastShotY };
  }
  if (world.time - world.lastPunchT < 0.3 && Math.hypot(p.x - ped.x, p.y - ped.y) < 90) {
    return { x: p.x, y: p.y };
  }
  for (const car of world.cars) {
    if (car.kind === 'police' && Math.abs(car.speed) > 120 && Math.hypot(car.x - ped.x, car.y - ped.y) < 100) return { x: car.x, y: car.y };
  }
  return null;
}

/**
 * Step every pedestrian. The loop for each is small: if down, lie there until the
 * despawn timer runs out; if threatened, run directly away until the panic fades;
 * otherwise stroll corner to corner, pausing at some corners like a person deciding
 * whether to cross. The crowd is topped back up near the player as members leave.
 */
export function updatePedestrians(world, dt) {
  const p = world.player;
  for (const ped of world.peds) {
    if (ped.state === 'down') {
      ped.downT -= dt;
      continue;
    }
    const threat = pedestrianThreat(world, ped);
    if (threat !== null) {
      ped.state = 'flee';
      ped.panicT = 1.6;
      ped.waitT = 0;
      ped.tx = ped.x + (ped.x - threat.x);
      ped.ty = ped.y + (ped.y - threat.y);
    }
    if (ped.state === 'flee') {
      ped.panicT -= dt;
      const dx = ped.tx - ped.x;
      const dy = ped.ty - ped.y;
      const d = Math.hypot(dx, dy);
      if (ped.panicT <= 0 || d < 6) {
        ped.state = 'wander';
        // Rejoin the sidewalk loop of whatever block the panic delivered them to.
        ped.bi = Math.max(0, Math.min(ROAD_COLS - 2, Math.floor(ped.x / PITCH)));
        ped.bj = Math.max(0, Math.min(ROAD_ROWS - 2, Math.floor(ped.y / PITCH)));
        const c = blockCorner(ped.bi, ped.bj, ped.corner);
        ped.tx = c.x;
        ped.ty = c.y;
      } else {
        ped.angle = Math.atan2(dy, dx);
        ped.x += Math.cos(ped.angle) * PEDS.flee * dt;
        ped.y += Math.sin(ped.angle) * PEDS.flee * dt;
        collideCircle(world.city, ped, FOOT.radius);
      }
      continue;
    }
    // Wander. A pause at a corner reads as life; movement between corners is plain.
    if (ped.waitT > 0) {
      ped.waitT -= dt;
      continue;
    }
    const dx = ped.tx - ped.x;
    const dy = ped.ty - ped.y;
    const d = Math.hypot(dx, dy);
    if (d < 5) {
      ped.corner = (ped.corner + 1) % 4;
      const c = blockCorner(ped.bi, ped.bj, ped.corner + 1);
      ped.tx = c.x;
      ped.ty = c.y;
      if (chance(world.random, 0.22)) ped.waitT = randRange(world.random, 0.5, 1.6);
    } else {
      ped.angle = Math.atan2(dy, dx);
      ped.x += Math.cos(ped.angle) * ped.speed * dt;
      ped.y += Math.sin(ped.angle) * ped.speed * dt;
    }
  }
  world.peds = world.peds.filter((ped) => !(ped.state === 'down' && ped.downT <= 0) && Math.hypot(ped.x - p.x, ped.y - p.y) < 1250);
  while (world.peds.length < PEDS.count) {
    if (spawnPedestrian(world) === null) break;
    // Spawns land near the player by construction; this is just a runaway guard.
    if (world.peds.length > PEDS.count + 4) break;
  }
}

/** An officer climbs out of a cruiser to chase Marco on foot. */
export function spawnOfficer(world, car) {
  const officer = {
    x: car.x - Math.cos(car.angle) * 24, y: car.y - Math.sin(car.angle) * 24,
    angle: car.angle, fireCd: randRange(world.random, 0.4, 1.1), state: 'chase',
  };
  world.officers.push(officer);
  return officer;
}

/**
 * Step the foot officers. While Marco is on foot they run him down (stopping at
 * arm's length, where the bust meter takes over); while he drives they fall back to
 * the nearest cruiser and leave the chase to it. At three stars or more an officer
 * with range and a clear line shoots, on a personal cadence, through the world's own
 * tracer and damage hooks. Officers also keep a little personal space from each
 * other, so a pile-out reads as three people rather than one fat sprite.
 */
export function updateOfficers(world, dt) {
  const p = world.player;
  const stars = world.wanted.stars;
  for (const officer of world.officers) {
    const dist = Math.hypot(p.x - officer.x, p.y - officer.y);
    if (p.inCar !== null) {
      if (dist > 240) officer.state = 'return';
    } else {
      officer.state = 'chase';
    }
    if (officer.state === 'return') {
      let nearest = null;
      let nd = Infinity;
      for (const car of world.cars) {
        if (car.kind !== 'police') continue;
        const d = Math.hypot(car.x - officer.x, car.y - officer.y);
        if (d < nd) { nd = d; nearest = car; }
      }
      if (nearest === null || nd < 26) {
        officer.state = 'gone';
        continue;
      }
      officer.angle = Math.atan2(nearest.y - officer.y, nearest.x - officer.x);
      officer.x += Math.cos(officer.angle) * POLICE.footSpeed * dt;
      officer.y += Math.sin(officer.angle) * POLICE.footSpeed * dt;
      collideCircle(world.city, officer, FOOT.radius);
      continue;
    }
    // Chase, with a gentle separation push so officers fan out around their target.
    let sx = 0;
    let sy = 0;
    for (const other of world.officers) {
      if (other === officer) continue;
      const ox = officer.x - other.x;
      const oy = officer.y - other.y;
      const od = Math.hypot(ox, oy);
      if (od > 0.01 && od < 24) {
        sx += (ox / od) * (24 - od);
        sy += (oy / od) * (24 - od);
      }
    }
    if (dist > POLICE.bustRangeFoot * 0.8) {
      officer.angle = Math.atan2(p.y - officer.y, p.x - officer.x);
      officer.x += Math.cos(officer.angle) * POLICE.footSpeed * dt + sx * 1.6 * dt;
      officer.y += Math.sin(officer.angle) * POLICE.footSpeed * dt + sy * 1.6 * dt;
      collideCircle(world.city, officer, FOOT.radius);
    } else {
      officer.angle = Math.atan2(p.y - officer.y, p.x - officer.x);
    }
    // Shooting: three stars and up, on foot, mid-range, clear line of fire.
    officer.fireCd -= dt;
    if (stars >= 3 && p.inCar === null && dist < 300 && dist > 46 && officer.fireCd <= 0) {
      officer.fireCd = randRange(world.random, 0.8, 1.4);
      if (!segmentBlocked(world.city, officer.x, officer.y, p.x, p.y)) {
        world.tracers.push({ x1: officer.x, y1: officer.y, x2: p.x, y2: p.y, t: 0.07, hostile: true });
        world.queueSound('gunshot');
        if (world.random() < Math.max(0.15, 0.55 - dist / 700)) world.damagePlayer(7);
      }
    }
  }
  world.officers = world.officers.filter((o) => o.state !== 'gone');
}

/** Turn one of the city's parked-car plans into a live, enterable car entity. */
export function parkedCarEntity(spec) {
  const car = makeCar(spec.x, spec.y, spec.angle, spec.color, spec.topSpeed, 'parked');
  car.driver = null;
  return car;
}

/** A police cruiser: black-and-white under the light bar, AI-driven, pursuit-tuned. */
export function policeCarEntity(world, x, y) {
  const car = makeCar(x, y, 0, '#f2f4f6', 400, 'police');
  car.driver = 'ai';
  car.cruise = POLICE.speed;
  return car;
}

export { isOnRoad };
