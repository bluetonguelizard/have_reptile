// Game constants
const GAME_START = { year: 2025, month: 5, day: 1 }; // May 1, 2025 (Thu)
const MS_PER_GAME_DAY = 13 * 60 * 1000; // 13 real minutes = 1 game day
const ADULT_GAME_DAYS = 548; // ~1.5 game years (365*1.5 ≈ 548)
const ECONOMY_START_DAYS = 153; // Oct 1, 2025 — crickets & chicory seeds cost coins

// Scenes
const SCENE = { SHOP: 'shop', EGG: 'egg', ROOM: 'room', OUTDOOR: 'outdoor' };

let canvas, ctx;
let scene = SCENE.SHOP;
let lizardType = null; // 'crestie' | 'bluetongue'
let lizardName = '';
let gs = null; // game state (active lizard)
let allLizards = []; // all lizards for current user
let activeLizardIdx = 0;
let newLizardType = null;  // temp: type selected when adding new lizard
let newLizardMorph = null; // temp: morph selected when adding new lizard
let newLizardColor = null; // temp: color selected when adding new lizard (crestie only)
let newLizardTraits = [];  // temp: traits selected when adding new lizard
let newLizardCountry = null; // temp: country selected when adding new bluetongue ('australia'|'indonesia')
let newLizardLocale = null;  // temp: btLocale for ajantics halmahera (locale separate from morph)
let outdoorState = null; // { dandelions: [{x,y,picked}], gathered: 0 }
let hatchingEggId = null; // egg id being named after hatch
let rehomeAnimState = null; // { phase, timer, lizardGs, name } — drives handover animation
let sleepGuardGame = null;  // sleep mini-game state

// Pixel art colors
const C = {
  bg: '#1a1a2e', floor: '#2d2d44', wall: '#3a3a5c',
  orange: '#e8a020', blue: '#4a90d9', lightblue: '#7ab8e8',
  skin_orange: '#e87820', skin_bluetongue: '#5a8a6a',
  wood: '#8B5E3C', wood2: '#6B3E1C',
  green: '#3a7a3a', darkgreen: '#2a5a2a',
  white: '#f0f0f0', black: '#0a0a0a',
  gray: '#888', darkgray: '#444',
  yellow: '#f0d020', pink: '#e87890',
  enclosure: '#c8b06a', enclosure2: '#a89050',
  substrate: '#d4a860',
};

// Game state defaults
function newGameState(type) {
  return {
    type,
    startRealTime: Date.now(),
    gameDaysPassed: 0,
    lastGameDayRealTime: Date.now(),
    hunger: 80,       // 0-100
    happy: 70,
    bond: 10,         // 0-100
    weight: type === 'crestie' ? 3 : 80, // grams
    handleCountToday: 0,
    waterCountToday: 0,
    lastFedGameDay: -2,
    lastFedWeekDay: [],
    isAdult: false,
    adultNotified: false,
    isJuvenile: false,
    juvenileNotified: false,
    gender: null,
    scene: SCENE.SHOP,
    lizardName: '',
    hydration: 80,    // 0-100, crested gecko needs misting, bluetongue needs water bowl
    bornAnim: false,
    shopEnterAnim: true,
    introShown: false,
    isSleeping: false,
    cricketCount: 0,
    lastCricketBreedDay: 0,
    lastCricketCareDay: -1,
    chicoryState: 'none',     // 'none' | 'growing' | 'ready'
    chicoryPlantedDay: 0,
    chicoryWateredDays: 0,
    chicoryLastWateredDay: -1,
    chicoryStock: 0,
    chicoryBatchSize: 1,
    pelletCount: 0,
    cgestieFoodCount: 0,
    lastCgestieFoodGetDay: -3,
    btFoodCount: 0,
    lastBtFoodGetDay: -3,
    dandelionStock: 0,
    lastDandelionGatherDay: -1,
    springNotifiedYear: 0,
    lastEggLayDay: -30,
    hasEgg: false,
    eggNotified: false,
    hasUnfertilizedEgg: false,
    lastUnfertilizedEggLayDay: -30,
    unfertilizedEggNotified: false,
    lastMatingDay: null,      // game day when last successful mating occurred
    matedNotified: false,     // whether the "pregnant" notification was shown
    fertilizedEggLayCount: 0, // how many fertilized clutches laid this cycle (max 6)
    lastFertilizedEggLayDay: null, // game day of most recent fertilized clutch
    isLonely: false,
    lastLonelyDay: null,   // null = not yet adult; set to gameDaysPassed when adult first reached
    lonelyNotified: false,
    btGenetics: null,      // bluetongue mutation allele counts per locus
    btLocale: null,        // bluetongue subspecies locale (e.g. 'northern', 'eastern')
    hasPoop: false,
    hasUrine: false,
    dailyQuestDay: -1,
    questClean: false,
    questSubstrate: false,
    questWashBowl: false,
    questAllDoneRewarded: false,
  };
}

function loadGame() {
  const user = AUTH.currentUser();
  if (!user) { window.location.href = 'index.html'; return; }
  allLizards = AUTH.getLizards();
  activeLizardIdx = AUTH.getActiveLizardIndex();
  if (activeLizardIdx >= allLizards.length) activeLizardIdx = 0;
  if (allLizards.length > 0 && allLizards[activeLizardIdx]) {
    gs = { ...newGameState('crestie'), ...allLizards[activeLizardIdx] };
    lizardName = gs.lizardName || '';
    lizardType = gs.type || null;
    scene = gs.scene || SCENE.SHOP;
    updateGameTime();
    // Persist migration: old single-lizard format
    if (!user.lizards) AUTH.saveAllLizards(allLizards, activeLizardIdx);
    // Migration: merge per-lizard coins into account coins
    const hasCoinInLizards = allLizards.some(l => typeof l.coins === 'number' && l.coins > 0);
    if (hasCoinInLizards && !user.coins) {
      const total = allLizards.reduce((sum, l) => sum + (l.coins || 0), 0);
      AUTH.saveAccountCoins(total);
      allLizards.forEach(l => { delete l.coins; });
      AUTH.saveAllLizards(allLizards, activeLizardIdx);
      delete gs.coins;
    }
  } else {
    gs = null;
    scene = SCENE.SHOP;
  }
}

function saveGame() {
  if (gs) {
    gs.scene = (scene === SCENE.OUTDOOR) ? SCENE.ROOM : scene;
    gs.type = lizardType;
    gs.lizardName = lizardName;
    allLizards[activeLizardIdx] = { ...gs };
    AUTH.saveAllLizards(allLizards, activeLizardIdx);
  }
}

// ─── SLEEP HELPERS ───────────────────────────────────────────────────────────
// diurnal: sleeps 00–06, nocturnal: sleeps 10–16
function isSleepyHour(activity) {
  const h = new Date().getHours();
  if (activity === 'nocturnal') return h >= 10 && h < 16;
  return h >= 0 && h < 6;
}
function isWakeHour(activity) { return !isSleepyHour(activity); }

// ─── TIME ───────────────────────────────────────────────────────────────────
function updateGameTime() {
  if (!gs) return;
  const now = Date.now();
  const elapsed = now - gs.lastGameDayRealTime;
  const daysElapsed = Math.floor(elapsed / MS_PER_GAME_DAY);
  if (daysElapsed > 0) {
    gs.gameDaysPassed += daysElapsed;
    gs.lastGameDayRealTime += daysElapsed * MS_PER_GAME_DAY;
    // decay stats per day
    gs.hunger = Math.max(0, gs.hunger - daysElapsed * 8);
    gs.happy = Math.max(0, gs.happy - daysElapsed * 5);
    gs.hydration = Math.max(0, (gs.hydration || 80) - daysElapsed * 30);
    if (gs.hydration < 20) gs.happy = Math.max(0, gs.happy - daysElapsed * 3);
    gs.handleCountToday = 0; // reset daily handles
    gs.waterCountToday = 0; // reset daily water count
    gs.questClean = false;
    gs.questSubstrate = false;
    gs.questWashBowl = false;
    gs.questAllDoneRewarded = false;
    gs.dailyQuestDay = gs.gameDaysPassed;
    if (!gs.isJuvenile && gs.gameDaysPassed >= 270) {
      gs.isJuvenile = true;
      gs.gender = Math.random() < 0.5 ? 'male' : 'female';
    }
    if (!gs.isAdult && gs.gameDaysPassed >= ADULT_GAME_DAYS) {
      gs.isAdult = true;
    }
    // Initialize loneliness cooldown the first day adult is reached
    if (gs.isAdult && gs.lastLonelyDay === null) {
      gs.lastLonelyDay = gs.gameDaysPassed;
    }
    // Loneliness: female every 15 days, male every 4 days
    if (gs.isAdult && gs.gender && !gs.isLonely) {
      const lonelyCooldown = gs.gender === 'female' ? 15 : 4;
      if (gs.gameDaysPassed - (gs.lastLonelyDay || gs.gameDaysPassed) >= lonelyCooldown) {
        gs.isLonely = true;
        gs.lonelyNotified = false;
      }
    }
    // Extra happy decay when lonely
    if (gs.isLonely) {
      gs.happy = Math.max(0, gs.happy - daysElapsed * 3);
    }
    // Fertilized egg/birth for adult females
    // Crestie: clutch every 45 days, up to 6 clutches
    // BT: live birth ~100 days after mating (viviparous, single litter)
    if (gs.isAdult && gs.gender === 'female' && !gs.hasEgg && gs.lastMatingDay !== null) {
      const isBT = gs.type === 'bluetongue';
      const gestationDays = isBT ? 100 : 45;
      const lastLayRef = (gs.lastFertilizedEggLayDay !== null && gs.lastFertilizedEggLayDay !== undefined)
        ? gs.lastFertilizedEggLayDay
        : gs.lastMatingDay;
      if (gs.gameDaysPassed - lastLayRef >= gestationDays) {
        gs.hasEgg = true;
        // count & lastFertilizedEggLayDay updated when egg is collected
      }
    }
    // Unfertilized egg laying for female cresties (juvenile 준성체, or adult without mating)
    const canLayUnfertilized = gs.type === 'crestie' && gs.gender === 'female'
      && (gs.isJuvenile || (gs.isAdult && gs.lastMatingDay === null))
      && !gs.hasUnfertilizedEgg && !gs.hasEgg;
    if (canLayUnfertilized) {
      const lastLay = (gs.lastUnfertilizedEggLayDay !== undefined && gs.lastUnfertilizedEggLayDay !== null) ? gs.lastUnfertilizedEggLayDay : -30;
      if (gs.gameDaysPassed - lastLay >= 30) {
        gs.hasUnfertilizedEgg = true;
      }
    }
    // Cricket auto-breeding every 3 game days
    if ((gs.cricketCount || 0) > 0) {
      const breedCycles = Math.floor((gs.gameDaysPassed - (gs.lastCricketBreedDay || 0)) / 3);
      if (breedCycles > 0) {
        gs.cricketCount = Math.min(150, Math.round(gs.cricketCount * Math.pow(1.25, breedCycles)));
        gs.lastCricketBreedDay = (gs.lastCricketBreedDay || 0) + breedCycles * 3;
      }
      // Cricket decay if not fed daily
      if ((gs.lastCricketCareDay || -1) >= 0) {
        const careMissed = gs.gameDaysPassed - (gs.lastCricketCareDay || 0) - 1;
        if (careMissed > 0) {
          gs.cricketCount = Math.max(0, gs.cricketCount - careMissed * 5);
        }
      }
    }
    saveGame();
  }
  // Chicory growth check (runs every tick)
  if (gs.chicoryState === 'growing') {
    const growthDays = (gs.gameDaysPassed - (gs.chicoryPlantedDay || 0)) + (gs.chicoryWateredDays || 0);
    if (growthDays >= 5) gs.chicoryState = 'ready';
  }
}

function getGameDate() {
  if (!gs) return { year: GAME_START.year, month: GAME_START.month, day: GAME_START.day, dow: 4 };
  const totalDays = gs.gameDaysPassed;
  let y = GAME_START.year, m = GAME_START.month - 1, d = GAME_START.day - 1 + totalDays;
  const daysInMonth = [31,28,31,30,31,30,31,31,30,31,30,31];
  while (d >= daysInMonth[m]) { d -= daysInMonth[m]; m++; if (m >= 12) { m = 0; y++; } }
  // May 1 2025 = Thursday (dow=4, 0=Sun)
  const startDow = 4;
  const dow = (startDow + gs.gameDaysPassed) % 7;
  return { year: y, month: m + 1, day: d + 1, dow };
}

function formatDate(gd) {
  const days = currentLang === 'ko'
    ? ['일','월','화','수','목','금','토']
    : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  if (currentLang === 'ko')
    return `${gd.year}.${String(gd.month).padStart(2,'0')}.${String(gd.day).padStart(2,'0')} (${days[gd.dow]})`;
  return `${gd.year}/${String(gd.month).padStart(2,'0')}/${String(gd.day).padStart(2,'0')} ${days[gd.dow]}`;
}

function getGameTime() {
  if (!gs) return { hour: 0, minute: 0 };
  const elapsed = Date.now() - gs.lastGameDayRealTime;
  const fraction = Math.min(elapsed / MS_PER_GAME_DAY, 1);
  const totalMinutes = Math.floor(fraction * 24 * 60);
  return { hour: Math.floor(totalMinutes / 60), minute: totalMinutes % 60 };
}

function formatTime(gt) {
  return `${String(gt.hour).padStart(2,'0')}:${String(gt.minute).padStart(2,'0')}`;
}

function updateTimeDisplay() {
  const el = document.getElementById('time-display');
  if (!el) return;
  if (scene === SCENE.ROOM && gs) {
    el.style.display = 'block';
    el.textContent = formatTime(getGameTime());
  } else {
    el.style.display = 'none';
  }
}

// ─── PIXEL ART HELPERS ──────────────────────────────────────────────────────
function px(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function adjustHex(hex, amt) {
  if (!hex || hex[0] !== '#') return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16)        + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255)        + amt));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

