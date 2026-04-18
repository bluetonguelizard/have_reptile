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
let outdoorState = null; // { dandelions: [{x,y,picked}], gathered: 0 }
let hatchingEggId = null; // egg id being named after hatch

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
function isSleepyHour() { const h = new Date().getHours(); return h >= 0 && h < 6; }
function isWakeHour()   { const h = new Date().getHours(); return h >= 6 && h < 24; }

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

function drawShopkeeper(x, y) {
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
  // Arms
  px(x, y+9*s, 3*s, 8*s, '#f5c88a');
  px(x+13*s, y+9*s, 3*s, 8*s, '#f5c88a');
  // Legs
  px(x+4*s, y+20*s, 4*s, 6*s, '#2a3a5a');
  px(x+8*s, y+20*s, 4*s, 6*s, '#2a3a5a');
  // Speech bubble
  const bx = x + 70, by = y - 30;
  px(bx, by, 130, 28, C.white);
  px(bx-2, by-2, 134, 32, C.black);
  px(bx, by, 130, 28, C.white);
  px(bx+12, by+28, 10, 8, C.white);
  ctx.font = "7px 'Press Start 2P', Galmuri11, monospace";
  ctx.fillStyle = '#1a1a1a';
  ctx.fillText(currentLang === 'ko' ? '알을 고르세요!' : 'Choose an egg!', bx+6, by+18);
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
let introTimer = 0;
let introShown = false;

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

  // Born animation
  if (!gs.bornAnim) {
    drawBornAnim(W/2, H*0.38);
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
    sleepBtn.style.display = isSleepyHour() ? '' : 'none';
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
  gs.handleCountToday++;
  const bondGain = gs.bond < 30 ? 3 : (gs.bond < 60 ? 5 : 7);
  gs.bond = Math.min(100, gs.bond + bondGain);
  gs.happy = Math.min(100, gs.happy + 8);
  if (gs.bond > 40) lizardAnim.threatening = false;
  showMsg(t('handle_ok') + bondGain);
  saveGame();
  // Animate
  lizardAnim.threatening = gs.bond < 40;
  setTimeout(() => { lizardAnim.threatening = false; }, 1500);
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
  const partners = allLizards
    .map((l, i) => ({ l, i }))
    .filter(({ l, i }) =>
      i !== activeLizardIdx &&
      l.type === gs.type &&
      l.isAdult &&
      l.gender && gs.gender &&
      l.gender !== gs.gender
    );

  const list = document.getElementById('companion-list');
  const noMsg = document.getElementById('companion-no-partners');
  list.innerHTML = '';

  if (partners.length === 0) {
    noMsg.style.display = '';
    noMsg.textContent = t('companion_no_partners');
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
      const morphText = l.morph ? t('morph_' + l.morph) : '';
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
        } else if (partner && partner.gender === 'female' && partner.isAdult) {
          partner.lastMatingDay = gs.gameDaysPassed;
          partner.fertilizedEggLayCount = 0;
          partner.lastFertilizedEggLayDay = null;
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
    drawShop();
  } else if (scene === SCENE.EGG) {
    drawEggScene();
  } else if (scene === SCENE.OUTDOOR) {
    drawOutdoor();
  } else if (scene === SCENE.ROOM) {
    drawRoom();
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
    // Threat animation oscillation
    lizardAnim.timer += dt;
    if (lizardAnim.timer > 3000) {
      lizardAnim.timer = 0;
      if (gs.bond < 40) lizardAnim.threatening = !lizardAnim.threatening;
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
    if (gs.isSleeping && isWakeHour()) {
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
      if (gs.bornAnim && !gs.isSleeping && isSleepyHour()) {
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
  newLizardMorph = null;
  newLizardColor = null;
  newLizardTraits = [];
  newLizardCountry = null;
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
    dandelions.push({ x, y, picked: false, gone: false });
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
  const stemH = 32;
  const fy = y - stemH - 9; // flower center y

  if (picked) {
    ctx.fillStyle = '#8a9870';
    ctx.fillRect(x - 1, y - stemH, 2, stemH);
    ctx.fillStyle = '#b0a080';
    ctx.beginPath();
    ctx.arc(x, y - stemH, 3, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.save();
  if (wiltLevel > 0) ctx.globalAlpha = 1 - wiltLevel * 0.5;

  // Stem
  ctx.fillStyle = wiltLevel > 0 ? '#7a8a20' : '#3a7a1a';
  ctx.fillRect(x - 1, y - stemH, 2, stemH);

  // Leaves
  ctx.fillStyle = wiltLevel > 0 ? '#8aaa28' : '#4a9a2a';
  ctx.save(); ctx.translate(x - 5, y - 14); ctx.rotate(-0.5 + wiltLevel * 0.4);
  ctx.beginPath(); ctx.ellipse(0, 0, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.save(); ctx.translate(x + 5, y - 9); ctx.rotate(0.5 - wiltLevel * 0.4);
  ctx.beginPath(); ctx.ellipse(0, 0, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Petals (shrink when wilted)
  const ps = 1 - wiltLevel * 0.45; // petal scale
  const pr = 12 * (1 - wiltLevel * 0.3); // petal orbit radius
  ctx.fillStyle = wiltLevel > 0
    ? `rgb(${Math.round(200 + 28 * wiltLevel)},${Math.round(160 - 60 * wiltLevel)},20)`
    : '#f8d030';
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const petalX = x + Math.cos(angle) * pr;
    const petalY = fy + Math.sin(angle) * pr;
    ctx.save(); ctx.translate(petalX, petalY); ctx.rotate(angle);
    ctx.beginPath(); ctx.ellipse(0, 0, 6 * ps, 3 * ps, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Center
  const cr = 7 * (1 - wiltLevel * 0.3);
  ctx.fillStyle = wiltLevel > 0 ? '#a05010' : '#e87820';
  ctx.beginPath(); ctx.arc(x, fy, cr, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = wiltLevel > 0 ? '#c07030' : '#f8b040';
  ctx.beginPath(); ctx.arc(x - 1, fy - 1, 3, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
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

  // === OUTDOOR GAME LOGIC ===
  let elapsed = 0, timeLeft = 999;
  if (outdoorState) {
    const now = Date.now();
    elapsed = (now - outdoorState.startTime) / 1000;
    timeLeft = Math.max(0, outdoorState.duration - elapsed);

    // Auto-leave when time's up
    if (timeLeft <= 0) { leaveOutdoor(); return; }

    // Wilt warning at 8s remaining
    if (timeLeft <= 8 && !outdoorState.wiltWarned) {
      outdoorState.wiltWarned = true;
      showMsg(t('dandelion_wilt_warning'));
    }

    // Update bug positions
    const dtBug = Math.min((now - outdoorState.lastUpdateTime) / 1000, 0.05);
    outdoorState.lastUpdateTime = now;
    const groundY = H * 0.52;
    for (const bug of outdoorState.bugs) {
      bug.x += bug.vx * dtBug;
      bug.y += bug.vy * dtBug;
      if (bug.x < 15)       { bug.x = 15;       bug.vx =  Math.abs(bug.vx); }
      if (bug.x > W - 15)   { bug.x = W - 15;   bug.vx = -Math.abs(bug.vx); }
      if (bug.y < groundY + 12) { bug.y = groundY + 12; bug.vy =  Math.abs(bug.vy); }
      if (bug.y > H - 20)   { bug.y = H - 20;   bug.vy = -Math.abs(bug.vy); }
    }
  }

  // Sky
  const skyGrad = ctx.createLinearGradient(0, 0, 0, skyH);
  skyGrad.addColorStop(0, '#3a80c8');
  skyGrad.addColorStop(1, '#90c8f0');
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, skyH);

  // Sun
  ctx.fillStyle = '#f8e840';
  ctx.beginPath(); ctx.arc(W * 0.82, H * 0.1, 24, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fffaaa';
  ctx.beginPath(); ctx.arc(W * 0.82, H * 0.1, 15, 0, Math.PI * 2); ctx.fill();

  // Clouds
  function cloud(cx, cy, sc) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    [[0,0,18],[22,5,13],[-18,6,11],[10,-9,11]].forEach(([ox,oy,r]) => {
      ctx.beginPath(); ctx.arc(cx+ox*sc, cy+oy*sc, r*sc, 0, Math.PI*2); ctx.fill();
    });
    ctx.fillRect(cx - 28*sc, cy, 56*sc, 16*sc);
  }
  cloud(W*0.18, H*0.1, 1);
  cloud(W*0.55, H*0.07, 0.75);

  // Background hills
  ctx.fillStyle = '#4a8a38';
  ctx.beginPath();
  ctx.moveTo(0, skyH);
  ctx.quadraticCurveTo(W*0.25, skyH - H*0.14, W*0.5, skyH - H*0.05);
  ctx.quadraticCurveTo(W*0.75, skyH + H*0.04, W, skyH - H*0.09);
  ctx.lineTo(W, skyH); ctx.closePath(); ctx.fill();

  // Ground
  const grassGrad = ctx.createLinearGradient(0, skyH, 0, H);
  grassGrad.addColorStop(0, '#68b848'); grassGrad.addColorStop(1, '#3a8828');
  ctx.fillStyle = grassGrad; ctx.fillRect(0, skyH, W, H - skyH);

  // Grass lines texture
  ctx.strokeStyle = 'rgba(0,60,0,0.1)'; ctx.lineWidth = 1;
  for (let gx = 0; gx < W; gx += 9) {
    ctx.beginPath(); ctx.moveTo(gx, skyH); ctx.lineTo(gx, H); ctx.stroke();
  }

  // Left tree
  px(W*0.07 - 7, skyH - H*0.01, 14, H*0.14, '#6b3e1c');
  ctx.fillStyle = '#2a6820';
  ctx.beginPath(); ctx.arc(W*0.07, skyH - H*0.09, W*0.065, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#3a8830';
  ctx.beginPath(); ctx.arc(W*0.07, skyH - H*0.17, W*0.048, 0, Math.PI*2); ctx.fill();

  // Right bush/tree
  px(W*0.91 - 5, skyH - H*0.01, 10, H*0.1, '#6b3e1c');
  ctx.fillStyle = '#2a6820';
  ctx.beginPath(); ctx.arc(W*0.91, skyH - H*0.08, W*0.055, 0, Math.PI*2); ctx.fill();

  // Dandelions (with wilt effect)
  if (outdoorState) {
    const wiltStart = outdoorState.duration - 8;  // wilt begins at 8s remaining
    for (const d of outdoorState.dandelions) {
      if (d.gone) continue;
      let wiltLevel = 0;
      if (elapsed > wiltStart) wiltLevel = Math.min(1, (elapsed - wiltStart) / 6);
      drawDandelionFlower(d.x, d.y, d.picked, wiltLevel);
    }
  }

  // Bugs
  if (outdoorState) {
    for (const bug of outdoorState.bugs) drawBug(bug.x, bug.y);
  }

  // Timer bar
  if (outdoorState) {
    const timerFrac = Math.max(0, timeLeft / outdoorState.duration);
    const barW = W * 0.62;
    const barX = W * 0.19;
    const barY = 10;
    const barH = 10;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);
    ctx.fillStyle = timeLeft > 10 ? '#4adb4a' : timeLeft > 5 ? '#f8c040' : '#f84040';
    ctx.fillRect(barX, barY, barW * timerFrac, barH);
    ctx.fillStyle = '#fff';
    ctx.font = "7px 'Press Start 2P', Galmuri11, monospace";
    ctx.textAlign = 'center';
    ctx.fillText(Math.ceil(timeLeft) + 's', W / 2, barY + barH + 14);
    ctx.textAlign = 'left';
  }

  // Tap hint (if dandelions remain)
  if (outdoorState && outdoorState.dandelions.some(d => !d.picked && !d.gone)) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(W / 2 - 110, H - 28, 220, 22);
    ctx.fillStyle = '#c8e84a';
    ctx.font = "7px 'Press Start 2P', Galmuri11, monospace";
    ctx.textAlign = 'center';
    ctx.fillText(t('dandelion_tap_hint_bug'), W / 2, H - 13);
    ctx.textAlign = 'left';
  }

  // Penalty flash
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
    ajantics:    ['#262830','#0c0c10','#d0d0d4','#181820','#bec0c4','#cecece','#202028','#0e0e12','#181820','#24242c'],
    patternless: ['#a89870','#a89870','#e8d898','#887860','#908070','#a89870','#807050','#605840','#706850','#806858'],
    melanistic:  ['#181810','#0c0c08','#484840','#101008','#1c1c14','#282820','#161610','#080808','#100c08','#181810'],
    amelanistic: ['#d89030','#c87020','#f0e498','#b07020','#c07828','#d08838','#b06018','#884800','#985010','#a86020'],
    albino:      ['#e8e0c0','#ccc4a0','#f8f4e0','#d0c8a8','#dcd4b8','#eae4c8','#c8c0a0','#b0a888','#b8b090','#c8c0a0'],
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

const LIZARD_MORPHS = {
  crestie:    ['normal', 'lilly_white', 'cappuccino', 'sable', 'azantic', 'choco'],
  bluetongue: ['ajantics', 'patternless', 'melanistic', 'amelanistic', 'albino']
};
const BT_MORPHS_BY_COUNTRY = {
  australia: ['amelanistic', 'melanistic', 'albino', 'patternless'],
  indonesia: ['azantic', 'patternless', 'melanistic', 'amelanistic', 'albino'],
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

function showDogramAdd() {
  if (AUTH.getAccountCoins() < ADOPT_COST) {
    showMsg(t('dogram_no_coins'));
    return;
  }
  document.getElementById('dogram-main-view').style.display = 'none';
  document.getElementById('dogram-add-view').style.display = '';
  document.getElementById('dogram-country-view').style.display = 'none';
  document.getElementById('dogram-morph-view').style.display = 'none';
  document.getElementById('dogram-color-view').style.display = 'none';
  document.getElementById('dogram-trait-view').style.display = 'none';
  document.getElementById('dogram-add-title').textContent = t('dogram_add_title');
  document.getElementById('dogram-add-subtitle').textContent = t('dogram_add_subtitle');
  document.getElementById('btn-dogram-crestie').textContent = t('egg_orange');
  document.getElementById('btn-dogram-bt').textContent = t('egg_blue');
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
  document.getElementById('dogram-add-view').style.display = 'none';
  document.getElementById('dogram-country-view').style.display = 'none';
  document.getElementById('dogram-morph-view').style.display = '';
  document.getElementById('dogram-color-view').style.display = 'none';
  document.getElementById('dogram-trait-view').style.display = 'none';
  document.getElementById('dogram-main-view').style.display = 'none';
  const isBT = newLizardType === 'bluetongue';
  document.getElementById('dogram-morph-title').textContent = t(isBT ? 'dogram_bt_select_title' : 'dogram_morph_title');
  document.getElementById('dogram-morph-subtitle').textContent = t(isBT ? 'dogram_locale_subtitle' : 'dogram_morph_subtitle');
  document.getElementById('btn-dogram-morph-back').textContent = t('dogram_back');

  const btns = document.getElementById('dogram-morph-btns');
  btns.innerHTML = '';

  function makeMorphBtn(id, bgColor) {
    const btn = document.createElement('button');
    btn.className = 'pixel-btn dogram-type-btn';
    btn.textContent = t('morph_' + id);
    btn.style.background = bgColor;
    btn.style.color = '#fff';
    btn.onclick = () => pickNewLizardMorph(id);
    return btn;
  }

  if (isBT) {
    const locales = BT_LOCALES_BY_COUNTRY[newLizardCountry] || [];
    const morphs = BT_MORPHS_BY_COUNTRY[newLizardCountry] || [];
    if (locales.length) {
      const lbl = document.createElement('div');
      lbl.textContent = t('dogram_locale_title');
      lbl.style.cssText = 'font-size:7px;color:#8ab88a;margin:6px 0 4px;text-align:center;';
      btns.appendChild(lbl);
      locales.forEach(id => btns.appendChild(makeMorphBtn(id, '#4a7a5a')));
    }
    if (morphs.length) {
      const lbl = document.createElement('div');
      lbl.textContent = t('dogram_morph_title');
      lbl.style.cssText = 'font-size:7px;color:#c8a860;margin:8px 0 4px;text-align:center;';
      btns.appendChild(lbl);
      const BT_MORPH_COLORS = {
        hypo:        '#d4a860',
        caramel:     '#c87830',
        leucistic:   '#e8e4d8',
        melanistic:  '#181810',
        patternless: '#a89870',
        amelanistic: '#d89030',
        albino:      '#dcd4b8',
      };
      const BT_MORPH_LIGHT = ['patternless', 'albino', 'amelanistic'];
      morphs.forEach(id => {
        const bg = BT_MORPH_COLORS[id] || '#8a6020';
        const btn = makeMorphBtn(id, bg);
        btn.style.color = BT_MORPH_LIGHT.includes(id) ? '#3a2a10' : '#fff';
        btns.appendChild(btn);
      });
    }
  } else {
    const CRESTIE_MORPH_COLORS = {
      normal:      '#c07020',
      lilly_white: '#e8e0d0',
      cappuccino:  '#8b5e3c',
      sable:       '#5a5248',
      azantic:     '#7a8aaa',
    };
    function makeCrestieMorphBtn(id) {
      const bg = CRESTIE_MORPH_COLORS[id] || '#c07020';
      const light = ['lilly_white'].includes(id);
      const btn = makeMorphBtn(id, bg);
      btn.style.color = light ? '#3a2a10' : '#fff';
      return btn;
    }
    (LIZARD_MORPHS[newLizardType] || []).forEach(id => btns.appendChild(makeCrestieMorphBtn(id)));
  }
}

function pickNewLizardMorph(morph) {
  newLizardMorph = morph;
  if (newLizardType === 'crestie') {
    showDogramColor(); // 크레스티: 모프 선택 후 컬러 선택
  } else {
    showDogramTrait();
  }
}

function showDogramColor() {
  document.getElementById('dogram-morph-view').style.display = 'none';
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
  // 크레스티: 모프 → 컬러 → 특성 순서
  showDogramMorph();
}

function tTrait(trait, lizardType) {
  const specificKey = 'trait_' + trait + '_' + lizardType;
  return (T[currentLang] && T[currentLang][specificKey]) || t('trait_' + trait);
}

function showDogramTrait() {
  document.getElementById('dogram-morph-view').style.display = 'none';
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
  const rareMorphs = ['lilly_white', 'azantic', 'sable', 'cappuccino', 'hypo', 'caramel', 'leucistic', 'melanistic', 'amelanistic', 'albino'];
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

  // Remove current lizard from list
  allLizards.splice(activeLizardIdx, 1);
  if (activeLizardIdx >= allLizards.length && allLizards.length > 0) {
    activeLizardIdx = allLizards.length - 1;
  }

  // Clear active state → go to egg shop
  gs = null;
  lizardType = null;
  lizardName = '';
  scene = SCENE.SHOP;

  AUTH.saveAllLizards(allLizards, Math.max(0, activeLizardIdx));

  // Hide room UI
  document.getElementById('ui-overlay').style.display = 'none';
  document.getElementById('date-display').style.display = 'none';
  document.getElementById('time-display').style.display = 'none';

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
    const morphText = lizardGs.morph ? t('morph_' + lizardGs.morph) : '';
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
    const morphStr = egg.morph ? t('morph_' + egg.morph) : '';
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
  const eggBase = {
    type: lizard.type,
    morph: lizard.morph || 'normal',
    color: lizard.color || null,
    traits: lizard.traits ? [...lizard.traits] : [],
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
