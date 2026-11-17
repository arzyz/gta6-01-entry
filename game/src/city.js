// Coral Bay, generated.
//
// This module lays out the whole city from the seeded stream: the road grid, four
// districts (Marina Beach along the south shore, Palm Heights' pastel houses, the
// Downtown tower cluster, and the Portside Docks on the east quay), every building,
// palm, lamp, bench, umbrella and planter, the parked cars waiting to be stolen, and
// the named places the story revolves around — Lena's Harborlight Garage, Cafe Del
// Mar, Pier 9 and the Coral Arms gun shop. It also owns the collision questions the
// rest of the game asks: is this point on asphalt, does this circle overlap anything
// solid, is this sight line blocked by a building?
import { BLOCK, CAR_COLORS, PALETTE, PITCH, ROAD_W, WORLD } from './config.js';
import { chance, pick, randInt, randRange } from './random.js';

export const DISTRICT_BEACH = 'Marina Beach';
export const DISTRICT_DOWNTOWN = 'Downtown';
export const DISTRICT_DOCKS = 'Portside Docks';
export const DISTRICT_SUBURB = 'Palm Heights';

const BUILDING_COLORS = ['#f6e3c5', '#f2b8c6', '#bfe3dd', '#f9d976', '#c9d6f2', '#f4a988', '#d9ead3', '#e6ccf0'];
const TOWER_COLORS = ['#7f8ea3', '#93a5bb', '#6e7f95', '#a8b6c6', '#8795a8'];
const HOUSE_COLORS = ['#fdf3d8', '#fde8e0', '#e3f2e1', '#e0ecfd', '#fbe9f4', '#fff7cc'];
const UMBRELLA_COLORS = [PALETTE.umbrella, PALETTE.umbrellaAlt, '#4ecdc4', '#ff6b6b'];

/** Centre line of the i-th north-south road. */
export function roadCenterX(i) {
  return ROAD_W / 2 + i * PITCH;
}

/** Centre line of the j-th east-west road. */
export function roadCenterY(j) {
  return ROAD_W / 2 + j * PITCH;
}

export const ROAD_COLS = Math.floor((WORLD.width - ROAD_W) / PITCH) + 1;
export const ROAD_ROWS = Math.floor((WORLD.height - ROAD_W) / PITCH) + 1;

/**
 * The district a point falls in. The story beats, the ground paint and the HUD label
 * all read this. Thresholds sit half a block inside the outer roads and are tested
 * against block centres, so the southernmost row of blocks genuinely is the
 * beachfront and the easternmost column genuinely is the docks.
 */
export function districtAt(x, y) {
  if (y > WORLD.height - PITCH - ROAD_W - 140) return DISTRICT_BEACH;
  if (x > WORLD.width - PITCH - ROAD_W - 140) return DISTRICT_DOCKS;
  if (x >= PITCH * 3 && x < PITCH * 5 && y >= PITCH * 2 && y < PITCH * 4) return DISTRICT_DOWNTOWN;
  return DISTRICT_SUBURB;
}

/** Is this point on a road (either direction) and inside the world? */
export function isOnRoad(x, y) {
  if (x < 0 || y < 0 || x > WORLD.width || y > WORLD.height) return false;
  const mx = x % PITCH;
  const my = y % PITCH;
  return mx < ROAD_W || my < ROAD_W;
}

/** Snap a point to the nearest road centre line — used for spawns that must land on a street. */
export function nearestRoadPoint(x, y) {
  const i = Math.max(0, Math.min(ROAD_COLS - 1, Math.round((x - ROAD_W / 2) / PITCH)));
  const j = Math.max(0, Math.min(ROAD_ROWS - 1, Math.round((y - ROAD_W / 2) / PITCH)));
  const cx = roadCenterX(i);
  const cy = roadCenterY(j);
  return Math.abs(x - cx) < Math.abs(y - cy) ? { x: cx, y } : { x, y: cy };
}