function blendHex(hex1, hex2, t) {
  if (!hex1 || hex1[0] !== '#') return hex1;
  if (!hex2 || hex2[0] !== '#') return hex1;
  const n1 = parseInt(hex1.slice(1), 16), n2 = parseInt(hex2.slice(1), 16);
  const r = Math.round(((n1 >> 16) & 255) * (1 - t) + ((n2 >> 16) & 255) * t);
  const g = Math.round(((n1 >>  8) & 255) * (1 - t) + ((n2 >>  8) & 255) * t);
  const b = Math.round(( n1        & 255) * (1 - t) + ( n2        & 255) * t);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

function drawText(text, x, y, size, color, align='left') {
  ctx.font = `${size}px 'Press Start 2P', Galmuri11, monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.imageSmoothingEnabled = false;
  // pixel shadow
  ctx.fillStyle = '#000';
  ctx.fillText(text, x+1, y+1);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.textAlign = 'left';
}

function drawZzz(x, y) {
  const s = 3;
  // small z
  ctx.fillStyle = '#8888cc';
  ctx.fillRect(x,      y,      3*s, s  );
  ctx.fillRect(x+2*s,  y+s,    s,   s  );
  ctx.fillRect(x+s,    y+2*s,  s,   s  );
  ctx.fillRect(x,      y+3*s,  3*s, s  );
  // medium Z (offset up-right)
  ctx.fillStyle = '#aaaaee';
  const zx = x + 4*s, zy = y - 5*s;
  ctx.fillRect(zx,       zy,       4*s, s  );
  ctx.fillRect(zx+3*s,   zy+s,     s,   s  );
  ctx.fillRect(zx+s,     zy+2*s,   s,   s  );
  ctx.fillRect(zx,       zy+3*s,   4*s, s  );
}

// ─── DRAW SCENES ─────────────────────────────────────────────────────────────
function drawShop() {
  const W = canvas.width, H = canvas.height;

  // Night sky gradient background
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H*0.6);
  skyGrad.addColorStop(0, '#0a0814');
  skyGrad.addColorStop(1, '#1e1608');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H*0.6);

  // Brick wall — filled bricks with mortar gaps
  const bw = 78, bh = 28, mortar = '#1a1208';
  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, W, H*0.6);
  for (let r = 0; r < 14; r++) {
    const off = r % 2 === 0 ? 0 : bw/2;
    const by = r * (bh + 2);
    if (by > H*0.6) break;
    const shade = r < 3 ? '#3a2c14' : '#352812';
    ctx.fillStyle = shade;
    for (let c = -1; c < Math.ceil(W/bw)+1; c++) {
      ctx.fillRect(c * (bw+2) + off + 1, by + 1, bw, bh);
    }
    // Brick highlight top edge
    ctx.fillStyle = '#4a3a1a';
    for (let c = -1; c < Math.ceil(W/bw)+1; c++) {
      ctx.fillRect(c * (bw+2) + off + 1, by + 1, bw, 2);
    }
  }

  // Floor (cobblestone)
  const floorGrad = ctx.createLinearGradient(0, H*0.6, 0, H);
  floorGrad.addColorStop(0, '#28200f');
  floorGrad.addColorStop(1, '#1e1808');
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, H*0.6, W, H*0.4);
  ctx.strokeStyle = '#1a1408'; ctx.lineWidth = 1;
  for (let fy = H*0.6; fy < H; fy += 20) {
    ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(W, fy); ctx.stroke();
  }
  for (let row = 0; row * 20 < H*0.4; row++) {
    const fy = H*0.6 + row * 20;
    for (let fx = row%2===0?0:55; fx < W; fx += 110) {
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy+20); ctx.stroke();
    }
  }

  // Shop sign glow
  const sx = W/2 - 180, sy = 28, sw = 360, sh = 80;
  const glowGrad = ctx.createRadialGradient(W/2, sy+sh/2, 10, W/2, sy+sh/2, 260);
  glowGrad.addColorStop(0,   'rgba(232,168,32,0.28)');
  glowGrad.addColorStop(0.6, 'rgba(180,110,10,0.08)');
  glowGrad.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, W, H*0.6);

  // Shop sign
  px(sx-8, sy-8, sw+16, sh+16, '#3a2008');  // deep shadow
  px(sx-4, sy-4, sw+8, sh+8, '#7a5010');    // frame
  px(sx, sy, sw, sh, '#f0a818');             // sign face
  // Sign inner bevel
  px(sx+3, sy+3, sw-6, 3, '#ffd060');
  px(sx+3, sy+3, 3, sh-6, '#ffd060');
  px(sx+3, sy+sh-6, sw-6, 3, '#b07010');
  px(sx+sw-6, sy+3, 3, sh-6, '#b07010');
  // Sign text
  ctx.font = "bold 22px 'Press Start 2P', Galmuri11, monospace";
  ctx.textAlign = 'center';
  ctx.fillStyle = '#60340a';
  ctx.fillText('HAVE REPTILE', W/2+2, sy+36);
  ctx.fillText('GAME', W/2+2, sy+66);
  ctx.fillStyle = '#1a0800';
  ctx.fillText('HAVE REPTILE', W/2, sy+34);
  ctx.fillText('GAME', W/2, sy+64);
  ctx.textAlign = 'left';

  // Street lanterns (left & right)
  for (let side = 0; side < 2; side++) {
    const lx = side === 0 ? W*0.18 : W*0.82;
    const ly = H*0.2;
    // Pole
    px(lx-3, ly, 6, H*0.42, '#4a3820');
    // Lamp housing
    px(lx-14, ly-30, 28, 26, '#5a4828');
    px(lx-10, ly-26, 20, 18, '#ffe880');
    // Glow
    const lanGrad = ctx.createRadialGradient(lx, ly-16, 4, lx, ly-16, 90);
    lanGrad.addColorStop(0,   'rgba(255,240,140,0.30)');
    lanGrad.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = lanGrad;
    ctx.fillRect(lx-100, ly-100, 200, 160);
  }

  // Door
  const dx = W/2 - 60, dy = H*0.3, dw = 120, dh = H*0.31;
  px(dx-10, dy-10, dw+20, dh+10, '#2a1a08');
  px(dx-4, dy-4, dw+8, dh+4, C.wood2);
  px(dx, dy, dw, dh, '#7a3c10');
  px(dx+6, dy+6, dw-12, dh/2-8, '#8c4818');
  px(dx+6, dy+dh/2+4, dw-12, dh/2-16, '#8c4818');
  // Door panel highlights
  px(dx+6, dy+6, dw-12, 2, '#a05a28');
  px(dx+6, dy+dh/2+4, dw-12, 2, '#a05a28');
  // Door knob
  px(dx+dw-24, dy+dh/2-10, 14, 14, '#f0d040');
  px(dx+dw-22, dy+dh/2-8, 6, 6, '#fff8a0');

  // Windows (with warm interior glow)
  for (let wi = 0; wi < 2; wi++) {
    const wx = wi === 0 ? W/2 - 265 : W/2 + 140;
    const wy = H*0.24;
    px(wx-6, wy-6, 112, 92, '#2a1a08');
    px(wx-2, wy-2, 104, 84, C.wood2);
    // Warm interior glow
    const winGrad = ctx.createRadialGradient(wx+50, wy+40, 4, wx+50, wy+40, 55);
    winGrad.addColorStop(0, 'rgba(255,220,140,0.85)');
    winGrad.addColorStop(1, 'rgba(100,60,10,0.6)');
    ctx.fillStyle = winGrad;
    ctx.fillRect(wx, wy, 100, 80);
    // Window cross
    px(wx+48, wy, 4, 80, C.wood2);
    px(wx, wy+38, 100, 4, C.wood2);
    // Exterior window glow
    const extGlow = ctx.createRadialGradient(wx+50, wy+40, 0, wx+50, wy+40, 80);
    extGlow.addColorStop(0,   'rgba(255,200,80,0.12)');
    extGlow.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = extGlow;
    ctx.fillRect(wx-40, wy-30, 180, 150);
  }

  // Shopkeeper
  drawShopkeeper(W/2 - 140, H*0.35);

  // Enter text (pulse effect via sin)
  const pulse = 0.85 + Math.sin(Date.now() / 500) * 0.15;
  ctx.font = "11px 'Press Start 2P', Galmuri11, monospace";
  ctx.textAlign = 'center';
  ctx.fillStyle = '#000';
  ctx.fillText(currentLang === 'ko' ? '▼ 가게에 들어가기' : '▼ ENTER SHOP', W/2+1, H-26);
  ctx.globalAlpha = pulse;
  ctx.fillStyle = '#f0d848';
  ctx.fillText(currentLang === 'ko' ? '▼ 가게에 들어가기' : '▼ ENTER SHOP', W/2, H-27);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

function drawShopkeeper(x, y, reaching) {
  // Body pixel art - simple shopkeeper
  const s = 4; // scale
  // Head
  px(x+4*s, y, 8*s, 8*s, '#f5c88a');
  // Eyes
  px(x+5*s, y+2*s, 2*s, 2*s, C.black);
  px(x+9*s, y+2*s, 2*s, 2*s, C.black);
  // Mouth (smile)
  px(x+6*s, y+5*s, s, s, C.black);
  px(x+7*s, y+6*s, 2*s, s, C.black);
  px(x+9*s, y+5*s, s, s, C.black);
  // Hair
  px(x+4*s, y, 8*s, 2*s, '#3a2010');
  // Body (green apron)
  px(x+3*s, y+8*s, 10*s, 12*s, '#4a6a4a');
  // Left arm
  px(x, y+9*s, 3*s, 8*s, '#f5c88a');
  // Right arm — extended toward counter when reaching
  if (reaching) {
    px(x+13*s, y+9*s, 20*s, 4*s, '#f5c88a');
  } else {
    px(x+13*s, y+9*s, 3*s, 8*s, '#f5c88a');
  }
  // Legs
  px(x+4*s, y+20*s, 4*s, 6*s, '#2a3a5a');
  px(x+8*s, y+20*s, 4*s, 6*s, '#2a3a5a');
  if (!reaching) {
    // Speech bubble (normal shop only)
    const bx = x + 70, by = y - 30;
    px(bx, by, 130, 28, C.white);
    px(bx-2, by-2, 134, 32, C.black);
    px(bx, by, 130, 28, C.white);
    px(bx+12, by+28, 10, 8, C.white);
    ctx.font = "7px 'Press Start 2P', Galmuri11, monospace";
    ctx.fillStyle = '#1a1a1a';
    ctx.fillText(currentLang === 'ko' ? '알을 고르세요!' : 'Choose an egg!', bx+6, by+18);
  }
}

// ─── REHOME HANDOVER ANIMATION ────────────────────────────────────────────────
function drawRehomePlayer(charX, charY, holdingLizard, lizardGs, walking, tm) {
  const s = 4;
  const bob = walking ? Math.abs(Math.sin(tm / 180)) * 3 : 0;
  const fy = charY - bob;

  // Shadow
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#000';
  ctx.fillRect(charX - 4, charY + 2, 52, 8);
  ctx.globalAlpha = 1;

  // Legs
  if (walking) {
    const sw = Math.sin(tm / 180) * 6;
    px(charX + 4, fy + sw * 0.5, 10, 22 - sw, '#3a3a6a');
    px(charX + 18, fy - sw * 0.5, 10, 22 + sw, '#3a3a6a');
  } else {
    px(charX + 4, fy, 10, 22, '#3a3a6a');
    px(charX + 18, fy, 10, 22, '#3a3a6a');
  }
  // Body (blue shirt)
  px(charX, fy - 32, 32, 32, '#5a8ae8');
  // Head
  px(charX + 6, fy - 52, 20, 20, '#f5c88a');
  // Hair
  px(charX + 6, fy - 52, 20, 5, '#3a2010');
  // Eye (facing left toward shopkeeper)
  px(charX + 8, fy - 45, 4, 4, C.black);

  // Left arm (toward shopkeeper — extended when holding lizard)
  if (holdingLizard) {
    px(charX - 18, fy - 28, 18, 8, '#f5c88a'); // arm extended left
    const lc = lizardGs && lizardGs.type === 'crestie' ? '#e87820' : '#5a8a6a';
    px(charX - 32, fy - 32, 18, 12, lc);        // lizard body
    px(charX - 26, fy - 24, 22, 6, lc);          // tail
    px(charX - 36, fy - 35, 10, 8, lc);          // head
  } else {
    px(charX - 6, fy - 28, 8, 22, '#f5c88a');
  }
  // Right arm
  px(charX + 32, fy - 28, 8, 22, '#f5c88a');
}

function drawRehomeAnim() {
  const W = canvas.width, H = canvas.height;
  const ras = rehomeAnimState;
  const tm = ras.timer;
  const phase = ras.phase;

  // Shop interior background
  const wallGrad = ctx.createLinearGradient(0, 0, 0, H * 0.7);
  wallGrad.addColorStop(0, '#1a1208');
  wallGrad.addColorStop(1, '#2a1e0c');
  ctx.fillStyle = wallGrad;
  ctx.fillRect(0, 0, W, H * 0.7);
  ctx.strokeStyle = '#3a2c14'; ctx.lineWidth = 1;
  for (let wy = 0; wy < H * 0.7; wy += 40) {
    ctx.beginPath(); ctx.moveTo(0, wy); ctx.lineTo(W, wy); ctx.stroke();
  }
  const intGlow = ctx.createRadialGradient(W / 2, 30, 10, W / 2, 30, W * 0.65);
  intGlow.addColorStop(0, 'rgba(255,230,160,0.18)');
  intGlow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = intGlow;
  ctx.fillRect(0, 0, W, H * 0.7);
  px(0, H * 0.7, W, H * 0.3, '#2e2010');
  ctx.strokeStyle = '#221808'; ctx.lineWidth = 1;
  for (let fy2 = H * 0.7; fy2 < H; fy2 += 16) {
    ctx.beginPath(); ctx.moveTo(0, fy2); ctx.lineTo(W, fy2); ctx.stroke();
  }
  // Counter
  px(W / 2 - 210, H * 0.5 - 4, 420, 6, '#b07828');
  px(W / 2 - 210, H * 0.5, 420, 28, C.wood);
  px(W / 2 - 210, H * 0.528, 420, 58, C.wood2);
  px(W / 2 - 210, H * 0.5, 420, 3, '#d09040');

  // Player position
  const counterArriveX = W / 2 + 90;
  const startX = W + 50;
  let playerX;
  let holdingLizard = true;
  let showLizardOnCounter = false;
  let shopkeeperReaching = false;
  let showBubble = false;
  let fadeAlpha = 0;

  if (phase === 0) {
    const prog = Math.min(1, tm / 2000);
    const ease = 1 - (1 - prog) * (1 - prog);
    playerX = startX - (startX - counterArriveX) * ease;
    holdingLizard = true;
  } else if (phase === 1) {
    playerX = counterArriveX;
    holdingLizard = tm < 600;
    showLizardOnCounter = tm >= 500;
    shopkeeperReaching = tm >= 900;
  } else if (phase === 2) {
    playerX = counterArriveX;
    holdingLizard = false;
    showLizardOnCounter = true;
    shopkeeperReaching = true;
    showBubble = true;
  } else if (phase === 3) {
    playerX = counterArriveX;
    holdingLizard = false;
    showLizardOnCounter = false;
    shopkeeperReaching = true;
    showBubble = true;
    fadeAlpha = Math.min(1, tm / 1200);
  }

  // Shopkeeper
  const skX = W / 2 - 140, skY = H * 0.2;
  drawShopkeeper(skX, skY, shopkeeperReaching);

  // Lizard on counter
  if (showLizardOnCounter) {
    const lx = W / 2 - 10, ly = H * 0.478;
    const lc = ras.lizardGs.type === 'crestie' ? '#e87820' : '#5a8a6a';
    px(lx - 6, ly - 6, 14, 10, lc);
    px(lx, ly - 2, 22, 8, lc);
    px(lx + 16, ly + 2, 20, 5, lc);
    // Glint
    if ((Math.floor(tm / 300)) % 2 === 0) {
      ctx.fillStyle = '#fffde0';
      ctx.fillRect(lx + 14, ly - 8, 4, 4);
    }
  }

  // Player character
  drawRehomePlayer(playerX, H * 0.688, holdingLizard, ras.lizardGs, phase === 0, tm);

  // Speech bubble from shopkeeper
  if (showBubble) {
    const bubAlpha = phase === 2 ? Math.min(1, tm / 300) : 1;
    ctx.globalAlpha = bubAlpha;
    const bx = skX + 72, by = skY - 38;
    const lines = (currentLang === 'ko' ? '잘 돌볼게요!' : "We'll take\ngreat care!").split('\n');
    const bw = currentLang === 'ko' ? 130 : 120;
    const bh = lines.length > 1 ? 48 : 30;
    px(bx - 2, by - 2, bw + 4, bh + 4, C.black);
    px(bx, by, bw, bh, C.white);
    px(bx + 12, by + bh, 10, 8, C.white);
    ctx.font = "7px 'Press Start 2P', Galmuri11, monospace";
    ctx.fillStyle = '#1a1a1a';
    lines.forEach((line, i) => ctx.fillText(line, bx + 6, by + 17 + i * 16));
    ctx.globalAlpha = 1;
  }

  // PSA notice (phases 0–2)
  if (phase < 3) {
    // Fade in after initial fade-in completes, fade out entering phase 3
    const psaAlpha = phase === 0 ? Math.min(1, Math.max(0, (tm - 400) / 300)) : 1;
    ctx.globalAlpha = psaAlpha;
    const psaText = t('rehome_psa');
    ctx.font = "7px 'Press Start 2P', Galmuri11, monospace";
    const tw = ctx.measureText(psaText).width;
    const px2 = W / 2 - tw / 2 - 10, py2 = H - 36, pw = tw + 20, ph = 22;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(px2, py2, pw, ph);
    ctx.fillStyle = '#ffb030';
    ctx.fillText(psaText, W / 2 - tw / 2, py2 + 15);
    ctx.globalAlpha = 1;
  }

  // Fade overlay
  if (fadeAlpha > 0) {
    ctx.globalAlpha = fadeAlpha;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  // Fade-in at start
  if (phase === 0 && tm < 400) {
    ctx.globalAlpha = Math.max(0, 1 - tm / 400);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

function drawEggScene() {
  const W = canvas.width, H = canvas.height;
  // Background - inside shop (warm interior)
  const wallGrad = ctx.createLinearGradient(0, 0, 0, H*0.7);
  wallGrad.addColorStop(0, '#1a1208');
  wallGrad.addColorStop(1, '#2a1e0c');
  ctx.fillStyle = wallGrad;
  ctx.fillRect(0, 0, W, H*0.7);
  // Wall shelf boards texture
  ctx.strokeStyle = '#3a2c14'; ctx.lineWidth = 1;
  for (let wy2 = 0; wy2 < H*0.7; wy2 += 40) {
    ctx.beginPath(); ctx.moveTo(0, wy2); ctx.lineTo(W, wy2); ctx.stroke();
  }
  // Warm ambient glow (ceiling lamp)
  const intGlow = ctx.createRadialGradient(W/2, 30, 10, W/2, 30, W*0.65);
  intGlow.addColorStop(0,   'rgba(255,230,160,0.18)');
  intGlow.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = intGlow;
  ctx.fillRect(0, 0, W, H*0.7);
  // Floor
  px(0, H*0.7, W, H*0.3, '#2e2010');
  ctx.strokeStyle = '#221808'; ctx.lineWidth = 1;
  for (let fy = H*0.7; fy < H; fy += 16) {
    ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(W, fy); ctx.stroke();
  }
  // Counter
  px(W/2 - 210, H*0.5-4, 420, 6, '#b07828');  // counter top trim
  px(W/2 - 210, H*0.5, 420, 28, C.wood);
  px(W/2 - 210, H*0.528, 420, 58, C.wood2);
  // Counter highlight
  px(W/2 - 210, H*0.5, 420, 3, '#d09040');
  // Shopkeeper behind counter
  drawShopkeeper(W/2 - 60, H*0.2);

  // Draw eggs
  const egg1x = W/2 - 130, egg2x = W/2 + 30, eggy = H*0.44;
  drawEgg(egg1x, eggy, 'orange', hoverEgg === 0);
  drawEgg(egg2x, eggy, 'blue', hoverEgg === 1);

  // Labels
  ctx.font = "8px 'Press Start 2P', Galmuri11, monospace";
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8a020'; ctx.fillText(t('egg_orange'), egg1x+40, eggy+105);
  ctx.fillStyle = '#7ab8e8'; ctx.fillText(t('egg_blue'), egg2x+40, eggy+105);
  ctx.textAlign = 'left';

  // Note for bluetongue
  ctx.font = "7px 'Press Start 2P', Galmuri11, monospace";
  ctx.fillStyle = '#aaa';
  ctx.textAlign = 'center';
  ctx.fillText(t('egg_note'), W/2, H - 40);
  ctx.textAlign = 'left';

  // Title
  ctx.font = "11px 'Press Start 2P', Galmuri11, monospace";
  ctx.textAlign = 'center';
  ctx.fillStyle = '#000'; ctx.fillText(t('choose_egg'), W/2+1, 36);
  ctx.fillStyle = '#e8d050'; ctx.fillText(t('choose_egg'), W/2, 35);
  ctx.textAlign = 'left';
}

function drawEgg(x, y, type, hover) {
  const W = 80, H = 100;
  const s = hover ? 1.08 : 1;
  const ox = hover ? -3 : 0, oy = hover ? -4 : 0;
  ctx.save();
  ctx.translate(x + ox, y + oy);
  ctx.scale(s, s);

  // Egg shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.ellipse(W/2, H+8, W/2*0.8, 8, 0, 0, Math.PI*2);
  ctx.fill();

  // Egg shape using bezier
  const color = type === 'orange' ? '#e87820' : '#5a7ab8';
  const color2 = type === 'orange' ? '#d06010' : '#4a6aa8';
  const shine = type === 'orange' ? '#f0a050' : '#8ab0e0';

  ctx.beginPath();
  ctx.moveTo(W/2, 2);
  ctx.bezierCurveTo(W*0.75, 0, W+12, H*0.62, W/2, H);
  ctx.bezierCurveTo(-12, H*0.62, W*0.25, 0, W/2, 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = color2;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Shine
  ctx.beginPath();
  ctx.ellipse(W/2 - 15, 22, 8, 13, -0.4, 0, Math.PI*2);
  ctx.fillStyle = shine;
  ctx.globalAlpha = 0.5;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Face on egg
  if (type === 'orange') drawCrestieEggFace(W/2, H/2 + 5);
  else drawBluetongueEggFace(W/2, H/2 + 5);

  ctx.restore();
}

function drawCrestieEggFace(cx, cy) {
  // Crested gecko face - distinct crest markings
  const s = 2;
  // eyes
  ctx.fillStyle = C.black;
  ctx.fillRect(cx-12, cy-8, 8, 7);
  ctx.fillRect(cx+4, cy-8, 8, 7);
  ctx.fillStyle = '#ffff80';
  ctx.fillRect(cx-10, cy-6, 4, 3);
  ctx.fillRect(cx+6, cy-6, 4, 3);
  // nose
  ctx.fillStyle = '#c06010';
  ctx.fillRect(cx-3, cy-1, 6, 4);
  // crest (top head bumps)
  ctx.fillStyle = '#f0a050';
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(cx-10+i*5, cy-18, 3, 8+i%2*3);
  }
  // mouth
  ctx.fillStyle = C.black;
  ctx.fillRect(cx-8, cy+4, 16, 3);
  ctx.fillRect(cx-6, cy+7, 4, 3);
  ctx.fillRect(cx+2, cy+7, 4, 3);
}

function drawBluetongueEggFace(cx, cy) {
  // Blue tongue skink face - flatter, broader
  ctx.fillStyle = '#3a6a4a';
  ctx.fillRect(cx-18, cy-5, 36, 22);
  // eyes
  ctx.fillStyle = C.black;
  ctx.fillRect(cx-14, cy-2, 8, 7);
  ctx.fillRect(cx+6, cy-2, 8, 7);
  ctx.fillStyle = '#ffff80';
  ctx.fillRect(cx-12, cy, 4, 3);
  ctx.fillRect(cx+8, cy, 4, 3);
  // scales texture
  ctx.fillStyle = '#4a7a5a';
  for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) {
    ctx.fillRect(cx-14+c*7, cy+8+r*5, 5, 3);
  }
  // snout
  ctx.fillStyle = '#3a5a3a';
  ctx.fillRect(cx-6, cy+14, 12, 5);
  // blue tongue peek
  ctx.fillStyle = '#4a90d9';
  ctx.fillRect(cx-4, cy+17, 8, 4);
}

// ─── ROOM SCENE ──────────────────────────────────────────────────────────────
let bornAnim = { phase: 0, timer: 0 }; // phase: 0=egg, 1=cracking, 2=born, 3=done
let lizardAnim = { frame: 0, timer: 0, threatening: true, threatTimer: 300 };
let eatAnim = { active: false, timer: 0, type: null }; // type: 'feed' | 'water'
let cleanAnim = { active: false, timer: 0 };
let introTimer = 0;
let introShown = false;

// Handling session state
let handlingSession = {
  active: false,
  petsGiven: 0,
  hearts: [],      // [{x, y, alpha, vy}]
  petting: false,  // true briefly after each pet (hand moves down)
  petTimer: 0,
};

function drawHandlingOverlay() {
  const W = canvas.width, H = canvas.height;
  // Lizard center: enclosure center area
  const lizX = W / 2;
  const lizY = lizardType === 'bluetongue' ? H * 0.55 : H * 0.52;

  // Hand position: above lizard, moves down when petting
  const handBaseY = lizY - 55;
  const handY = handlingSession.petting ? handBaseY + 22 : handBaseY;
  const handX = lizX + 10;

  // Draw pixel-art hand (open palm facing down)
  drawPixelHand(handX, handY);

  // Pet count indicator
  const maxPets = 4;
  const given = handlingSession.petsGiven;
  for (let i = 0; i < maxPets; i++) {
    const dotX = lizX - (maxPets * 10) / 2 + i * 10 + 5;
    const dotY = lizY + 28;
    ctx.fillStyle = i < given ? '#f0d020' : '#555577';
    ctx.beginPath();
    ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Floating hearts
  for (const h of handlingSession.hearts) {
    ctx.globalAlpha = h.alpha;
    ctx.fillStyle = '#f06080';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('♥', h.x - 6, h.y);
    ctx.globalAlpha = 1;
  }

  // Instruction text
  if (given < maxPets) {
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#e8d0ff';
    ctx.font = '7px "Press Start 2P", monospace';
    const txt = t('handle_start');
    ctx.fillText(txt, lizX - ctx.measureText(txt).width / 2, lizY + 46);
    ctx.globalAlpha = 1;
  }

  // Click hit area: circle around lizard
  // (visual hint: faint glow around lizard when active)
  ctx.strokeStyle = 'rgba(240,210,255,0.25)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.ellipse(lizX, lizY - 10, 45, 28, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawPixelHand(cx, cy) {
  // Simple pixel-art open hand (top-down, pointing down)
  const s = 2; // pixel size
  const pixels = [
    // palm
    [0,0],[1,0],[2,0],[3,0],[4,0],
    [0,1],[1,1],[2,1],[3,1],[4,1],
    [0,2],[1,2],[2,2],[3,2],[4,2],
    // fingers
    [0,-1],[2,-1],[4,-1],
    [0,-2],[2,-2],[4,-2],
    [0,-3],[2,-3],[4,-3],
    [1,-1],[3,-1],
    [1,-2],[3,-2],
    // thumb (side)
    [-1,0],[-1,1],
  ];
  ctx.fillStyle = '#f5d5a8';
  for (const [px2, py] of pixels) {
    ctx.fillRect(cx + px2 * s - 4, cy + py * s, s, s);
  }
  // Outline
  ctx.fillStyle = '#c09060';
  const outline = [
    [-2,0],[-2,1],[5,0],[5,1],[5,2],
    [-1,-1],[0,-4],[1,-3],[2,-4],[3,-3],[4,-4],[5,-1],
    [0,3],[1,3],[2,3],[3,3],[4,3],
  ];
  for (const [px2, py] of outline) {
    ctx.fillRect(cx + px2 * s - 4, cy + py * s, s, s);
  }
}

function updateHandlingHearts(dt) {
  for (const h of handlingSession.hearts) {
    h.y += h.vy * dt * 0.04;
    h.alpha -= dt * 0.001;
  }
  handlingSession.hearts = handlingSession.hearts.filter(h => h.alpha > 0);
  if (handlingSession.petting) {
    handlingSession.petTimer -= dt;
    if (handlingSession.petTimer <= 0) handlingSession.petting = false;
  }
}

function tryPetLizard(mx, my) {
  if (!handlingSession.active) return false;
  const W = canvas.width, H = canvas.height;
  const lizX = W / 2;
  const lizY = lizardType === 'bluetongue' ? H * 0.55 : H * 0.52;
  const dx = mx - lizX, dy = my - (lizY - 10);
  if (dx * dx / (50 * 50) + dy * dy / (32 * 32) > 1) return false;

  handlingSession.petsGiven++;
  handlingSession.petting = true;
  handlingSession.petTimer = 300;
  // Spawn heart
  handlingSession.hearts.push({ x: lizX + (Math.random() - 0.5) * 40, y: lizY - 20, alpha: 1, vy: -1 });

  if (handlingSession.petsGiven >= 4) {
    // All 4 pets done — apply stats
    setTimeout(() => {
      if (!handlingSession.active) return;
      handlingSession.active = false;
      gs.handleCountToday++;
      const bondGain = gs.bond < 30 ? 3 : (gs.bond < 60 ? 5 : 7);
      gs.bond = Math.min(100, gs.bond + bondGain);
      gs.happy = Math.min(100, gs.happy + 10);
      if (gs.bond > 40) lizardAnim.threatening = false;
      showMsg(t('handle_done') + bondGain);
      saveGame();
    }, 400);
  }
  return true;
}

function drawRoom() {
  const W = canvas.width, H = canvas.height;
  const wallH = H * 0.65;

  // Wall base
  px(0, 0, W, wallH, '#2e2544');

  // Wallpaper: subtle diamond grid
  ctx.strokeStyle = '#3d3460';
  ctx.lineWidth = 1;
  const gw = 36, gh = 36;
  for (let gy = 0; gy < wallH + gh; gy += gh) {
    for (let gx = (gy/gh % 2 === 0 ? 0 : gw/2); gx < W + gw; gx += gw) {
      ctx.beginPath();
      ctx.moveTo(gx, gy - gh/2);
      ctx.lineTo(gx + gw/2, gy);
      ctx.lineTo(gx, gy + gh/2);
      ctx.lineTo(gx - gw/2, gy);
      ctx.closePath();
      ctx.stroke();
    }
  }

  // Ceiling strip with light fixture
  px(0, 0, W, 10, '#1e1830');
  // Ceiling lamp
  const lampX = W / 2;
  px(lampX - 6, 0, 12, 14, '#aaa090');    // cord/mount
  px(lampX - 22, 14, 44, 18, '#e0d8b0');  // shade base
  px(lampX - 18, 14, 36, 14, '#f0e8c0');  // shade highlight

  // Ambient light cone from lamp
  const lampGrad = ctx.createRadialGradient(lampX, 22, 10, lampX, 22, W * 0.7);
  lampGrad.addColorStop(0,   'rgba(255,240,180,0.13)');
  lampGrad.addColorStop(0.5, 'rgba(240,200,120,0.05)');
  lampGrad.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = lampGrad;
  ctx.fillRect(0, 0, W, wallH);

  // Floor: wood planks
  px(0, wallH, W, H * 0.35, '#1e1a14');
  ctx.strokeStyle = '#2c2218';
  ctx.lineWidth = 1;
  for (let fy = wallH; fy < H; fy += 18) {
    ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(W, fy); ctx.stroke();
  }
  // Plank vertical breaks (staggered)
  ctx.strokeStyle = '#26200a';
  for (let row = 0; row < 8; row++) {
    const fy = wallH + row * 18;
    const off = row % 2 === 0 ? 0 : 60;
    for (let fx = off; fx < W; fx += 120) {
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy + 18); ctx.stroke();
    }
  }
  // Floor highlight strip (near wall)
  const floorShine = ctx.createLinearGradient(0, wallH, 0, wallH + 30);
  floorShine.addColorStop(0, 'rgba(255,220,140,0.08)');
  floorShine.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = floorShine;
  ctx.fillRect(0, wallH, W, 30);

  // Baseboard
  px(0, wallH - 8, W, 12, '#4a3860');
  px(0, wallH - 8, W, 3, '#6a5888');

  // Enclosure
  if (lizardType === 'crestie') drawCrestieEnclosure(W/2 - 180, H*0.15, W*0.75, H*0.48);
  else drawBluetongueEnclosure(W/2 - 200, H*0.15, W*0.8, H*0.48);

  if (gs.bornAnim) drawPoopInEnclosure();
  if (gs.bornAnim && cleanAnim.active) drawCleanAnim();
  if (gs.bornAnim && eatAnim.active) drawEatDrinkAnim();

  // Born animation
  if (!gs.bornAnim) {
    drawBornAnim(W/2, H*0.38);
  }

  // Handling session overlay
  if (gs.bornAnim && handlingSession.active) {
    drawHandlingOverlay();
  }
}

function drawCrestieEnclosure(x, y, w, h) {
  // JIF enclosure - outer shadow/glow
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 18;
  px(x-6, y-6, w+12, h+12, '#3a2c14');
  ctx.shadowBlur = 0;

  // Walls (warm cream)
  px(x, y, w, h, '#ddd090');
  // Inner subtle gradient (depth illusion)
  const encGrad = ctx.createLinearGradient(x, y, x+w, y);
  encGrad.addColorStop(0,   'rgba(0,0,0,0.12)');
  encGrad.addColorStop(0.15,'rgba(0,0,0,0)');
  encGrad.addColorStop(0.85,'rgba(0,0,0,0)');
  encGrad.addColorStop(1,   'rgba(0,0,0,0.10)');
  ctx.fillStyle = encGrad;
  ctx.fillRect(x, y, w, h);

  // Glass front panel
  ctx.fillStyle = 'rgba(160,210,245,0.08)';
  ctx.fillRect(x+6, y+20, w-12, h-50);
  // Glass reflections
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(x+12, y+22, 14, h-60);
  ctx.fillRect(x+30, y+22, 5, h-60);

  // Frame border
  ctx.strokeStyle = '#786030';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = '#a08848';
  ctx.lineWidth = 1;
  ctx.strokeRect(x+3, y+3, w-6, h-6);

  // Mesh top
  px(x, y, w, 22, '#b8b8b8');
  px(x, y, w, 3, '#d0d0d0');
  ctx.strokeStyle = '#909090';
  ctx.lineWidth = 1;
  for (let i = 0; i < w; i += 7) ctx.strokeRect(x+i, y, 5, 22);
  for (let j = 0; j < 22; j += 7) {
    ctx.beginPath(); ctx.moveTo(x, y+j); ctx.lineTo(x+w, y+j); ctx.stroke();
  }

  // Label (engraved look)
  ctx.font = "6px 'Press Start 2P', Galmuri11, monospace";
  ctx.fillStyle = '#8a7030';
  ctx.fillText('JIF ENCLOSURE', x+12, y+h-7);

  // Substrate (coco fiber texture)
  px(x+6, y+h-52, w-12, 46, '#4a2e14');
  ctx.fillStyle = '#583418';
  for (let si = 0; si < 30; si++) {
    const sx2 = x+8 + (si*37)%(w-16), sy2 = y+h-50 + (si*19)%40;
    ctx.fillRect(sx2, sy2, 3+(si%3), 2);
  }
  // Substrate highlight
  px(x+6, y+h-52, w-12, 3, '#6a4228');

  // Decor & lizard
  drawCrestieHide(x + 20, y + h - 95, false);
  drawCrestieHide(x + w - 110, y + h - 80, true);
  drawLeaf(x+w-50, y+h-90);
  if (gs.bornAnim) drawCrestie(x+w/2-20, y+h-90, { ...lizardAnim, sleeping: gs.isSleeping }, { morph: gs.morph, color: gs.color, traits: gs.traits });
}

function drawCrestieHide(x, y, small) {
  const s = small ? 0.7 : 1;
  // Cork bark / egg hide - cozy style
  ctx.save(); ctx.translate(x, y); ctx.scale(s,s);
  // Arch shape
  ctx.fillStyle = '#8B5E3C';
  ctx.beginPath();
  ctx.arc(35, 35, 35, Math.PI, 0);
  ctx.lineTo(70, 55); ctx.lineTo(0, 55);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#6B3E1C';
  ctx.beginPath();
  ctx.arc(35, 35, 28, Math.PI, 0);
  ctx.lineTo(63, 55); ctx.lineTo(7, 55);
  ctx.closePath(); ctx.fill();
  // Opening
  ctx.fillStyle = '#2a1a0a';
  ctx.beginPath();
  ctx.arc(35, 50, 20, Math.PI, 0);
  ctx.lineTo(55, 55); ctx.lineTo(15, 55);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawLeaf(x, y) {
  ctx.fillStyle = '#3a8a3a';
  ctx.beginPath();
  ctx.ellipse(x, y, 20, 8, -0.4, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = '#2a6a2a';
  ctx.beginPath();
  ctx.ellipse(x-15, y+10, 15, 6, 0.4, 0, Math.PI*2);
  ctx.fill();
}

function drawCrestie(x, y, anim, appearance) {
  const threatening = anim.threatening;
  const s = 3;
  const traits  = (appearance && appearance.traits) || [];
  const colorId = (appearance && appearance.color)  || 'orange';
  const morph   = (appearance && appearance.morph)  || 'normal';
  const c = getCrestieColors(colorId, traits, morph);
  const hasXH   = traits.includes('extreme_harlequin');
  const isBold  = traits.includes('bold');

  // TAIL — long, prehensile, curves down then tip curls back up
  ctx.fillStyle = c.tailTip;
  ctx.fillRect(x-8*s, y+8*s,  s,   s  );
  ctx.fillRect(x-7*s, y+7*s,  2*s, 2*s);
  ctx.fillStyle = c.tailMid;
  ctx.fillRect(x-6*s, y+6*s,  3*s, 2*s);
  ctx.fillRect(x-4*s, y+5*s,  3*s, 2*s);
  ctx.fillStyle = c.bodyShade;
  ctx.fillRect(x-2*s, y+5*s,  3*s, 3*s);

  // BODY — slender
  // Tricolor + extreme harlequin: cream is the dominant base color
  if (colorId === 'tricolor' && hasXH && traits.includes('harlequin')) {
    ctx.fillStyle = '#ddd0a0';  // cream/ivory base
  } else {
    ctx.fillStyle = c.body;
  }
  ctx.fillRect(x,   y+4*s, 11*s, 5*s);

  // Base stripe/ventral (skipped for patternless)
  if (!traits.includes('patternless')) {
    ctx.fillStyle = c.stripe;
    ctx.fillRect(x+s, y+4*s, 9*s, s);
    ctx.fillStyle = c.ventral;
    ctx.fillRect(x+s, y+8*s, 9*s, s);
  }

  // ── MORPH PATTERNS (drawn before crests so crests sit on top) ──
  if (traits.includes('flame') || traits.includes('harlequin')) {
    const darkAmt  = isBold ? -65 : -45;
    const patchDark = adjustHex(c.body, darkAmt);

    if (traits.includes('flame')) {
      const patchLight = hasXH ? adjustHex(c.ventral, 40) : c.stripe;
      // Irregular upward-pointing bright patches
      ctx.fillStyle = patchLight;
      ctx.fillRect(x+1*s, y+4*s, 2*s, 2*s);
      ctx.fillRect(x+2*s, y+3*s, s,   2*s);
      ctx.fillRect(x+5*s, y+3*s, 2*s, 3*s);
      ctx.fillRect(x+6*s, y+2*s, s,   2*s);
      ctx.fillRect(x+8*s, y+4*s, 2*s, 2*s);
      ctx.fillRect(x+9*s, y+3*s, s,   2*s);
      if (hasXH) {
        // Extreme: large flame coverage
        ctx.fillRect(x+0*s, y+4*s, 4*s, 4*s);
        ctx.fillRect(x+5*s, y+3*s, 4*s, 5*s);
        ctx.fillRect(x+9*s, y+4*s, 2*s, 4*s);
        ctx.fillStyle = patchDark;
        ctx.fillRect(x+4*s, y+5*s, s, 3*s);
        ctx.fillRect(x+8*s, y+7*s, s, 2*s);
      }
    } else {
      // HARLEQUIN
      if (hasXH && colorId === 'tricolor') {
        // Tricolor extreme harlequin (per reference photos):
        //   cream base already drawn above
        //   orange patches (sporadic, medium coverage)
        //   dark chocolate side patches (lower coverage, but visually impactful)
        ctx.fillStyle = c.body;  // orange patches (#8a5020 area)
        ctx.fillRect(x+2*s, y+5*s, 2*s, 3*s);
        ctx.fillRect(x+6*s, y+4*s, 2*s, 4*s);
        ctx.fillRect(x+9*s, y+5*s, 2*s, 3*s);
        ctx.fillRect(x+10*s,y+3*s, s,   2*s);
        ctx.fillStyle = '#1e0c00';  // dark chocolate patches on sides
        ctx.fillRect(x+0*s, y+6*s, 2*s, 3*s);
        ctx.fillRect(x+4*s, y+7*s, 2*s, 2*s);
        ctx.fillRect(x+8*s, y+6*s, s,   3*s);
        ctx.fillRect(x+3*s, y+4*s, s,   2*s);
      } else if (hasXH) {
        // Non-tricolor extreme harlequin
        const patchLight = adjustHex(c.ventral, 40);
        ctx.fillStyle = patchLight;
        ctx.fillRect(x+0*s, y+3*s, 4*s, 5*s);
        ctx.fillRect(x+1*s, y+2*s, 2*s, 2*s);
        ctx.fillRect(x+6*s, y+3*s, 4*s, 4*s);
        ctx.fillRect(x+7*s, y+2*s, 2*s, 2*s);
        ctx.fillRect(x+10*s,y+3*s, 2*s, 3*s);
        ctx.fillStyle = patchDark;
        ctx.fillRect(x+4*s, y+4*s, 2*s, 5*s);
        ctx.fillRect(x+0*s, y+7*s, 2*s, 2*s);
        ctx.fillRect(x+9*s, y+6*s, 2*s, 3*s);
        ctx.fillRect(x+2*s, y+7*s, 2*s, s  );
      } else {
        // Regular harlequin
        ctx.fillStyle = c.stripe;
        ctx.fillRect(x+1*s, y+3*s, 3*s, 4*s);
        ctx.fillRect(x+2*s, y+2*s, s,   2*s);
        ctx.fillRect(x+6*s, y+3*s, 3*s, 3*s);
        ctx.fillRect(x+9*s, y+3*s, 2*s, 4*s);
        ctx.fillStyle = patchDark;
        ctx.fillRect(x+4*s, y+5*s, 2*s, 3*s);
        ctx.fillRect(x+7*s, y+6*s, 2*s, 2*s);
      }
    }
  }

  if (traits.includes('dalmatian')) {
    const spotColor = adjustHex(c.body, isBold ? -65 : -50);
    ctx.fillStyle = spotColor;
    ctx.fillRect(x+2*s, y+5*s, s, s);
    ctx.fillRect(x+4*s, y+6*s, s, s);
    ctx.fillRect(x+6*s, y+5*s, s, s);
    ctx.fillRect(x+8*s, y+6*s, s, s);
    ctx.fillRect(x+3*s, y+7*s, s, s);
    ctx.fillRect(x+7*s, y+7*s, s, s);
    ctx.fillRect(x+13*s,y+4*s, s, s);
    ctx.fillRect(x+15*s,y+6*s, s, s);
    if (hasXH) {
      ctx.fillRect(x+s,    y+6*s, s, s);
      ctx.fillRect(x+5*s,  y+7*s, s, s);
      ctx.fillRect(x+9*s,  y+5*s, s, s);
      ctx.fillRect(x+14*s, y+2*s, s, s);
    }
  }

  // DORSAL CRESTS — fan-like spines running from neck down back
  if (traits.includes('pinstripe')) {
    ctx.fillStyle = adjustHex(c.crest, 20);
    ctx.fillRect(x+2*s, y+2*s, 9*s, s);     // top connecting line
    ctx.fillStyle = c.crest;
    ctx.fillRect(x+2*s,  y+3*s, s, 2*s);
    ctx.fillRect(x+4*s,  y+2*s, s, 3*s);
    ctx.fillRect(x+6*s,  y+3*s, s, 2*s);
    ctx.fillRect(x+8*s,  y+2*s, s, 3*s);
    ctx.fillRect(x+10*s, y+s,   s, 4*s);
    // Leg pinstripes
    ctx.fillStyle = adjustHex(c.crest, 20);
    ctx.fillRect(x+17*s, y+9*s, s, 4*s);
    ctx.fillRect(x+6*s,  y+9*s, s, 4*s);
  } else {
    ctx.fillStyle = c.crest;
    ctx.fillRect(x+2*s,  y+3*s, s,   2*s);
    ctx.fillRect(x+4*s,  y+2*s, s,   3*s);
    ctx.fillRect(x+6*s,  y+3*s, s,   2*s);
    ctx.fillRect(x+8*s,  y+2*s, s,   3*s);
    ctx.fillRect(x+10*s, y+s,   s,   4*s);
  }

  // NECK
  ctx.fillStyle = c.neck;
  ctx.fillRect(x+10*s, y+4*s, 3*s, 5*s);

  // HEAD — triangular, flares wide at temples, slightly narrow snout
  ctx.fillStyle = c.head;
  ctx.fillRect(x+12*s, y+2*s, 5*s, 8*s);
  ctx.fillRect(x+17*s, y+3*s, 3*s, 6*s);
  ctx.fillStyle = c.headTip;
  ctx.fillRect(x+19*s, y+4*s, 2*s, 4*s);

  // SUPRAORBITAL RIDGE — the "eyelash" crests above eyes
  ctx.fillStyle = c.crest;
  ctx.fillRect(x+12*s, y+2*s, s,   s  );
  ctx.fillRect(x+13*s, y+s,   3*s, 2*s);
  ctx.fillRect(x+13*s, y,     s,   s  );

  // EYE — very large relative to head
  ctx.fillStyle = '#1a0a00';
  ctx.fillRect(x+13*s, y+3*s, 3*s, 4*s);
  ctx.fillStyle = '#f5c800';
  ctx.fillRect(x+13*s, y+3*s, 3*s, 3*s);
  ctx.fillStyle = C.black;
  ctx.fillRect(x+14*s, y+3*s, s,   3*s);
  ctx.fillStyle = '#ffffa0';
  ctx.fillRect(x+13*s, y+3*s, s,   s  );

  // FRONT LEGS
  ctx.fillStyle = c.legs;
  ctx.fillRect(x+17*s, y+9*s,  2*s, 4*s);
  ctx.fillRect(x+15*s, y+12*s, 3*s, s  );
  ctx.fillStyle = c.ventral;
  ctx.fillRect(x+15*s, y+13*s, s,   s  );
  ctx.fillRect(x+16*s, y+13*s, s,   s  );

  // BACK LEGS
  ctx.fillStyle = c.legs;
  ctx.fillRect(x+6*s,  y+9*s,  2*s, 4*s);
  ctx.fillRect(x+4*s,  y+12*s, 3*s, s  );
  ctx.fillStyle = c.ventral;
  ctx.fillRect(x+4*s,  y+13*s, s,   s  );
  ctx.fillRect(x+5*s,  y+13*s, s,   s  );

  // MOUTH
  if (!anim.sleeping && threatening) {
    ctx.fillStyle = '#ff2020';
    ctx.fillRect(x+13*s, y+8*s, 8*s, 3*s);
    ctx.fillStyle = '#ffff80';
    ctx.fillRect(x+14*s, y+8*s, s,   s  );
    ctx.fillRect(x+16*s, y+8*s, s,   s  );
    ctx.fillRect(x+18*s, y+8*s, s,   s  );
    ctx.fillStyle = '#ff8888';
    ctx.fillRect(x+19*s, y+9*s, 2*s, s  );
  } else {
    ctx.fillStyle = c.headTip;
    ctx.fillRect(x+13*s, y+9*s, 7*s, s  );
  }

  // SLEEPING — override eyes, draw Zzz
  if (anim.sleeping) {
    ctx.fillStyle = '#3a2010';
    ctx.fillRect(x+13*s, y+4*s, 3*s, s);
    ctx.fillRect(x+13*s, y+5*s, s,   s);
    ctx.fillRect(x+15*s, y+5*s, s,   s);
    drawZzz(x + 20*s, y - s*2);
  }
}

function drawBluetongueEnclosure(x, y, w, h) {
  // 3-size Formax enclosure - shadow
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 18;
  px(x-6, y-6, w+12, h+12, '#202020');
  ctx.shadowBlur = 0;

  // White formax walls
  px(x, y, w, h, '#dcdcc4');
  // Side depth gradient
  const fGrad = ctx.createLinearGradient(x, y, x+w, y);
  fGrad.addColorStop(0,   'rgba(0,0,0,0.10)');
  fGrad.addColorStop(0.1, 'rgba(0,0,0,0)');
  fGrad.addColorStop(0.9, 'rgba(0,0,0,0)');
  fGrad.addColorStop(1,   'rgba(0,0,0,0.08)');
  ctx.fillStyle = fGrad;
  ctx.fillRect(x, y, w, h);

  // Sliding glass panels
  const gw2 = (w-14)/2 - 2;
  ctx.fillStyle = 'rgba(160,210,245,0.09)';
  ctx.fillRect(x+6, y+6, gw2, h-30);
  ctx.fillRect(x+gw2+10, y+6, gw2, h-30);
  // Glass reflections
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x+10, y+8, 10, h-36);
  ctx.fillRect(x+gw2+14, y+8, 10, h-36);
  // Glass borders
  ctx.strokeStyle = '#b0b0b0'; ctx.lineWidth = 2;
  ctx.strokeRect(x+6, y+6, gw2, h-30);
  ctx.strokeRect(x+gw2+10, y+6, gw2, h-30);
  // Center rail divider
  px(x+gw2+6, y+6, 4, h-30, '#888');

  // Frame border
  ctx.strokeStyle = '#303030'; ctx.lineWidth = 4;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = '#505050'; ctx.lineWidth = 1;
  ctx.strokeRect(x+3, y+3, w-6, h-6);

  // Label
  ctx.font = "6px 'Press Start 2P', Galmuri11, monospace";
  ctx.fillStyle = '#404040';
  ctx.fillText('3-SIZE FORMAX', x+12, y+h-7);

  // Substrate (paper/newspaper texture)
  px(x+6, y+h-56, w-12, 50, '#e8e0b0');
  ctx.fillStyle = '#d8d098';
  for (let si = 0; si < 12; si++) {
    ctx.fillRect(x+8 + si * ((w-16)/12), y+h-50, (w-16)/12 - 1, 1);
    ctx.fillRect(x+8 + si * ((w-16)/12), y+h-38, (w-16)/12 - 1, 1);
  }
  px(x+6, y+h-56, w-12, 3, '#f0e8c0');

  // Decor & lizard
  drawBluetongueHide(x+20, y+h-100);
  drawLeaf(x+w-60, y+h-100);
  if (gs.bornAnim) drawBluetongue(x+w/2-30, y+h-95, { ...lizardAnim, sleeping: gs.isSleeping }, { morph: gs.morph, color: gs.color, traits: gs.traits });
}

function drawBluetongueHide(x, y) {
  // Rock cave hide
  ctx.fillStyle = '#606060';
  ctx.beginPath();
  ctx.arc(45, 40, 45, Math.PI, 0);
  ctx.lineTo(90, 55); ctx.lineTo(0, 55);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#808080';
  ctx.beginPath();
  ctx.arc(45, 40, 36, Math.PI, 0);
  ctx.lineTo(81, 55); ctx.lineTo(9, 55);
  ctx.closePath(); ctx.fill();
  // Opening
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(15, 35, 60, 22);
  ctx.font = "5px 'Press Start 2P', Galmuri11, monospace"; ctx.fillStyle = '#ccc';
  ctx.fillText('HIDE', 30, 30);
}

function drawBluetongue(x, y, anim, appearance) {
  const threatening = anim.threatening;
  const s = 3;
  const morph  = (appearance && appearance.morph)  || 'northern';
  const traits = (appearance && appearance.traits) || [];
  const c = getBluetongueColors(morph, traits);
  const hasXH = traits.includes('extreme_harlequin');

  // TAIL — short, fat, tapers sharply
  ctx.fillStyle = c.tail1;
  ctx.fillRect(x-7*s, y+6*s, 2*s, 3*s);
  ctx.fillStyle = c.tail2;
  ctx.fillRect(x-5*s, y+5*s, 2*s, 4*s);
  ctx.fillStyle = c.tail3;
  ctx.fillRect(x-3*s, y+4*s, 3*s, 5*s);

  // BODY — heavy, cylindrical sausage
  ctx.fillStyle = c.body;
  ctx.fillRect(x, y+3*s, 15*s, 8*s);

  // DARK CROSSBANDS — very prominent, key bluetongue identifier
  if (morph !== 'patternless') {
  ctx.fillStyle = c.crossband;
  const bw = morph === 'eastern' ? s : 2*s;   // narrower for eastern
  ctx.fillRect(x+s,    y+3*s, bw, 8*s);
  ctx.fillRect(x+5*s,  y+3*s, bw, 8*s);
  ctx.fillRect(x+9*s,  y+3*s, bw, 8*s);
  ctx.fillRect(x+13*s, y+3*s, bw, 8*s);
  }

  // Irian Jaya: fade upper halves of some bands (reduced pattern)
  if (morph === 'irian_jaya') {
    ctx.fillStyle = c.body;
    ctx.fillRect(x+s,   y+3*s, s, 3*s);
    ctx.fillRect(x+9*s, y+3*s, s, 3*s);
  }

  // Ajantics (실버텅): silver speckling over dark body
  if (morph === 'ajantics') {
    ctx.fillStyle = adjustHex(c.belly, -25);
    ctx.fillRect(x+2*s,  y+4*s, s, s);
    ctx.fillRect(x+4*s,  y+7*s, s, s);
    ctx.fillRect(x+7*s,  y+4*s, s, s);
    ctx.fillRect(x+10*s, y+6*s, s, s);
    ctx.fillRect(x+12*s, y+3*s, s, s);
    ctx.fillRect(x+3*s,  y+9*s, s, s);
    ctx.fillRect(x+8*s,  y+8*s, s, s);
  }

  // Pale belly
  ctx.fillStyle = c.belly;
  ctx.fillRect(x+s, y+10*s, 13*s, s);

  // EXTREME HARLEQUIN trait: large irregular patches over the crossbands
  if (hasXH) {
    ctx.fillStyle = adjustHex(c.crossband, -10);
    ctx.fillRect(x+2*s,  y+3*s, 3*s, 5*s);
    ctx.fillRect(x+7*s,  y+3*s, 2*s, 4*s);
    ctx.fillRect(x+11*s, y+3*s, 3*s, 6*s);
    ctx.fillStyle = adjustHex(c.belly, -10);
    ctx.fillRect(x+3*s,  y+3*s, 2*s, 2*s);
    ctx.fillRect(x+8*s,  y+4*s, 2*s, 2*s);
  }

  // NECK — noticeably narrower than both body and head
  ctx.fillStyle = c.neck;
  ctx.fillRect(x+15*s, y+5*s, 3*s, 5*s);

  // HEAD — wide, flat, triangular
  ctx.fillStyle = c.head;
  ctx.fillRect(x+17*s, y+2*s, 10*s, 10*s);
  ctx.fillStyle = adjustHex(c.head, 10);
  ctx.fillRect(x+17*s, y+2*s, 10*s, 2*s);    // flat head top
  ctx.fillStyle = adjustHex(c.headTip, 15);
  ctx.fillRect(x+25*s, y+4*s, 3*s, 6*s);
  ctx.fillStyle = c.headTip;
  ctx.fillRect(x+27*s, y+5*s, s,   4*s);     // snout tip
  // Head spots/speckles
  ctx.fillStyle = adjustHex(c.head, -30);
  ctx.fillRect(x+19*s, y+2*s, s, s);
  ctx.fillRect(x+22*s, y+2*s, s, s);
  ctx.fillRect(x+24*s, y+2*s, s, s);

  // EYE — beady but visible
  if (morph === 'ajantics') {
    // All-black eye for silver tongue (아잔틱)
    ctx.fillStyle = '#080808';
    ctx.fillRect(x+19*s, y+3*s, 5*s, 5*s);
    ctx.fillStyle = '#000000';
    ctx.fillRect(x+20*s, y+4*s, 4*s, 4*s);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x+22*s, y+4*s, s, s);   // top-right glint
    ctx.fillRect(x+20*s, y+6*s, s, s);   // bottom-left glint
  } else if (morph === 'halmahera') {
    // Bright amber eye with large highlight (초롱초롱)
    ctx.fillStyle = '#3a2800';
    ctx.fillRect(x+19*s, y+3*s, 5*s, 5*s);
    ctx.fillStyle = '#1a0e00';
    ctx.fillRect(x+20*s, y+4*s, 4*s, 4*s);
    ctx.fillStyle = '#ffcc00';
    ctx.fillRect(x+20*s, y+4*s, 3*s, 3*s);
    ctx.fillStyle = C.black;
    ctx.fillRect(x+20*s, y+4*s, 2*s, 2*s);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x+21*s, y+4*s, 2*s, s);   // wide top glint
    ctx.fillRect(x+22*s, y+5*s, s,   s);   // second sparkle dot
  } else if (morph === 'albino') {
    // Pink/red eye for albino
    ctx.fillStyle = '#e08090';
    ctx.fillRect(x+19*s, y+3*s, 5*s, 5*s);
    ctx.fillStyle = '#cc6070';
    ctx.fillRect(x+20*s, y+4*s, 4*s, 4*s);
    ctx.fillStyle = '#ff3050';
    ctx.fillRect(x+20*s, y+4*s, 3*s, 3*s);
    ctx.fillStyle = C.black;
    ctx.fillRect(x+20*s, y+4*s, 2*s, 2*s);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x+21*s, y+4*s, s,   s  );
  } else {
    ctx.fillStyle = '#3a2800';
    ctx.fillRect(x+19*s, y+3*s, 5*s, 5*s);
    ctx.fillStyle = '#1a1000';
    ctx.fillRect(x+20*s, y+4*s, 4*s, 4*s);
    ctx.fillStyle = '#e8c030';
    ctx.fillRect(x+20*s, y+4*s, 3*s, 3*s);
    ctx.fillStyle = C.black;
    ctx.fillRect(x+20*s, y+4*s, 2*s, 2*s);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x+21*s, y+4*s, s,   s  );
  }

  // FRONT LEGS — very short and stubby
  ctx.fillStyle = c.legs;
  ctx.fillRect(x+19*s, y+12*s, 4*s, 2*s);
  ctx.fillRect(x+18*s, y+13*s, 5*s, s  );
  // BACK LEGS
  ctx.fillRect(x+3*s,  y+11*s, 4*s, 2*s);
  ctx.fillRect(x+2*s,  y+12*s, 5*s, s  );

  // MOUTH + TONGUE
  if (!anim.sleeping && threatening) {
    ctx.fillStyle = '#c83020';
    ctx.fillRect(x+18*s, y+10*s, 10*s, 4*s);
    ctx.fillStyle = '#1848c0';
    ctx.fillRect(x+27*s, y+11*s, 6*s, 2*s);
    ctx.fillStyle = '#1040a8';
    ctx.fillRect(x+32*s, y+10*s, 2*s, s);
    ctx.fillRect(x+32*s, y+12*s, 2*s, s);
    ctx.fillStyle = '#f0f0e0';
    ctx.fillRect(x+20*s, y+10*s, s, s);
    ctx.fillRect(x+22*s, y+10*s, s, s);
    ctx.fillRect(x+24*s, y+10*s, s, s);
  } else {
    ctx.fillStyle = adjustHex(c.head, -20);
    ctx.fillRect(x+19*s, y+11*s, 8*s, s);
  }

  // SLEEPING — override eyes, draw Zzz
  if (anim.sleeping) {
    if (morph === 'ajantics') {
      ctx.fillStyle = '#080808';
      ctx.fillRect(x+19*s, y+3*s, 5*s, 5*s);
      ctx.fillStyle = '#000000';
      ctx.fillRect(x+20*s, y+5*s, 4*s, 2*s);
    } else if (morph === 'halmahera') {
      ctx.fillStyle = '#3a2800';
      ctx.fillRect(x+19*s, y+3*s, 5*s, 5*s);
      ctx.fillStyle = '#805030';
      ctx.fillRect(x+20*s, y+5*s, 4*s, 2*s);
      ctx.fillStyle = '#1a0e00';
      ctx.fillRect(x+20*s, y+5*s, 4*s, s);
    } else if (morph === 'albino') {
      ctx.fillStyle = '#e08090';
      ctx.fillRect(x+19*s, y+3*s, 5*s, 5*s);
      ctx.fillStyle = '#cc6070';
      ctx.fillRect(x+20*s, y+5*s, 4*s, 2*s);
    } else {
      ctx.fillStyle = '#3a2800';
      ctx.fillRect(x+19*s, y+3*s, 5*s, 5*s);
      ctx.fillStyle = '#805030';
      ctx.fillRect(x+20*s, y+5*s, 4*s, 2*s);
      ctx.fillStyle = '#1a1000';
      ctx.fillRect(x+20*s, y+5*s, 4*s, s);
    }
    drawZzz(x + 28*s, y - s);
  }
}

function drawBornAnim(cx, cy) {
  const tm = bornAnim.timer;
  const eggShellColor = lizardType === 'crestie' ? '#e87820' : '#5a7ab8';

  if (bornAnim.phase === 0) {
    // Phase 0: egg wobbles gently — something is moving inside
    const wobble = Math.sin(tm / 160) * 5 * Math.min(1, tm / 600);
    ctx.save();
    ctx.translate(cx - 40 + 40, cy - 50 + 55);
    ctx.rotate((wobble * Math.PI) / 180);
    ctx.translate(-(cx - 40 + 40), -(cy - 50 + 55));
    if (lizardType === 'crestie') drawEgg(cx-40, cy-50, 'orange', false);
    else {
      ctx.globalAlpha = 0.9;
      drawEgg(cx-40, cy-50, 'yellow_bt', false);
    }
    ctx.restore();

  } else if (bornAnim.phase === 1) {
    // Phase 1: first crack appears, egg shakes harder
    const shake = Math.sin(tm / 80) * 4;
    const eggColor = lizardType === 'crestie' ? 'orange' : 'blue';
    drawEgg(cx - 40 + shake, cy - 50, eggColor, false);
    // Faint inner glow
    ctx.save();
    ctx.globalAlpha = 0.18 + Math.sin(tm / 150) * 0.08;
    ctx.fillStyle = '#ffffaa';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 20, 22, 28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // First crack line
    ctx.save();
    ctx.translate(shake, 0);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx-20, cy-50);
    ctx.lineTo(cx-15, cy-20);
    ctx.lineTo(cx, cy-35);
    ctx.lineTo(cx+5, cy-10);
    ctx.stroke();
    ctx.restore();

  } else if (bornAnim.phase === 2) {
    // Phase 2: many cracks, violent shaking, glow brightens
    const shake = (Math.random() - 0.5) * 8;
    const eggColor = lizardType === 'crestie' ? 'orange' : 'blue';
    drawEgg(cx - 40 + shake, cy - 50 + shake * 0.4, eggColor, false);
    // Bright inner glow
    ctx.save();
    ctx.globalAlpha = 0.35 + Math.sin(tm / 100) * 0.12;
    ctx.fillStyle = '#ffffcc';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 20, 26, 32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Multiple crack lines
    ctx.save();
    ctx.translate(shake, shake * 0.4);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx-20, cy-50); ctx.lineTo(cx-15, cy-20); ctx.lineTo(cx, cy-35); ctx.lineTo(cx+5, cy-10);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx+10, cy-60); ctx.lineTo(cx+5, cy-38); ctx.lineTo(cx+16, cy-28);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx-28, cy-42); ctx.lineTo(cx-18, cy-22); ctx.lineTo(cx-25, cy-8);
    ctx.stroke();
    ctx.restore();

  } else if (bornAnim.phase === 3) {
    // Phase 3: lizard fully out, shell pieces on ground, sparkles
    const pulse = 0.88 + Math.sin(tm / 220) * 0.12;
    ctx.save();
    ctx.globalAlpha = pulse;
    if (lizardType === 'crestie') drawCrestie(cx-30, cy-40, { threatening: false }, { morph: gs.morph, color: gs.color, traits: gs.traits });
    else drawBluetongue(cx-40, cy-40, { threatening: false }, { morph: gs.morph, color: gs.color, traits: gs.traits });
    ctx.restore();
    // Shell pieces scattered on ground
    ctx.fillStyle = eggShellColor;
    ctx.save(); ctx.translate(cx-52, cy+18); ctx.rotate(-0.35); ctx.fillRect(-11,-7,22,14); ctx.restore();
    ctx.save(); ctx.translate(cx+38, cy+12); ctx.rotate(0.45); ctx.fillRect(-9,-6,18,12); ctx.restore();
    ctx.save(); ctx.translate(cx-5, cy+8); ctx.rotate(-0.2); ctx.fillRect(-8,-5,16,10); ctx.restore();
    ctx.save(); ctx.translate(cx+15, cy+22); ctx.rotate(0.6); ctx.fillRect(-6,-4,12,8); ctx.restore();
    // Sparkles orbiting
    for (let i = 0; i < 6; i++) {
      const angle = (tm / 600 + i * Math.PI * 2 / 6);
      const dist = 38 + Math.sin(tm / 350 + i) * 8;
      const sx = cx + Math.cos(angle) * dist;
      const sy = cy - 22 + Math.sin(angle) * dist * 0.55;
      const alpha = 0.5 + Math.sin(tm / 200 + i * 1.3) * 0.45;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

// ─── UI OVERLAY ──────────────────────────────────────────────────────────────
function drawUI() {
  if (scene !== SCENE.ROOM || !gs || !gs.bornAnim) return;
  const ui = document.getElementById('ui-overlay');
  ui.style.display = 'flex';
  // Update stat bars
  document.getElementById('bar-hunger').style.width = gs.hunger + '%';
  document.getElementById('bar-happy').style.width = gs.happy + '%';
  document.getElementById('bar-bond').style.width = gs.bond + '%';
  document.getElementById('bar-hydration').style.width = (gs.hydration || 0) + '%';
  // Update water button label based on type
  const wBtn = document.getElementById('btn-water');
  if (wBtn) wBtn.textContent = t(lizardType === 'bluetongue' ? 'water_btn_bt' : 'water_btn');
  // Date & time
  const gd = getGameDate();
  document.getElementById('date-display').textContent = formatDate(gd);
  updateTimeDisplay();
  // Age stage: 베이비(0-90) / 아성체(90-270) / 준성체(270-ADULT) / 성체(ADULT+)
  const ageEl = document.getElementById('age-label');
  if (gs.isAdult) ageEl.textContent = t('age_adult');
  else if (gs.gameDaysPassed >= 270) ageEl.textContent = t('age_juvenile');
  else if (gs.gameDaysPassed >= 90) ageEl.textContent = t('age_subadult');
  else ageEl.textContent = t('age_baby');
  // Gender (shown from juvenile stage onward)
  const genderEl = document.getElementById('gender-label');
  if (gs.gameDaysPassed >= 270 && gs.gender) {
    genderEl.style.display = '';
    genderEl.textContent = t(gs.gender === 'female' ? 'gender_female' : 'gender_male');
    genderEl.style.color = gs.gender === 'female' ? '#f080c0' : '#80c0f0';
  } else {
    genderEl.style.display = 'none';
  }
  // Weight
  const wUnit = lizardType === 'crestie' ? 'g' : 'g';
  document.getElementById('weight-label').textContent = `${t('weight_label')}: ${gs.weight.toFixed(1)}${wUnit}`;
  // Lizard name
  document.getElementById('lizard-name-label').textContent = lizardName || '???';

  // Sleep button visibility
  const sleepBtn = document.getElementById('btn-sleep');
  const actionBtns = ['btn-handle', 'btn-feed', 'btn-water'];
  if (gs.isSleeping) {
    actionBtns.forEach(id => { document.getElementById(id).style.display = 'none'; });
    sleepBtn.style.display = 'none';
  } else {
    actionBtns.forEach(id => { document.getElementById(id).style.display = ''; });
    sleepBtn.style.display = isSleepyHour(SPECIES_META[gs.species]?.activity) ? '' : 'none';
  }
  // Companion button — visible only when adult
  const companionBtn = document.getElementById('btn-companion');
  if (companionBtn) {
    companionBtn.style.display = gs.isAdult ? '' : 'none';
  }
  // Rehome button — hide while sleeping
  const rehomeBtn = document.getElementById('btn-rehome');
  if (rehomeBtn) {
    rehomeBtn.style.display = gs.isSleeping ? 'none' : '';
  }
  // Sleep guard button — show only when sleeping and not already playing
  const sleepGuardBtn = document.getElementById('btn-sleep-guard');
  if (sleepGuardBtn) {
    sleepGuardBtn.style.display = (gs.isSleeping && !sleepGuardGame) ? '' : 'none';
  }
  // Clean button — show when there's poop or urine
  const cleanBtn = document.getElementById('btn-clean');
  if (cleanBtn) {
    cleanBtn.textContent = t('clean_btn');
    cleanBtn.style.display = (gs.hasPoop || gs.hasUrine) ? '' : 'none';
  }
  // Substrate / bowl buttons label update
  const subBtn = document.getElementById('btn-substrate');
  if (subBtn) subBtn.textContent = t('quest_substrate_btn');
  const bowlBtn = document.getElementById('btn-wash-bowl');
  if (bowlBtn) bowlBtn.textContent = t('quest_wash_bowl_btn');
  updateQuestPanel();
}

function showMsg(text, duration=2500) {
  const el = document.getElementById('msg-box');
  el.textContent = text;
  el.style.display = 'block';
  clearTimeout(showMsg._t);
  showMsg._t = setTimeout(() => el.style.display = 'none', duration);
}

// ─── ACTIONS ─────────────────────────────────────────────────────────────────
function doHandle() {
  if (!gs || !gs.bornAnim) return;
  if (gs.handleCountToday >= 2) { showMsg(t('handle_no')); return; }
  if (handlingSession.active) return; // already in session
  handlingSession.active = true;
  handlingSession.petsGiven = 0;
  handlingSession.hearts = [];
  handlingSession.petting = false;
  handlingSession.petTimer = 0;
  showMsg(t('handle_start'), 3000);
}

function drawPoopPile(cx, cy) {
  const s = 3;
  // Stacked brown ovals getting smaller (classic poop silhouette)
  ctx.fillStyle = '#5a3010';
  ctx.beginPath(); ctx.ellipse(cx, cy, 4*s, 2*s, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx - s*0.5, cy - 3*s, 3*s, 2*s, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx, cy - 6*s, 2*s, 1.5*s, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx, cy - 8*s, s, s, 0, 0, Math.PI*2); ctx.fill();
  // Highlight sheen
  ctx.fillStyle = '#8b5020';
  ctx.beginPath(); ctx.ellipse(cx - s, cy - 0.5*s, 1.5*s, s, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx - s, cy - 3.5*s, s, 0.8*s, 0, 0, Math.PI*2); ctx.fill();
}

function drawPoopInEnclosure() {
  if (!gs || (!gs.hasPoop && !gs.hasUrine)) return;
  const W = canvas.width, H = canvas.height;
  const isC = lizardType === 'crestie';
  const ex = isC ? W/2 - 180 : W/2 - 200;
  const ey = H * 0.15;
  const ew = isC ? W * 0.75 : W * 0.8;
  const eh = H * 0.48;

  const poopX = Math.round(ex + ew * 0.65);
  const poopY = Math.round(ey + eh - (isC ? 24 : 28));
  const urineX = Math.round(ex + ew * 0.31);
  const urineY = Math.round(ey + eh - (isC ? 30 : 34));

  // Hide poop once hand has grabbed it (timer >= 700ms)
  const grabbed = cleanAnim.active && cleanAnim.timer >= 700;

  if (gs.hasUrine && !grabbed) {
    ctx.fillStyle = 'rgba(210,200,60,0.52)';
    ctx.beginPath(); ctx.ellipse(urineX, urineY, 15, 5, 0.2, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(245,235,110,0.3)';
    ctx.beginPath(); ctx.ellipse(urineX - 2, urineY - 1, 8, 3, 0, 0, Math.PI*2); ctx.fill();
  }
  if (gs.hasPoop && !grabbed) {
    drawPoopPile(poopX, poopY);
  }
}

function drawCleanAnim() {
  const W = canvas.width, H = canvas.height;
  const isC = lizardType === 'crestie';
  const ex = isC ? W/2 - 180 : W/2 - 200;
  const ey = H * 0.15;
  const ew = isC ? W * 0.75 : W * 0.8;
  const eh = H * 0.48;

  const poopX = Math.round(ex + ew * 0.65);
  const poopY = Math.round(ey + eh - (isC ? 24 : 28));
  const topY = ey - 20;
  const targetY = poopY - 20;
  const tm = cleanAnim.timer;

  let handY;
  let showAttached = false;
  if (tm < 700) {
    handY = topY + (targetY - topY) * (tm / 700);
  } else if (tm < 1100) {
    handY = targetY;
  } else {
    handY = targetY - (targetY - topY + 30) * ((tm - 1100) / 900);
    showAttached = true;
  }

  const alpha = tm < 300 ? tm / 300 : tm > 1700 ? Math.max(0, 1 - (tm - 1700) / 300) : 1;
  ctx.globalAlpha = alpha;
  drawPixelHand(poopX, handY);
  if (showAttached) drawPoopPile(poopX, handY + 24);
  ctx.globalAlpha = 1;
}

function doClean() {
  if (!gs || !gs.bornAnim) return;
  if (!gs.hasPoop && !gs.hasUrine) return;
  if (cleanAnim.active) return;
  cleanAnim = { active: true, timer: 0 };
  gs.questClean = true;
  showMsg(t('clean_ok'));
}

function doChangeSubstrate() {
  if (!gs || !gs.bornAnim) return;
  if (gs.questSubstrate) { showMsg(t('quest_done_today')); return; }
  gs.questSubstrate = true;
  gs.happy = Math.min(100, gs.happy + 5);
  updateQuestPanel();
  showMsg(t('quest_substrate_ok'));
  checkQuestCompletion();
  saveGame();
}

function doWashBowl() {
  if (!gs || !gs.bornAnim) return;
  if (gs.questWashBowl) { showMsg(t('quest_done_today')); return; }
  gs.questWashBowl = true;
  gs.hydration = Math.min(100, (gs.hydration || 0) + 5);
  updateQuestPanel();
  showMsg(t('quest_wash_bowl_ok'));
  checkQuestCompletion();
  saveGame();
}

function checkQuestCompletion() {
  if (!gs || gs.questAllDoneRewarded) return;
  const cleanDone = gs.questClean || (!gs.hasPoop && !gs.hasUrine && !cleanAnim.active);
  if (cleanDone && gs.questSubstrate && gs.questWashBowl) {
    gs.questAllDoneRewarded = true;
    AUTH.saveAccountCoins(AUTH.getAccountCoins() + 2);
    gs.bond = Math.min(100, gs.bond + 2);
    showMsg(t('quest_all_done'), 3500);
    saveGame();
  }
}

function updateQuestPanel() {
  const panel = document.getElementById('quest-panel');
  if (!panel || !gs || !gs.bornAnim || scene !== SCENE.ROOM) { if (panel) panel.style.display = 'none'; return; }
  panel.style.display = '';
  const titleEl = document.getElementById('quest-panel-title');
  if (titleEl) titleEl.textContent = t('quest_panel_title');
  const cleanDone = gs.questClean;
  const subDone = gs.questSubstrate;
  const bowlDone = gs.questWashBowl;
  document.getElementById('qitem-clean').className = 'quest-item' + (cleanDone ? ' done' : '');
  document.getElementById('qitem-clean').textContent = (cleanDone ? '✓ ' : '○ ') + t('quest_clean');
  document.getElementById('qitem-substrate').className = 'quest-item' + (subDone ? ' done' : '');
  document.getElementById('qitem-substrate').textContent = (subDone ? '✓ ' : '○ ') + t('quest_substrate');
  document.getElementById('qitem-bowl').className = 'quest-item' + (bowlDone ? ' done' : '');
  document.getElementById('qitem-bowl').textContent = (bowlDone ? '✓ ' : '○ ') + t('quest_wash_bowl');
  // Update button visibility
  const subBtn = document.getElementById('btn-substrate');
  if (subBtn) subBtn.style.display = subDone ? 'none' : '';
  const bowlBtn = document.getElementById('btn-wash-bowl');
  if (bowlBtn) bowlBtn.style.display = bowlDone ? 'none' : '';
}

function drawEatDrinkAnim() {
  const tm = eatAnim.timer;
  const isFeed = eatAnim.type === 'feed';
  const W = canvas.width, H = canvas.height;

  const alpha = tm < 300 ? tm / 300 : tm > 2200 ? Math.max(0, 1 - (tm - 2200) / 600) : 1;

  const isC = lizardType === 'crestie';
  const ex = isC ? W/2 - 180 : W/2 - 200;
  const ey = H * 0.15;
  const ew = isC ? W * 0.75 : W * 0.8;
  const eh = H * 0.48;
  const liz0x = ex + ew/2 + (isC ? -20 : -30);
  const liz0y = ey + eh - (isC ? 90 : 95);
  const s = 3;

  const snoutX = isC ? liz0x + 20*s : liz0x + 28*s;
  const snoutY = isC ? liz0y + 5*s  : liz0y + 7*s;
  const bx = snoutX + 14;
  const by = snoutY + 4;

  ctx.globalAlpha = alpha;

  // Bowl shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(bx - 13, by + 7, 26, 4);

  if (isFeed) {
    ctx.fillStyle = '#6B3E1C';
    ctx.fillRect(bx - 11, by, 22, 9);
    ctx.fillStyle = '#8B5E3C';
    ctx.fillRect(bx - 11, by, 22, 4);
    ctx.fillStyle = '#e87820'; ctx.fillRect(bx - 7, by + 2, 4, 4);
    ctx.fillStyle = '#f8a848'; ctx.fillRect(bx - 2, by + 2, 3, 3);
    ctx.fillStyle = '#4a8a2a'; ctx.fillRect(bx + 3, by + 3, 3, 3);
  } else {
    ctx.fillStyle = '#1e3a5a';
    ctx.fillRect(bx - 11, by, 22, 9);
    ctx.fillStyle = '#2a6a9a';
    ctx.fillRect(bx - 11, by, 22, 4);
    const shimOdd = Math.floor(tm / 200) % 2 === 0;
    ctx.fillStyle = shimOdd ? '#7ad4f8' : '#5ab8e0';
    ctx.fillRect(bx - 8, by + 2, 16, 4);
    ctx.fillStyle = '#b0e8ff';
    ctx.fillRect(bx - 5, by + 2, 3, 2);
  }

  // Floating particles
  const pColors = ['#e87820', '#f8a848', '#4a8a2a', '#c87830', '#f0d020'];
  for (let i = 0; i < 5; i++) {
    const offset = tm - 200 + i * 120;
    if (offset < 0) continue;
    const progress = (offset % 600) / 600;
    ctx.globalAlpha = alpha * (1 - progress);
    const px_p = bx - 8 + (i * 7) % 20;
    const py_p = by - progress * 28;
    if (isFeed) {
      ctx.fillStyle = pColors[i % pColors.length];
      ctx.fillRect(Math.round(px_p), Math.round(py_p), 3, 3);
    } else {
      ctx.fillStyle = '#7ad4f8';
      ctx.fillRect(Math.round(px_p), Math.round(py_p), 2, 4);
    }
  }

  ctx.globalAlpha = alpha * 0.95;
  ctx.font = "7px 'Press Start 2P', Galmuri11, monospace";
  ctx.fillStyle = isFeed ? '#f8d048' : '#80d8f8';
  const bobY = Math.sin(tm / 180) * 2;
  const label = isFeed
    ? (currentLang === 'ko' ? '냠냠!' : 'NOM!')
    : (currentLang === 'ko' ? '쩝쩝!' : 'SIP!');
  ctx.fillText(label, bx - 10, by - 18 + bobY);
  ctx.globalAlpha = 1;
}

function doFeed() {
  if (!gs || !gs.bornAnim) return;
  const currentDay = gs.gameDaysPassed;
  if (currentDay - gs.lastFedGameDay < 2) {
    showMsg(t('feed_no')); return;
  }
  const hasPellet = (gs.pelletCount || 0) >= 1;
  const hasChicory = lizardType !== 'crestie' && (gs.chicoryStock || 0) >= 1;
  const hasCricket = (gs.cricketCount || 0) >= 5;
  if (!hasPellet && !hasChicory && !hasCricket) {
    showMsg(t('feed_no_food')); return;
  }
  let feedMsg;
  if (hasPellet) {
    gs.pelletCount -= 1;
    feedMsg = t('feed_ok_pellet');
  } else if (hasChicory) {
    gs.chicoryStock -= 1;
    feedMsg = t('feed_ok_chicory');
  } else {
    gs.cricketCount -= 5;
    feedMsg = t('feed_ok_cricket');
  }
  gs.lastFedGameDay = currentDay;
  gs.hunger = Math.min(100, gs.hunger + 40);
  gs.happy = Math.min(100, gs.happy + 10);
  if (lizardType === 'crestie') gs.weight = Math.min(50, gs.weight + 0.3);
  else gs.weight = Math.min(600, gs.weight + 4);
  gs.hasPoop = true;
  gs.hasUrine = true;
  eatAnim = { active: true, timer: 0, type: 'feed' };
  showMsg(feedMsg);
  saveGame();
}

function doWater() {
  if (!gs || !gs.bornAnim) return;
  if ((gs.waterCountToday || 0) >= 2) { showMsg(t('water_no')); return; }
  gs.hydration = Math.min(100, (gs.hydration || 0) + 25);
  gs.happy = Math.min(100, gs.happy + 5);
  gs.waterCountToday = (gs.waterCountToday || 0) + 1;
  const key = lizardType === 'crestie' ? 'water_ok' : 'water_ok_bt';
  eatAnim = { active: true, timer: 0, type: 'water' };
  showMsg(t(key));
  saveGame();
}

function doStatus() {
  if (!gs || !gs.bornAnim) return;
  const gd = getGameDate();
  const wUnit = lizardType === 'crestie' ? 'g' : 'g';
  const typeName = t(lizardType === 'crestie' ? 'type_crestie' : 'type_bt');
  const warning = gs.hunger < 25 || gs.happy < 25 || (gs.hydration || 0) < 20;
  const lines = [
    `${t('type_label')}: ${typeName}`,
    `${t('days_label')} ${gs.gameDaysPassed}`,
    `${t('weight_label')}: ${gs.weight.toFixed(1)}${wUnit}`,
    `${t('hunger')}: ${gs.hunger}%`,
    `${t('happy')}: ${gs.happy}%`,
    `${t('hydration')}: ${(gs.hydration||0)}%`,
    `${t('bond')}: ${gs.bond}%`,
    warning ? `⚠ ${t('stat_warning')}` : `✓ ${t('stat_full')}`,
  ];
  showMsg(lines.join('\n'), 5000);
}

function doSleep() {
  if (!gs || !gs.bornAnim) return;
  gs.isSleeping = true;
  showMsg(t('sleeping_msg'), 3000);
  saveGame();
}

// ─── SLEEP GUARD MINI-GAME ───────────────────────────────────────────────────
function doSleepGuard() {
  if (!gs || !gs.isSleeping || !gs.bornAnim) return;
  if (sleepGuardGame) return;
  sleepGuardGame = {
    startTime: Date.now(),
    duration: 30000,
    bugs: [],
    score: 0,
    lives: 3,
    spawnTimer: 1500,
    spawnInterval: 2200,
    bugIdCounter: 0,
    particles: [],
    screenFlash: 0,
    result: null,
    resultTimer: 0,
    coinsEarned: 0,
    bondEarned: 0,
    _closeBtnBounds: null,
  };
}

function _sgSpawnBug(W, H) {
  const lizX = W / 2;
  const lizY = lizardType === 'bluetongue' ? H * 0.55 : H * 0.52;
  // 60% fly, 40% mite
  const type = Math.random() < 0.6 ? 'fly' : 'mite';
  let x, y;
  if (type === 'mite') {
    // Mites crawl from sides/bottom only
    const side = Math.random() < 0.5 ? 1 : (Math.random() < 0.5 ? 3 : 2);
    if (side === 1) { x = W + 12; y = 40 + Math.random() * (H * 0.65); }
    else if (side === 2) { x = Math.random() * W; y = H * 0.83; }
    else { x = -12; y = 40 + Math.random() * (H * 0.65); }
  } else {
    const side = Math.floor(Math.random() * 4);
    if (side === 0) { x = Math.random() * W; y = -15; }
    else if (side === 1) { x = W + 15; y = 30 + Math.random() * (H * 0.7); }
    else if (side === 2) { x = Math.random() * W; y = H * 0.85; }
    else { x = -15; y = 30 + Math.random() * (H * 0.7); }
  }
  const dx = lizX - x, dy = lizY - y;
  const dist = Math.hypot(dx, dy) || 1;
  // Mites are slower but harder to spot; flies faster with wobble
  const speed = type === 'mite'
    ? 0.022 + Math.random() * 0.015
    : 0.035 + Math.random() * 0.025;
  return {
    id: sleepGuardGame.bugIdCounter++,
    type,
    x, y,
    vx: (dx / dist) * speed,
    vy: (dy / dist) * speed,
    wobble: Math.random() * Math.PI * 2,
    wobbleSpeed: type === 'mite' ? 0.001 + Math.random() * 0.001 : 0.003 + Math.random() * 0.002,
    hit: false, hitTimer: 0,
    reached: false, reachTimer: 0,
    phase: Math.random() * Math.PI * 2,
  };
}

function updateSleepGuard(dt) {
  const sg = sleepGuardGame;
  if (!sg) return;
  if (sg.result) { sg.resultTimer += dt; return; }

  const W = canvas.width, H = canvas.height;
  const lizX = W / 2;
  const lizY = lizardType === 'bluetongue' ? H * 0.55 : H * 0.52;
  const elapsed = Date.now() - sg.startTime;

  if (elapsed >= sg.duration || sg.lives <= 0) {
    _endSleepGuard();
    return;
  }

  // Spawn
  sg.spawnTimer += dt;
  if (sg.spawnTimer >= sg.spawnInterval) {
    sg.spawnTimer = 0;
    sg.bugs.push(_sgSpawnBug(W, H));
    sg.spawnInterval = Math.max(1000, 2200 - elapsed * 0.025);
  }

  // Update bugs
  for (const bug of sg.bugs) {
    bug.phase += dt * 0.014;
    if (bug.hit) { bug.hitTimer += dt; continue; }
    if (bug.reached) { bug.reachTimer += dt; continue; }
    bug.wobble += bug.wobbleSpeed * dt;
    bug.x += bug.vx * dt + Math.sin(bug.wobble) * 0.25;
    bug.y += bug.vy * dt + Math.cos(bug.wobble * 0.7) * 0.12;
    if (Math.hypot(bug.x - lizX, bug.y - lizY) < 28) {
      bug.reached = true;
      sg.lives = Math.max(0, sg.lives - 1);
      sg.screenFlash = 500;
      for (let i = 0; i < 6; i++) {
        sg.particles.push({ x: lizX, y: lizY,
          vx: (Math.random() - 0.5) * 0.18,
          vy: (Math.random() - 0.5) * 0.18,
          alpha: 1, color: '#ff5050' });
      }
    }
  }
  sg.bugs = sg.bugs.filter(b => !(b.hit && b.hitTimer > 500) && !(b.reached && b.reachTimer > 600));

  for (const p of sg.particles) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.alpha -= dt * 0.0025;
  }
  sg.particles = sg.particles.filter(p => p.alpha > 0);
  if (sg.screenFlash > 0) sg.screenFlash -= dt;
}

function _endSleepGuard() {
  const sg = sleepGuardGame;
  let coins = 0, bond = 0;
  if (sg.lives > 0) {
    if (sg.score >= 12) { coins = 5; bond = 2; }
    else if (sg.score >= 6) { coins = 3; bond = 1; }
    else { coins = 1; }
  } else {
    if (sg.score >= 8) { coins = 2; }
    else if (sg.score >= 3) { coins = 1; }
  }
  sg.coinsEarned = coins; sg.bondEarned = bond;
  sg.result = 'done'; sg.resultTimer = 0;
  if (coins > 0) AUTH.saveAccountCoins(AUTH.getAccountCoins() + coins);
  if (bond > 0) { gs.bond = Math.min(100, gs.bond + bond); saveGame(); }
}

function _drawSgBug(x, y, phase, alpha) {
  ctx.globalAlpha = alpha;
  const flap = Math.sin(phase) > 0;
  const wY = flap ? -7 : -5;
  const wW = flap ? 9 : 7;
  const wH = flap ? 3 : 4;
  ctx.fillStyle = 'rgba(200, 230, 255, 0.55)';
  ctx.beginPath(); ctx.ellipse(x - wW * 0.55, y + wY, wW * 0.5, wH, -0.35, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x + wW * 0.55, y + wY, wW * 0.5, wH, 0.35, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2e1e0e';
  ctx.beginPath(); ctx.ellipse(x, y, 4, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1e0e00';
  ctx.beginPath(); ctx.arc(x, y - 5, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ff2020';
  ctx.fillRect(x - 2, y - 6, 2, 2); ctx.fillRect(x + 1, y - 6, 2, 2);
  ctx.strokeStyle = '#2e1e0e'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 4, y - 1); ctx.lineTo(x - 8, y + 2);
  ctx.moveTo(x - 4, y + 2); ctx.lineTo(x - 8, y + 5);
  ctx.moveTo(x + 4, y - 1); ctx.lineTo(x + 8, y + 2);
  ctx.moveTo(x + 4, y + 2); ctx.lineTo(x + 8, y + 5);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function _drawSgMite(x, y, phase, alpha) {
  // Mite: tiny arachnid (8 legs, two-part body), reddish-brown
  ctx.globalAlpha = alpha;
  const legWiggle = Math.sin(phase * 1.8) * 1.5;

  // 8 legs (4 per side), alternating with animation
  ctx.strokeStyle = '#6b2a0a'; ctx.lineWidth = 1;
  ctx.beginPath();
  // left legs
  ctx.moveTo(x - 3, y - 1); ctx.lineTo(x - 7, y - 3 + legWiggle);
  ctx.moveTo(x - 3, y + 1); ctx.lineTo(x - 8, y + legWiggle * 0.5);
  ctx.moveTo(x - 3, y + 3); ctx.lineTo(x - 7, y + 3 - legWiggle);
  ctx.moveTo(x - 2, y + 4); ctx.lineTo(x - 6, y + 6 + legWiggle * 0.3);
  // right legs
  ctx.moveTo(x + 3, y - 1); ctx.lineTo(x + 7, y - 3 - legWiggle);
  ctx.moveTo(x + 3, y + 1); ctx.lineTo(x + 8, y - legWiggle * 0.5);
  ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + 7, y + 3 + legWiggle);
  ctx.moveTo(x + 2, y + 4); ctx.lineTo(x + 6, y + 6 - legWiggle * 0.3);
  ctx.stroke();

  // Abdomen (rear, larger)
  ctx.fillStyle = '#8b2010';
  ctx.beginPath(); ctx.ellipse(x, y + 2, 4, 5, 0, 0, Math.PI * 2); ctx.fill();
  // Cephalothorax (front, smaller)
  ctx.fillStyle = '#5a1a08';
  ctx.beginPath(); ctx.ellipse(x, y - 3, 3, 3, 0, 0, Math.PI * 2); ctx.fill();
  // Tiny eyes (2 red dots)
  ctx.fillStyle = '#ff6030';
  ctx.fillRect(x - 2, y - 4, 1, 1); ctx.fillRect(x + 1, y - 4, 1, 1);

  ctx.globalAlpha = 1;
}

function drawSleepGuardOverlay() {
  const sg = sleepGuardGame;
  if (!sg) return;
  const W = canvas.width, H = canvas.height;
  const lizX = W / 2;
  const lizY = lizardType === 'bluetongue' ? H * 0.55 : H * 0.52;

  // Dark overlay
  ctx.fillStyle = 'rgba(4, 4, 18, 0.52)';
  ctx.fillRect(0, 0, W, H);

  // Soft moonlight glow around lizard
  const grd = ctx.createRadialGradient(lizX, lizY - 15, 8, lizX, lizY - 15, 90);
  grd.addColorStop(0, 'rgba(140,190,255,0.1)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);

  // Screen flash on bug reaching lizard
  if (sg.screenFlash > 0) {
    ctx.fillStyle = `rgba(255,40,40,${Math.min(0.38, (sg.screenFlash / 500) * 0.38)})`;
    ctx.fillRect(0, 0, W, H);
  }

  // Particles
  for (const p of sg.particles) {
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Bugs
  for (const bug of sg.bugs) {
    let a = 1;
    if (bug.hit) a = Math.max(0, 1 - bug.hitTimer / 500);
    if (bug.reached) a = Math.max(0, 1 - bug.reachTimer / 600);
    if (bug.type === 'mite') _drawSgMite(bug.x, bug.y, bug.phase, a);
    else _drawSgBug(bug.x, bug.y, bug.phase, a);
  }

  if (!sg.result) {
    const elapsed = Date.now() - sg.startTime;
    const remaining = Math.max(0, sg.duration - elapsed);

    // Timer bar (top center)
    const barW = Math.min(W * 0.55, 200);
    const barX = W / 2 - barW / 2;
    const barY = 18;
    ctx.fillStyle = '#0a0a22';
    ctx.fillRect(barX - 1, barY - 1, barW + 2, 12);
    const ratio = remaining / sg.duration;
    ctx.fillStyle = ratio > 0.5 ? '#40e890' : ratio > 0.25 ? '#e8c040' : '#e84040';
    ctx.fillRect(barX, barY, barW * ratio, 10);
    ctx.strokeStyle = '#3a3a6a'; ctx.lineWidth = 2;
    ctx.strokeRect(barX, barY, barW, 10);

    ctx.fillStyle = '#d8eaff';
    ctx.font = '7px "Press Start 2P", monospace';
    const scoreTxt = t('sleep_guard_score').replace('{n}', sg.score);
    ctx.fillText(scoreTxt, barX, barY + 26);

    // Hearts (lives)
    ctx.font = '11px sans-serif';
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < sg.lives ? '#ff4080' : '#2a2a4a';
      ctx.fillText('♥', barX + barW - 14 - i * 17, barY + 26);
    }

    // Hint text (first 4 seconds)
    const hintAlpha = Math.min(1, Math.max(0, (4000 - elapsed) / 1500));
    if (hintAlpha > 0) {
      ctx.globalAlpha = hintAlpha;
      ctx.fillStyle = '#aaddff';
      ctx.font = '6px "Press Start 2P", monospace';
      const hint = t('sleep_guard_tap');
      ctx.fillText(hint, W / 2 - ctx.measureText(hint).width / 2, H * 0.17);
      ctx.globalAlpha = 1;
    }
  } else {
    // Result panel
    const panelW = Math.min(260, W * 0.78);
    const panelH = 115;
    const px = W / 2 - panelW / 2;
    const py = H / 2 - panelH / 2 - 25;

    ctx.fillStyle = '#080820';
    ctx.fillRect(px, py, panelW, panelH);
    ctx.strokeStyle = sg.lives > 0 ? '#4488ff' : '#884444';
    ctx.lineWidth = 3;
    ctx.strokeRect(px, py, panelW, panelH);

    // Stars / result title
    ctx.fillStyle = '#ffe060';
    ctx.font = '10px "Press Start 2P", monospace';
    const stars = sg.lives > 0 ? (sg.score >= 12 ? '★★★' : sg.score >= 6 ? '★★' : '★') : '✕';
    ctx.fillText(stars, W / 2 - ctx.measureText(stars).width / 2, py + 22);

    // Result lines
    let raw;
    if (sg.lives > 0) {
      if (sg.score >= 12) raw = t('sleep_guard_result_great').replace('{n}', sg.score).replace('{c}', sg.coinsEarned).replace('{b}', sg.bondEarned);
      else if (sg.score >= 6) raw = t('sleep_guard_result_good').replace('{n}', sg.score).replace('{c}', sg.coinsEarned);
      else raw = t('sleep_guard_result_ok').replace('{c}', sg.coinsEarned);
    } else {
      raw = t('sleep_guard_result_fail').replace('{n}', sg.score);
    }
    const lines = raw.split('\n');
    ctx.fillStyle = '#c8e0ff';
    ctx.font = '6px "Press Start 2P", monospace';
    lines.forEach((line, i) => {
      ctx.fillText(line, W / 2 - ctx.measureText(line).width / 2, py + 42 + i * 17);
    });

    // Close button
    const btnW = 80, btnH = 22;
    const btnX = W / 2 - btnW / 2;
    const btnY = py + panelH - 28;
    ctx.fillStyle = '#1a3060';
    ctx.fillRect(btnX, btnY, btnW, btnH);
    ctx.strokeStyle = '#4488ff'; ctx.lineWidth = 2;
    ctx.strokeRect(btnX, btnY, btnW, btnH);
    ctx.fillStyle = '#e0f0ff';
    ctx.font = '7px "Press Start 2P", monospace';
    const closeTxt = t('sleep_guard_done_btn');
    ctx.fillText(closeTxt, W / 2 - ctx.measureText(closeTxt).width / 2, btnY + 15);
    sg._closeBtnBounds = { x: btnX, y: btnY, w: btnW, h: btnH };
  }
}

function doFindCompanion() {
  if (!gs || !gs.bornAnim) return;
  if (!gs.isAdult) { showMsg(t('companion_msg_no_adult'), 3000); return; }
  // BT breeding season: December~April only
  if (gs.type === 'bluetongue') {
    const gd = getGameDate();
    const inSeason = gd.month === 12 || gd.month <= 4;
    if (!inSeason) { showMsg(t('bt_no_breed_season'), 4000); return; }
  }
  openCompanionModal();
}

function openCompanionModal() {
  document.getElementById('companion-modal-title').textContent = t('companion_title');

  // Find same-type, opposite-gender, adult lizards (excluding current)
  const isLillyWhite = m => m === 'lilly_white' || m === 'super_lilly_white';
  const CAPPUCCINO_MORPHS = new Set(['cappuccino','super_cappuccino','frappuccino','luwak','triple_combo','cappuccino_azantic','cappuccino_choco']);
  const isCappuccino = m => CAPPUCCINO_MORPHS.has(m);
  const partners = allLizards
    .map((l, i) => ({ l, i }))
    .filter(({ l, i }) =>
      i !== activeLizardIdx &&
      l.type === gs.type &&
      l.isAdult &&
      l.gender && gs.gender &&
      l.gender !== gs.gender &&
      !(isLillyWhite(gs.morph) && isLillyWhite(l.morph)) &&
      !(isCappuccino(gs.morph) && isCappuccino(l.morph))
    );

  const list = document.getElementById('companion-list');
  const noMsg = document.getElementById('companion-no-partners');
  list.innerHTML = '';

  if (partners.length === 0) {
    noMsg.style.display = '';
    const allSameLilly = allLizards.some((l, i) =>
      i !== activeLizardIdx && l.type === gs.type && l.isAdult &&
      l.gender && gs.gender && l.gender !== gs.gender &&
      isLillyWhite(gs.morph) && isLillyWhite(l.morph)
    );
    const allSameCappuccino = allLizards.some((l, i) =>
      i !== activeLizardIdx && l.type === gs.type && l.isAdult &&
      l.gender && gs.gender && l.gender !== gs.gender &&
      isCappuccino(gs.morph) && isCappuccino(l.morph)
    );
    noMsg.textContent = allSameLilly
      ? t('companion_no_partners_lilly')
      : allSameCappuccino
        ? t('companion_no_partners_cappuccino')
        : t('companion_no_partners');
  } else {
    noMsg.style.display = 'none';
    partners.forEach(({ l, i }) => {
      const card = document.createElement('div');
      card.style.cssText =
        'display:flex;align-items:center;gap:10px;padding:8px 6px;background:#1a0a14;' +
        'border:2px solid #6a2a4a;margin-bottom:6px;border-radius:2px;cursor:pointer';

      const miniCanvas = document.createElement('canvas');
      miniCanvas.width = 80; miniCanvas.height = 54;
      miniCanvas.className = 'dogram-mini-canvas';
      card.appendChild(miniCanvas);

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';
      const genderText = l.gender === 'female' ? ' ♀' : ' ♂';
      const typeText = l.type === 'crestie' ? t('type_crestie') : t('type_bt');
      const morphText = getMorphLabel(l.type === 'bluetongue' ? l.btGenetics : l.genetics, l.morph, l.type);
      const colorText = l.color ? t('color_' + l.color) : '';
      const detail = [morphText, colorText].filter(Boolean).join(' · ');
      info.innerHTML =
        `<div style="font-size:8px;color:#e8a020;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">` +
          `${l.lizardName || '???'}${genderText}</div>` +
        `<div style="font-size:7px;color:#aaa;margin-top:2px">${typeText}${detail ? ' · ' + detail : ''}</div>`;
      card.appendChild(info);

      const btn = document.createElement('button');
      btn.className = 'pixel-btn small';
      btn.style.cssText = 'background:#9a2a6a;color:#ffb0e0;flex-shrink:0';
      btn.textContent = t('companion_select');
      btn.onclick = () => { closeCompanionModal(); startMatingAnim(i); };
      card.appendChild(btn);

      list.appendChild(card);
      renderMiniLizard(miniCanvas, l);
    });
  }

  document.getElementById('companion-modal').style.display = 'flex';
}

function closeCompanionModal() {
  document.getElementById('companion-modal').style.display = 'none';
}

// ─── MATING ANIMATION ────────────────────────────────────────────────────────
let _matingAnimId = null;
let _matingTick   = 0;
const MATING_TOTAL  = 200;
const MATING_KISS   = 65;  // frame when snouts meet
const MATING_FAIL_BACK = 95; // frame when avoider fully retreats (fail only)

function startMatingAnim(partnerIdx) {
  const partner = allLizards[partnerIdx];
  _matingTick = 0;

  // Randomly decide outcome and which lizard avoids (if fail)
  // 60% success, 40% failure
  const matingSuccess = Math.random() < 0.6;
  // 0 = left lizard (mine) avoids, 1 = right lizard (partner) avoids
  const avoider = Math.random() < 0.5 ? 0 : 1;

  const modal = document.getElementById('mating-modal');
  modal.style.display = 'flex';
  document.getElementById('mating-close-btn').style.display = 'none';
  document.getElementById('mating-msg').textContent = '';

  const mCanvas = document.getElementById('mating-canvas');
  const W = mCanvas.width;   // 300
  const H = mCanvas.height;  // 130
  const sc = 0.42;
  const s  = 3; // used inside draw functions
  const isC = gs.type === 'crestie';

  // How far snout/tail are from the draw origin (in local px = units*s)
  const snoutPx = (isC ? 20 : 28) * s * sc; // canvas px from origin to snout
  const tailPx  = (isC ?  8 :  7) * s * sc; // canvas px from origin to tail tip

  const centerX = W / 2;
  const yOff    = Math.round(H * 0.62); // canvas y of the draw origin
  const mockAnim = { frame: 0, timer: 0, threatening: false, sleeping: false };

  // Left lizard travels from lx_start → lx_end
  const lx_start = 5 + tailPx;
  const lx_end   = centerX - snoutPx;
  // Right lizard (flipped) travels from rx_start → rx_end
  const rx_start = W - 5 - tailPx;
  const rx_end   = centerX + snoutPx;

  if (_matingAnimId) { cancelAnimationFrame(_matingAnimId); _matingAnimId = null; }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  function drawFrame() {
    const mCtx = mCanvas.getContext('2d');
    mCtx.imageSmoothingEnabled = false;

    // -- Background --
    mCtx.fillStyle = '#180810';
    mCtx.fillRect(0, 0, W, H);
    // Hearts pattern on bg (static tiny hearts)
    mCtx.fillStyle = matingSuccess ? '#2a0a18' : '#0e0e0e';
    for (let hx = 12; hx < W; hx += 30) {
      for (let hy = 10; hy < H * 0.6; hy += 24) {
        mCtx.fillRect(hx,   hy,   3, 2);
        mCtx.fillRect(hx+3, hy,   3, 2);
        mCtx.fillRect(hx+1, hy-1, 4, 1);
        mCtx.fillRect(hx+1, hy+2, 4, 2);
        mCtx.fillRect(hx+2, hy+4, 2, 1);
      }
    }
    // Floor
    mCtx.fillStyle = '#2a1020';
    mCtx.fillRect(0, Math.floor(H * 0.72), W, H);
    mCtx.fillStyle = '#3a1830';
    mCtx.fillRect(0, Math.floor(H * 0.72), W, 2);

    // ── Phase 1: approach (both lizards close in) ──
    // ── Phase 2 (fail): avoider backs away, other stays ──
    // ── Phase 2 (success): kiss with hearts ──

    let lx, rx;
    let lFlipped = false; // true = left lizard faces left (turned away)
    let rFlipped = true;  // right lizard normally mirrors; false = faces right (turned away)

    if (_matingTick <= MATING_KISS) {
      // Approach phase
      const t01 = Math.min(1, _matingTick / MATING_KISS);
      const ease = easeInOut(t01);
      lx = lx_start + (lx_end - lx_start) * ease;
      rx = rx_start + (rx_end - rx_start) * ease;
    } else if (!matingSuccess) {
      // Failure: avoider retreats, other stays at meeting point then backs off slowly
      const failT = Math.min(1, (_matingTick - MATING_KISS) / (MATING_FAIL_BACK - MATING_KISS));
      const failEase = easeInOut(failT);
      if (avoider === 0) {
        // Left lizard (mine) turns away
        lx = lx_end + (lx_start - lx_end) * failEase;
        lFlipped = true; // facing left = turned away
        rx = rx_end + (rx_start - rx_end) * failEase * 0.4; // right follows slowly
      } else {
        // Right lizard (partner) turns away
        rx = rx_end + (rx_start - rx_end) * failEase;
        rFlipped = false; // facing right = turned away
        lx = lx_end + (lx_start - lx_end) * failEase * 0.4; // left follows slowly
      }
    } else {
      // Success: both stay at kiss position
      lx = lx_end;
      rx = rx_end;
    }

    const savedCtx = ctx;
    ctx = mCtx;

    // Left lizard
    mCtx.save();
    mCtx.translate(Math.round(lx), yOff);
    if (lFlipped) mCtx.scale(-sc, sc);
    else          mCtx.scale(sc, sc);
    if (isC) drawCrestie(0, 0, mockAnim, { morph: gs.morph, color: gs.color, traits: gs.traits });
    else     drawBluetongue(0, 0, mockAnim, { morph: gs.morph, color: gs.color, traits: gs.traits });
    mCtx.restore();

    // Right lizard
    mCtx.save();
    mCtx.translate(Math.round(rx), yOff);
    if (rFlipped) mCtx.scale(-sc, sc);
    else          mCtx.scale(sc, sc);
    if (partner.type === 'crestie') drawCrestie(0, 0, mockAnim, { morph: partner.morph, color: partner.color, traits: partner.traits });
    else                             drawBluetongue(0, 0, mockAnim, { morph: partner.morph, color: partner.color, traits: partner.traits });
    mCtx.restore();

    ctx = savedCtx;

    // ── Post-meet effects ──
    if (_matingTick >= MATING_KISS) {
      const kissY = yOff + (isC ? 6 : 8) * s * sc;

      if (matingSuccess) {
        // Hearts / kiss effect
        const hp = (_matingTick - MATING_KISS) / (MATING_TOTAL - MATING_KISS); // 0→1
        const sparkAlpha = Math.max(0, 1 - hp * 1.4);
        mCtx.save();
        mCtx.globalAlpha = sparkAlpha;
        mCtx.font = `${Math.round(14 + 6 * Math.sin(hp * Math.PI))}px serif`;
        mCtx.textAlign = 'center';
        mCtx.textBaseline = 'middle';
        mCtx.fillText('💋', centerX, kissY - hp * 22);
        mCtx.font = '11px serif';
        mCtx.globalAlpha = Math.max(0, 0.9 - hp);
        mCtx.fillText('❤', centerX - 22, kissY - 8  - hp * 28);
        mCtx.fillText('❤', centerX + 24, kissY - 12 - hp * 24);
        mCtx.globalAlpha = Math.max(0, 0.7 - hp);
        mCtx.fillText('❤', centerX,      kissY - 18 - hp * 32);
        mCtx.restore();
      } else {
        // Sad effect: broken heart floats up briefly
        const fp = Math.min(1, (_matingTick - MATING_KISS) / (MATING_TOTAL - MATING_KISS));
        const sadAlpha = Math.max(0, 0.9 - fp * 1.2);
        if (sadAlpha > 0) {
          mCtx.save();
          mCtx.globalAlpha = sadAlpha;
          mCtx.font = `${Math.round(13 + 3 * Math.sin(fp * Math.PI))}px serif`;
          mCtx.textAlign = 'center';
          mCtx.textBaseline = 'middle';
          mCtx.fillText('💔', centerX, kissY - fp * 28);
          mCtx.restore();
        }
      }
    }

    _matingTick++;

    if (_matingTick < MATING_TOTAL) {
      _matingAnimId = requestAnimationFrame(drawFrame);
    } else {
      _matingAnimId = null;
      document.getElementById('mating-close-btn').style.display = '';

      const msgEl = document.getElementById('mating-msg');
      if (matingSuccess) {
        // Bond/happy boost
        gs.bond  = Math.min(100, gs.bond  + 3);
        gs.happy = Math.min(100, gs.happy + 8);
        gs.isLonely = false;
        gs.lastLonelyDay = gs.gameDaysPassed;
        gs.lonelyNotified = false;
        // Record mating day so female lays fertilized egg ~45 days later; reset cycle
        if (gs.gender === 'female' && gs.isAdult) {
          gs.lastMatingDay = gs.gameDaysPassed;
          gs.fertilizedEggLayCount = 0;
          gs.lastFertilizedEggLayDay = null;
          gs.matingPartnerGenetics    = getLizardGenetics(partner);
          gs.matingPartnerBtGenetics  = getBtLizardGenetics(partner);
          gs.matingPartnerBtLocale    = partner ? (BT_LOCALE_SET.has(partner.morph) ? partner.morph : (partner.btLocale || 'northern')) : 'northern';
          gs.matingPartnerTraits      = partner ? [...(partner.traits || [])] : [];
        } else if (partner && partner.gender === 'female' && partner.isAdult) {
          partner.lastMatingDay = gs.gameDaysPassed;
          partner.fertilizedEggLayCount = 0;
          partner.lastFertilizedEggLayDay = null;
          partner.matingPartnerGenetics   = getLizardGenetics(gs);
          partner.matingPartnerBtGenetics = getBtLizardGenetics(gs);
          partner.matingPartnerBtLocale   = BT_LOCALE_SET.has(gs.morph) ? gs.morph : (gs.btLocale || 'northern');
          partner.matingPartnerTraits     = [...(gs.traits || [])];
        }
        msgEl.textContent = t('mating_success');
        msgEl.style.color = '#ffb0e0';
      } else {
        // Mating failed — lonely state persists
        const avoiderName = avoider === 0
          ? (gs.lizardName || '???')
          : (partner.lizardName || '???');
        const key = avoider === 0 ? 'mating_fail_left' : 'mating_fail_right';
        const raw = t(key);
        msgEl.textContent = raw
          .replace('{name}', gs.lizardName || '???')
          .replace('{partner}', partner.lizardName || '???');
        msgEl.style.color = '#aaaaaa';
      }
      saveGame();
    }
  }

  drawFrame();
}

function closeMatingModal() {
  if (_matingAnimId) { cancelAnimationFrame(_matingAnimId); _matingAnimId = null; }
  document.getElementById('mating-modal').style.display = 'none';
}

// ─── MAIN LOOP ───────────────────────────────────────────────────────────────
let lastTime = 0;
function gameLoop(ts) {
  requestAnimationFrame(gameLoop);
  const dt = ts - lastTime;
  lastTime = ts;

  updateGameTime();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (scene === SCENE.SHOP) {
    if (rehomeAnimState) {
      drawRehomeAnim();
      rehomeAnimState.timer += dt;
      if (rehomeAnimState.phase === 0 && rehomeAnimState.timer > 2200) {
        rehomeAnimState.phase = 1; rehomeAnimState.timer = 0;
      } else if (rehomeAnimState.phase === 1 && rehomeAnimState.timer > 1800) {
        rehomeAnimState.phase = 2; rehomeAnimState.timer = 0;
      } else if (rehomeAnimState.phase === 2 && rehomeAnimState.timer > 2000) {
        rehomeAnimState.phase = 3; rehomeAnimState.timer = 0;
      } else if (rehomeAnimState.phase === 3 && rehomeAnimState.timer > 1300) {
        _finalizeRehome();
      }
    } else {
      drawShop();
    }
  } else if (scene === SCENE.EGG) {
    drawEggScene();
  } else if (scene === SCENE.OUTDOOR) {
    drawOutdoor();
  } else if (scene === SCENE.ROOM) {
    drawRoom();
    // Sleep guard mini-game
    if (sleepGuardGame) {
      if (!gs || !gs.isSleeping) { sleepGuardGame = null; }
      else { updateSleepGuard(dt); drawSleepGuardOverlay(); }
    }
    // Born animation progression
    if (!gs.bornAnim) {
      bornAnim.timer += dt;
      if (bornAnim.phase === 0 && bornAnim.timer > 2200) { bornAnim.phase = 1; bornAnim.timer = 0; }
      else if (bornAnim.phase === 1 && bornAnim.timer > 1800) { bornAnim.phase = 2; bornAnim.timer = 0; }
      else if (bornAnim.phase === 2 && bornAnim.timer > 1500) { bornAnim.phase = 3; bornAnim.timer = 0; }
      else if (bornAnim.phase === 3 && bornAnim.timer > 2500) {
        gs.bornAnim = true;
        lizardAnim.threatening = true;
        if (!gs.introShown) {
          const key = lizardType === 'crestie' ? 'room_intro_crestie' : 'room_intro_blue';
          showMsg(t(key), 4000);
          if (lizardType === 'bluetongue') {
            setTimeout(() => showMsg(t('room_intro_blue2'), 3500), 4500);
          }
          gs.introShown = true;
        }
        saveGame();
      }
    }
    // Eat/drink animation tick
    if (eatAnim.active) {
      eatAnim.timer += dt;
      if (eatAnim.timer > 2800) eatAnim = { active: false, timer: 0, type: null };
    }
    // Clean animation tick
    if (cleanAnim.active) {
      cleanAnim.timer += dt;
      if (cleanAnim.timer >= 2000) {
        gs.hasPoop = false;
        gs.hasUrine = false;
        cleanAnim = { active: false, timer: 0 };
        updateQuestPanel();
        checkQuestCompletion();
        saveGame();
      }
    }

    // Threat animation oscillation
    lizardAnim.timer += dt;
    if (lizardAnim.timer > 3000) {
      lizardAnim.timer = 0;
      if (gs.bond < 40) lizardAnim.threatening = !lizardAnim.threatening;
    }
    // Handling session heart update
    if (handlingSession.active || handlingSession.hearts.length > 0) {
      updateHandlingHearts(dt);
    }
    // Juvenile notification (gender revealed)
    if (gs.isJuvenile && !gs.juvenileNotified) {
      gs.juvenileNotified = true;
      const juvenileKey = gs.gender === 'female' ? 'juvenile_msg_female' : 'juvenile_msg_male';
      showMsg(t(juvenileKey), 5000);
      saveGame();
    }
    // Adult notification
    if (gs.isAdult && !gs.adultNotified) {
      gs.adultNotified = true;
      showMsg(t('adult_msg'), 5000);
      saveGame();
    }
    // Egg / pup laid notification
    if (gs.bornAnim && gs.hasEgg && !gs.eggNotified) {
      gs.eggNotified = true;
      const name = gs.lizardName || '???';
      showMsg(t(gs.type === 'crestie' ? 'egg_laid_msg' : 'pup_born_msg').replace('{name}', name), 5000);
      saveGame();
    }
    if (gs.bornAnim && !gs.hasEgg) gs.eggNotified = false;
    // Unfertilized egg notification
    if (gs.bornAnim && gs.hasUnfertilizedEgg && !gs.unfertilizedEggNotified) {
      gs.unfertilizedEggNotified = true;
      const name = gs.lizardName || '???';
      showMsg(t('unfertilized_egg_laid_msg').replace('{name}', name), 5000);
      saveGame();
    }
    if (gs.bornAnim && !gs.hasUnfertilizedEgg) gs.unfertilizedEggNotified = false;
    // Lonely notification
    if (gs.bornAnim && gs.isLonely && !gs.lonelyNotified) {
      gs.lonelyNotified = true;
      showMsg(t('lonely_msg').replace('{name}', gs.lizardName || '???'), 5000);
      saveGame();
    }
    if (gs.bornAnim && !gs.isLonely) gs.lonelyNotified = false;
    // Auto-wake in the morning
    if (gs.isSleeping && isWakeHour(SPECIES_META[gs.species]?.activity)) {
      gs.isSleeping = false;
      gs.bond = Math.min(100, gs.bond + 1);
      showMsg(t('wake_msg'), 3500);
      saveGame();
    }
    drawUI();
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
let hoverEgg = -1;

window.addEventListener('load', () => {
  canvas = document.getElementById('game-canvas');

  function resizeCanvas() {
    canvas.width = Math.min(window.innerWidth, 900);
    canvas.height = Math.min(window.innerHeight - 70, 600);
    if (ctx) ctx.imageSmoothingEnabled = false;
  }
  resizeCanvas();

  ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  loadGame();
  if (gs) {
    scene = gs.scene || SCENE.SHOP;
    lizardType = gs.type || null;
    lizardName = gs.lizardName || '';
    if (gs.bornAnim) lizardAnim.threatening = gs.bond < 40;
  }

  // Update date display if in room
  if (scene === SCENE.ROOM && gs) {
    document.getElementById('date-display').style.display = 'block';
    updateTimeDisplay();
    if (gs.bornAnim) document.getElementById('ui-overlay').style.display = 'flex';
  }

  updateDogramButton();

  // Touch support for canvas
  canvas.addEventListener('touchstart', function(e) {
    e.preventDefault();
    const touch = e.touches[0];
    canvas_click({ clientX: touch.clientX, clientY: touch.clientY });
  }, { passive: false });

  canvas.addEventListener('touchmove', function(e) {
    e.preventDefault();
    const touch = e.touches[0];
    canvas_mousemove({ clientX: touch.clientX, clientY: touch.clientY });
  }, { passive: false });

  // Resize on orientation change
  window.addEventListener('resize', () => {
    resizeCanvas();
  });

  requestAnimationFrame(gameLoop);

  // 1초마다 게임 내 시계 업데이트
  setInterval(updateTimeDisplay, 1000);

  // Setinterval to update date display + sleepy/thirsty/hungry message
  let lastSleepyMsgTime = 0;
  let lastThirstyMsgTime = 0;
  let lastHungryMsgTime = 0;
  let lastLonelyMsgTime = 0;
  setInterval(() => {
    if (scene === SCENE.ROOM && gs) {
      updateGameTime();
      const gd = getGameDate();
      document.getElementById('date-display').textContent = formatDate(gd);
      updateTimeDisplay();
      drawUI();
      const now = Date.now();
      // Show sleepy message periodically at night (every 60s)
      if (gs.bornAnim && !gs.isSleeping && isSleepyHour(SPECIES_META[gs.species]?.activity)) {
        if (now - lastSleepyMsgTime > 60000) {
          lastSleepyMsgTime = now;
          showMsg(t('sleepy_msg'), 4000);
        }
      }
      // Show thirsty message when hydration is low (every 90s)
      if (gs.bornAnim && !gs.isSleeping && (gs.hydration || 0) < 30) {
        if (now - lastThirstyMsgTime > 90000) {
          lastThirstyMsgTime = now;
          showMsg(t('thirsty_msg'), 4000);
        }
      }
      // Show hungry message when it's feeding day (every 90s)
      if (gs.bornAnim && !gs.isSleeping && gs.gameDaysPassed - gs.lastFedGameDay >= 2) {
        if (now - lastHungryMsgTime > 90000) {
          lastHungryMsgTime = now;
          showMsg(t('hungry_msg'), 4000);
        }
      }
      // Show lonely message periodically when adult and lonely (every 90s)
      if (gs.bornAnim && !gs.isSleeping && gs.isLonely) {
        if (now - lastLonelyMsgTime > 90000) {
          lastLonelyMsgTime = now;
          showMsg(t('lonely_periodic_msg'), 4000);
        }
      }
      // Show spring message when game month enters April (once per game year)
      if (gs.bornAnim) {
        const springDate = getGameDate();
        if (springDate.month === 4 && springDate.year > (gs.springNotifiedYear || 0)) {
          gs.springNotifiedYear = springDate.year;
          showMsg(t('spring_msg'), 5000);
          saveGame();
        }
      }
    }
  }, 5000);
});

canvas_click = function(e) {
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const my = (e.clientY - rect.top) * (canvas.height / rect.height);
  const W = canvas.width, H = canvas.height;

  // Sleep guard mini-game: intercept click
  if (scene === SCENE.ROOM && sleepGuardGame) {
    if (sleepGuardGame.result && sleepGuardGame._closeBtnBounds) {
      const b = sleepGuardGame._closeBtnBounds;
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
        sleepGuardGame = null;
      }
    } else if (!sleepGuardGame.result) {
      for (const bug of sleepGuardGame.bugs) {
        if (bug.hit || bug.reached) continue;
        const hitR = bug.type === 'mite' ? 14 : 20;
        if (Math.hypot(mx - bug.x, my - bug.y) < hitR) {
          bug.hit = true;
          sleepGuardGame.score++;
          for (let i = 0; i < 8; i++) {
            sleepGuardGame.particles.push({
              x: bug.x, y: bug.y,
              vx: (Math.random() - 0.5) * 0.22,
              vy: (Math.random() - 0.5) * 0.22,
              alpha: 1, color: '#88ddff',
            });
          }
          break;
        }
      }
    }
    return;
  }

  // Handling session: intercept click
  if (scene === SCENE.ROOM && handlingSession.active) {
    tryPetLizard(mx, my);
    return;
  }

  if (scene === SCENE.OUTDOOR && outdoorState) {
    // Check bugs first — penalty on hit
    for (const bug of outdoorState.bugs) {
      if (Math.hypot(mx - bug.x, my - bug.y) < 18) {
        outdoorState.startTime -= 3000; // costs 3 seconds
        outdoorState.penaltyEndTime = Date.now() + 700;
        return;
      }
    }
    // Check dandelions
    for (const d of outdoorState.dandelions) {
      if (d.picked || d.gone) continue;
      const fy = d.y - 41; // flower center
      const dist = Math.hypot(mx - d.x, my - fy);
      if (dist < 22) {
        d.picked = true;
        outdoorState.gathered++;
        burstSeeds(d.x, fy);
        updateOutdoorCounter();
        // Stock full → auto-leave
        if ((gs.dandelionStock || 0) + outdoorState.gathered >= 10) {
          showMsg(t('dandelion_stock_max'));
          setTimeout(leaveOutdoor, 900);
        // All picked → auto-leave
        } else if (outdoorState.dandelions.every(d2 => d2.picked || d2.gone)) {
          setTimeout(leaveOutdoor, 600);
        }
        break;
      }
    }
    return;
  }

  if (scene === SCENE.SHOP) {
    // Click anywhere = enter shop
    scene = SCENE.EGG;
    if (!gs) {
      // Will init after egg pick
    }
  } else if (scene === SCENE.EGG) {
    const egg1x = W/2 - 130, egg2x = W/2 + 30, eggy = H*0.44;
    // Check egg 1 click
    if (mx >= egg1x && mx <= egg1x+80 && my >= eggy && my <= eggy+100) {
      pickEgg('crestie');
    }
    // Check egg 2 click
    if (mx >= egg2x && mx <= egg2x+80 && my >= eggy && my <= eggy+100) {
      pickEgg('bluetongue');
    }
  }
};

canvas_mousemove = function(e) {
  if (scene !== SCENE.EGG) return;
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const my = (e.clientY - rect.top) * (canvas.height / rect.height);
  const W = canvas.width, H = canvas.height;
  const egg1x = W/2 - 130, egg2x = W/2 + 30, eggy = H*0.44;
  if (mx >= egg1x && mx <= egg1x+80 && my >= eggy && my <= eggy+100) hoverEgg = 0;
  else if (mx >= egg2x && mx <= egg2x+80 && my >= eggy && my <= eggy+100) hoverEgg = 1;
  else hoverEgg = -1;
};

function pickEgg(type) {
  newLizardType = type;
  // Show name modal
  document.getElementById('name-modal').style.display = 'flex';
  document.getElementById('modal-title').textContent = t('name_title');
  document.getElementById('modal-prompt').textContent = t('name_prompt');
  document.getElementById('lizard-name-input').value = '';
  document.getElementById('lizard-name-input').placeholder = t('name_placeholder');
  document.getElementById('modal-confirm').textContent = t('name_btn');
}

function confirmName() {
  const name = document.getElementById('lizard-name-input').value.trim();
  if (!name) return;
  document.getElementById('name-modal').style.display = 'none';
  if (hatchingEggId !== null) { finishHatchEgg(name); return; }
  const type = newLizardType || lizardType;
  newLizardType = null;
  // Save current lizard if exists
  if (gs) {
    gs.scene = scene;
    gs.type = lizardType;
    gs.lizardName = lizardName;
    allLizards[activeLizardIdx] = { ...gs };
  }
  // Create new lizard
  const newGs = newGameState(type);
  newGs.lizardName = name;
  newGs.scene = SCENE.ROOM;
  if (newLizardMorph) newGs.morph = newLizardMorph;
  if (newLizardColor) newGs.color = newLizardColor;
  if (newLizardTraits.length > 0) newGs.traits = newLizardTraits.slice();
  if (newLizardLocale) newGs.btLocale = newLizardLocale;
  newLizardMorph = null;
  newLizardColor = null;
  newLizardTraits = [];
  newLizardCountry = null;
  newLizardLocale = null;
  allLizards.push({ ...newGs });
  activeLizardIdx = allLizards.length - 1;
  gs = newGs;
  lizardType = type;
  lizardName = name;
  scene = SCENE.ROOM;
  AUTH.saveAllLizards(allLizards, activeLizardIdx);
  document.getElementById('date-display').style.display = 'block';
  document.getElementById('ui-overlay').style.display = 'none';
  updateTimeDisplay();
  updateDogramButton();
  updateGameLabels();
}

// ─── FARM PIXEL ART ───────────────────────────────────────────────────────────
function drawPixelCricket(c, x, y) {
  const s = 2;
  // Body
  c.fillStyle = '#5a4010';
  c.fillRect(x, y, 10*s, 4*s);
  // Wing sheen
  c.fillStyle = '#7a5820';
  c.fillRect(x+s, y, 8*s, 2*s);
  // Head
  c.fillStyle = '#4a3008';
  c.fillRect(x+7*s, y-s, 4*s, 3*s);
  // Eye
  c.fillStyle = '#cc3300';
  c.fillRect(x+8*s, y-s, s, s);
  // Antennae
  c.fillStyle = '#7a6030';
  c.fillRect(x+8*s, y-3*s, s, 2*s);
  c.fillRect(x+7*s, y-4*s, 2*s, s);
  c.fillRect(x+10*s, y-3*s, s, 2*s);
  c.fillRect(x+9*s, y-4*s, 2*s, s);
  // Legs
  c.fillStyle = '#3a2808';
  c.fillRect(x+2*s, y+4*s, s, 3*s);
  c.fillRect(x+5*s, y+4*s, s, 3*s);
  c.fillRect(x+8*s, y+4*s, s, 2*s);
  // Hind jump legs
  c.fillStyle = '#4a3810';
  c.fillRect(x, y+3*s, s, 4*s);
  c.fillRect(x-s, y+6*s, 3*s, s);
}

function drawFarmCricketCanvas() {
  const el = document.getElementById('farm-cricket-canvas');
  if (!el) return;
  const c = el.getContext('2d');
  const W = el.width, H = el.height;
  c.clearRect(0, 0, W, H);
  // Background
  c.fillStyle = '#0a140a';
  c.fillRect(0, 0, W, H);
  // Enclosure border
  c.strokeStyle = '#2a5a2a';
  c.lineWidth = 3;
  c.strokeRect(3, 3, W-6, H-6);
  // Egg-carton hides at back
  c.fillStyle = '#8a6040';
  for (let i = 0; i < 5; i++) {
    c.fillRect(8 + i*60, H-32, 50, 18);
    c.fillStyle = '#6a4828';
    c.fillRect(8 + i*60, H-32, 50, 4);
    c.fillStyle = '#8a6040';
  }
  // Soil floor
  c.fillStyle = '#3a2a18';
  c.fillRect(6, H-18, W-12, 12);
  c.fillStyle = '#4a3820';
  c.fillRect(6, H-20, W-12, 4);

  const count = gs ? (gs.cricketCount || 0) : 0;
  const displayCount = Math.min(count, 18);
  for (let i = 0; i < displayCount; i++) {
    const col = i % 6;
    const row = Math.floor(i / 6);
    const bx = 18 + col * 50 + (row % 2) * 10;
    const by = H - 38 - row * 16;
    drawPixelCricket(c, bx, by);
  }
  if (count === 0) {
    c.fillStyle = '#555';
    c.font = "7px 'Press Start 2P', monospace";
    c.textAlign = 'center';
    c.fillText(currentLang === 'ko' ? '비어있음' : 'empty', W/2, H/2 + 4);
    c.textAlign = 'left';
  }
}

function drawChicorySprout(c, cx, groundY) {
  const s = 2;
  c.fillStyle = '#4a7a30';
  c.fillRect(cx-s, groundY-8*s, 2*s, 8*s);
  c.fillStyle = '#5a9a40';
  c.fillRect(cx-5*s, groundY-6*s, 4*s, 2*s);
  c.fillRect(cx+s, groundY-5*s, 4*s, 2*s);
}

function drawChicorySmall(c, cx, groundY) {
  const s = 2;
  c.fillStyle = '#4a7a30';
  c.fillRect(cx-s, groundY-13*s, 2*s, 13*s);
  c.fillStyle = '#5a9a40';
  c.fillRect(cx-8*s, groundY-10*s, 7*s, 2*s);
  c.fillRect(cx+s, groundY-12*s, 7*s, 2*s);
  c.fillRect(cx-6*s, groundY-7*s, 5*s, 2*s);
  c.fillRect(cx+s, groundY-8*s, 5*s, 2*s);
  c.fillStyle = '#3a6a20';
  c.fillRect(cx-4*s, groundY-10*s, s, s);
  c.fillRect(cx+3*s, groundY-12*s, s, s);
}

function drawChicoryMedium(c, cx, groundY) {
  const s = 2;
  c.fillStyle = '#4a7a30';
  c.fillRect(cx-s, groundY-19*s, 2*s, 19*s);
  c.fillRect(cx-9*s, groundY-15*s, 9*s, s);
  c.fillRect(cx+s, groundY-13*s, 9*s, s);
  c.fillStyle = '#5a9a40';
  c.fillRect(cx-12*s, groundY-9*s, 10*s, 3*s);
  c.fillRect(cx+2*s, groundY-7*s, 10*s, 3*s);
  c.fillRect(cx-10*s, groundY-5*s, 8*s, 3*s);
  // Budding flowers (light blue)
  c.fillStyle = '#8ab0e0';
  c.fillRect(cx-2*s, groundY-22*s, 4*s, 3*s);
  c.fillRect(cx-9*s, groundY-17*s, 3*s, 3*s);
}

function drawChicoryFull(c, cx, groundY) {
  const s = 2;
  // Stems & branches
  c.fillStyle = '#4a7a30';
  c.fillRect(cx-s, groundY-24*s, 2*s, 24*s);
  c.fillRect(cx-10*s, groundY-19*s, 10*s, s);
  c.fillRect(cx+s, groundY-17*s, 10*s, s);
  c.fillRect(cx-8*s, groundY-15*s, 7*s, s);
  // Large leaves
  c.fillStyle = '#5a9a40';
  c.fillRect(cx-14*s, groundY-10*s, 12*s, 3*s);
  c.fillRect(cx+2*s, groundY-8*s, 12*s, 3*s);
  c.fillRect(cx-12*s, groundY-5*s, 10*s, 3*s);
  c.fillRect(cx+2*s, groundY-12*s, 10*s, 3*s);
  c.fillStyle = '#3a6a20';
  c.fillRect(cx-8*s, groundY-10*s, s, s);
  c.fillRect(cx+7*s, groundY-8*s, s, s);
  // Blue chicory flowers (signature color!)
  c.fillStyle = '#4a7ed8';
  c.fillRect(cx-4*s, groundY-27*s, 8*s, 4*s);
  c.fillRect(cx-6*s, groundY-25*s, 12*s, 2*s);
  c.fillStyle = '#6aa0f0';
  c.fillRect(cx-2*s, groundY-26*s, 4*s, 2*s);
  c.fillStyle = '#f0e840';
  c.fillRect(cx-s, groundY-25*s, 2*s, 2*s);
  // Left branch flower
  c.fillStyle = '#4a7ed8';
  c.fillRect(cx-12*s, groundY-21*s, 5*s, 4*s);
  c.fillStyle = '#f0e840';
  c.fillRect(cx-11*s, groundY-20*s, 2*s, s);
  // Right branch flower
  c.fillStyle = '#4a7ed8';
  c.fillRect(cx+9*s, groundY-19*s, 5*s, 4*s);
  c.fillStyle = '#f0e840';
  c.fillRect(cx+10*s, groundY-18*s, 2*s, s);
  // Sparkles
  c.fillStyle = '#ffffff';
  c.fillRect(cx-2*s, groundY-29*s, s, s);
  c.fillRect(cx+6*s, groundY-23*s, s, s);
  c.fillRect(cx-8*s, groundY-16*s, s, s);
}

function drawFarmChicoryCanvas() {
  const el = document.getElementById('farm-chicory-canvas');
  if (!el) return;
  const c = el.getContext('2d');
  const W = el.width, H = el.height;
  c.clearRect(0, 0, W, H);
  const state = gs ? (gs.chicoryState || 'none') : 'none';
  const growthDays = gs ? Math.min(5, (gs.gameDaysPassed - (gs.chicoryPlantedDay||0)) + (gs.chicoryWateredDays||0)) : 0;
  // Sky
  c.fillStyle = state === 'none' ? '#0a140a' : '#1a2a3a';
  c.fillRect(0, 0, W, H);
  if (state !== 'none') {
    c.fillStyle = '#152840';
    c.fillRect(0, 0, W, H * 0.55);
    // Sun
    c.fillStyle = '#f8f060';
    c.fillRect(W-32, 8, 14, 14);
    c.fillStyle = '#f0d840';
    c.fillRect(W-30, 10, 18, 18);
    c.fillStyle = '#f8f060';
    c.fillRect(W-29, 11, 14, 14);
  }
  // Soil
  c.fillStyle = '#5a4030';
  c.fillRect(0, H-22, W, 22);
  c.fillStyle = '#7a5a40';
  c.fillRect(0, H-24, W, 4);
  c.fillStyle = '#6a4a38';
  for (let i = 0; i < 7; i++) c.fillRect(10 + i*44, H-20, 14, 4);
  const groundY = H - 22;
  if (state === 'none') {
    c.fillStyle = '#555';
    c.font = "7px 'Press Start 2P', monospace";
    c.textAlign = 'center';
    c.fillText(currentLang === 'ko' ? '미심재' : 'not planted', W/2, H/2 + 4);
    c.textAlign = 'left';
  } else {
    const batch = gs ? (gs.chicoryBatchSize || 1) : 1;
    const count = Math.min(batch, 9);
    const spacing = W / (count + 1);
    for (let i = 0; i < count; i++) {
      const cx = Math.round(spacing * (i + 1));
      if (state === 'growing') {
        if (growthDays <= 1) drawChicorySprout(c, cx, groundY);
        else if (growthDays <= 3) drawChicorySmall(c, cx, groundY);
        else drawChicoryMedium(c, cx, groundY);
      } else if (state === 'ready') {
        drawChicoryFull(c, cx, groundY);
      }
    }
  }
}

function drawSmallEggInCanvas(c, cx, baseY, type) {
  const ew = 22, eh = 28;
  const ey = baseY - eh;
  const color  = type === 'orange' ? '#e87820' : '#5a7ab8';
  const color2 = type === 'orange' ? '#d06010' : '#4a6aa8';
  const shine  = type === 'orange' ? '#f0a050' : '#8ab0e0';
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.beginPath();
  c.ellipse(cx, baseY + 3, ew * 0.5, 4, 0, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.moveTo(cx, ey + 2);
  c.bezierCurveTo(cx + ew * 0.75, ey, cx + ew * 0.5 + 8, baseY - eh * 0.38, cx, baseY);
  c.bezierCurveTo(cx - ew * 0.5 - 8, baseY - eh * 0.38, cx - ew * 0.75, ey, cx, ey + 2);
  c.fillStyle = color;
  c.fill();
  c.strokeStyle = color2;
  c.lineWidth = 1.5;
  c.stroke();
  c.beginPath();
  c.ellipse(cx - 5, ey + 8, 3, 5, -0.4, 0, Math.PI * 2);
  c.fillStyle = shine;
  c.globalAlpha = 0.5;
  c.fill();
  c.globalAlpha = 1;
}

function drawFarmIncubatorCanvas() {
  const el = document.getElementById('farm-incubator-canvas');
  if (!el) return;
  const c = el.getContext('2d');
  const W = el.width, H = el.height;
  c.clearRect(0, 0, W, H);

  // Background
  c.fillStyle = '#0e0e1a';
  c.fillRect(0, 0, W, H);

  const bx = 8, by = 8, bw = 270, bh = 100;

  // Drop shadow
  c.fillStyle = 'rgba(0,0,0,0.45)';
  c.fillRect(bx + 5, by + 5, bw, bh);

  // Main body
  c.fillStyle = '#7a6a58';
  c.fillRect(bx, by, bw, bh);

  // Top lid (lighter strip)
  c.fillStyle = '#8a7a68';
  c.fillRect(bx, by, bw, 22);

  // Lid highlight edge
  c.fillStyle = '#9a8a78';
  c.fillRect(bx, by, bw, 3);

  // Bottom shading
  c.fillStyle = '#5a4a38';
  c.fillRect(bx, by + bh - 8, bw, 8);

  // Vent holes on top lid
  c.fillStyle = '#4a3a28';
  for (let i = 0; i < 7; i++) {
    c.fillRect(bx + 22 + i * 18, by + 8, 10, 4);
  }

  // Brand label
  c.fillStyle = '#b8a888';
  c.font = "6px 'Press Start 2P', monospace";
  c.textAlign = 'center';
  c.fillText('REPTILE INC.', bx + 145, by + 18);
  c.textAlign = 'left';

  // === Glass viewing window ===
  const wx = bx + 12, wy = by + 28, ww = 172, wh = 62;

  // Window frame
  c.fillStyle = '#3a2a18';
  c.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
  c.fillStyle = '#5a4a38';
  c.fillRect(wx - 3, wy - 3, ww + 6, 3);
  c.fillRect(wx - 3, wy - 3, 3, wh + 6);

  // Interior
  const eggs = (typeof AUTH !== 'undefined' && AUTH.getIncubator) ? AUTH.getIncubator() : [];
  const hasEggs = eggs.length > 0;
  c.fillStyle = hasEggs ? '#3a2a0e' : '#221508';
  c.fillRect(wx, wy, ww, wh);

  if (hasEggs) {
    // Warm glow from heating element
    const grd = c.createRadialGradient(wx + ww / 2, wy + wh, 0, wx + ww / 2, wy + wh, wh * 1.6);
    grd.addColorStop(0, 'rgba(255,130,30,0.45)');
    grd.addColorStop(1, 'rgba(255,60,0,0)');
    c.fillStyle = grd;
    c.fillRect(wx, wy, ww, wh);
  }

  // Substrate bedding
  c.fillStyle = '#4a3010';
  c.fillRect(wx, wy + wh - 14, ww, 14);
  c.fillStyle = '#5a4020';
  c.fillRect(wx, wy + wh - 16, ww, 4);
  // Bedding texture bumps
  c.fillStyle = '#3a2208';
  for (let i = 0; i < 8; i++) c.fillRect(wx + 8 + i * 20, wy + wh - 10, 12, 4);

  // Draw eggs
  const showCount = Math.min(eggs.length, 5);
  if (showCount > 0) {
    const spacing = ww / (showCount + 1);
    for (let i = 0; i < showCount; i++) {
      const eType = (eggs[i].lizardType === 'crestie') ? 'orange' : 'blue';
      drawSmallEggInCanvas(c, wx + spacing * (i + 1), wy + wh - 16, eType);
    }
  }

  // Glass reflection overlay
  c.fillStyle = 'rgba(255,255,255,0.06)';
  c.fillRect(wx, wy, ww, wh / 2);
  c.fillStyle = 'rgba(255,255,255,0.10)';
  c.fillRect(wx, wy, 3, wh);
  c.fillRect(wx, wy, ww, 2);

  // === Control panel (right side) ===
  const px = bx + 196, py = by + 28, pw = 70, ph = 62;

  // Panel background
  c.fillStyle = '#2e2820';
  c.fillRect(px, py, pw, ph);

  // Temperature display frame
  c.fillStyle = '#111008';
  c.fillRect(px + 4, py + 5, pw - 8, 20);
  const temp = hasEggs ? (eggs[0].temp || 23) : 23;
  c.fillStyle = '#00ee70';
  c.font = "10px 'Press Start 2P', monospace";
  c.textAlign = 'center';
  c.fillText(temp + '\u00b0C', px + pw / 2, py + 19);
  c.fillStyle = '#667766';
  c.font = "5px 'Press Start 2P', monospace";
  c.fillText('TEMP', px + pw / 2, py + 30);

  // Humidity display frame
  c.fillStyle = '#111008';
  c.fillRect(px + 4, py + 33, pw - 8, 16);
  const humid = hasEggs ? (eggs[0].humidity || 65) : 65;
  c.fillStyle = '#38b8ff';
  c.font = "9px 'Press Start 2P', monospace";
  c.textAlign = 'center';
  c.fillText(humid + '%', px + pw / 2, py + 44);
  c.fillStyle = '#556677';
  c.font = "5px 'Press Start 2P', monospace";
  c.fillText('HUM', px + pw / 2, py + 55);
  c.textAlign = 'left';

  // Power LED
  c.fillStyle = hasEggs ? '#30ff50' : '#303030';
  c.fillRect(px + pw / 2 - 3, py + ph - 8, 6, 6);
  if (hasEggs) {
    const lg = c.createRadialGradient(px + pw / 2, py + ph - 5, 0, px + pw / 2, py + ph - 5, 9);
    lg.addColorStop(0, 'rgba(50,255,80,0.55)');
    lg.addColorStop(1, 'rgba(50,255,80,0)');
    c.fillStyle = lg;
    c.beginPath();
    c.arc(px + pw / 2, py + ph - 5, 9, 0, Math.PI * 2);
    c.fill();
  }

  // Legs
  c.fillStyle = '#3a2a18';
  c.fillRect(bx + 18, by + bh, 10, 7);
  c.fillRect(bx + bw - 28, by + bh, 10, 7);
  c.fillStyle = '#2a1a08';
  c.fillRect(bx + 18, by + bh + 5, 10, 2);
  c.fillRect(bx + bw - 28, by + bh + 5, 10, 2);
}

// ─── FARM ACTIONS ─────────────────────────────────────────────────────────────
let currentFarmTab = 'cricket';

function openFarm() {
  if (!gs || !gs.bornAnim) return;
  document.getElementById('farm-modal').style.display = 'flex';
  currentFarmTab = 'cricket';
  document.getElementById('farm-cricket-panel').style.display = '';
  document.getElementById('farm-chicory-panel').style.display = 'none';
  document.getElementById('farm-cgestie-panel').style.display = 'none';
  document.getElementById('farm-incubator-panel').style.display = 'none';
  document.getElementById('tab-btn-cricket').className = 'tab-btn active';
  document.getElementById('tab-btn-chicory').className = 'tab-btn';
  document.getElementById('tab-btn-cgestie').className = 'tab-btn';
  document.getElementById('tab-btn-incubator').className = 'tab-btn';
  updateFarmUI();
}

function closeFarm() {
  document.getElementById('farm-modal').style.display = 'none';
}

function switchFarmTab(tab) {
  currentFarmTab = tab;
  document.getElementById('farm-cricket-panel').style.display = tab === 'cricket' ? '' : 'none';
  document.getElementById('farm-chicory-panel').style.display = tab === 'chicory' ? '' : 'none';
  document.getElementById('farm-cgestie-panel').style.display = tab === 'cgestie' ? '' : 'none';
  document.getElementById('farm-incubator-panel').style.display = tab === 'incubator' ? '' : 'none';
  document.getElementById('tab-btn-cricket').className = 'tab-btn' + (tab === 'cricket' ? ' active' : '');
  document.getElementById('tab-btn-chicory').className = 'tab-btn' + (tab === 'chicory' ? ' active' : '');
  document.getElementById('tab-btn-cgestie').className = 'tab-btn' + (tab === 'cgestie' ? ' active' : '');
  document.getElementById('tab-btn-incubator').className = 'tab-btn' + (tab === 'incubator' ? ' active' : '');
  if (tab === 'incubator') updateIncubatorUI();
  drawFarmCricketCanvas();
  drawFarmChicoryCanvas();
  if (tab === 'incubator') drawFarmIncubatorCanvas();
}

function updateFarmUI() {
  document.getElementById('farm-title').textContent = t('farm_title');
  document.getElementById('tab-btn-cricket').textContent = t('farm_tab_cricket');
  document.getElementById('tab-btn-chicory').textContent = t('farm_tab_chicory');
  document.getElementById('tab-btn-cgestie').textContent = t('farm_tab_cgestie');
  document.getElementById('tab-btn-incubator').textContent = t('farm_tab_incubator');
  document.getElementById('lbl-cricket-count').textContent = t('cricket_count_label');
  document.getElementById('lbl-chicory-stage').textContent = t('chicory_stage_label');
  const inEconomy = gs && gs.gameDaysPassed >= ECONOMY_START_DAYS;
  document.getElementById('btn-cricket-get').textContent = inEconomy ? t('cricket_buy_btn') : t('cricket_get_btn');
  document.getElementById('btn-cricket-feed').textContent = t('cricket_feed_btn');
  document.getElementById('btn-chicory-plant').textContent = inEconomy ? t('chicory_seed_buy_btn') : t('chicory_plant_btn');
  document.getElementById('btn-chicory-water').textContent = t('chicory_water_btn');
  document.getElementById('btn-chicory-harvest').textContent = t('chicory_harvest_btn');
  document.getElementById('btn-chicory-feed-lizard').textContent = t('chicory_feed_lizard_btn');
  document.getElementById('lbl-pellet').textContent = t('pellet_label');
  document.getElementById('btn-pellet-get').textContent = t('pellet_get_btn');
  document.getElementById('btn-cricket-care').textContent = t('cricket_care_btn');
  document.getElementById('lbl-chicory-stock').textContent = t('chicory_stock_label');
  document.getElementById('lbl-cgestie-food').textContent = t('cgestie_food_label');
  const cgestieFoodInSeason = gs && gs.gameDaysPassed <= 44; // May 1 ~ June 14, 2025
  document.getElementById('btn-cgestie-food-get').textContent = cgestieFoodInSeason ? t('cgestie_food_get_btn') : t('cgestie_food_buy_btn');
  document.getElementById('btn-cgestie-feed-lizard').textContent = t('cgestie_feed_lizard_btn');
  document.getElementById('lbl-bt-food').textContent = t('bt_food_label');
  const btFoodInSeason = gs && gs.gameDaysPassed <= 44; // May 1 ~ June 14, 2025
  document.getElementById('btn-bt-food-get').textContent = btFoodInSeason ? t('bt_food_get_btn') : t('bt_food_buy_btn');
  document.getElementById('btn-bt-feed-lizard').textContent = t('bt_feed_lizard_btn');
  document.getElementById('lbl-dandelion-stock').textContent = t('dandelion_stock_label');
  document.getElementById('btn-dandelion-gather').textContent = t('dandelion_gather_btn');
  document.getElementById('btn-dandelion-feed-lizard').textContent = t('dandelion_feed_lizard_btn');
  document.getElementById('btn-sell-dandelion').textContent = t('sell_dandelion_btn');
  document.getElementById('btn-sell-chicory').textContent = t('sell_chicory_btn');
  document.getElementById('coin-display').textContent = t('coin_label') + ': ' + AUTH.getAccountCoins();
  // Cricket stats
  const count = gs ? (gs.cricketCount || 0) : 0;
  document.getElementById('bar-cricket').style.width = (count / 150 * 100) + '%';
  document.getElementById('cricket-count-text').textContent = count + ' / 150';
  const caredToday = gs && gs.lastCricketCareDay === gs.gameDaysPassed;
  document.getElementById('cricket-care-status').textContent =
    count > 0 ? (caredToday ? t('cricket_care_status_ok') : t('cricket_care_status_need')) : '';
  document.getElementById('cricket-care-status').style.color = caredToday ? '#4adb4a' : '#e84a4a';
  document.getElementById('cricket-info').textContent =
    count > 0 ? (currentLang === 'ko' ? `3일마다 자동 번식 (+25%)` : `Auto-breeds every 3 days (+25%)`) : '';
  // Pellet stats
  const pellets = gs ? (gs.pelletCount || 0) : 0;
  document.getElementById('pellet-count-text').textContent = pellets + ' / 10';
  document.getElementById('bar-pellet').style.width = (pellets / 10 * 100) + '%';
  // Chicory stats
  const chicState = gs ? (gs.chicoryState || 'none') : 'none';
  const chicStock = gs ? (gs.chicoryStock || 0) : 0;
  const growthDays = gs ? Math.min(5, (gs.gameDaysPassed - (gs.chicoryPlantedDay||0)) + (gs.chicoryWateredDays||0)) : 0;
  const growthPct = chicState === 'none' ? 0 : (chicState === 'ready' ? 100 : Math.round(growthDays / 5 * 100));
  document.getElementById('bar-chicory').style.width = growthPct + '%';
  document.getElementById('chicory-stage-text').textContent =
    chicState === 'none' ? t('chicory_none_text') :
    chicState === 'ready' ? t('chicory_ready_text') : t('chicory_growing_text');
  const chicBatch = gs ? (gs.chicoryBatchSize || 1) : 1;
  document.getElementById('chicory-info').textContent =
    chicState === 'growing' ? t('chicory_info_growing') + ` (${growthDays}/5) ×${chicBatch}` :
    chicState === 'ready' ? t('chicory_info_ready') + ` ×${chicBatch}` : '';
  document.getElementById('chicory-stock-text').textContent = chicStock;
  // Button enable/disable
  document.getElementById('btn-chicory-plant').disabled = chicState === 'ready' || (chicState === 'growing' && chicBatch >= 5);
  document.getElementById('btn-chicory-water').disabled = chicState !== 'growing';
  document.getElementById('btn-chicory-harvest').disabled = chicState !== 'ready';
  document.getElementById('btn-chicory-feed-lizard').disabled = chicStock < 1;
  // Cgestie food stats
  const cgestieFood = gs ? (gs.cgestieFoodCount || 0) : 0;
  document.getElementById('bar-cgestie-food').style.width = (cgestieFood / 10 * 100) + '%';
  document.getElementById('cgestie-food-count-text').textContent = cgestieFood + ' / 10';
  document.getElementById('btn-cgestie-feed-lizard').disabled = cgestieFood < 1;
  // BT food stats
  const btFood = gs ? (gs.btFoodCount || 0) : 0;
  document.getElementById('bar-bt-food').style.width = (btFood / 10 * 100) + '%';
  document.getElementById('bt-food-count-text').textContent = btFood + ' / 10';
  document.getElementById('btn-bt-feed-lizard').disabled = btFood < 1;
  // Dandelion stats
  const dandelionStock = gs ? (gs.dandelionStock || 0) : 0;
  const gameMonth = gs ? getGameDate().month : 0;
  const inDandelionSeason = gameMonth >= 4 && gameMonth <= 8;
  const gatheredToday = gs && gs.lastDandelionGatherDay === gs.gameDaysPassed;
  document.getElementById('dandelion-stock-text').textContent = dandelionStock + ' / 10';
  document.getElementById('bar-dandelion').style.width = (dandelionStock / 10 * 100) + '%';
  document.getElementById('dandelion-season-info').textContent = inDandelionSeason
    ? (gatheredToday ? t('dandelion_gathered_today') : t('dandelion_available'))
    : t('dandelion_out_of_season');
  document.getElementById('dandelion-season-info').style.color = inDandelionSeason
    ? (gatheredToday ? '#4adb4a' : '#c8e84a') : '#888';
  document.getElementById('btn-dandelion-gather').disabled = !inDandelionSeason || gatheredToday || dandelionStock >= 10;
  document.getElementById('btn-dandelion-feed-lizard').disabled = dandelionStock < 1;
  document.getElementById('btn-sell-dandelion').disabled = dandelionStock < 1;
  document.getElementById('btn-sell-chicory').disabled = chicStock < 1;
  drawFarmCricketCanvas();
  drawFarmChicoryCanvas();
}

function doCricketGet() {
  if (!gs) return;
  if ((gs.cricketCount || 0) >= 150) { showMsg(t('cricket_get_max')); return; }
  if (gs.gameDaysPassed >= ECONOMY_START_DAYS) {
    if (AUTH.getAccountCoins() < 5) { showMsg(t('cricket_buy_no_coins')); return; }
    AUTH.saveAccountCoins(AUTH.getAccountCoins() - 5);
  }
  gs.cricketCount = Math.min(150, (gs.cricketCount || 0) + 20);
  gs.lastCricketBreedDay = gs.gameDaysPassed;
  if ((gs.lastCricketCareDay || -1) < 0) gs.lastCricketCareDay = gs.gameDaysPassed;
  showMsg(gs.gameDaysPassed >= ECONOMY_START_DAYS ? t('cricket_buy_ok') : t('cricket_get_ok'));
  saveGame();
  updateFarmUI();
}

function doCricketFeed() {
  if (!gs || !gs.bornAnim) return;
  if ((gs.cricketCount || 0) < 5) { showMsg(t('cricket_feed_none')); return; }
  if (gs.gameDaysPassed - gs.lastFedGameDay < 2) { showMsg(t('cricket_feed_no')); return; }
  gs.cricketCount -= 5;
  gs.lastFedGameDay = gs.gameDaysPassed;
  gs.hunger = Math.min(100, gs.hunger + 55);
  gs.happy = Math.min(100, gs.happy + 12);
  if (lizardType === 'crestie') gs.weight = Math.min(50, gs.weight + 0.5);
  else gs.weight = Math.min(600, gs.weight + 6);
  gs.hasPoop = true;
  gs.hasUrine = true;
  showMsg(t('cricket_feed_ok'));
  saveGame();
  closeFarm();
}

function doChicoryPlant() {
  if (!gs) return;
  const inEconomy = gs.gameDaysPassed >= ECONOMY_START_DAYS;
  if (gs.chicoryState === 'growing') {
    const cur = gs.chicoryBatchSize || 1;
    if (cur >= 5) { showMsg(t('chicory_plant_max')); return; }
    if (inEconomy) {
      if (AUTH.getAccountCoins() < 3) { showMsg(t('chicory_seed_no_coins')); return; }
      AUTH.saveAccountCoins(AUTH.getAccountCoins() - 3);
    }
    gs.chicoryBatchSize = cur + 1;
    const msg = inEconomy
      ? t('chicory_seed_buy_ok').replace('{n}', gs.chicoryBatchSize).replace('{c}', 3)
      : t('chicory_plant_add_ok').replace('{n}', gs.chicoryBatchSize);
    showMsg(msg);
    saveGame();
    updateFarmUI();
    return;
  }
  if (gs.chicoryState !== 'none') { showMsg(t('chicory_plant_already')); return; }
  if (inEconomy) {
    if (AUTH.getAccountCoins() < 3) { showMsg(t('chicory_seed_no_coins')); return; }
    AUTH.saveAccountCoins(AUTH.getAccountCoins() - 3);
  }
  gs.chicoryState = 'growing';
  gs.chicoryPlantedDay = gs.gameDaysPassed;
  gs.chicoryWateredDays = 0;
  gs.chicoryLastWateredDay = -1;
  gs.chicoryBatchSize = 1;
  const msg = inEconomy
    ? t('chicory_seed_buy_ok').replace('{n}', 1).replace('{c}', 3)
    : t('chicory_plant_ok').replace('{n}', 1);
  showMsg(msg);
  saveGame();
  updateFarmUI();
}

function doChicoryWater() {
  if (!gs) return;
  if (gs.chicoryState === 'none') { showMsg(t('chicory_water_none')); return; }
  if (gs.chicoryState !== 'growing') { showMsg(t('chicory_harvest_none')); return; }
  if (gs.chicoryLastWateredDay === gs.gameDaysPassed) { showMsg(t('chicory_water_already')); return; }
  gs.chicoryWateredDays = (gs.chicoryWateredDays || 0) + 1;
  gs.chicoryLastWateredDay = gs.gameDaysPassed;
  const growthDays = (gs.gameDaysPassed - gs.chicoryPlantedDay) + gs.chicoryWateredDays;
  if (growthDays >= 5) gs.chicoryState = 'ready';
  showMsg(t('chicory_water_ok'));
  saveGame();
  updateFarmUI();
}

function doChicoryHarvest() {
  if (!gs) return;
  if (gs.chicoryState !== 'ready') { showMsg(t('chicory_harvest_none')); return; }
  const batch = gs.chicoryBatchSize || 1;
  gs.chicoryState = 'none';
  gs.chicoryBatchSize = 1;
  gs.chicoryStock = (gs.chicoryStock || 0) + batch;
  showMsg(t('chicory_harvest_ok').replace('{n}', batch));
  saveGame();
  updateFarmUI();
}

function doChicoryFeedLizard() {
  if (!gs || !gs.bornAnim) return;
  if (lizardType === 'crestie') { showMsg(t('chicory_crestie_no')); return; }
  if ((gs.chicoryStock || 0) < 1) { showMsg(t('chicory_feed_lizard_none')); return; }
  gs.chicoryStock -= 1;
  gs.hunger = Math.min(100, gs.hunger + 25);
  gs.happy = Math.min(100, gs.happy + 20);
  gs.hydration = Math.min(100, (gs.hydration || 0) + 15);
  gs.hasPoop = true;
  gs.hasUrine = true;
  showMsg(t('chicory_feed_lizard_ok'));
  saveGame();
  closeFarm();
}

function doPelletGet() {
  if (!gs) return;
  if ((gs.pelletCount || 0) >= 10) { showMsg(t('pellet_get_max')); return; }
  gs.pelletCount = Math.min(10, (gs.pelletCount || 0) + 5);
  showMsg(t('pellet_get_ok'));
  saveGame();
  updateFarmUI();
}

function doCgestieFoodGet() {
  if (!gs) return;
  if ((gs.cgestieFoodCount || 0) >= 10) { showMsg(t('cgestie_food_get_max')); return; }
  const inSeason = gs.gameDaysPassed <= 44; // May 1 ~ June 14, 2025
  if (inSeason) {
    // Free but 3-game-day cooldown
    const daysSinceLast = gs.gameDaysPassed - (gs.lastCgestieFoodGetDay || -3);
    if (daysSinceLast < 3) {
      const remaining = 3 - daysSinceLast;
      showMsg(t('cgestie_food_cooldown').replace('{n}', remaining));
      return;
    }
    gs.cgestieFoodCount = Math.min(10, (gs.cgestieFoodCount || 0) + 3);
    gs.lastCgestieFoodGetDay = gs.gameDaysPassed;
    showMsg(t('cgestie_food_get_ok'));
  } else {
    // After season: buy with 5 coins, no cooldown
    if (AUTH.getAccountCoins() < 5) { showMsg(t('cgestie_food_buy_no_coins')); return; }
    AUTH.saveAccountCoins(AUTH.getAccountCoins() - 5);
    gs.cgestieFoodCount = Math.min(10, (gs.cgestieFoodCount || 0) + 3);
    showMsg(t('cgestie_food_buy_ok'));
  }
  saveGame();
  updateFarmUI();
}

function doCgestieFeedLizard() {
  if (!gs || !gs.bornAnim) return;
  if (lizardType !== 'crestie') { showMsg(t('cgestie_food_bt_no')); return; }
  if ((gs.cgestieFoodCount || 0) < 1) { showMsg(t('cgestie_food_none')); return; }
  if (gs.gameDaysPassed - gs.lastFedGameDay < 2) { showMsg(t('cricket_feed_no')); return; }
  gs.cgestieFoodCount -= 1;
  gs.lastFedGameDay = gs.gameDaysPassed;
  gs.hunger = Math.min(100, gs.hunger + 45);
  gs.happy = Math.min(100, gs.happy + 12);
  gs.weight = Math.min(50, gs.weight + 0.5);
  gs.hasPoop = true;
  gs.hasUrine = true;
  showMsg(t('cgestie_food_feed_ok'));
  saveGame();
  closeFarm();
}

function doBtFoodGet() {
  if (!gs) return;
  if ((gs.btFoodCount || 0) >= 10) { showMsg(t('bt_food_get_max')); return; }
  const inSeason = gs.gameDaysPassed <= 44; // May 1 ~ June 14, 2025
  if (inSeason) {
    // Free but 3-game-day cooldown
    const daysSinceLast = gs.gameDaysPassed - (gs.lastBtFoodGetDay || -3);
    if (daysSinceLast < 3) {
      const remaining = 3 - daysSinceLast;
      showMsg(t('bt_food_cooldown').replace('{n}', remaining));
      return;
    }
    gs.btFoodCount = Math.min(10, (gs.btFoodCount || 0) + 3);
    gs.lastBtFoodGetDay = gs.gameDaysPassed;
    showMsg(t('bt_food_get_ok'));
  } else {
    // After season: buy with 5 coins, no cooldown
    if (AUTH.getAccountCoins() < 5) { showMsg(t('bt_food_buy_no_coins')); return; }
    AUTH.saveAccountCoins(AUTH.getAccountCoins() - 5);
    gs.btFoodCount = Math.min(10, (gs.btFoodCount || 0) + 3);
    showMsg(t('bt_food_buy_ok'));
  }
  saveGame();
  updateFarmUI();
}

function doBtFeedLizard() {
  if (!gs || !gs.bornAnim) return;
  if (lizardType !== 'bluetongue') { showMsg(t('bt_food_crestie_no')); return; }
  if ((gs.btFoodCount || 0) < 1) { showMsg(t('bt_food_none')); return; }
  if (gs.gameDaysPassed - gs.lastFedGameDay < 2) { showMsg(t('cricket_feed_no')); return; }
  gs.btFoodCount -= 1;
  gs.lastFedGameDay = gs.gameDaysPassed;
  gs.hunger = Math.min(100, gs.hunger + 45);
  gs.happy = Math.min(100, gs.happy + 12);
  gs.weight = Math.min(600, gs.weight + 4);
  gs.hasPoop = true;
  gs.hasUrine = true;
  showMsg(t('bt_food_feed_ok'));
  saveGame();
  closeFarm();
}

function seededRand(s) {
  const x = Math.sin(s * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function initOutdoorScene() {
  const W = canvas.width, H = canvas.height;
  const groundY = H * 0.52;
  const seed = gs ? gs.gameDaysPassed : 0;
  const dandelions = [];
  for (let i = 0; i < 8; i++) {
    const x = Math.round(W * 0.1 + seededRand(seed + i * 13) * W * 0.8);
    const y = Math.round(groundY + 52 + seededRand(seed + i * 17 + 100) * (H - groundY - 85));
    const spd = 28 + seededRand(seed + i * 31 + 5) * 38;
    const dir = seededRand(seed + i * 43 + 11) * Math.PI * 2;
    dandelions.push({
      x, y,
      baseX: x, baseY: y,
      vx: Math.cos(dir) * spd,
      vy: Math.sin(dir) * spd * 0.4,
      picked: false, gone: false,
    });
  }
  // Animated bugs (ladybugs)
  const bugs = [];
  for (let i = 0; i < 2; i++) {
    bugs.push({
      x: W * (0.2 + i * 0.55),
      y: groundY + 55 + i * 35,
      vx: (seededRand(seed + i * 99 + 7) > 0.5 ? 1 : -1) * (52 + seededRand(seed + i * 77) * 38),
      vy: (seededRand(seed + i * 88 + 3) > 0.5 ? 1 : -1) * (32 + seededRand(seed + i * 66) * 24),
    });
  }
  outdoorState = {
    dandelions,
    bugs,
    seeds: [],
    ambientSeedTimer: 0,
    gathered: 0,
    startTime: Date.now(),
    duration: 22,
    lastUpdateTime: Date.now(),
    penaltyEndTime: 0,
    wiltWarned: false,
  };
  updateOutdoorCounter();
}

function updateOutdoorCounter() {
  const el = document.getElementById('outdoor-counter');
  if (!el || !outdoorState) return;
  const total = outdoorState.dandelions.length;
  const picked = outdoorState.dandelions.filter(d => d.picked).length;
  const gone = outdoorState.dandelions.filter(d => d.gone && !d.picked).length;
  const label = gone > 0
    ? t('dandelion_outdoor_counter').replace('{n}', picked).replace('{t}', total) + ' (-' + gone + ')'
    : t('dandelion_outdoor_counter').replace('{n}', picked).replace('{t}', total);
  el.textContent = label;
}

function drawDandelionFlower(x, y, picked, wiltLevel) {
  wiltLevel = wiltLevel || 0;
  const stemH = 38;
  const fy = y - stemH - 12;

  if (picked) {
    ctx.strokeStyle = '#7a9060';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 4, y - stemH * 0.55, x, y - stemH);
    ctx.stroke();
    ctx.fillStyle = '#9a8050';
    ctx.beginPath(); ctx.arc(x, y - stemH, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c4aa70';
    ctx.beginPath(); ctx.arc(x - 0.5, y - stemH - 0.5, 1.8, 0, Math.PI * 2); ctx.fill();
    return;
  }

  ctx.save();
  if (wiltLevel > 0) ctx.globalAlpha = 1 - wiltLevel * 0.4;

  // Stem (slight curve)
  ctx.strokeStyle = wiltLevel > 0 ? '#7a8820' : '#2e7016';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + 5 * (1 - wiltLevel), y - stemH * 0.52, x, y - stemH);
  ctx.stroke();

  // Leaves (larger, more dandelion-like)
  const leafColor = wiltLevel > 0 ? '#8aaa26' : '#3a9020';
  ctx.fillStyle = leafColor;
  ctx.save(); ctx.translate(x - 8, y - 17); ctx.rotate(-0.7 + wiltLevel * 0.55);
  ctx.beginPath(); ctx.ellipse(0, 0, 13, 4.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.save(); ctx.translate(x + 8, y - 11); ctx.rotate(0.7 - wiltLevel * 0.55);
  ctx.beginPath(); ctx.ellipse(0, 0, 13, 4.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // Leaf tips (slightly darker)
  ctx.fillStyle = wiltLevel > 0 ? '#6a9020' : '#2a7010';
  ctx.save(); ctx.translate(x - 18, y - 19); ctx.rotate(-0.7 + wiltLevel * 0.55);
  ctx.beginPath(); ctx.ellipse(0, 0, 5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.save(); ctx.translate(x + 18, y - 13); ctx.rotate(0.7 - wiltLevel * 0.55);
  ctx.beginPath(); ctx.ellipse(0, 0, 5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Petals — two rings, 24 petals total, narrow and dense like a real dandelion
  const ps = 1 - wiltLevel * 0.32;
  const pr = 12 * (1 - wiltLevel * 0.22);
  const numP = 24;
  const petalR = Math.round(248 - wiltLevel * 38);
  const petalG = Math.round(215 - wiltLevel * 80);

  // Outer ring (slightly dimmer)
  ctx.fillStyle = `rgb(${Math.round(petalR * 0.82)},${Math.round(petalG * 0.82)},10)`;
  for (let i = 0; i < numP; i++) {
    const angle = (i / numP) * Math.PI * 2 + 0.065;
    ctx.save();
    ctx.translate(x + Math.cos(angle) * pr, fy + Math.sin(angle) * pr);
    ctx.rotate(angle);
    ctx.beginPath(); ctx.ellipse(0, 0, 10 * ps, 2.2 * ps, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  // Inner ring (brighter)
  ctx.fillStyle = `rgb(${petalR},${petalG},12)`;
  for (let i = 0; i < numP; i++) {
    const angle = (i / numP) * Math.PI * 2;
    ctx.save();
    ctx.translate(x + Math.cos(angle) * pr, fy + Math.sin(angle) * pr);
    ctx.rotate(angle);
    ctx.beginPath(); ctx.ellipse(0, 0, 10 * ps, 2.2 * ps, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Center disc
  const cr = 7 * (1 - wiltLevel * 0.22);
  ctx.fillStyle = wiltLevel > 0 ? '#9a5010' : '#c06808';
  ctx.beginPath(); ctx.arc(x, fy, cr, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = wiltLevel > 0 ? '#ba7028' : '#e89010';
  ctx.beginPath(); ctx.arc(x - 0.5, fy - 0.5, cr * 0.62, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,248,180,0.55)';
  ctx.beginPath(); ctx.arc(x - 1.2, fy - 1.5, cr * 0.26, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

function roundRect(c, x, y, w, h, r) {
  if (w <= 0) return;
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r);
  c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h);
  c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r);
  c.arcTo(x, y, x + r, y, r);
  c.closePath();
}

function drawFloatingSeed(sx, sy, angle, alpha, scale) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.translate(sx, sy);
  ctx.rotate(angle);

  const stemLen = 13 * scale;
  const bodyH = 4 * scale;
  const bristleLen = 8 * scale;
  const numBristles = 13;

  // Seed body
  ctx.fillStyle = '#c8a030';
  ctx.beginPath();
  ctx.ellipse(0, 0, 1.6 * scale, bodyH * 0.52, 0, 0, Math.PI * 2);
  ctx.fill();

  // Stem
  ctx.strokeStyle = 'rgba(210,185,90,0.88)';
  ctx.lineWidth = 0.8 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -bodyH * 0.52);
  ctx.lineTo(0, -bodyH * 0.52 - stemLen);
  ctx.stroke();

  // Fluffy pappus bristles
  const tipY = -bodyH * 0.52 - stemLen;
  ctx.strokeStyle = 'rgba(255,255,235,0.88)';
  ctx.lineWidth = 0.55 * scale;
  for (let i = 0; i < numBristles; i++) {
    const a = (i / numBristles) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, tipY);
    ctx.lineTo(Math.cos(a) * bristleLen * 0.72, tipY + Math.sin(a) * bristleLen * 0.58);
    ctx.stroke();
  }
  // Center dot
  ctx.fillStyle = 'rgba(255,252,210,0.92)';
  ctx.beginPath(); ctx.arc(0, tipY, 1.3 * scale, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

function burstSeeds(fx, fy) {
  if (!outdoorState) return;
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2 + (Math.random() - 0.5) * 1.0;
    const speed = 45 + Math.random() * 65;
    outdoorState.seeds.push({
      x: fx, y: fy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 35,
      angle: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 3.5,
      life: 0,
      maxLife: 2.2 + Math.random() * 1.8,
      scale: 0.45 + Math.random() * 0.38,
      burst: true,
    });
  }
}

function drawBug(x, y) {
  const frame = Math.floor(Date.now() / 200) % 2;
  // Body (ladybug red)
  ctx.fillStyle = '#cc2a08';
  ctx.beginPath(); ctx.ellipse(x, y, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
  // Wing divider
  ctx.strokeStyle = '#1a0800';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.stroke();
  // Spots
  ctx.fillStyle = '#1a0800';
  ctx.beginPath(); ctx.arc(x - 2.5, y - 0.5, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 3, y + 1, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x - 1, y + 2.5, 1.2, 0, Math.PI * 2); ctx.fill();
  // Head
  ctx.fillStyle = '#1a0800';
  ctx.beginPath(); ctx.arc(x, y - 6, 3, 0, Math.PI * 2); ctx.fill();
  // Antennae
  ctx.strokeStyle = '#1a0800';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x - 1, y - 8); ctx.lineTo(x - 5, y - 13); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 1, y - 8); ctx.lineTo(x + 5, y - 13); ctx.stroke();
  // Animated legs
  const legOff = frame === 0 ? 2 : -2;
  ctx.strokeStyle = '#2a1000';
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(x + s * 6, y - 2); ctx.lineTo(x + s * 11, y - 3 + legOff); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + s * 6, y + 1); ctx.lineTo(x + s * 11, y + legOff); ctx.stroke();
  }
}

function drawOutdoor() {
  const W = canvas.width, H = canvas.height;
  const skyH = H * 0.52;
  const now = Date.now();
  const tSec = now / 1000;

  // === OUTDOOR GAME LOGIC ===
  let elapsed = 0, timeLeft = 999;
  if (outdoorState) {
    elapsed = (now - outdoorState.startTime) / 1000;
    timeLeft = Math.max(0, outdoorState.duration - elapsed);

    if (timeLeft <= 0) { leaveOutdoor(); return; }

    if (timeLeft <= 8 && !outdoorState.wiltWarned) {
      outdoorState.wiltWarned = true;
      showMsg(t('dandelion_wilt_warning'));
    }

    // Update bugs + seeds with shared dt
    const dt = Math.min((now - outdoorState.lastUpdateTime) / 1000, 0.05);
    outdoorState.lastUpdateTime = now;
    const groundY = H * 0.52;

    for (const bug of outdoorState.bugs) {
      bug.x += bug.vx * dt;
      bug.y += bug.vy * dt;
      if (bug.x < 15)           { bug.x = 15;       bug.vx =  Math.abs(bug.vx); }
      if (bug.x > W - 15)       { bug.x = W - 15;   bug.vx = -Math.abs(bug.vx); }
      if (bug.y < groundY + 12) { bug.y = groundY + 12; bug.vy =  Math.abs(bug.vy); }
      if (bug.y > H - 20)       { bug.y = H - 20;   bug.vy = -Math.abs(bug.vy); }
    }

    // Move dandelions (bounce within ground area)
    const minDY = groundY + 52, maxDY = H - 85;
    for (const d of outdoorState.dandelions) {
      if (d.picked || d.gone) continue;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.x < W * 0.06)  { d.x = W * 0.06;  d.vx =  Math.abs(d.vx); }
      if (d.x > W * 0.94)  { d.x = W * 0.94;  d.vx = -Math.abs(d.vx); }
      if (d.y < minDY)     { d.y = minDY;      d.vy =  Math.abs(d.vy); }
      if (d.y > maxDY)     { d.y = maxDY;      d.vy = -Math.abs(d.vy); }
    }

    // Spawn ambient seeds
    outdoorState.ambientSeedTimer += dt;
    if (outdoorState.ambientSeedTimer > 1.6 && outdoorState.seeds.filter(s => !s.burst).length < 9) {
      outdoorState.ambientSeedTimer = 0;
      outdoorState.seeds.push({
        x: Math.random() * W,
        y: -10,
        vx: (Math.random() - 0.35) * 22,
        vy: 18 + Math.random() * 16,
        angle: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 1.8,
        life: 0,
        maxLife: 7 + Math.random() * 6,
        scale: 0.55 + Math.random() * 0.45,
        burst: false,
      });
    }

    // Update seeds
    for (let i = outdoorState.seeds.length - 1; i >= 0; i--) {
      const s = outdoorState.seeds[i];
      s.vy += (s.burst ? 38 : 6) * dt;    // gravity (burst seeds fall faster)
      s.vx *= s.burst ? 0.97 : 0.995;     // gentle drag
      s.x += s.vx * dt + Math.sin(s.life * 2.0 + i) * 14 * dt;
      s.y += s.vy * dt;
      s.angle += s.rotSpeed * dt;
      s.life += dt;
      if (s.life > s.maxLife || s.y > H + 30 || s.x < -30 || s.x > W + 30) {
        outdoorState.seeds.splice(i, 1);
      }
    }
  }

  // ── Sky ──
  const skyGrad = ctx.createLinearGradient(0, 0, 0, skyH);
  skyGrad.addColorStop(0,   '#1e6bb8');
  skyGrad.addColorStop(0.45,'#4a9cd4');
  skyGrad.addColorStop(1,   '#aaddee');
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, skyH);

  // ── Sun ──
  const sunX = W * 0.82, sunY = H * 0.1;
  // Glow
  ctx.fillStyle = 'rgba(255,240,100,0.12)';
  ctx.beginPath(); ctx.arc(sunX, sunY, 40, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,240,100,0.18)';
  ctx.beginPath(); ctx.arc(sunX, sunY, 30, 0, Math.PI * 2); ctx.fill();
  // Body
  ctx.fillStyle = '#ffe838';
  ctx.beginPath(); ctx.arc(sunX, sunY, 20, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff8c0';
  ctx.beginPath(); ctx.arc(sunX, sunY, 12, 0, Math.PI * 2); ctx.fill();
  // Rays
  ctx.strokeStyle = 'rgba(255,238,80,0.55)';
  ctx.lineWidth = 2; ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + tSec * 0.18;
    ctx.beginPath();
    ctx.moveTo(sunX + Math.cos(a) * 24, sunY + Math.sin(a) * 24);
    ctx.lineTo(sunX + Math.cos(a) * 36, sunY + Math.sin(a) * 36);
    ctx.stroke();
  }

  // ── Clouds (gently drifting) ──
  function cloud(cx, cy, sc) {
    const puffs = [[0,0,19],[24,5,14],[-20,6,12],[12,-10,12],[38,-1,10],[-6,-11,10]];
    // Shadow
    ctx.fillStyle = 'rgba(170,200,220,0.35)';
    puffs.forEach(([ox,oy,r]) => {
      ctx.beginPath(); ctx.arc(cx+ox*sc+2, cy+oy*sc+4, r*sc, 0, Math.PI*2); ctx.fill();
    });
    // Body
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    puffs.forEach(([ox,oy,r]) => {
      ctx.beginPath(); ctx.arc(cx+ox*sc, cy+oy*sc, r*sc, 0, Math.PI*2); ctx.fill();
    });
    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(cx - 8*sc, cy - 8*sc, 10*sc, 0, Math.PI*2); ctx.fill();
  }
  const cdx1 = (tSec * 8) % (W * 1.4) - W * 0.2;
  const cdx2 = (tSec * 5 + W * 0.55) % (W * 1.4) - W * 0.2;
  cloud(cdx1, H * 0.09, 1.0);
  cloud(cdx2, H * 0.06, 0.72);

  // ── Background hills ──
  ctx.fillStyle = '#3a7e2a';
  ctx.beginPath();
  ctx.moveTo(0, skyH);
  ctx.bezierCurveTo(W*0.12, skyH - H*0.18, W*0.28, skyH - H*0.08, W*0.5, skyH - H*0.06);
  ctx.bezierCurveTo(W*0.68, skyH - H*0.04, W*0.82, skyH - H*0.13, W, skyH - H*0.1);
  ctx.lineTo(W, skyH); ctx.closePath(); ctx.fill();
  // Hill highlight
  ctx.fillStyle = '#4a9838';
  ctx.beginPath();
  ctx.moveTo(0, skyH);
  ctx.bezierCurveTo(W*0.12, skyH - H*0.13, W*0.28, skyH - H*0.05, W*0.5, skyH - H*0.04);
  ctx.bezierCurveTo(W*0.68, skyH - H*0.02, W*0.82, skyH - H*0.09, W, skyH - H*0.07);
  ctx.lineTo(W, skyH); ctx.closePath(); ctx.fill();

  // ── Ground ──
  const grassGrad = ctx.createLinearGradient(0, skyH, 0, H);
  grassGrad.addColorStop(0,   '#72cc50');
  grassGrad.addColorStop(0.3, '#5ab840');
  grassGrad.addColorStop(1,   '#3a9028');
  ctx.fillStyle = grassGrad; ctx.fillRect(0, skyH, W, H - skyH);

  // Subtle ground stripes
  ctx.strokeStyle = 'rgba(0,50,0,0.07)'; ctx.lineWidth = 1;
  for (let gx = 0; gx < W; gx += 10) {
    ctx.beginPath(); ctx.moveTo(gx, skyH); ctx.lineTo(gx, H); ctx.stroke();
  }

  // Grass blades at ground edge
  ctx.strokeStyle = '#3aaa1a'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  for (let gx = 4; gx < W; gx += 7) {
    const h = 6 + Math.sin(gx * 0.31 + tSec * 1.2) * 3;
    const lean = Math.sin(gx * 0.17 + tSec * 0.8) * 3;
    ctx.beginPath();
    ctx.moveTo(gx, skyH);
    ctx.quadraticCurveTo(gx + lean, skyH - h * 0.5, gx + lean * 1.4, skyH - h);
    ctx.stroke();
  }

  // ── Left tree ──
  px(W*0.07 - 7, skyH - H*0.01, 14, H*0.14, '#5a3010');
  ctx.fillStyle = '#1e5818';
  ctx.beginPath(); ctx.arc(W*0.07, skyH - H*0.1, W*0.068, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#2a7222';
  ctx.beginPath(); ctx.arc(W*0.065, skyH - H*0.17, W*0.05, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#38903a';  // highlight
  ctx.beginPath(); ctx.arc(W*0.06, skyH - H*0.2, W*0.026, 0, Math.PI*2); ctx.fill();

  // ── Right bush/tree ──
  px(W*0.91 - 5, skyH - H*0.01, 10, H*0.1, '#5a3010');
  ctx.fillStyle = '#1e5818';
  ctx.beginPath(); ctx.arc(W*0.91, skyH - H*0.09, W*0.058, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#2a7222';
  ctx.beginPath(); ctx.arc(W*0.908, skyH - H*0.14, W*0.038, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#38903a';
  ctx.beginPath(); ctx.arc(W*0.905, skyH - H*0.17, W*0.02, 0, Math.PI*2); ctx.fill();

  // ── Small background flowers (decorative, non-pickable) ──
  const bgFlowers = [[W*0.38, skyH+14],[W*0.53, skyH+10],[W*0.65, skyH+18],[W*0.28, skyH+20]];
  for (const [fx, fy] of bgFlowers) {
    ctx.strokeStyle = '#2a8010'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - 10); ctx.stroke();
    ctx.fillStyle = '#ff88aa';
    for (let i = 0; i < 5; i++) {
      const a = (i/5)*Math.PI*2;
      ctx.beginPath(); ctx.arc(fx + Math.cos(a)*4, fy - 10 + Math.sin(a)*4, 2.5, 0, Math.PI*2); ctx.fill();
    }
    ctx.fillStyle = '#ffe050';
    ctx.beginPath(); ctx.arc(fx, fy - 10, 2, 0, Math.PI*2); ctx.fill();
  }

  // ── Dandelions ──
  if (outdoorState) {
    const wiltStart = outdoorState.duration - 8;
    for (const d of outdoorState.dandelions) {
      if (d.gone) continue;
      let wiltLevel = 0;
      if (elapsed > wiltStart) wiltLevel = Math.min(1, (elapsed - wiltStart) / 6);
      drawDandelionFlower(d.x, d.y, d.picked, wiltLevel);
    }
  }

  // ── Floating seeds ──
  if (outdoorState) {
    for (const s of outdoorState.seeds) {
      const lr = s.life / s.maxLife;
      let alpha = lr < 0.12 ? lr / 0.12 : lr > 0.78 ? (1 - lr) / 0.22 : 1;
      alpha = Math.max(0, Math.min(1, alpha)) * 0.88;
      drawFloatingSeed(s.x, s.y, s.angle, alpha, s.scale);
    }
  }

  // ── Bugs ──
  if (outdoorState) {
    for (const bug of outdoorState.bugs) drawBug(bug.x, bug.y);
  }

  // ── Timer bar ──
  if (outdoorState) {
    const timerFrac = Math.max(0, timeLeft / outdoorState.duration);
    const barW = W * 0.62, barX = W * 0.19, barY = 10, barH = 10;
    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    roundRect(ctx, barX - 2, barY - 2, barW + 4, barH + 4, 4);
    ctx.fill();
    // Fill
    const barColor = timeLeft > 10 ? '#44dd44' : timeLeft > 5 ? '#f8c040' : '#f84040';
    ctx.fillStyle = barColor;
    roundRect(ctx, barX, barY, Math.max(0, barW * timerFrac), barH, 2);
    ctx.fill();
    // Shine
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    roundRect(ctx, barX, barY, Math.max(0, barW * timerFrac), barH * 0.4, 2);
    ctx.fill();
    // Time text
    ctx.fillStyle = '#fff';
    ctx.font = "7px 'Press Start 2P', Galmuri11, monospace";
    ctx.textAlign = 'center';
    ctx.fillText(Math.ceil(timeLeft) + 's', W / 2, barY + barH + 14);
    ctx.textAlign = 'left';
  }

  // ── Tap hint ──
  if (outdoorState && outdoorState.dandelions.some(d => !d.picked && !d.gone)) {
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    roundRect(ctx, W/2 - 112, H - 29, 224, 23, 5);
    ctx.fill();
    ctx.fillStyle = '#c8e84a';
    ctx.font = "7px 'Press Start 2P', Galmuri11, monospace";
    ctx.textAlign = 'center';
    ctx.fillText(t('dandelion_tap_hint_bug'), W / 2, H - 13);
    ctx.textAlign = 'left';
  }

  // ── Penalty flash ──
  if (outdoorState && Date.now() < outdoorState.penaltyEndTime) {
    ctx.fillStyle = 'rgba(255,30,0,0.28)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ff5533';
    ctx.font = "11px 'Press Start 2P', Galmuri11, monospace";
    ctx.textAlign = 'center';
    ctx.fillText(t('dandelion_bug_penalty'), W / 2, H * 0.44);
    ctx.textAlign = 'left';
  }
}

function doDandelionGather() {
  if (!gs) return;
  const gameMonth = getGameDate().month;
  if (gameMonth < 4 || gameMonth > 8) { showMsg(t('dandelion_out_of_season')); return; }
  if (gs.lastDandelionGatherDay === gs.gameDaysPassed) { showMsg(t('dandelion_gathered_today')); return; }
  if ((gs.dandelionStock || 0) >= 10) { showMsg(t('dandelion_stock_max')); return; }
  closeFarm();
  scene = SCENE.OUTDOOR;
  initOutdoorScene();
  document.getElementById('outdoor-overlay').style.display = 'flex';
  document.getElementById('ui-overlay').style.display = 'none';
}

function leaveOutdoor() {
  if (outdoorState && outdoorState.gathered > 0) {
    gs.dandelionStock = Math.min(10, (gs.dandelionStock || 0) + outdoorState.gathered);
    gs.lastDandelionGatherDay = gs.gameDaysPassed;
    showMsg(t('dandelion_gather_ok').replace('{n}', outdoorState.gathered));
    saveGame();
  }
  outdoorState = null;
  scene = SCENE.ROOM;
  document.getElementById('outdoor-overlay').style.display = 'none';
  if (gs && gs.bornAnim) document.getElementById('ui-overlay').style.display = 'flex';
}

function doDandelionFeedLizard() {
  if (!gs || !gs.bornAnim) return;
  if (lizardType === 'crestie') { showMsg(t('dandelion_crestie_no')); return; }
  if ((gs.dandelionStock || 0) < 1) { showMsg(t('dandelion_feed_none')); return; }
  gs.dandelionStock -= 1;
  gs.hunger = Math.min(100, gs.hunger + 20);
  gs.happy = Math.min(100, gs.happy + 15);
  gs.hydration = Math.min(100, (gs.hydration || 0) + 10);
  gs.hasPoop = true;
  gs.hasUrine = true;
  showMsg(t('dandelion_feed_ok'));
  saveGame();
  closeFarm();
}

function doSellDandelion() {
  if (!gs) return;
  const stock = gs.dandelionStock || 0;
  if (stock < 1) { showMsg(t('sell_none_dandelion')); return; }
  const earned = stock * 2;
  gs.dandelionStock = 0;
  AUTH.saveAccountCoins(AUTH.getAccountCoins() + earned);
  showMsg(t('sell_dandelion_ok').replace('{n}', stock).replace('{c}', earned));
  saveGame();
  updateFarmUI();
}

function doSellChicory() {
  if (!gs) return;
  const stock = gs.chicoryStock || 0;
  if (stock < 1) { showMsg(t('sell_none_chicory')); return; }
  const earned = stock * 5;
  gs.chicoryStock = 0;
  AUTH.saveAccountCoins(AUTH.getAccountCoins() + earned);
  showMsg(t('sell_chicory_ok').replace('{n}', stock).replace('{c}', earned));
  saveGame();
  updateFarmUI();
}

function doCricketCare() {
  if (!gs) return;
  if ((gs.cricketCount || 0) === 0) { showMsg(t('cricket_care_none')); return; }
  if ((gs.pelletCount || 0) < 1 && (gs.chicoryStock || 0) < 1) { showMsg(t('cricket_care_no_food')); return; }
  if (gs.lastCricketCareDay === gs.gameDaysPassed) { showMsg(t('cricket_care_already')); return; }
  if ((gs.pelletCount || 0) >= 1) {
    gs.pelletCount -= 1;
    showMsg(t('cricket_care_ok'));
  } else {
    gs.chicoryStock -= 1;
    showMsg(t('cricket_care_ok_chicory'));
  }
  gs.lastCricketCareDay = gs.gameDaysPassed;
  saveGame();
  updateFarmUI();
}

// ─── DOGRAM (도감) ────────────────────────────────────────────────────────────
function updateDogramButton() {
  const btn = document.getElementById('btn-nav-dogram');
  if (btn) btn.style.display = allLizards.length > 0 ? '' : 'none';
}

function openDogram() {
  closeFarm();
  showDogramMain();
  renderDogram();
  document.getElementById('dogram-modal').style.display = 'flex';
}

function closeDogram() {
  document.getElementById('dogram-modal').style.display = 'none';
}

function showDogramMain() {
  document.getElementById('dogram-main-view').style.display = '';
  document.getElementById('dogram-add-view').style.display = 'none';
  document.getElementById('dogram-country-view').style.display = 'none';
  document.getElementById('dogram-morph-view').style.display = 'none';
  document.getElementById('dogram-bt-morph-view').style.display = 'none';
  document.getElementById('dogram-color-view').style.display = 'none';
  document.getElementById('dogram-trait-view').style.display = 'none';
  document.getElementById('dogram-sell-view').style.display = 'none';
  renderDogram();
}

const ADOPT_COST = 20;

// ─── LIZARD APPEARANCE ──────────────────────────────────────────────────────
function getCrestieColors(colorId, traits, morph) {
  traits = traits || [];
  //            [0]body    [1]bodyShd [2]stripe  [3]ventral [4]crest   [5]neck    [6]head    [7]headTip [8]legs    [9]tailTip [10]tailMid
  const P = {
    orange:  ['#c07020','#a86020','#e8b050','#e8c870','#f0b040','#c87828','#d88030','#c87020','#b06018','#8a5018','#9a5820'],
    red:     ['#901818','#701010','#b83030','#c86060','#c82828','#801010','#a01818','#881010','#701010','#501010','#601010'],
    dark:    ['#2e1a08','#1e0e04','#5a3818','#6a4828','#5a3010','#281408','#341c0c','#281008','#221008','#180808','#200c08'],
    tricolor:['#8a5020','#6a3810','#c09050','#d4b880','#b89040','#7a4818','#9a5828','#8a4818','#7a4010','#5a3010','#6a3818'],
    yellow:  ['#a89010','#887808','#d4c030','#e8d870','#d4c040','#988018','#b09018','#a07810','#887010','#686008','#787010'],
    cream:   ['#c4a070','#a48050','#e8d0a0','#f0e8c8','#e0c880','#b89060','#caa878','#ba9868','#a87858','#887040','#987848'],
    olive:   ['#5a6820','#3a4810','#7a8830','#98a850','#6a7828','#4a5818','#606828','#505818','#485018','#303810','#3a4010'],
    gray:    ['#707070','#505050','#909090','#b0b0b0','#888888','#686868','#787878','#686868','#606060','#404040','#505050'],
    purple:  ['#682898','#481878','#9040b8','#b870d8','#8030a8','#5a2080','#742898','#602080','#502070','#381858','#401860'],
  };
  const a = P[colorId] || P.orange;
  let c = {
    body:a[0], bodyShade:a[1], stripe:a[2], ventral:a[3],
    crest:a[4], neck:a[5], head:a[6], headTip:a[7],
    legs:a[8], tailTip:a[9], tailMid:a[10]
  };
  // ── MORPH OVERLAYS ──
  if (morph === 'lilly_white') {
    // 릴리화이트: 몸 전체가 크림/흰색으로 크게 밝아짐
    for (const k in c) c[k] = blendHex(c[k], '#f8f4ec', 0.62);
  } else if (morph === 'cappuccino') {
    // 카푸치노: 따뜻한 갈색 계열로 이동
    for (const k in c) c[k] = blendHex(c[k], '#8b5e3c', 0.32);
  } else if (morph === 'sable') {
    // 세이블: 탈채색 + 어둡게
    for (const k in c) {
      const n = parseInt(c[k].slice(1), 16);
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      const avg = Math.round(r * 0.35 + g * 0.50 + b * 0.15);
      const dr = Math.max(0, Math.min(255, Math.round(r * 0.4 + avg * 0.6) - 18));
      const dg = Math.max(0, Math.min(255, Math.round(g * 0.4 + avg * 0.6) - 14));
      const db = Math.max(0, Math.min(255, Math.round(b * 0.4 + avg * 0.6) - 10));
      c[k] = '#' + ((dr << 16) | (dg << 8) | db).toString(16).padStart(6, '0');
    }
  } else if (morph === 'azantic') {
    // 아잔틱: 차갑고 은빛이 도는 청회색 계열
    for (const k in c) c[k] = blendHex(c[k], '#9aa4b8', 0.52);
  }
  // normal 은 변형 없음
  if (traits.includes('hypo'))        for (const k in c) c[k] = adjustHex(c[k],  50);
  if (traits.includes('melanistic'))  for (const k in c) c[k] = adjustHex(c[k], -60);
  if (traits.includes('high_yellow')) {
    c.body   = adjustHex(c.body,   18);
    c.stripe = adjustHex(c.stripe, 25);
    c.crest  = adjustHex(c.crest,  18);
    c.head   = adjustHex(c.head,   12);
  }
  return c;
}

function getBluetongueColors(morph, traits) {
  traits = traits || [];
  //            [0]body    [1]crossbnd [2]belly   [3]neck    [4]head    [5]headTip [6]legs    [7]tail1   [8]tail2   [9]tail3
  const M = {
    northern:  ['#c0a050','#2c1608','#f0e8c0','#b09848','#c8a058','#a88040','#a88840','#6a7050','#7a8060','#8a9070'],
    eastern:   ['#909040','#201808','#e8e0a8','#807838','#989848','#787830','#887838','#505030','#606040','#707050'],
    central:   ['#c07030','#1c0c04','#e8d490','#a06028','#b07038','#906828','#a06828','#503010','#603818','#704020'],
    blotched:  ['#7a8a60','#242010','#d0cca0','#606850','#708060','#505040','#606050','#383828','#484838','#585848'],
    western:   ['#c0a068','#201408','#ecdcb0','#a08858','#b09068','#908050','#988860','#584828','#685838','#786848'],
    singleback:['#5a4028','#140c04','#c8bc88','#4a3020','#584030','#402818','#4a3020','#281408','#341c0c','#402410'],
    irian_jaya:['#808078','#181810','#d8d8c0','#686860','#787870','#585850','#686858','#404038','#505048','#606058'],
    merauke:   ['#a07040','#180a00','#d0c890','#906030','#a87848','#887030','#906038','#503010','#603820','#704028'],
    halmahera: ['#2c2818','#100c04','#c8bc80','#201c10','#383018','#484030','#282010','#181408','#201a0c','#302818'],
    tanimbar:  ['#b08850','#200e00','#e8d898','#987040','#a87848','#906038','#985830','#582800','#683810','#784820'],
    kei_island:['#6a8870','#0c1810','#c8dcc0','#4a6850','#587860','#4a6850','#3a5840','#182818','#283828','#384840'],
    ajantics:         ['#262830','#0c0c10','#d0d0d4','#181820','#bec0c4','#cecece','#202028','#0e0e12','#181820','#24242c'],
    patternless:      ['#a89870','#a89870','#e8d898','#887860','#908070','#a89870','#807050','#605840','#706850','#806858'],
    melanistic:       ['#181810','#0c0c08','#484840','#101008','#1c1c14','#282820','#161610','#080808','#100c08','#181810'],
    super_melanistic: ['#080808','#040404','#1c1c18','#060606','#0c0c0a','#101010','#060606','#020202','#040402','#080808'],
    anerythristic:    ['#8a9090','#282c28','#c8ccc8','#707878','#808888','#6a7878','#6a7870','#484c48','#585c58','#686868'],
    albino:           ['#e8e0c0','#ccc4a0','#f8f4e0','#d0c8a8','#dcd4b8','#eae4c8','#c8c0a0','#b0a888','#b8b090','#c8c0a0'],
    hypo:             ['#d4a85c','#5a4030','#f8f0c8','#b89050','#c8a060','#b89050','#b09040','#989070','#a09878','#b0a888'],
    lava:             ['#e87020','#181008','#f4d098','#c86018','#d07028','#e08030','#c06010','#983000','#a84010','#b85020'],
    platinum:         ['#b0b0a8','#484840','#d8d8d0','#909088','#a0a098','#b8b8b0','#888880','#606058','#707068','#808078'],
    sunglow:          ['#f0d060','#d8b848','#fef8d8','#e8c850','#f0d060','#e8d868','#e0c048','#c8a030','#d0a838','#d8b040'],
    snow:             ['#e0e4e0','#c0c4c0','#f4f8f4','#d0d4d0','#d8dcd8','#e4e8e4','#c8ccc8','#b0b4b0','#b8bcb8','#c0c4c0'],
  };
  const a = M[morph] || M.northern;
  let c = {
    body:a[0], crossband:a[1], belly:a[2], neck:a[3],
    head:a[4], headTip:a[5], legs:a[6],
    tail1:a[7], tail2:a[8], tail3:a[9]
  };
  if (traits.includes('hypo'))        for (const k in c) c[k] = adjustHex(c[k],  50);
  if (traits.includes('melanistic'))  for (const k in c) c[k] = adjustHex(c[k], -50);
  if (traits.includes('high_yellow')) {
    c.body  = adjustHex(c.body,  20);
    c.belly = adjustHex(c.belly, 15);
    c.head  = adjustHex(c.head,  15);
  }
  return c;
}

const SPECIES_META = {
  crestie:    { size: 'small',  activity: 'nocturnal' },
  bluetongue: { size: 'medium', activity: 'diurnal'   },
};

const LIZARD_MORPHS = {
  crestie:    ['normal', 'lilly_white', 'cappuccino', 'sable', 'azantic', 'choco'],
  bluetongue: ['hypo', 'patternless', 'melanistic', 'anerythristic', 'albino']
};
const BT_MORPHS_BY_COUNTRY = {
  australia: ['hypo', 'anerythristic', 'melanistic', 'albino', 'patternless'],
  indonesia: ['patternless', 'melanistic', 'albino'],
};
const LIZARD_LOCALES = {
  bluetongue: ['northern', 'eastern', 'irian_jaya', 'merauke', 'halmahera', 'tanimbar', 'kei_island']
};
const BT_LOCALES_BY_COUNTRY = {
  australia: ['northern', 'eastern', 'central', 'blotched', 'western', 'singleback'],
  indonesia: ['halmahera', 'merauke', 'irian_jaya', 'tanimbar', 'kei_island'],
};
const LIZARD_COLORS = {
  crestie: [
    { id: 'red',       hex: '#c03020' },
    { id: 'dark',      hex: '#3a2510' },
    { id: 'tricolor',  hex: '#a06030' },
    { id: 'orange',    hex: '#d07010' },
    { id: 'yellow',    hex: '#c8b020' },
    { id: 'cream',     hex: '#d4b890' },
    { id: 'olive',     hex: '#6a7830' },
    { id: 'gray',      hex: '#7a7a7a' },
    { id: 'purple',    hex: '#7a3a9a' },
  ]
};
const LIZARD_TRAITS = ['flame', 'harlequin', 'pinstripe', 'dalmatian', 'patternless', 'high_yellow', 'hypo', 'bold', 'melanistic', 'extreme_harlequin'];
function getBtTraits(country, morph) {
  if (country === 'australia' && morph === 'northern') return ['sunset'];
  return [];
}

// ─── BT GENETICS SYSTEM ──────────────────────────────────────────────────────
// Locales are subspecies names (not mutation morphs)
const BT_LOCALE_SET = new Set([
  'northern', 'eastern', 'central', 'blotched', 'western', 'singleback',
  'halmahera', 'merauke', 'irian_jaya', 'tanimbar', 'kei_island'
]);

const BT_MORPH_LOCI = {
  albino:        'recessive',   // 2 alleles = albino
  anerythristic: 'recessive',   // 2 alleles = anerythristic (no red/yellow pigment)
  hypo:          'recessive',   // 2 alleles = hypomelanistic (proven recessive)
  melanistic:    'codominant',  // 1 = melanistic; 2 = super_melanistic
  patternless:   'recessive',   // 2 alleles = patternless
};

const BT_MORPH_COMBOS = [
  { loci: ['albino', 'melanistic'],    name: 'lava'     },
  { loci: ['hypo',   'melanistic'],    name: 'platinum' },
  { loci: ['hypo',   'albino'],        name: 'sunglow'  },
  { loci: ['albino', 'anerythristic'], name: 'snow'     },
];

function inferBtGenetics(morph) {
  const g = {};
  for (const locus of Object.keys(BT_MORPH_LOCI)) g[locus] = 0;
  switch (morph) {
    case 'albino':           g.albino        = 2; break;
    case 'anerythristic':    g.anerythristic = 2; break;
    case 'hypo':             g.hypo          = 2; break;
    case 'melanistic':       g.melanistic    = 1; break;
    case 'super_melanistic': g.melanistic    = 2; break;
    case 'patternless':      g.patternless   = 2; break;
    case 'lava':             g.albino = 2; g.melanistic    = 1; break;
    case 'platinum':         g.hypo   = 2; g.melanistic    = 1; break;
    case 'sunglow':          g.hypo   = 2; g.albino        = 2; break;
    case 'snow':             g.albino = 2; g.anerythristic = 2; break;
  }
  return g;
}

function getBtLizardGenetics(lizard) {
  if (!lizard || lizard.type !== 'bluetongue') return null;
  if (lizard.btGenetics) return lizard.btGenetics;
  const mutationMorph = BT_LOCALE_SET.has(lizard.morph) ? null : (lizard.morph || null);
  return inferBtGenetics(mutationMorph || 'normal');
}

function crossBtGenetics(momG, dadG) {
  const childG = {};
  for (const locus of Object.keys(BT_MORPH_LOCI)) {
    const m = momG[locus] || 0;
    const d = dadG[locus] || 0;
    const momAllele = Math.random() < m / 2 ? 1 : 0;
    const dadAllele = Math.random() < d / 2 ? 1 : 0;
    childG[locus] = momAllele + dadAllele;
  }
  return childG;
}

function getBtPhenotype(g, fallbackLocale) {
  if (!g) return fallbackLocale || 'northern';
  const expressed = Object.entries(BT_MORPH_LOCI)
    .filter(([locus, type]) => {
      const cnt = g[locus] || 0;
      return type === 'codominant' ? cnt >= 1 : cnt >= 2;
    })
    .map(([locus]) => locus);
  if (expressed.length === 0) return fallbackLocale || 'northern';
  for (const combo of BT_MORPH_COMBOS) {
    if (combo.loci.every(l => expressed.includes(l))) return combo.name;
  }
  if (expressed.length === 1) {
    const locus = expressed[0];
    if (BT_MORPH_LOCI[locus] === 'codominant' && (g[locus] || 0) === 2) return 'super_' + locus;
    return locus;
  }
  return expressed[0];
}

// ─── CRESTIE GENETICS SYSTEM ─────────────────────────────────────────────────
// Crestie morph loci and their inheritance type
const CRESTIE_MORPH_LOCI = {
  lilly_white: 'codominant',  // 1 allele = visible; 2 = super form
  cappuccino:  'codominant',
  sable:       'codominant',
  azantic:     'recessive',   // 1 allele = het (hidden); 2 = visible
  choco:       'recessive',
};

// Combo morph names produced when multiple loci express simultaneously
// Sorted most-specific first (longer loci list = higher priority)
const CRESTIE_MORPH_COMBOS = [
  { loci: ['lilly_white', 'cappuccino', 'sable'], name: 'triple_combo'        },
  { loci: ['lilly_white', 'cappuccino'],           name: 'frappuccino'         },
  { loci: ['cappuccino',  'sable'],                name: 'luwak'               },
  { loci: ['lilly_white', 'sable'],                name: 'lilly_sable'         },
  { loci: ['lilly_white', 'azantic'],              name: 'lilly_azantic'       },
  { loci: ['lilly_white', 'choco'],                name: 'lilly_choco'         },
  { loci: ['cappuccino',  'azantic'],              name: 'cappuccino_azantic'  },
  { loci: ['sable',       'azantic'],              name: 'sable_azantic'       },
  { loci: ['cappuccino',  'choco'],                name: 'cappuccino_choco'    },
  { loci: ['sable',       'choco'],                name: 'sable_choco'         },
];

// Derive genotype from a morph string (for lizards that predate the genetics system)
function inferCrestieGenetics(morph) {
  const g = {};
  for (const locus of Object.keys(CRESTIE_MORPH_LOCI)) g[locus] = 0;
  switch (morph) {
    case 'lilly_white':        g.lilly_white = 1; break;
    case 'cappuccino':         g.cappuccino  = 1; break;
    case 'sable':              g.sable       = 1; break;
    case 'azantic':            g.azantic     = 2; break;
    case 'choco':              g.choco       = 2; break;
    case 'frappuccino':        g.lilly_white = 1; g.cappuccino = 1; break;
    case 'luwak':              g.cappuccino  = 1; g.sable      = 1; break;
    case 'lilly_sable':        g.lilly_white = 1; g.sable      = 1; break;
    case 'lilly_azantic':      g.lilly_white = 1; g.azantic    = 2; break;
    case 'lilly_choco':        g.lilly_white = 1; g.choco      = 2; break;
    case 'cappuccino_azantic': g.cappuccino  = 1; g.azantic    = 2; break;
    case 'sable_azantic':      g.sable       = 1; g.azantic    = 2; break;
    case 'cappuccino_choco':   g.cappuccino  = 1; g.choco      = 2; break;
    case 'sable_choco':        g.sable       = 1; g.choco      = 2; break;
    case 'triple_combo':       g.lilly_white = 1; g.cappuccino = 1; g.sable = 1; break;
    case 'super_lilly_white':  g.lilly_white = 2; break;
    case 'super_cappuccino':   g.cappuccino  = 2; break;
    case 'super_sable':        g.sable       = 2; break;
  }
  return g;
}

function getLizardGenetics(lizard) {
  if (!lizard || lizard.type !== 'crestie') return null;
  return lizard.genetics || inferCrestieGenetics(lizard.morph || 'normal');
}

// Each parent contributes one allele; allele count per parent: 0/1/2 morph alleles
function crossCrestieGenetics(momG, dadG) {
  const childG = {};
  for (const locus of Object.keys(CRESTIE_MORPH_LOCI)) {
    const m = momG[locus] || 0;
    const d = dadG[locus] || 0;
    const momAllele = Math.random() < m / 2 ? 1 : 0;
    const dadAllele = Math.random() < d / 2 ? 1 : 0;
    childG[locus] = momAllele + dadAllele;
  }
  return childG;
}

// Determine visual morph name from genotype
function getCrestiePhenotype(g) {
  if (!g) return 'normal';
  const expressed = Object.entries(CRESTIE_MORPH_LOCI)
    .filter(([locus, type]) => {
      const cnt = g[locus] || 0;
      return type === 'codominant' ? cnt >= 1 : cnt >= 2;
    })
    .map(([locus]) => locus);

  if (expressed.length === 0) return 'normal';

  // Check combos (most specific first)
  for (const combo of CRESTIE_MORPH_COMBOS) {
    if (expressed.length === combo.loci.length && combo.loci.every(l => expressed.includes(l))) {
      return combo.name;
    }
  }

  if (expressed.length === 1) {
    const locus = expressed[0];
    // Homozygous co-dominant = super form (super_cappuccino is suppressed — treated as cappuccino)
    if (CRESTIE_MORPH_LOCI[locus] === 'codominant' && (g[locus] || 0) === 2) {
      if (locus === 'cappuccino') return 'cappuccino';
      return 'super_' + locus;
    }
    return locus;
  }

  return expressed.join('_');
}

// Build display label including het carrier status (for both crestie and BT)
function getMorphLabel(genetics, morph, type) {
  let baseMorph, label, hetParts = [];
  if (genetics && type === 'crestie') {
    baseMorph = getCrestiePhenotype(genetics);
    label = t('morph_' + baseMorph) || baseMorph;
    hetParts = Object.entries(CRESTIE_MORPH_LOCI)
      .filter(([locus, itype]) => itype === 'recessive' && (genetics[locus] || 0) === 1)
      .map(([locus]) => t('morph_' + locus) || locus);
  } else if (genetics && type === 'bluetongue') {
    baseMorph = getBtPhenotype(genetics, morph);
    label = t('morph_' + baseMorph) || baseMorph;
    hetParts = Object.entries(BT_MORPH_LOCI)
      .filter(([locus, itype]) => itype === 'recessive' && (genetics[locus] || 0) === 1)
      .map(([locus]) => t('morph_' + locus) || locus);
  } else {
    baseMorph = morph || 'normal';
    label = t('morph_' + baseMorph) || baseMorph;
  }
  if (hetParts.length > 0) label += ' het ' + hetParts.join(' ');
  return label;
}

// Offspring inherits each trait present in either parent with 50% probability
function deriveOffspringTraits(momTraits, dadTraits) {
  const all = [...new Set([...(momTraits || []), ...(dadTraits || [])])];
  return all.filter(() => Math.random() < 0.5);
}

function showDogramAdd() {
  if (AUTH.getAccountCoins() < ADOPT_COST) {
    showMsg(t('dogram_no_coins'));
    return;
  }
  document.getElementById('dogram-main-view').style.display = 'none';
  document.getElementById('dogram-add-view').style.display = '';
  document.getElementById('dogram-country-view').style.display = 'none';
  document.getElementById('dogram-morph-view').style.display = 'none';
  document.getElementById('dogram-bt-morph-view').style.display = 'none';
  document.getElementById('dogram-color-view').style.display = 'none';
  document.getElementById('dogram-trait-view').style.display = 'none';
  document.getElementById('dogram-add-title').textContent = t('dogram_add_title');
  document.getElementById('dogram-add-subtitle').textContent = t('dogram_add_subtitle');
  ['crestie', 'bluetongue'].forEach(type => {
    const id = type === 'crestie' ? 'btn-dogram-crestie' : 'btn-dogram-bt';
    const meta = SPECIES_META[type];
    const nameKey = type === 'crestie' ? 'egg_orange' : 'egg_blue';
    document.getElementById(id).innerHTML =
      `<div style="font-size:9px;margin-bottom:5px">${t(nameKey)}</div>` +
      `<div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap">` +
      `<span class="species-badge size-badge">${t('size_' + meta.size)}</span>` +
      `<span class="species-badge activity-badge">${t('activity_' + meta.activity)}</span>` +
      `</div>`;
  });
  document.getElementById('btn-dogram-back').textContent = t('dogram_back');
}

