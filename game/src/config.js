// Harbor Vice — tuning & palette.
//
// Every gameplay number and every colour the game uses lives in this one module, so
// balancing the game means editing this file and nothing else. Two coordinate ideas to
// keep straight while reading: the renderer thinks in a fixed 1280x720 "logical" view
// that gets scaled onto the real window, while the simulation thinks in world pixels —
// Coral Bay is far bigger than one screen and the camera roams over it.

export const VIEW = { width: 1280, height: 720 };

/** Fixed simulation step (seconds). The world always advances in 1/60 s slices. */
export const STEP = 1 / 60;

/** Coral Bay's extent in world pixels: everything is laid out inside this rectangle. */
export const WORLD = { width: 3200, height: 2400 };

/**
 * Street geometry. The city is a regular grid: each road is ROAD_W wide, each city
 * block is BLOCK wide, and one road-plus-block repeat (the pitch) is their sum.
 */
export const ROAD_W = 120;
export const BLOCK = 280;
export const PITCH = ROAD_W + BLOCK;

/** Marco on foot: body radius, walk/sprint pace (px/s), health and fist/gun timings. */
export const FOOT = {
  radius: 13,
  walk: 174,
  sprint: 268,
  health: 100,
  punchRange: 50,
  punchCooldown: 0.32,
  fireCooldown: 0.22,
  bulletRange: 460,
};

/** Driving feel: throttle/brake strength, drag, steering lock and the body radius. */
export const DRIVE = {
  accel: 312,
  brake: 520,
  reverseMax: 150,
  drag: 0.55,
  steer: 2.42,
  radius: 17,
};

/** Ambient traffic: how many AI cars the world maintains near Marco, and their pace. */
export const TRAFFIC = { count: 16, speed: 150, gap: 64 };

/** Pedestrians: headcount near the player, stroll pace, flee pace, and threat range. */
export const PEDS = { count: 42, walk: 74, flee: 196, sight: 300 };

/**
 * The wanted system. Crimes add "heat"; every HEAT_PER_STAR points of heat is one star,
 * up to MAX stars. Heat only drains after COOL_DELAY quiet seconds, at COOL_RATE per
 * second, and only while no police unit can see Marco.
 */
export const WANTED = {
  max: 5,
  heatPerStar: 30,
  coolDelay: 8,
  coolRate: 3.1,
  theft: 32,
  hitPed: 62,
  killPed: 95,
  shotFired: 16,
  shotOfficer: 70,
  carRam: 10,
};

/** Police response: cruisers per star, pursuit pace, spawn ring, and the bust meter. */
export const POLICE = {
  carsPerStar: 1,
  maxCars: 5,
  speed: 350,
  footSpeed: 188,
  spawnDistance: 780,
  bustFill: 0.52,
  bustDrain: 0.8,
  bustRangeFoot: 34,
  bustRangeCar: 84,
};

/** Coral Bay's sun-bleached palette: sand and sea foam outside, neon in the signs. */
export const PALETTE = {
  backdrop: '#0d1520',
  sea: '#2e7fa8',
  sand: '#e8cf9e',
  grass: '#79b657',
  park: '#5da34c',
  sidewalk: '#cfc8bb',
  blockPad: '#ddd6c7',
  road: '#3c414c',
  roadEdge: '#f3ead2',
  lane: '#e9d44d',
  crosswalk: '#e8e8e8',
  warehouse: '#8d7d6b',
  crate: '#a9805a',
  palmTrunk: '#8a6844',
  palmLeaf: '#3e9e4f',
  lampPost: '#5a6068',
  lampGlow: '#ffe9a3',
  bench: '#7a5c3e',
  umbrella: '#ff8fab',
  umbrellaAlt: '#ffd166',
  planter: '#4c956c',
  planterDark: '#35704d',
  brakeOn: '#ff5040',
  brakeOff: 'rgba(255,70,55,0.4)',
  player: '#ffcf3f',
  playerSkin: '#e8b08a',
  policeCar: '#f2f4f6',
  policeTrim: '#20365e',
  lightRed: '#ff3b30',
  lightBlue: '#2e7fff',
  hudText: '#ffffff',
  hudShadow: 'rgba(10,16,24,0.55)',
  star: '#ffd23f',
  starOff: 'rgba(255,255,255,0.28)',
  health: '#57d977',
  healthLow: '#ff5147',
  cash: '#7be382',
  marker: '#ffd23f',
  beacon: 'rgba(255,210,63,0.30)',
  panel: 'rgba(13,21,32,0.88)',
  accent: '#ff5d8f',
  neon: '#22d3ee',
  title: '#ffd23f',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** localStorage key under which cash, story stage and gear persist between visits. */
export const SAVE_KEY = 'harbor-vice.save.v1';

/** Paint jobs the city generator and the traffic spawner choose from. */
export const CAR_COLORS = ['#e74c3c', '#f39c12', '#f7f7f7', '#3498db', '#9b59b6', '#1abc9c', '#e67e22', '#ecf0f1', '#fd79a8', '#00cec9', '#6c5ce7', '#b2bec3'];
