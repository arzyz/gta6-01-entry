// Pixels only. The renderer takes the world state and a screen name and paints one
// frame: Coral Bay under a camera centred on a 1280x720 logical window (scaled and
// letterboxed onto the real canvas), then the HUD — minimap, health, cash, wanted
// stars, objective, weapon, speedometer — then any full-screen panel the current
// screen calls for. Flat vector shapes in the sunny palette throughout; no images,
// no webfonts, nothing to load.
import { BLOCK, PALETTE, PITCH, ROAD_W, VIEW, WORLD } from './config.js';
import { districtAt, roadCenterX, roadCenterY, ROAD_COLS, ROAD_ROWS } from './city.js';
import { MISSION_INFO } from './missions.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_BUSTED = 'busted';
export const SCREEN_WASTED = 'wasted';

/** Ground tint per district, keyed by the names city.js assigns. */
const DISTRICT_GROUND = {
  'Marina Beach': '#e8cf9e',
  'Portside Docks': '#b8ab98',
  'Downtown': '#c9cdd4',
  'Palm Heights': '#a8c68f',
};

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  let lastDistrict = '';
  let districtT = 0;
  let lastTime = 0;

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / VIEW.width, height / VIEW.height);
    view.x = (width - VIEW.width * view.scale) / 2;
    view.y = (height - VIEW.height * view.scale) / 2;
  }

  function text(value, x, y, size, color, align = 'left', weight = 600) {
    ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(value, x, y);
  }

  function panel(x, y, w, h, radius = 12) {
    ctx.fillStyle = PALETTE.panel;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();
  }

  /** Cheap visibility test against the camera window, with a margin for big sprites. */
  function inView(world, x, y, margin = 90) {
    return Math.abs(x - world.camera.x) < VIEW.width / 2 + margin && Math.abs(y - world.camera.y) < VIEW.height / 2 + margin;
  }

  // -- the city -------------------------------------------------------------------------

  function drawGround(world) {
    const { city } = world;
    // Sea first (it surrounds everything), then the landmass.
    ctx.fillStyle = PALETTE.sea;
    ctx.fillRect(world.camera.x - VIEW.width / 2 - 100, world.camera.y - VIEW.height / 2 - 100, VIEW.width + 200, VIEW.height + 200);
    ctx.fillStyle = PALETTE.grass;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    // One ground pad per block: district tint, sidewalk rim, district tint again.
    for (let bi = 0; bi < ROAD_COLS - 1; bi += 1) {
      for (let bj = 0; bj < ROAD_ROWS - 1; bj += 1) {
        const x = ROAD_W + bi * PITCH;
        const y = ROAD_W + bj * PITCH;
        if (!inView(world, x + BLOCK / 2, y + BLOCK / 2, 320)) continue;
        const ground = DISTRICT_GROUND[districtAt(x + BLOCK / 2, y + BLOCK / 2)] ?? PALETTE.blockPad;
        ctx.fillStyle = ground;
        ctx.fillRect(x, y, BLOCK, BLOCK);
        ctx.fillStyle = PALETTE.sidewalk;
        ctx.fillRect(x + 6, y + 6, BLOCK - 12, BLOCK - 12);
        ctx.fillStyle = ground;
        ctx.fillRect(x + 14, y + 14, BLOCK - 28, BLOCK - 28);
      }
    }
    // Where the blocks run out: beach sand to the south, dock concrete to the east,
    // then harbour water, with a foam line that sparkles as time passes.
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(0, roadCenterY(ROAD_ROWS - 1) + ROAD_W / 2, WORLD.width, WORLD.height);
    ctx.fillStyle = '#b8ab98';
    ctx.fillRect(roadCenterX(ROAD_COLS - 1) + ROAD_W / 2, 0, WORLD.width, WORLD.height);
    ctx.fillStyle = PALETTE.sea;
    ctx.fillRect(0, WORLD.height - 42, WORLD.width, 42);
    ctx.fillRect(WORLD.width - 42, 0, 42, WORLD.height);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillRect(0, WORLD.height - 44, WORLD.width, 3);
    ctx.fillRect(WORLD.width - 44, 0, 3, WORLD.height);
    for (let sx = 30; sx < WORLD.width; sx += 90) {
      if (!inView(world, sx, WORLD.height - 30, 60)) continue;
      ctx.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(world.time * 2.2 + sx * 0.11));
      ctx.fillRect(sx, WORLD.height - 34 - (sx % 3) * 4, 26, 2.5);
    }
    for (let sy = 30; sy < WORLD.height; sy += 90) {
      if (!inView(world, WORLD.width - 30, sy, 60)) continue;
      ctx.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(world.time * 2.2 + sy * 0.13 + 2));
      ctx.fillRect(WORLD.width - 34 - (sy % 3) * 4, sy, 2.5, 26);
    }
    ctx.globalAlpha = 1;
    // Asphalt strips, kerb dashes down the centres, crosswalks at each junction.
    ctx.fillStyle = PALETTE.road;
    for (let i = 0; i < ROAD_COLS; i += 1) ctx.fillRect(roadCenterX(i) - ROAD_W / 2, 0, ROAD_W, WORLD.height);
    for (let j = 0; j < ROAD_ROWS; j += 1) ctx.fillRect(0, roadCenterY(j) - ROAD_W / 2, WORLD.width, ROAD_W);
    ctx.strokeStyle = PALETTE.lane;
    ctx.lineWidth = 4;
    ctx.setLineDash([26, 30]);
    for (let i = 0; i < ROAD_COLS; i += 1) {
      ctx.beginPath();
      ctx.moveTo(roadCenterX(i), 0);
      ctx.lineTo(roadCenterX(i), WORLD.height);
      ctx.stroke();
    }
    for (let j = 0; j < ROAD_ROWS; j += 1) {
      ctx.beginPath();
      ctx.moveTo(0, roadCenterY(j));
      ctx.lineTo(WORLD.width, roadCenterY(j));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = PALETTE.crosswalk;
    for (let i = 0; i < ROAD_COLS; i += 1) {
      for (let j = 0; j < ROAD_ROWS; j += 1) {
        const cx = roadCenterX(i);
        const cy = roadCenterY(j);
        if (!inView(world, cx, cy, 200)) continue;
        for (let s = -2; s <= 2; s += 1) {
          ctx.fillRect(cx + s * 22 - 7, cy - ROAD_W / 2 + 4, 14, 16);
          ctx.fillRect(cx + s * 22 - 7, cy + ROAD_W / 2 - 20, 14, 16);
        }
      }
    }
    // Buildings: a drop shadow, the body, a lighter inset, then per-style detail —
    // window grids for towers, a roof and door for houses, seams for warehouses.
    for (const b of city.buildings) {
      if (!inView(world, b.x + b.w / 2, b.y + b.h / 2, 320)) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(b.x + 7, b.y + 9, b.w, b.h);
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(b.x + 5, b.y + 5, b.w - 10, b.h - 10);
      if (b.style === 'tower') {
        ctx.fillStyle = 'rgba(30,48,72,0.55)';
        const cols = Math.floor((b.w - 16) / 22);
        const rows = Math.floor((b.h - 16) / 22);
        for (let cx = 0; cx < cols; cx += 1) {
          for (let cy = 0; cy < rows; cy += 1) {
            if ((cx * 7 + cy * 13) % 5 === 0) continue;
            ctx.fillRect(b.x + 10 + cx * 22, b.y + 10 + cy * 22, 11, 13);
          }
        }
      } else if (b.style === 'house') {
        ctx.fillStyle = 'rgba(146,64,44,0.75)';
        ctx.fillRect(b.x + 8, b.y + 8, b.w - 16, b.h - 16);
        ctx.fillStyle = '#6b4a2f';
        ctx.fillRect(b.x + b.w / 2 - 7, b.y + b.h - 20, 14, 14);
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.14)';
        for (let s = 1; s < 4; s += 1) ctx.fillRect(b.x, b.y + (b.h / 4) * s - 3, b.w, 6);
      }
    }
    // Street furniture: crates, benches, planters, beach umbrellas, lamps, palms.
    ctx.fillStyle = PALETTE.crate;
    for (const c of city.crates) {
      if (!inView(world, c.x, c.y, 60)) continue;
      ctx.fillRect(c.x, c.y, c.s, c.s);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 2;
      ctx.strokeRect(c.x + 2, c.y + 2, c.s - 4, c.s - 4);
    }
    ctx.fillStyle = PALETTE.bench;
    for (const bench of city.benches) {
      if (!inView(world, bench.x, bench.y, 60)) continue;
      ctx.fillRect(bench.x, bench.y, 44, 10);
    }
    for (const planter of city.planters) {
      if (!inView(world, planter.x, planter.y, 60)) continue;
      ctx.fillStyle = '#8a6844';
      ctx.fillRect(planter.x, planter.y + 8, 24, 14);
      ctx.fillStyle = PALETTE.planter;
      ctx.beginPath();
      ctx.arc(planter.x + 7, planter.y + 8, 8, 0, Math.PI * 2);
      ctx.arc(planter.x + 17, planter.y + 6, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.planterDark;
      ctx.beginPath();
      ctx.arc(planter.x + 12, planter.y + 10, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const umbrella of city.umbrellas) {
      if (!inView(world, umbrella.x, umbrella.y, 60)) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.ellipse(umbrella.x + 3, umbrella.y + 4, 17, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#f5f0e6';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(umbrella.x, umbrella.y + 6);
      ctx.lineTo(umbrella.x, umbrella.y - 6);
      ctx.stroke();
      ctx.fillStyle = umbrella.color;
      ctx.beginPath();
      ctx.moveTo(umbrella.x - 18, umbrella.y - 4);
      ctx.lineTo(umbrella.x + 18, umbrella.y - 4);
      ctx.lineTo(umbrella.x, umbrella.y - 15);
      ctx.closePath();
      ctx.fill();
    }
    for (const lamp of city.lamps) {
      if (!inView(world, lamp.x, lamp.y, 60)) continue;
      ctx.fillStyle = PALETTE.lampPost;
      ctx.fillRect(lamp.x - 2, lamp.y - 2, 4, 4);
      ctx.fillStyle = PALETTE.lampGlow;
      ctx.beginPath();
      ctx.arc(lamp.x, lamp.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const palm of city.palms) {
      if (!inView(world, palm.x, palm.y, 80)) continue;
      ctx.strokeStyle = PALETTE.palmTrunk;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(palm.x, palm.y);
      ctx.lineTo(palm.x + 4, palm.y - 6);
      ctx.stroke();
      ctx.strokeStyle = PALETTE.palmLeaf;
      ctx.lineWidth = 3.4;
      for (let f = 0; f < 6; f += 1) {
        const a = (f / 6) * Math.PI * 2 + 0.4;
        ctx.beginPath();
        ctx.moveTo(palm.x + 4, palm.y - 6);
        ctx.quadraticCurveTo(palm.x + 4 + Math.cos(a) * 13, palm.y - 6 + Math.sin(a) * 13 - 5, palm.x + 4 + Math.cos(a) * 20, palm.y - 6 + Math.sin(a) * 20 + 3);
        ctx.stroke();
      }
    }
    // The named places get ground signs so the player learns the map by eye.
    drawPlaceSign(city.garage.x, city.garage.y, 'HARBORLIGHT GARAGE', '#ffd23f');
    drawPlaceSign(city.gunShop.x, city.gunShop.y, 'CORAL ARMS', '#ff5d8f');
    drawPlaceSign(city.cafe.x, city.cafe.y, 'CAFE DEL MAR', '#2ec4b6');
  }

  function drawPlaceSign(x, y, label, color) {
    ctx.font = '700 13px system-ui, sans-serif';
    const w = ctx.measureText(label).width + 18;
    ctx.fillStyle = 'rgba(13,21,32,0.72)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 44, w, 22, 6);
    ctx.fill();
    text(label, x, y - 29, 13, color, 'center', 700);
  }

  // -- markers, pickups, effects -----------------------------------------------------------

  function drawMarker(world, marker) {
    if (marker === null) return;
    const pulse = 1 + Math.sin(world.time * 4) * 0.12;
    const grad = ctx.createLinearGradient(0, marker.y - 300, 0, marker.y);
    grad.addColorStop(0, 'rgba(255,210,63,0)');
    grad.addColorStop(1, PALETTE.beacon);
    ctx.fillStyle = grad;
    ctx.fillRect(marker.x - 16, marker.y - 300, 32, 300);
    ctx.strokeStyle = PALETTE.marker;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, 26 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = PALETTE.marker;
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPickups(world) {
    for (const pk of world.pickups) {
      if (!inView(world, pk.x, pk.y, 60)) continue;
      const bob = Math.sin(world.time * 3 + pk.x) * 3;
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath();
      ctx.ellipse(pk.x, pk.y + 8, 12, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      if (pk.kind === 'ammo') {
        ctx.fillStyle = '#37474f';
        ctx.fillRect(pk.x - 10, pk.y - 7 + bob, 20, 14);
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(pk.x - 10, pk.y - 2 + bob, 20, 4);
      } else if (pk.kind === 'cash') {
        ctx.fillStyle = '#2e9e4f';
        ctx.beginPath();
        ctx.arc(pk.x, pk.y + bob, 10, 0, Math.PI * 2);
        ctx.fill();
        text('$', pk.x, pk.y + 4 + bob, 13, '#ffffff', 'center', 800);
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(pk.x, pk.y + bob, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff5147';
        ctx.fillRect(pk.x - 2.5, pk.y - 6 + bob, 5, 12);
        ctx.fillRect(pk.x - 6, pk.y - 2.5 + bob, 12, 5);
      }
    }
  }

  function drawCar(world, car) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(2, 4, 27, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = car.wrecked ? '#4a4a4a' : car.color;
    ctx.beginPath();
    ctx.roundRect(-25, -12, 50, 24, 7);
    ctx.fill();
    if (car.kind === 'police') {
      ctx.fillStyle = PALETTE.policeTrim;
      ctx.fillRect(-25, -12, 50, 6);
      ctx.fillRect(-25, 6, 50, 6);
      const phase = Math.sin(world.time * 10 + car.lightPhase) > 0;
      ctx.fillStyle = phase ? PALETTE.lightRed : '#7a1f1a';
      ctx.fillRect(-7, -8, 6, 16);
      ctx.fillStyle = phase ? '#7ab5ff' : PALETTE.lightBlue;
      ctx.fillRect(1, -8, 6, 16);
      if (Math.abs(car.speed) > 4) {
        ctx.fillStyle = phase ? 'rgba(255,59,48,0.20)' : 'rgba(46,127,255,0.20)';
        ctx.beginPath();
        ctx.arc(0, 0, 44 + Math.sin(world.time * 10 + car.lightPhase) * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(20,30,44,0.85)';
    ctx.beginPath();
    ctx.roundRect(2, -9, 13, 18, 3);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(-16, -9, 8, 18, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    ctx.beginPath();
    ctx.roundRect(-6, -10, 10, 20, 4);
    ctx.fill();
    ctx.fillStyle = '#15181d';
    ctx.fillRect(-19, -15, 11, 5);
    ctx.fillRect(-19, 10, 11, 5);
    ctx.fillRect(9, -15, 11, 5);
    ctx.fillRect(9, 10, 11, 5);
    // Headlights at the nose; brake lamps at the tail, bright while slowing.
    ctx.fillStyle = '#ffe9a3';
    ctx.fillRect(23, -9, 3, 5);
    ctx.fillRect(23, 4, 3, 5);
    ctx.fillStyle = car.braking ? PALETTE.brakeOn : PALETTE.brakeOff;
    ctx.fillRect(-26, -9, 3, 5);
    ctx.fillRect(-26, 4, 3, 5);
    if (car.wrecked) {
      ctx.fillStyle = 'rgba(30,30,30,0.5)';
      ctx.beginPath();
      ctx.arc(14 + Math.sin(world.time * 2 + car.x) * 2, -4, 9 + Math.sin(world.time * 3) * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPerson(x, y, angle, bodyColor, skin, down) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(x, y + 3, 11, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    if (down) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.ellipse(0, 0, 15, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(16, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.arc(x, y, 9.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(x + Math.cos(angle) * 3.4, y + Math.sin(angle) * 3.4, 5.4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawEntities(world) {
    for (const car of world.cars) {
      if (world.player.inCar === car) continue;
      if (!inView(world, car.x, car.y)) continue;
      drawCar(world, car);
    }
    if (world.player.inCar !== null) drawCar(world, world.player.inCar);
    for (const ped of world.peds) {
      if (!inView(world, ped.x, ped.y, 50)) continue;
      drawPerson(ped.x, ped.y, ped.angle, ped.dead && ped.state === 'down' ? '#6e6e6e' : ped.color, ped.skin, ped.state === 'down');
    }
    for (const officer of world.officers) {
      if (!inView(world, officer.x, officer.y, 50)) continue;
      drawPerson(officer.x, officer.y, officer.angle, '#20365e', '#e0ac69', false);
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(officer.x - 3, officer.y - 11, 6, 3);
    }
    const p = world.player;
    if (p.inCar === null) {
      drawPerson(p.x, p.y, p.angle, PALETTE.player, PALETTE.playerSkin, false);
      if (p.weapon === 'pistol') {
        ctx.strokeStyle = '#22252b';
        ctx.lineWidth = 3.4;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(p.angle) * 8, p.y + Math.sin(p.angle) * 8);
        ctx.lineTo(p.x + Math.cos(p.angle) * 19, p.y + Math.sin(p.angle) * 19);
        ctx.stroke();
      } else if (p.punchCd > 0.18) {
        ctx.fillStyle = PALETTE.playerSkin;
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(p.angle) * 17, p.y + Math.sin(p.angle) * 17, 4.4, 0, Math.PI * 2);
        ctx.fill();
      }
      // A soft pulsing ring, so Marco reads at a glance even in a crowd.
      ctx.strokeStyle = 'rgba(255,207,63,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 15 + Math.sin(world.time * 3) * 1.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const t of world.tracers) {
      ctx.strokeStyle = t.hostile ? 'rgba(255,90,80,0.85)' : 'rgba(255,230,150,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(t.x1, t.y1);
      ctx.lineTo(t.x2, t.y2);
      ctx.stroke();
    }
    for (const pt of world.particles) {
      ctx.globalAlpha = Math.max(0, 1 - pt.t / pt.life);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
  }

  // -- HUD -----------------------------------------------------------------------------------

  function drawMinimap(world, marker) {
    const mx = 16;
    const my = 16;
    const mw = 212;
    const mh = 159;
    const sx = mw / WORLD.width;
    const sy = mh / WORLD.height;
    ctx.fillStyle = 'rgba(13,21,32,0.82)';
    ctx.beginPath();
    ctx.roundRect(mx - 4, my - 4, mw + 8, mh + 8, 10);
    ctx.fill();
    ctx.fillStyle = PALETTE.sea;
    ctx.fillRect(mx, my, mw, mh);
    ctx.fillStyle = '#9db98a';
    ctx.fillRect(mx, my, mw, mh - PITCH * sy - 4);
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(mx, my + (WORLD.height - PITCH - ROAD_W - 140) * sy, mw, mh - (WORLD.height - PITCH - ROAD_W - 140) * sy);
    ctx.fillStyle = 'rgba(60,65,76,0.9)';
    for (let i = 0; i < ROAD_COLS; i += 1) ctx.fillRect(mx + (roadCenterX(i) - ROAD_W / 2) * sx, my, ROAD_W * sx, mh);
    for (let j = 0; j < ROAD_ROWS; j += 1) ctx.fillRect(mx, my + (roadCenterY(j) - ROAD_W / 2) * sy, mw, ROAD_W * sy);
    const dot = (x, y, color, r) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(mx + x * sx, my + y * sy, r, 0, Math.PI * 2);
      ctx.fill();
    };
    // Fixed points of interest, then the mission marker pulsing over them.
    dot(world.city.garage.x, world.city.garage.y, '#ffd23f', 3.4);
    dot(world.city.gunShop.x, world.city.gunShop.y, '#ff5d8f', 2.6);
    dot(world.city.cafe.x, world.city.cafe.y, '#2ec4b6', 2.6);
    if (marker !== null) {
      dot(marker.x, marker.y, '#ffd23f', 4 + Math.sin(world.time * 5) * 1.2);
      dot(marker.x, marker.y, '#ffffff', 1.8);
    }
    // Police blink red/blue, the way their light bars do.
    const blink = Math.sin(world.time * 9) > 0;
    for (const car of world.cars) {
      if (car.kind === 'police') dot(car.x, car.y, blink ? '#ff3b30' : '#2e7fff', 3);
    }
    for (const officer of world.officers) dot(officer.x, officer.y, '#2e7fff', 2.2);
    // Marco is a white arrow, turned the way he's facing.
    const p = world.player;
    ctx.save();
    ctx.translate(mx + p.x * sx, my + p.y * sy);
    ctx.rotate(p.angle);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-4.4, -4);
    ctx.lineTo(-4.4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    text('CORAL BAY', mx + 4, my + mh - 6, 11, 'rgba(255,255,255,0.85)', 'left', 700);
  }

  function drawHud(world, marker) {
    const p = world.player;
    drawMinimap(world, marker);
    // Health bar under the minimap, red once Marco is nearly down.
    const hw = 212;
    ctx.fillStyle = 'rgba(13,21,32,0.82)';
    ctx.beginPath();
    ctx.roundRect(12, 184, hw + 8, 22, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(16, 190, hw, 10);
    ctx.fillStyle = p.health < 30 ? PALETTE.healthLow : PALETTE.health;
    ctx.fillRect(16, 190, (hw * Math.max(0, p.health)) / 100, 10);
    // While driving, a speedometer joins the health bar under the minimap.
    if (p.inCar !== null) {
      ctx.fillStyle = 'rgba(13,21,32,0.82)';
      ctx.beginPath();
      ctx.roundRect(12, 212, hw + 8, 26, 8);
      ctx.fill();
      const kmh = Math.round(Math.abs(p.inCar.speed) * 0.24);
      text(`${kmh} km/h`, 22, 231, 17, PALETTE.hudText, 'left', 800);
      text(p.inCar.wrecked ? 'WRECKED' : 'SPEED', 222, 231, 11, 'rgba(255,255,255,0.6)', 'right', 700);
    }
    // Cash and wanted level, top right.
    const cashText = `$${p.cash.toLocaleString('en-US')}`;
    ctx.font = '800 30px system-ui, sans-serif';
    const cashW = ctx.measureText(cashText).width;
    panel(VIEW.width - cashW - 44, 14, cashW + 28, 66);
    text(cashText, VIEW.width - 30, 50, 30, PALETTE.cash, 'right', 800);
    let stars = '';
    for (let s = 0; s < 5; s += 1) stars += s < world.wanted.stars ? '★' : '☆';
    text(stars, VIEW.width - 30, 74, 21, PALETTE.star, 'right', 800);
    // The current objective, top centre.
    const objective = world.missions.objective;
    ctx.font = '600 16px system-ui, sans-serif';
    const ow = Math.min(760, ctx.measureText(objective).width + 34);
    panel((VIEW.width - ow) / 2, 14, ow, 34, 10);
    text(objective, VIEW.width / 2, 37, 16, PALETTE.hudText, 'center', 600);
    // Weapon and ammo, bottom right, with the key hints under it.
    const weaponText = p.weapon === 'pistol' ? `PISTOL · ${p.ammo}` : 'FISTS';
    ctx.font = '800 19px system-ui, sans-serif';
    const ww = ctx.measureText(weaponText).width;
    panel(VIEW.width - ww - 44, VIEW.height - 52, ww + 28, 36, 10);
    text(weaponText, VIEW.width - 30, VIEW.height - 27, 19, PALETTE.hudText, 'right', 800);
    text('1 fists · 2 pistol · M mute', VIEW.width - 30, VIEW.height - 60, 12, 'rgba(255,255,255,0.65)', 'right', 500);
    // The district name, announced centre-bottom whenever Marco crosses into one.
    const district = districtAt(p.x, p.y);
    if (district !== lastDistrict) {
      lastDistrict = district;
      districtT = 2.6;
    }
    if (districtT > 0) {
      ctx.globalAlpha = Math.min(1, districtT);
      text(district.toUpperCase(), VIEW.width / 2, VIEW.height - 26, 25, '#ffffff', 'center', 800);
      ctx.globalAlpha = 1;
    }
    // The bust meter only exists while the police have their hands on Marco.
    if (world.bustMeter > 0.02) {
      const bw = 260;
      panel((VIEW.width - bw) / 2, 120, bw, 40, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect((VIEW.width - bw) / 2 + 10, 132, bw - 20, 16);
      ctx.fillStyle = '#ff5147';
      ctx.fillRect((VIEW.width - bw) / 2 + 10, 132, (bw - 20) * world.bustMeter, 16);
      text('BUSTED?', VIEW.width / 2, 128, 13, '#ffb3ad', 'center', 800);
    }
    // Mission result banners, and the briefing line while a job is starting.
    const m = world.missions;
    if (m.bannerT > 0 && m.banner !== '') {
      ctx.font = '800 27px system-ui, sans-serif';
      const bw2 = ctx.measureText(m.banner).width + 44;
      panel((VIEW.width - bw2) / 2, 64, bw2, 46, 12);
      const color = m.bannerKind === 'complete' ? PALETTE.cash : m.bannerKind === 'failed' ? '#ff7a70' : PALETTE.star;
      text(m.banner, VIEW.width / 2, 96, 27, color, 'center', 800);
    }
    if (m.bannerT > 0 && m.active !== 0 && MISSION_INFO[m.active] !== undefined && m.bannerKind === 'start' && m.banner === MISSION_INFO[m.active].title) {
      const brief = MISSION_INFO[m.active].brief;
      ctx.font = '500 16px system-ui, sans-serif';
      const bw3 = Math.min(880, ctx.measureText(brief).width + 36);
      panel((VIEW.width - bw3) / 2, VIEW.height - 118, bw3, 40, 10);
      text(brief, VIEW.width / 2, VIEW.height - 92, 16, PALETTE.hudText, 'center', 500);
    }
    // The delivery clock, once the package is on board.
    if (m.active === 1 && m.phase === 1) {
      const left = Math.max(0, Math.ceil(m.timeLeft));
      text(`⏱ ${left}s`, VIEW.width / 2, 128, 24, left < 30 ? '#ff7a70' : '#ffffff', 'center', 800);
    }
    // An edge arrow (with distance) whenever the marker is off-screen.
    if (marker !== null) {
      const dx = marker.x - world.camera.x;
      const dy = marker.y - world.camera.y;
      if (Math.abs(dx) > VIEW.width / 2 - 40 || Math.abs(dy) > VIEW.height / 2 - 40) {
        const ex = VIEW.width / 2 + Math.max(-VIEW.width / 2 + 44, Math.min(VIEW.width / 2 - 44, dx));
        const ey = VIEW.height / 2 + Math.max(-VIEW.height / 2 + 44, Math.min(VIEW.height / 2 - 44, dy));
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(Math.atan2(dy, dx));
        ctx.fillStyle = PALETTE.marker;
        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.lineTo(-8, -9);
        ctx.lineTo(-8, 9);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        const dist = Math.round(Math.hypot(dx, dy) / 10);
        text(`${dist}m`, ex, ey + 26, 13, PALETTE.marker, 'center', 700);
      }
    }
  }

  // -- screens ---------------------------------------------------------------------------------

  function drawTitle(world, opts) {
    ctx.fillStyle = 'rgba(8,14,24,0.45)';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    const cx = VIEW.width / 2;
    text('HARBOR VICE', cx, 168, 92, PALETTE.title, 'center', 900);
    text('a Coral Bay story', cx, 206, 26, '#ffffff', 'center', 500);
    const lines = [
      'Marco Vale is new in Coral Bay: sun, salt water, and work that pays in cash.',
      'Lena Ortiz at the Harborlight Garage has jobs for a driver who keeps his nerve.',
      'Run her errands, lift what the rival crews leave lying around, and stay out of jail.',
    ];
    lines.forEach((line, i) => text(line, cx, 258 + i * 27, 18, 'rgba(255,255,255,0.92)', 'center', 500));
    const controls = [
      'WASD / arrows — move & drive      Shift — sprint      E — enter / exit car',
      'Mouse — aim pistol · click — shoot      F / click — punch      Space — handbrake',
      '1 / 2 — fists / pistol      P — pause      M — mute',
    ];
    panel(cx - 400, 356, 800, 118, 14);
    controls.forEach((line, i) => text(line, cx, 392 + i * 30, 17, PALETTE.hudText, 'center', 600));
    if (opts.hasSave) {
      text(`ENTER — new game        C — continue  ($${opts.saveCash}, ${opts.saveStage})`, cx, 540, 23, PALETTE.cash, 'center', 800);
    } else {
      text('ENTER — start', cx, 540, 23, PALETTE.cash, 'center', 800);
    }
    text('An original open-world crime game: city, traffic, police, missions — all in your browser.', cx, 664, 14, 'rgba(255,255,255,0.6)', 'center', 500);
  }

  function drawCenterPanel(title, lines, prompt, color) {
    ctx.fillStyle = 'rgba(8,14,24,0.55)';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    const cx = VIEW.width / 2;
    text(title, cx, 268, 74, color, 'center', 900);
    lines.forEach((line, i) => text(line, cx, 330 + i * 30, 20, '#ffffff', 'center', 500));
    text(prompt, cx, 330 + lines.length * 30 + 26, 22, PALETTE.cash, 'center', 800);
  }

  /** Paint one frame: world first, HUD over it, then the screen's panel if it has one. */
  function draw(world, screen, opts = {}) {
    const dt = Math.min(0.1, Math.max(0, world.time - lastTime));
    lastTime = world.time;
    if (districtT > 0) districtT -= dt;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.backdrop;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    const marker = typeof world.missionMarker === 'function' ? world.missionMarker() : null;
    ctx.save();
    ctx.translate(VIEW.width / 2 - world.camera.x, VIEW.height / 2 - world.camera.y);
    drawGround(world);
    drawMarker(world, marker);
    drawPickups(world);
    drawEntities(world);
    ctx.restore();
    if (screen !== SCREEN_TITLE) drawHud(world, marker);
    if (screen === SCREEN_TITLE) drawTitle(world, opts);
    else if (screen === SCREEN_PAUSED) drawCenterPanel('PAUSED', ['The city waits for no one — except now.', 'WASD drive · E car · F punch · click shoot · P resume'], 'Press P to resume', '#ffffff');
    else if (screen === SCREEN_BUSTED) drawCenterPanel('BUSTED', ['The Coral Bay police walk Marco to a cell.', 'Lena pays the $150 fine out of his pocket money.'], 'Press ENTER to continue', '#ff7a70');
    else if (screen === SCREEN_WASTED) drawCenterPanel('WASTED', ['Marco wakes up outside Coral Bay General.', 'The hospital bill comes to $100. The city is still out there.'], 'Press ENTER to continue', '#ff5147');
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw };
}