function pickNewLizardType(type) {
  if (AUTH.getAccountCoins() < ADOPT_COST) {
    showMsg(t('dogram_no_coins'));
    closeDogram();
    return;
  }
  newLizardType = type;
  newLizardMorph = null;
  newLizardColor = null;
  newLizardTraits = [];
  newLizardCountry = null;
  newLizardLocale = null;
  if (type === 'bluetongue') {
    showDogramCountry();
  } else {
    showDogramColorOrMorph();
  }
}

function showDogramCountry() {
  document.getElementById('dogram-add-view').style.display = 'none';
  document.getElementById('dogram-country-view').style.display = '';
  document.getElementById('dogram-morph-view').style.display = 'none';
  document.getElementById('dogram-bt-morph-view').style.display = 'none';
  document.getElementById('dogram-color-view').style.display = 'none';
  document.getElementById('dogram-trait-view').style.display = 'none';
  document.getElementById('dogram-main-view').style.display = 'none';
  document.getElementById('dogram-country-title').textContent = t('dogram_country_title');
  document.getElementById('dogram-country-subtitle').textContent = t('dogram_country_subtitle');
  document.getElementById('btn-dogram-country-back').textContent = t('dogram_back');

  const btns = document.getElementById('dogram-country-btns');
  btns.innerHTML = '';
  const makeBtn = (id, bg) => {
    const btn = document.createElement('button');
    btn.className = 'pixel-btn dogram-type-btn';
    btn.textContent = t('country_' + id);
    btn.style.background = bg;
    btn.style.color = '#fff';
    btn.onclick = () => pickNewLizardCountry(id);
    return btn;
  };
  btns.appendChild(makeBtn('australia', '#c87030'));
  btns.appendChild(makeBtn('indonesia', '#3a7a5a'));
}