function circleHitsRect(x, y, r, rect) {
  const nx = Math.max(rect.x, Math.min(x, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(y, rect.y + rect.h));
  const dx = x - nx;
  const dy = y - ny;
  return dx * dx + dy * dy < r * r;
}

/**
 * Resolve a moving circle (Marco, a pedestrian, a car) against the world: clamp it to
 * the map edge, then push it out of every building and palm trunk it overlaps, along
 * whichever axis penetrates least. Returns true if anything pushed, so callers can
 * play a thud, throw sparks or call it a wreck. The building count is small enough
 * that a straight scan beats any spatial index here.
 */
export function collideCircle(city, pos, radius) {
  let hit = false;
  pos.x = Math.max(radius, Math.min(WORLD.width - radius, pos.x));
  pos.y = Math.max(radius, Math.min(WORLD.height - radius, pos.y));
  for (const b of city.buildings) {
    if (!circleHitsRect(pos.x, pos.y, radius, b)) continue;
    const left = pos.x + radius - b.x;
    const right = b.x + b.w + radius - pos.x;
    const top = pos.y + radius - b.y;
    const bottom = b.y + b.h + radius - pos.y;
    const min = Math.min(left, right, top, bottom);
    if (min === left) pos.x = b.x - radius;
    else if (min === right) pos.x = b.x + b.w + radius;
    else if (min === top) pos.y = b.y - radius;
    else pos.y = b.y + b.h + radius;
    hit = true;
  }
  for (const p of city.palms) {
    const dx = pos.x - p.x;
    const dy = pos.y - p.y;
    const d2 = dx * dx + dy * dy;
    const rr = radius + 6;
    if (d2 < rr * rr && d2 > 0.01) {
      const d = Math.sqrt(d2);
      pos.x = p.x + (dx / d) * rr;
      pos.y = p.y + (dy / d) * rr;
      hit = true;
    }
  }
  return hit;
}

/** Is the straight segment a→b interrupted by a building? (Bullets and sight lines.) */
export function segmentBlocked(city, ax, ay, bx, by) {
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 14);
  for (let s = 1; s < steps; s += 1) {
    const t = s / steps;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    for (const b of city.buildings) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
    }
  }
  return false;
}

/**
 * Build the city once. Alongside the geometry this returns the story's fixed places:
 * the garage, cafe, docks pickup and gun shop are hand-placed (not rolled) so the
 * missions always stage well, while everything decorative is seeded.
 */