function pickNewLizardCountry(country) {
  newLizardCountry = country;
  showDogramMorph();
}

function dogramMorphBack() {
  if (newLizardType === 'bluetongue') showDogramCountry();
  else showDogramAdd();
}

function showDogramMorph() {
  const allViews = ['dogram-add-view','dogram-country-view','dogram-bt-morph-view',
    'dogram-color-view','dogram-trait-view','dogram-main-view'];
  allViews.forEach(id => document.getElementById(id).style.display = 'none');
  document.getElementById('dogram-morph-view').style.display = '';
  const isBT = newLizardType === 'bluetongue';
  document.getElementById('dogram-morph-title').textContent = t(isBT ? 'dogram_locale_select_title' : 'dogram_morph_title');
  document.getElementById('dogram-morph-subtitle').textContent = t(isBT ? 'dogram_locale_subtitle' : 'dogram_morph_subtitle');
  document.getElementById('btn-dogram-morph-back').textContent = t('dogram_back');

  const btns = document.getElementById('dogram-morph-btns');
  btns.innerHTML = '';

  if (isBT) {
    const locales = BT_LOCALES_BY_COUNTRY[newLizardCountry] || [];
    locales.forEach(id => {
      const btn = document.createElement('button');
      btn.className = 'pixel-btn dogram-type-btn';
      btn.textContent = t('morph_' + id);
      btn.style.background = '#4a7a5a';
      btn.style.color = '#fff';
      btn.onclick = () => pickBtLocale(id);
      btns.appendChild(btn);
    });
  } else {
    const CRESTIE_MORPH_COLORS = {
      normal:      '#c07020',
      lilly_white: '#e8e0d0',
      cappuccino:  '#8b5e3c',
      sable:       '#5a5248',
      azantic:     '#7a8aaa',
    };
    (LIZARD_MORPHS[newLizardType] || []).forEach(id => {
      const bg = CRESTIE_MORPH_COLORS[id] || '#c07020';
      const btn = document.createElement('button');
      btn.className = 'pixel-btn dogram-type-btn';
      btn.textContent = t('morph_' + id);
      btn.style.background = bg;
      btn.style.color = id === 'lilly_white' ? '#3a2a10' : '#fff';
      btn.onclick = () => pickNewLizardMorph(id);
      btns.appendChild(btn);
    });
  }
}

function pickBtLocale(locale) {
  newLizardLocale = locale;
  showDogramBtMorph();
}

function showDogramBtMorph() {
  const allViews = ['dogram-add-view','dogram-country-view','dogram-morph-view',
    'dogram-color-view','dogram-trait-view','dogram-main-view'];
  allViews.forEach(id => document.getElementById(id).style.display = 'none');
  document.getElementById('dogram-bt-morph-view').style.display = '';
  document.getElementById('dogram-bt-morph-title').textContent = t('dogram_morph_title');
  document.getElementById('dogram-bt-morph-subtitle').textContent = t('dogram_bt_morph_subtitle');
  document.getElementById('btn-dogram-bt-morph-back').textContent = t('dogram_back');

  const btns = document.getElementById('dogram-bt-morph-btns');
  btns.innerHTML = '';

  const BT_MORPH_COLORS = {
    hypo:          '#d4a860',
    caramel:       '#c87830',
    leucistic:     '#e8e4d8',
    melanistic:    '#181810',
    patternless:   '#a89870',
    anerythristic: '#8a9090',
    albino:        '#dcd4b8',
    platinum:      '#b0b0a8',
    sunglow:       '#f0d060',
    snow:          '#e0e4e0',
    ajantics:      '#383848',
  };
  const BT_MORPH_LIGHT = ['patternless', 'albino', 'anerythristic', 'platinum', 'sunglow', 'snow', 'leucistic'];

  function makeBtMorphBtn(morph, bgColor, label, desc) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:3px;';
    const btn = document.createElement('button');
    btn.className = 'pixel-btn dogram-type-btn';
    btn.textContent = label;
    btn.style.background = bgColor;
    btn.style.color = BT_MORPH_LIGHT.includes(morph) ? '#3a2a10' : '#fff';
    btn.onclick = () => { newLizardMorph = morph; showDogramTrait(); };
    wrap.appendChild(btn);
    if (desc) {
      const d = document.createElement('div');
      d.textContent = desc;
      d.style.cssText = 'font-size:6px;color:#aaa;text-align:center;';
      wrap.appendChild(d);
    }
    return wrap;
  }

  // Normal (locale palette)
  if (newLizardLocale === 'halmahera') {
    btns.appendChild(makeBtMorphBtn('halmahera', '#4a3a18', t('halma_normal'), t('halma_normal_desc')));
    btns.appendChild(makeBtMorphBtn('ajantics',  '#383848', t('halma_ajantics'), t('halma_ajantics_desc')));
  } else {
    btns.appendChild(makeBtMorphBtn(newLizardLocale, '#4a7a5a', t('dogram_bt_morph_normal'), null));
    const morphs = BT_MORPHS_BY_COUNTRY[newLizardCountry] || [];
    morphs.forEach(id => {
      const bg = BT_MORPH_COLORS[id] || '#8a6020';
      btns.appendChild(makeBtMorphBtn(id, bg, t('morph_' + id), null));
    });
  }
}