export function createCity(random) {
  const buildings = [];
  const palms = [];
  const lamps = [];
  const benches = [];
  const crates = [];
  const umbrellas = [];
  const planters = [];

  for (let bi = 0; bi < ROAD_COLS - 1; bi += 1) {
    for (let bj = 0; bj < ROAD_ROWS - 1; bj += 1) {
      const bx = ROAD_W + bi * PITCH + 14;
      const by = ROAD_W + bj * PITCH + 14;
      const bw = BLOCK - 28;
      const bh = BLOCK - 28;
      const cx = bx + bw / 2;
      const cy = by + bh / 2;
      const district = districtAt(cx, cy);
      if (district === DISTRICT_DOWNTOWN) {
        // One tower per block, slightly inset, plus planters softening its corners.
        const inset = randInt(random, 6, 26);
        buildings.push({ x: bx + inset, y: by + inset, w: bw - inset * 2, h: bh - inset * 2, color: pick(random, TOWER_COLORS), style: 'tower', floors: randInt(random, 6, 11) });
        planters.push({ x: bx + 4, y: by + 4 });
        planters.push({ x: bx + bw - 28, y: by + bh - 28 });
      } else if (district === DISTRICT_DOCKS) {
        // Two long warehouses and a scatter of cargo crates in the yard between them.
        buildings.push({ x: bx + 10, y: by + 30, w: bw - 20, h: 96, color: PALETTE.warehouse, style: 'warehouse', floors: 1 });
        buildings.push({ x: bx + 10, y: by + 150, w: bw - 20, h: 84, color: PALETTE.warehouse, style: 'warehouse', floors: 1 });
        for (let c = 0; c < 4; c += 1) crates.push({ x: bx + randRange(random, 8, bw - 34), y: by + randRange(random, 8, bh - 34), s: randInt(random, 20, 30) });
      } else if (district === DISTRICT_BEACH) {
        // No buildings on the promenade: open sand, palms, benches, beach umbrellas.
        for (let p = 0; p < 5; p += 1) palms.push({ x: bx + randRange(random, 16, bw - 16), y: by + randRange(random, 16, bh - 16) });
        benches.push({ x: bx + 30, y: by + bh - 22 });
        benches.push({ x: bx + bw - 52, y: by + bh - 22 });
        for (let u = 0; u < 2; u += 1) {
          umbrellas.push({ x: bx + randRange(random, 30, bw - 30), y: by + randRange(random, 30, bh - 40), color: pick(random, UMBRELLA_COLORS) });
        }
      } else {
        // Palm Heights: a neat four-house block, a garden palm more often than not,
        // and the odd planter where two front paths meet.
        const hw = (bw - 18) / 2;
        const hh = (bh - 18) / 2;
        for (let hx = 0; hx < 2; hx += 1) {
          for (let hy = 0; hy < 2; hy += 1) {
            buildings.push({ x: bx + hx * (hw + 18) + 6, y: by + hy * (hh + 18) + 6, w: hw - 12, h: hh - 12, color: pick(random, HOUSE_COLORS), style: 'house', floors: 2 });
          }
        }
        if (chance(random, 0.8)) palms.push({ x: bx + bw / 2, y: by + bh / 2 });
        if (chance(random, 0.35)) planters.push({ x: bx + bw / 2 - 12, y: by + 6 });
      }
    }
  }

  // A palm at every beachfront intersection and lamps dotted along the kerbs.
  for (let i = 0; i < ROAD_COLS; i += 1) {
    palms.push({ x: roadCenterX(i) - ROAD_W / 2 - 12, y: WORLD.height - 70 });
    lamps.push({ x: roadCenterX(i) + ROAD_W / 2 + 8, y: roadCenterY(ROAD_ROWS - 1) - ROAD_W / 2 - 8 });
    if (i % 2 === 0) {
      for (let j = 0; j < ROAD_ROWS; j += 2) lamps.push({ x: roadCenterX(i) - ROAD_W / 2 - 9, y: roadCenterY(j) - ROAD_W / 2 - 9 });
    }
  }

  // The story's fixed addresses.
  const garage = { x: roadCenterX(2) + 96, y: roadCenterY(2) + 40, name: 'Harborlight Garage' };
  const cafe = { x: roadCenterX(5) + 40, y: roadCenterY(ROAD_ROWS - 1) - 130, name: 'Cafe Del Mar' };
  const docksPickup = { x: roadCenterX(ROAD_COLS - 1) - 150, y: roadCenterY(1) + 30, name: 'Pier 9, Portside Docks' };
  const gunShop = { x: roadCenterX(4) - 50, y: roadCenterY(3) + 70, name: 'Coral Arms' };
  const stashSpots = [
    { x: roadCenterX(1), y: roadCenterY(0) + 340, name: 'the old lighthouse path' },
    { x: roadCenterX(6) - 170, y: roadCenterY(4) + 40, name: 'a Downtown parking court' },
    { x: roadCenterX(3) + 30, y: roadCenterY(ROAD_ROWS - 1) - 170, name: 'the beach showers' },
  ];

  // Parked cars hug the kerbs all over town, angled with their road, empty and
  // unlocked — each one a small crime waiting for a driver. Two are placed by hand
  // near the garage so a brand-new Marco always has a first ride in sight.
  const parkedCars = [];
  for (let n = 0; n < 26; n += 1) {
    const vertical = chance(random, 0.5);
    const i = randInt(random, 0, ROAD_COLS - 1);
    const j = randInt(random, 0, ROAD_ROWS - 1);
    const along = randRange(random, -WORLD.height / 2, WORLD.height / 2);
    let x;
    let y;
    let angle;
    if (vertical) {
      x = roadCenterX(i) + (chance(random, 0.5) ? -ROAD_W / 2 + 16 : ROAD_W / 2 - 16);
      y = Math.max(40, Math.min(WORLD.height - 40, roadCenterY(j) + along % 600));
      angle = chance(random, 0.5) ? Math.PI / 2 : -Math.PI / 2;
    } else {
      y = roadCenterY(j) + (chance(random, 0.5) ? -ROAD_W / 2 + 16 : ROAD_W / 2 - 16);
      x = Math.max(40, Math.min(WORLD.width - 40, roadCenterX(i) + along % 600));
      angle = chance(random, 0.5) ? 0 : Math.PI;
    }
    parkedCars.push({ x, y, angle, color: pick(random, CAR_COLORS), topSpeed: randRange(random, 330, 430) });
  }
  parkedCars.push({ x: roadCenterX(1) + ROAD_W / 2 - 16, y: roadCenterY(2) + 130, angle: Math.PI / 2, color: '#3498db', topSpeed: 392 });
  parkedCars.push({ x: roadCenterX(2) + 150, y: roadCenterY(3) - ROAD_W / 2 + 16, angle: 0, color: '#e74c3c', topSpeed: 366 });

  return { buildings, palms, lamps, benches, crates, umbrellas, planters, parkedCars, garage, cafe, docksPickup, gunShop, stashSpots };
}