function pickNewLizardMorph(morph) {
  newLizardMorph = morph;
  if (newLizardType === 'crestie') {
    showDogramColor();
  } else {
    showDogramTrait();
  }
}

function showDogramColor() {
  document.getElementById('dogram-morph-view').style.display = 'none';
  document.getElementById('dogram-bt-morph-view').style.display = 'none';
  document.getElementById('dogram-color-view').style.display = '';
  document.getElementById('dogram-trait-view').style.display = 'none';
  document.getElementById('dogram-main-view').style.display = 'none';
  document.getElementById('dogram-color-title').textContent = t('dogram_color_title');
  document.getElementById('dogram-color-subtitle').textContent = t('dogram_color_subtitle');
  document.getElementById('btn-dogram-color-back').textContent = t('dogram_back');

  const btns = document.getElementById('dogram-color-btns');
  btns.innerHTML = '';
  (LIZARD_COLORS[newLizardType] || []).forEach(color => {
    const btn = document.createElement('button');
    btn.className = 'pixel-btn dogram-type-btn';
    btn.textContent = t('color_' + color.id);
    btn.style.background = color.hex;
    btn.style.color = ['cream', 'yellow', 'olive'].includes(color.id) ? '#1a1a2e' : '#fff';
    btn.onclick = () => pickNewLizardColor(color.id);
    btns.appendChild(btn);
  });
}

function pickNewLizardColor(colorId) {
  newLizardColor = colorId;
  showDogramTrait();
}

function showDogramColorOrMorph() {
  if (newLizardType === 'bluetongue') showDogramBtMorph();
  else showDogramColor();
}

function tTrait(trait, lizardType) {
  const specificKey = 'trait_' + trait + '_' + lizardType;
  return (T[currentLang] && T[currentLang][specificKey]) || t('trait_' + trait);
}

function showDogramTrait() {
  document.getElementById('dogram-morph-view').style.display = 'none';
  document.getElementById('dogram-bt-morph-view').style.display = 'none';
  document.getElementById('dogram-color-view').style.display = 'none';
  document.getElementById('dogram-trait-view').style.display = '';
  document.getElementById('dogram-trait-title').textContent = t('dogram_trait_title');
  document.getElementById('dogram-trait-subtitle').textContent = t('dogram_trait_subtitle');
  document.getElementById('btn-dogram-trait-back').textContent = t('dogram_back');
  document.getElementById('btn-dogram-confirm-traits').textContent = t('dogram_confirm_traits');

  const btns = document.getElementById('dogram-trait-btns');
  btns.innerHTML = '';
  const traitList = newLizardType === 'bluetongue' ? (getBtTraits(newLizardCountry, newLizardMorph)) : LIZARD_TRAITS;
  traitList.forEach(trait => {
    const btn = document.createElement('button');
    btn.className = 'pixel-btn dogram-type-btn';
    btn.id = 'trait-btn-' + trait;
    btn.textContent = tTrait(trait, newLizardType);
    btn.style.background = '#2a2a4a';
    btn.style.color = '#8888cc';
    btn.onclick = () => toggleLizardTrait(trait);
    btns.appendChild(btn);
  });
}

function toggleLizardTrait(trait) {
  const idx = newLizardTraits.indexOf(trait);
  if (idx >= 0) newLizardTraits.splice(idx, 1);
  else newLizardTraits.push(trait);
  const traitList = newLizardType === 'bluetongue' ? (getBtTraits(newLizardCountry, newLizardMorph)) : LIZARD_TRAITS;
  traitList.forEach(tr => {
    const btn = document.getElementById('trait-btn-' + tr);
    if (!btn) return;
    const selected = newLizardTraits.includes(tr);
    btn.style.background = selected ? '#6a3a8a' : '#2a2a4a';
    btn.style.color = selected ? '#e0c0ff' : '#8888cc';
  });
}

function confirmNewLizardTraits() {
  if (AUTH.getAccountCoins() < ADOPT_COST) {
    showMsg(t('dogram_no_coins'));
    closeDogram();
    return;
  }
  AUTH.saveAccountCoins(AUTH.getAccountCoins() - ADOPT_COST);
  closeDogram();
  document.getElementById('name-modal').style.display = 'flex';
  document.getElementById('modal-title').textContent = t('name_title');
  document.getElementById('modal-prompt').textContent = t('name_prompt');
  document.getElementById('lizard-name-input').value = '';
  document.getElementById('lizard-name-input').placeholder = t('name_placeholder');
  document.getElementById('modal-confirm').textContent = t('name_btn');
}

function switchToLizard(idx) {
  if (idx < 0 || idx >= allLizards.length) return;
  // Save current lizard
  if (gs) {
    gs.scene = scene;
    gs.type = lizardType;
    gs.lizardName = lizardName;
    allLizards[activeLizardIdx] = { ...gs };
  }
  // Switch
  activeLizardIdx = idx;
  gs = { ...newGameState('crestie'), ...allLizards[idx] };
  // Reset animations for new lizard
  bornAnim = { phase: 0, timer: 0 };
  lizardAnim = { frame: 0, timer: 0, threatening: true, threatTimer: 300 };
  eatAnim = { active: false, timer: 0, type: null };
  lizardName = gs.lizardName || '';
  lizardType = gs.type || null;
  scene = gs.scene || SCENE.ROOM;
  updateGameTime();
  AUTH.saveAllLizards(allLizards, activeLizardIdx);
  closeDogram();
  // Update UI
  const uiOverlay = document.getElementById('ui-overlay');
  const dateDisplay = document.getElementById('date-display');
  if (scene === SCENE.ROOM && gs) {
    dateDisplay.style.display = 'block';
    uiOverlay.style.display = gs.bornAnim ? 'flex' : 'none';
    if (gs.bornAnim) lizardAnim.threatening = gs.bond < 40;
    updateTimeDisplay();
  } else {
    uiOverlay.style.display = 'none';
    dateDisplay.style.display = 'none';
  }
  updateGameLabels();
}

let _sellTargetIdx = null;

function calcSellPrice(lizardGs) {
  let price = 10; // base
  // Rare morphs give bonus
  const rareMorphs = ['lilly_white', 'azantic', 'sable', 'cappuccino', 'hypo', 'caramel', 'leucistic', 'melanistic', 'anerythristic', 'albino', 'lava', 'platinum', 'sunglow', 'snow'];
  if (lizardGs.morph && rareMorphs.includes(lizardGs.morph)) price += 10;
  // Traits bonus
  if (lizardGs.traits && lizardGs.traits.length > 0) price += lizardGs.traits.length * 5;
  // Age bonus
  if (lizardGs.isAdult) price += 15;
  else if ((lizardGs.gameDaysPassed || 0) >= 270) price += 8;
  else if ((lizardGs.gameDaysPassed || 0) >= 90) price += 4;
  // Bond bonus
  if ((lizardGs.bond || 0) >= 80) price += 5;
  return price;
}

function showSellConfirm(idx) {
  if (allLizards.length <= 1) {
    showMsg(t('dogram_sell_only_one'));
    return;
  }
  _sellTargetIdx = idx;
  const lizardGs = allLizards[idx];
  const price = calcSellPrice(lizardGs);
  const name = lizardGs.lizardName || '???';

  // Hide all views, show sell view
  document.getElementById('dogram-main-view').style.display = 'none';
  document.getElementById('dogram-add-view').style.display = 'none';
  document.getElementById('dogram-country-view').style.display = 'none';
  document.getElementById('dogram-morph-view').style.display = 'none';
  document.getElementById('dogram-bt-morph-view').style.display = 'none';
  document.getElementById('dogram-color-view').style.display = 'none';
  document.getElementById('dogram-trait-view').style.display = 'none';
  document.getElementById('dogram-sell-view').style.display = '';

  document.getElementById('dogram-sell-title').textContent = t('dogram_sell_confirm_title');
  document.getElementById('dogram-sell-msg').textContent =
    t('dogram_sell_confirm_msg').replace('{name}', name).replace('{price}', price);
  document.getElementById('btn-sell-cancel').textContent = t('dogram_sell_cancel');
  document.getElementById('btn-sell-confirm').textContent = t('dogram_sell_confirm');

  // Mini lizard preview
  const wrap = document.getElementById('dogram-sell-mini-wrap');
  wrap.innerHTML = '';
  const mini = document.createElement('canvas');
  mini.width = 120; mini.height = 80;
  mini.className = 'dogram-mini-canvas';
  wrap.appendChild(mini);
  renderMiniLizard(mini, lizardGs);
}

function doSellLizard() {
  if (_sellTargetIdx === null) return;
  const idx = _sellTargetIdx;
  _sellTargetIdx = null;
  if (allLizards.length <= 1) {
    showMsg(t('dogram_sell_only_one'));
    showDogramMain();
    return;
  }
  const lizardGs = allLizards[idx];
  const price = calcSellPrice(lizardGs);
  const name = lizardGs.lizardName || '???';

  // Adjust active index before splice
  const wasActive = activeLizardIdx === idx;
  let newActive = activeLizardIdx;
  if (wasActive) {
    // Switch to next lizard (or previous if sold was last)
    newActive = idx < allLizards.length - 1 ? idx : idx - 1;
  } else if (activeLizardIdx > idx) {
    newActive = activeLizardIdx - 1;
  }

  // Remove lizard from list
  allLizards.splice(idx, 1);
  activeLizardIdx = Math.max(0, Math.min(newActive, allLizards.length - 1));

  // Load newly active lizard
  gs = { ...newGameState('crestie'), ...allLizards[activeLizardIdx] };
  lizardName = gs.lizardName || '';
  lizardType = gs.type || null;
  scene = gs.scene || SCENE.ROOM;
  updateGameTime();

  AUTH.saveAllLizards(allLizards, activeLizardIdx);
  AUTH.saveAccountCoins(AUTH.getAccountCoins() + price);

  closeDogram();
  showMsg(t('dogram_sell_ok').replace('{name}', name).replace('{price}', price));

  // Update UI for newly active lizard
  const uiOverlay = document.getElementById('ui-overlay');
  const dateDisplay = document.getElementById('date-display');
  if (scene === SCENE.ROOM && gs) {
    dateDisplay.style.display = 'block';
    uiOverlay.style.display = gs.bornAnim ? 'flex' : 'none';
  } else {
    uiOverlay.style.display = 'none';
    dateDisplay.style.display = 'none';
  }
  updateGameLabels();
}

// ─── REHOME (분양) ────────────────────────────────────────────────────────────
function doRehome() {
  if (!gs || !gs.bornAnim) return;
  const name = lizardName || '???';
  document.getElementById('rehome-msg').textContent = t('rehome_confirm_msg').replace('{name}', name);
  document.getElementById('rehome-modal').style.display = 'flex';
}

function cancelRehome() {
  document.getElementById('rehome-modal').style.display = 'none';
}

function confirmRehome() {
  document.getElementById('rehome-modal').style.display = 'none';
  const name = lizardName || '???';

  // Start handover animation — actual removal happens in _finalizeRehome()
  rehomeAnimState = { phase: 0, timer: 0, lizardGs: { ...gs }, name };

  scene = SCENE.SHOP;
  document.getElementById('ui-overlay').style.display = 'none';
  document.getElementById('date-display').style.display = 'none';
  document.getElementById('time-display').style.display = 'none';
  updateDogramButton();
}

function _finalizeRehome() {
  const ras = rehomeAnimState;
  rehomeAnimState = null;
  const name = ras.name;

  // Remove lizard from list
  allLizards.splice(activeLizardIdx, 1);
  if (activeLizardIdx >= allLizards.length && allLizards.length > 0) {
    activeLizardIdx = allLizards.length - 1;
  }

  gs = null;
  lizardType = null;
  lizardName = '';
  // scene stays SCENE.SHOP

  AUTH.saveAllLizards(allLizards, Math.max(0, activeLizardIdx));
  updateDogramButton();
  showMsg(t('rehome_ok').replace('{name}', name), 3000);
}

function renderDogram() {
  const grid = document.getElementById('dogram-grid');
  grid.innerHTML = '';
  document.getElementById('dogram-title').textContent = t('dogram_title');
  document.getElementById('btn-add-lizard').textContent = t('dogram_add');

  allLizards.forEach((lizardGs, idx) => {
    const isActive = idx === activeLizardIdx;
    const card = document.createElement('div');
    card.className = 'dogram-card' + (isActive ? ' dogram-card-active' : '');

    // Mini canvas
    const miniCanvas = document.createElement('canvas');
    miniCanvas.width = 120;
    miniCanvas.height = 80;
    miniCanvas.className = 'dogram-mini-canvas';
    card.appendChild(miniCanvas);

    // Info section
    const info = document.createElement('div');
    info.className = 'dogram-card-info';
    const lizName = lizardGs.lizardName || '???';
    const lizType = lizardGs.type === 'crestie' ? t('type_crestie') : t('type_bt');
    const days = lizardGs.gameDaysPassed || 0;
    let stage = t('age_baby');
    if (lizardGs.isAdult) stage = t('age_adult');
    else if (days >= 270) stage = t('age_juvenile');
    else if (days >= 90) stage = t('age_subadult');
    const genderText = (lizardGs.gender && days >= 270)
      ? (lizardGs.gender === 'female' ? ' ♀' : ' ♂') : '';
    const morphText = getMorphLabel(lizardGs.type === 'bluetongue' ? lizardGs.btGenetics : lizardGs.genetics, lizardGs.morph, lizardGs.type);
    const colorText = lizardGs.color ? t('color_' + lizardGs.color) : '';
    const traitsText = (lizardGs.traits && lizardGs.traits.length > 0)
      ? lizardGs.traits.map(tr => tTrait(tr, lizardGs.type)).join(' · ')
      : '';
    const morphColorLine = [morphText, colorText].filter(Boolean).join(' · ');
    info.innerHTML =
      `<div class="dogram-card-name">${lizName}${genderText}</div>` +
      `<div class="dogram-card-type">${lizType}${morphColorLine ? ' · ' + morphColorLine : ''}</div>` +
      (traitsText ? `<div class="dogram-card-trait">${traitsText}</div>` : '') +
      `<div class="dogram-card-age">${stage} · ${days}${t('days_format')}</div>`;
    card.appendChild(info);

    // Button row
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:center;';

    const hasSell = allLizards.length > 1;

    // Enter button
    const btn = document.createElement('button');
    btn.className = 'pixel-btn small dogram-enter-btn';
    if (hasSell) btn.style.width = 'auto';
    if (isActive) {
      btn.textContent = t('dogram_current');
      btn.style.background = '#4ad94a';
      btn.style.color = '#1a1a2e';
    } else {
      btn.textContent = t('dogram_enter');
    }
    btn.onclick = () => switchToLizard(idx);
    btnRow.appendChild(btn);

    // Rehome button — only shown when there are multiple lizards
    if (hasSell) {
      const sellBtn = document.createElement('button');
      sellBtn.className = 'pixel-btn small';
      sellBtn.textContent = t('dogram_sell_btn') + ' (' + calcSellPrice(lizardGs) + ')';
      sellBtn.style.cssText = 'background:#7a2020;color:#ffb0b0;';
      sellBtn.onclick = () => showSellConfirm(idx);
      btnRow.appendChild(sellBtn);
    }

    card.appendChild(btnRow);

    grid.appendChild(card);
    renderMiniLizard(miniCanvas, lizardGs);
  });
}

function renderMiniLizard(miniCanvas, lizardGs) {
  const type = (lizardGs && lizardGs.type) || 'crestie';
  const appearance = lizardGs ? { morph: lizardGs.morph, color: lizardGs.color, traits: lizardGs.traits } : {};
  const savedCtx = ctx;
  ctx = miniCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const W = miniCanvas.width, H = miniCanvas.height;
  // Background
  ctx.fillStyle = type === 'crestie' ? '#2a1808' : '#0a1a14';
  ctx.fillRect(0, 0, W, H);
  // Mini floor
  ctx.fillStyle = type === 'crestie' ? '#3a2510' : '#1a2a1a';
  ctx.fillRect(0, Math.floor(H * 0.72), W, Math.ceil(H * 0.28));
  ctx.save();
  const sc = 0.48;
  const mockAnim = { frame: 0, timer: 0, threatening: false, sleeping: false };
  if (type === 'crestie') {
    ctx.translate(W/2 - 22*sc, H*0.55 - 15*sc);
    ctx.scale(sc, sc);
    drawCrestie(0, 0, mockAnim, appearance);
  } else {
    ctx.translate(W/2 - 34*sc, H*0.55 - 8*sc);
    ctx.scale(sc, sc);
    drawBluetongue(0, 0, mockAnim, appearance);
  }
  ctx.restore();
  ctx = savedCtx;
}

// ─── INCUBATOR ────────────────────────────────────────────────────────────────
const BASE_HATCH_MS = {
  crestie: 70 * 13 * 60 * 1000,  // 70 game days base (22°C→~74d, 25°C→~62d)
  bluetongue: 1 * 13 * 60 * 1000 // 1 game day (viviparous live birth — immediate collect)
};
// Humidity decreases 1% per 20 real minutes
const HUMID_DECREASE_MS = 20 * 60 * 1000;

function getCurrentHumid(egg) {
  const stored = egg.humid !== undefined ? egg.humid : 70;
  const lastUpdate = egg.lastHumidUpdate || egg.placedRealTime;
  const elapsed = Date.now() - lastUpdate;
  return Math.max(0, stored - elapsed / HUMID_DECREASE_MS);
}

function getEffectiveHatchMs(egg) {
  const base = BASE_HATCH_MS[egg.type] || BASE_HATCH_MS.crestie;
  // Optimal temp 23°C; ±6% per degree (range 22~25°C → ~62~74 game days)
  const tempDiff = (egg.temp || 23) - 23;
  let ms = Math.round(base * (1 - tempDiff * 0.06));
  // Humidity penalty: below 60% slows hatching by 30%
  if (getCurrentHumid(egg) < 60) ms = Math.round(ms * 1.3);
  return ms;
}

function updateIncubatorUI() {
  drawFarmIncubatorCanvas();
  const eggs = AUTH.getIncubator();
  const now = Date.now();

  // --- Collect zone: lizards with eggs/pups ready ---
  const collectZone = document.getElementById('incubator-collect-zone');
  collectZone.innerHTML = '';
  const readyLizards = allLizards.map((l, i) => ({ l, i })).filter(({ l }) => l.hasEgg);
  if (readyLizards.length > 0) {
    readyLizards.forEach(({ l, i }) => {
      const isCrestie = l.type === 'crestie';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding:6px;background:#0d1a0d;border:2px solid #2a5a2a;';
      const label = document.createElement('span');
      label.style.cssText = 'font-size:7px;color:#c8f0c8;';
      if (isCrestie) {
        const nextCount = (l.fertilizedEggLayCount || 0) + 1;
        label.textContent = (currentLang === 'ko')
          ? `${l.lizardName || '???'}의 알 🥚×2 (${nextCount}/6번째)`
          : `${l.lizardName || '???'}'s eggs 🥚×2 (clutch ${nextCount}/6)`;
      } else {
        label.textContent = (currentLang === 'ko')
          ? `${l.lizardName || '???'}의 새끼 🦎`
          : `${l.lizardName || '???'}'s pup 🦎`;
      }
      const btn = document.createElement('button');
      btn.className = 'pixel-btn small';
      btn.style.cssText = 'background:#d94a7a;color:#fff;';
      btn.textContent = t('incubator_collect_btn');
      btn.onclick = () => collectEgg(i);
      row.appendChild(label);
      row.appendChild(btn);
      collectZone.appendChild(row);
    });
    const hdr = document.createElement('p');
    hdr.className = 'farm-info';
    hdr.style.cssText = 'color:#d94a7a;margin-bottom:6px;';
    hdr.textContent = t('incubator_collect_title');
    collectZone.insertBefore(hdr, collectZone.firstChild);
  }
  // Unfertilized eggs from juvenile cresties
  const unfertilizedLizards = allLizards.map((l, i) => ({ l, i })).filter(({ l }) => l.hasUnfertilizedEgg);
  if (unfertilizedLizards.length > 0) {
    if (readyLizards.length === 0) {
      const hdr = document.createElement('p');
      hdr.className = 'farm-info';
      hdr.style.cssText = 'color:#d94a7a;margin-bottom:6px;';
      hdr.textContent = t('incubator_collect_title');
      collectZone.appendChild(hdr);
    }
    unfertilizedLizards.forEach(({ l, i }) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding:6px;background:#1a0d0d;border:2px solid #5a2a2a;';
      const label = document.createElement('span');
      label.style.cssText = 'font-size:7px;color:#f0c8c8;';
      label.textContent = (currentLang === 'ko')
        ? `${l.lizardName || '???'}의 무정란 🥚×2 (+2코인)`
        : `${l.lizardName || '???'}'s unfertilized eggs 🥚×2 (+2 coins)`;
      const btn = document.createElement('button');
      btn.className = 'pixel-btn small';
      btn.style.cssText = 'background:#a04040;color:#fff;';
      btn.textContent = t('unfertilized_egg_collect_btn');
      btn.onclick = () => collectUnfertilizedEgg(i);
      row.appendChild(label);
      row.appendChild(btn);
      collectZone.appendChild(row);
    });
  }
  document.getElementById('incubator-collect-divider').style.display = (readyLizards.length > 0 || unfertilizedLizards.length > 0) ? '' : 'none';

  // --- Incubating eggs list ---
  const list = document.getElementById('incubator-eggs-list');
  list.innerHTML = '';
  const emptyMsg = document.getElementById('incubator-empty-msg');

  if (eggs.length === 0 && readyLizards.length === 0) {
    emptyMsg.style.display = '';
    emptyMsg.textContent = t('incubator_empty');
    return;
  }
  emptyMsg.style.display = 'none';

  if (eggs.length === 0) return;

  const hdr2 = document.createElement('p');
  hdr2.className = 'farm-info';
  hdr2.style.cssText = 'color:#aaa;margin-bottom:8px;';
  hdr2.textContent = t('incubator_title');
  list.appendChild(hdr2);

  eggs.forEach(egg => {
    const effective = getEffectiveHatchMs(egg);
    const elapsed = now - egg.placedRealTime;
    const progress = Math.min(1, elapsed / effective);
    const isReady = progress >= 1;
    const remainSec = Math.max(0, Math.ceil((effective - elapsed) / 1000));
    const remainMin = Math.floor(remainSec / 60);
    const remainHr = Math.floor(remainMin / 60);
    const remainStr = remainHr > 0
      ? (currentLang === 'ko' ? `${remainHr}시간 ${remainMin % 60}분` : `${remainHr}h ${remainMin % 60}m`)
      : (currentLang === 'ko' ? `${remainMin}분 ${remainSec % 60}초` : `${remainMin}m ${remainSec % 60}s`);

    const isCrestie = egg.type === 'crestie';
    const typeColor = isCrestie ? '#e87820' : '#5a8a6a';
    const card = document.createElement('div');
    card.style.cssText = `margin-bottom:10px;padding:8px;background:#0a0a1a;border:2px solid ${typeColor};`;

    // Header row
    const headRow = document.createElement('div');
    headRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';
    const titleSpan = document.createElement('span');
    titleSpan.style.cssText = `font-size:7px;color:${typeColor};`;
    const typeName = isCrestie ? t('type_crestie') : t('type_bt');
    const morphStr = getMorphLabel(egg.type === 'bluetongue' ? egg.btGenetics : egg.genetics, egg.morph, egg.type);
    titleSpan.textContent = `${typeName}${morphStr ? ' · ' + morphStr : ''}`;
    const parentSpan = document.createElement('span');
    parentSpan.style.cssText = 'font-size:7px;color:#888;';
    parentSpan.textContent = (currentLang === 'ko' ? '♀ ' : '♀ ') + (egg.parentName || '???');
    headRow.appendChild(titleSpan);
    headRow.appendChild(parentSpan);
    card.appendChild(headRow);

    // Progress bar
    const pbWrap = document.createElement('div');
    pbWrap.style.cssText = 'background:#1a1a2e;border:2px solid #333;height:10px;border-radius:3px;overflow:hidden;margin-bottom:4px;';
    const pbFill = document.createElement('div');
    pbFill.style.cssText = `height:100%;width:${Math.round(progress * 100)}%;background:${isReady ? '#4adb4a' : typeColor};transition:width 0.3s;`;
    pbWrap.appendChild(pbFill);
    card.appendChild(pbWrap);

    // Status row
    const statusRow = document.createElement('div');
    statusRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';
    const statusSpan = document.createElement('span');
    statusSpan.style.cssText = `font-size:7px;color:${isReady ? '#4adb4a' : '#aaa'};`;
    statusSpan.textContent = isReady ? t('incubator_ready') : (t('incubator_progress').replace('{r}', remainStr));
    const pctSpan = document.createElement('span');
    pctSpan.style.cssText = 'font-size:7px;color:#888;';
    pctSpan.textContent = Math.round(progress * 100) + '%';
    statusRow.appendChild(statusSpan);
    statusRow.appendChild(pctSpan);
    card.appendChild(statusRow);

    // Temp control row (22~25°C)
    const curTemp = egg.temp || 23;
    const tempRow = document.createElement('div');
    tempRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
    const tempLabel = document.createElement('span');
    tempLabel.style.cssText = 'font-size:7px;color:#aaa;flex:1;';
    tempLabel.textContent = t('incubator_temp_label') + ': ' + curTemp + '°C';
    const btnMinus = document.createElement('button');
    btnMinus.className = 'pixel-btn small';
    btnMinus.style.cssText = 'padding:3px 8px;font-size:8px;background:#333;color:#aaa;';
    btnMinus.textContent = '-';
    btnMinus.disabled = curTemp <= 22;
    btnMinus.onclick = () => setEggTemp(egg.id, -1);
    const btnPlus = document.createElement('button');
    btnPlus.className = 'pixel-btn small';
    btnPlus.style.cssText = 'padding:3px 8px;font-size:8px;background:#333;color:#aaa;';
    btnPlus.textContent = '+';
    btnPlus.disabled = curTemp >= 25;
    btnPlus.onclick = () => setEggTemp(egg.id, +1);
    tempRow.appendChild(tempLabel);
    tempRow.appendChild(btnMinus);
    tempRow.appendChild(btnPlus);
    card.appendChild(tempRow);

    // Humidity control row (60~80%)
    const curHumid = Math.round(getCurrentHumid(egg));
    const humidOk = curHumid >= 60 && curHumid <= 80;
    const humidRow = document.createElement('div');
    humidRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
    const humidLabel = document.createElement('span');
    humidLabel.style.cssText = `font-size:7px;color:${humidOk ? '#aaa' : '#f55'};flex:1;`;
    humidLabel.textContent = t('incubator_humid_label') + ': ' + curHumid + '%' + (humidOk ? '' : ' ⚠');
    const mistBtn = document.createElement('button');
    mistBtn.className = 'pixel-btn small';
    mistBtn.style.cssText = 'padding:3px 8px;font-size:8px;background:#1a4a6a;color:#7cf;';
    mistBtn.textContent = t('incubator_mist_btn') + ' 💧';
    mistBtn.disabled = curHumid >= 80;
    mistBtn.onclick = () => mistEgg(egg.id);
    humidRow.appendChild(humidLabel);
    humidRow.appendChild(mistBtn);
    card.appendChild(humidRow);

    if (!humidOk) {
      const humidWarn = document.createElement('div');
      humidWarn.style.cssText = 'font-size:7px;color:#f55;margin-bottom:4px;';
      humidWarn.textContent = curHumid < 60 ? t('incubator_humid_low') : t('incubator_humid_range');
      card.appendChild(humidWarn);
    }

    // Hatch button
    const hatchBtn = document.createElement('button');
    hatchBtn.className = 'pixel-btn small' + (isReady ? ' green' : '');
    hatchBtn.style.cssText = 'width:100%;' + (isReady ? '' : 'opacity:0.5;cursor:not-allowed;');
    hatchBtn.textContent = t('incubator_hatch_btn');
    hatchBtn.disabled = !isReady;
    hatchBtn.onclick = () => hatchEgg(egg.id);
    card.appendChild(hatchBtn);

    list.appendChild(card);
  });
}

function collectEgg(lizardIdx) {
  const lizard = allLizards[lizardIdx];
  if (!lizard || !lizard.hasEgg) return;
  const eggs = AUTH.getIncubator();
  const isCrestie = lizard.type === 'crestie';
  const now = Date.now();

  // Determine offspring genetics by crossing mother × partner
  let eggGenetics   = null;
  let eggBtGenetics = null;
  let eggBtLocale   = null;
  let eggMorph      = lizard.morph || 'normal';
  let eggTraits     = lizard.traits ? [...lizard.traits] : [];
  if (lizard.type === 'crestie') {
    const momG = getLizardGenetics(lizard);
    const dadG = lizard.matingPartnerGenetics || inferCrestieGenetics('normal');
    eggGenetics = crossCrestieGenetics(momG, dadG);
    eggMorph    = getCrestiePhenotype(eggGenetics);
    eggTraits   = deriveOffspringTraits(lizard.traits, lizard.matingPartnerTraits);
  } else {
    // BT: cross mutation morph genetics and randomly inherit locale
    const momBtG   = getBtLizardGenetics(lizard);
    const dadBtG   = lizard.matingPartnerBtGenetics || inferBtGenetics('normal');
    eggBtGenetics  = crossBtGenetics(momBtG, dadBtG);
    const momLocale = BT_LOCALE_SET.has(lizard.morph) ? lizard.morph : (lizard.btLocale || 'northern');
    const dadLocale = lizard.matingPartnerBtLocale || 'northern';
    eggBtLocale    = Math.random() < 0.5 ? momLocale : dadLocale;
    eggMorph       = getBtPhenotype(eggBtGenetics, eggBtLocale);
    eggTraits      = deriveOffspringTraits(lizard.traits, lizard.matingPartnerTraits);
  }

  const eggBase = {
    type: lizard.type,
    morph: eggMorph,
    genetics: eggGenetics,
    btGenetics: eggBtGenetics,
    btLocale: eggBtLocale,
    color: lizard.color || null,
    traits: eggTraits,
    country: lizard.country || null,
    parentName: lizard.lizardName || '???',
    placedRealTime: now,
    temp: 23,
    humid: 70,
    lastHumidUpdate: now,
  };
  // Cresties lay 2 eggs per clutch; BTs lay 1 pup
  eggs.push({ ...eggBase, id: now + Math.floor(Math.random() * 1000) });
  if (isCrestie) {
    eggs.push({ ...eggBase, id: now + Math.floor(Math.random() * 1000) + 500 });
  }
  AUTH.saveIncubator(eggs);

  lizard.hasEgg = false;
  lizard.lastEggLayDay = lizard.gameDaysPassed;
  lizard.eggNotified = false;

  // Track fertilized clutch count for cresties; reset cycle after 6 clutches
  if (isCrestie) {
    lizard.fertilizedEggLayCount = (lizard.fertilizedEggLayCount || 0) + 1;
    lizard.lastFertilizedEggLayDay = lizard.gameDaysPassed;
    if (lizard.fertilizedEggLayCount >= 6) {
      lizard.lastMatingDay = null;
      lizard.fertilizedEggLayCount = 0;
      lizard.lastFertilizedEggLayDay = null;
    }
  }

  allLizards[lizardIdx] = lizard;
  if (lizardIdx === activeLizardIdx) {
    gs.hasEgg = false;
    gs.lastEggLayDay = gs.gameDaysPassed;
    gs.eggNotified = false;
    gs.fertilizedEggLayCount = lizard.fertilizedEggLayCount;
    gs.lastFertilizedEggLayDay = lizard.lastFertilizedEggLayDay;
    gs.lastMatingDay = lizard.lastMatingDay;
  }
  AUTH.saveAllLizards(allLizards, activeLizardIdx);
  showMsg(t(isCrestie ? 'incubator_egg_collected' : 'incubator_pup_collected'));
  updateIncubatorUI();
}

function collectUnfertilizedEgg(lizardIdx) {
  const lizard = allLizards[lizardIdx];
  if (!lizard || !lizard.hasUnfertilizedEgg) return;
  const reward = 2; // 2 unfertilized eggs × 1 coin each
  AUTH.saveAccountCoins(AUTH.getAccountCoins() + reward);
  lizard.hasUnfertilizedEgg = false;
  lizard.lastUnfertilizedEggLayDay = lizard.gameDaysPassed;
  lizard.unfertilizedEggNotified = false;
  allLizards[lizardIdx] = lizard;
  if (lizardIdx === activeLizardIdx) {
    gs.hasUnfertilizedEgg = false;
    gs.lastUnfertilizedEggLayDay = gs.gameDaysPassed;
    gs.unfertilizedEggNotified = false;
  }
  AUTH.saveAllLizards(allLizards, activeLizardIdx);
  showMsg(t('unfertilized_egg_collected'), 4000);
  updateIncubatorUI();
  updateFarmUI();
}

function setEggTemp(eggId, delta) {
  const eggs = AUTH.getIncubator();
  const egg = eggs.find(e => e.id === eggId);
  if (!egg) return;
  egg.temp = Math.max(22, Math.min(25, (egg.temp || 23) + delta));
  AUTH.saveIncubator(eggs);
  updateIncubatorUI();
}

function mistEgg(eggId) {
  const eggs = AUTH.getIncubator();
  const egg = eggs.find(e => e.id === eggId);
  if (!egg) return;
  const current = getCurrentHumid(egg);
  egg.humid = Math.min(80, current + 10);
  egg.lastHumidUpdate = Date.now();
  AUTH.saveIncubator(eggs);
  updateIncubatorUI();
}

function hatchEgg(eggId) {
  const eggs = AUTH.getIncubator();
  const egg = eggs.find(e => e.id === eggId);
  if (!egg) return;
  const elapsed = Date.now() - egg.placedRealTime;
  if (elapsed < getEffectiveHatchMs(egg)) { showMsg(t('incubator_not_ready')); return; }
  hatchingEggId = eggId;
  closeFarm();
  document.getElementById('modal-title').textContent = t('incubator_hatch_name_title');
  document.getElementById('modal-prompt').textContent = t('incubator_hatch_name_prompt');
  document.getElementById('lizard-name-input').value = '';
  document.getElementById('lizard-name-input').placeholder = t('name_placeholder');
  document.getElementById('modal-confirm').textContent = t('name_btn');
  document.getElementById('name-modal').style.display = 'flex';
}

function finishHatchEgg(name) {
  const eggs = AUTH.getIncubator();
  const eggIdx = eggs.findIndex(e => e.id === hatchingEggId);
  hatchingEggId = null;
  if (eggIdx < 0) return;
  const egg = eggs[eggIdx];
  eggs.splice(eggIdx, 1);
  AUTH.saveIncubator(eggs);
  // Save current lizard
  if (gs) {
    gs.scene = scene;
    gs.type = lizardType;
    gs.lizardName = lizardName;
    allLizards[activeLizardIdx] = { ...gs };
  }
  // Create new lizard from egg
  const newGs = newGameState(egg.type);
  newGs.lizardName = name;
  newGs.morph = egg.morph || 'normal';
  if (egg.genetics)   newGs.genetics   = egg.genetics;
  if (egg.btGenetics) newGs.btGenetics = egg.btGenetics;
  if (egg.btLocale)   newGs.btLocale   = egg.btLocale;
  if (egg.color) newGs.color = egg.color;
  if (egg.traits && egg.traits.length > 0) newGs.traits = [...egg.traits];
  if (egg.country) newGs.country = egg.country;
  newGs.scene = SCENE.ROOM;
  newGs.startRealTime = Date.now();
  newGs.lastGameDayRealTime = Date.now();
  allLizards.push({ ...newGs });
  activeLizardIdx = allLizards.length - 1;
  gs = newGs;
  lizardType = newGs.type;
  lizardName = name;
  scene = SCENE.ROOM;
  bornAnim = { phase: 0, timer: 0 };
  AUTH.saveAllLizards(allLizards, activeLizardIdx);
  document.getElementById('date-display').style.display = 'block';
  document.getElementById('ui-overlay').style.display = 'none';
  updateDogramButton();
  updateGameLabels();
  showMsg(t('incubator_hatched').replace('{name}', name), 5000);
}
