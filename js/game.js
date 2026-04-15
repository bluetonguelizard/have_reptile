// Game constants
const GAME_START = { year: 2025, month: 5, day: 1 }; // May 1, 2025 (Thu)
const MS_PER_GAME_DAY = 13 * 60 * 1000; // 13 real minutes = 1 game day
const ADULT_GAME_DAYS = 548; // ~1.5 game years (365*1.5 ≈ 548)

// Scenes
const SCENE = { SHOP: 'shop', EGG: 'egg', ROOM: 'room' };

let canvas, ctx;
let scene = SCENE.SHOP;
let lizardType = null; // 'crestie' | 'bluetongue'
let lizardName = '';
let gs = null; // game state

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
    pelletCount: 0,
    cgestieFoodCount: 0,
  };
}

function loadGame() {
  const user = AUTH.currentUser();
  if (!user) { window.location.href = 'index.html'; return; }
  lizardName = user.lizardName || '';
  gs = user.gameState ? { ...newGameState('crestie'), ...user.gameState } : null;
  if (gs) {
    scene = gs.scene || SCENE.SHOP;
    lizardType = gs.type || null;
    updateGameTime();
  }
}

function saveGame() {
  if (gs) {
    gs.scene = scene;
    gs.type = lizardType;
    gs.lizardName = lizardName;
    AUTH.saveGameState(gs);
  }
}

// ─── SLEEP HELPERS ───────────────────────────────────────────────────────────
function isSleepyHour() { const h = new Date().getHours(); return h >= 21; }
function isWakeHour()   { const h = new Date().getHours(); return h >= 7 && h < 21; }

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
  if (gs.bornAnim) drawCrestie(x+w/2-20, y+h-90, { ...lizardAnim, sleeping: gs.isSleeping });
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

function drawCrestie(x, y, anim) {
  const threatening = anim.threatening;
  const s = 3;

  // TAIL — long, prehensile, curves down then tip curls back up
  ctx.fillStyle = '#8a5018';
  ctx.fillRect(x-8*s, y+8*s,  s,   s  );  // tip curl end
  ctx.fillRect(x-7*s, y+7*s,  2*s, 2*s);
  ctx.fillStyle = '#9a5820';
  ctx.fillRect(x-6*s, y+6*s,  3*s, 2*s);
  ctx.fillRect(x-4*s, y+5*s,  3*s, 2*s);
  ctx.fillStyle = '#a86020';
  ctx.fillRect(x-2*s, y+5*s,  3*s, 3*s);  // tail base

  // BODY — slender
  ctx.fillStyle = '#c07020';
  ctx.fillRect(x,      y+4*s, 11*s, 5*s);
  // Dorsal stripe (lateral line pattern)
  ctx.fillStyle = '#e8b050';
  ctx.fillRect(x+s,    y+4*s,  9*s, s  );
  // Ventral (paler belly)
  ctx.fillStyle = '#e8c870';
  ctx.fillRect(x+s,    y+8*s,  9*s, s  );

  // DORSAL CRESTS — fan-like spines running from neck down back (key crestie feature)
  ctx.fillStyle = '#f0b040';
  ctx.fillRect(x+2*s,  y+3*s,  s,   2*s);
  ctx.fillRect(x+4*s,  y+2*s,  s,   3*s);
  ctx.fillRect(x+6*s,  y+3*s,  s,   2*s);
  ctx.fillRect(x+8*s,  y+2*s,  s,   3*s);
  ctx.fillRect(x+10*s, y+s,    s,   4*s);  // tallest, near neck

  // NECK
  ctx.fillStyle = '#c87828';
  ctx.fillRect(x+10*s, y+4*s,  3*s, 5*s);

  // HEAD — triangular, flares wide at temples, slightly narrow snout
  ctx.fillStyle = '#d88030';
  ctx.fillRect(x+12*s, y+2*s,  5*s, 8*s);  // main skull
  ctx.fillRect(x+17*s, y+3*s,  3*s, 6*s);  // snout
  ctx.fillStyle = '#c87020';
  ctx.fillRect(x+19*s, y+4*s,  2*s, 4*s);  // snout tip

  // SUPRAORBITAL RIDGE — the "eyelash" crests above eyes (iconic crested gecko feature)
  ctx.fillStyle = '#f5c050';
  ctx.fillRect(x+12*s, y+2*s,  s,   s  );  // brow ridge
  ctx.fillRect(x+13*s, y+s,    3*s, 2*s);  // raised head crest
  ctx.fillRect(x+13*s, y,      s,   s  );  // crest peak

  // EYE — very large relative to head (geckos have huge eyes)
  ctx.fillStyle = '#1a0a00';
  ctx.fillRect(x+13*s, y+3*s,  3*s, 4*s);  // eye socket
  ctx.fillStyle = '#f5c800';                // bright amber iris
  ctx.fillRect(x+13*s, y+3*s,  3*s, 3*s);
  ctx.fillStyle = C.black;
  ctx.fillRect(x+14*s, y+3*s,  s,   3*s);  // vertical slit pupil
  ctx.fillStyle = '#ffffa0';
  ctx.fillRect(x+13*s, y+3*s,  s,   s  );  // highlight

  // FRONT LEGS — longer, more slender than skink
  ctx.fillStyle = '#b06018';
  ctx.fillRect(x+17*s, y+9*s,  2*s, 4*s);
  ctx.fillRect(x+15*s, y+12*s, 3*s, s  );  // foot
  ctx.fillStyle = '#f0d080';
  ctx.fillRect(x+15*s, y+13*s, s,   s  );  // toe pad
  ctx.fillRect(x+16*s, y+13*s, s,   s  );

  // BACK LEGS
  ctx.fillStyle = '#b06018';
  ctx.fillRect(x+6*s,  y+9*s,  2*s, 4*s);
  ctx.fillRect(x+4*s,  y+12*s, 3*s, s  );
  ctx.fillStyle = '#f0d080';
  ctx.fillRect(x+4*s,  y+13*s, s,   s  );
  ctx.fillRect(x+5*s,  y+13*s, s,   s  );

  // MOUTH
  if (!anim.sleeping && threatening) {
    ctx.fillStyle = '#ff2020';
    ctx.fillRect(x+13*s, y+8*s,  8*s, 3*s);  // wide gape
    ctx.fillStyle = '#ffff80';
    ctx.fillRect(x+14*s, y+8*s,  s,   s  );
    ctx.fillRect(x+16*s, y+8*s,  s,   s  );
    ctx.fillRect(x+18*s, y+8*s,  s,   s  );
    ctx.fillStyle = '#ff8888';
    ctx.fillRect(x+19*s, y+9*s,  2*s, s  );  // pink tongue tip
  } else {
    ctx.fillStyle = '#b05010';
    ctx.fillRect(x+13*s, y+9*s,  7*s, s  );  // closed mouth line
  }

  // SLEEPING — override eyes, draw Zzz
  if (anim.sleeping) {
    // closed eyes (horizontal line)
    ctx.fillStyle = '#3a2010';
    ctx.fillRect(x+13*s, y+4*s, 3*s, s);
    ctx.fillRect(x+13*s, y+5*s, s, s);
    ctx.fillRect(x+15*s, y+5*s, s, s);
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
  if (gs.bornAnim) drawBluetongue(x+w/2-30, y+h-95, { ...lizardAnim, sleeping: gs.isSleeping });
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

function drawBluetongue(x, y, anim) {
  const threatening = anim.threatening;
  const s = 3;

  // TAIL — short, fat, tapers sharply (very different from gecko's long tail)
  ctx.fillStyle = '#6a7050';
  ctx.fillRect(x-7*s, y+6*s,  2*s, 3*s);  // tip (still thick)
  ctx.fillStyle = '#7a8060';
  ctx.fillRect(x-5*s, y+5*s,  2*s, 4*s);
  ctx.fillStyle = '#8a9070';
  ctx.fillRect(x-3*s, y+4*s,  3*s, 5*s);  // tail base

  // BODY — heavy, cylindrical sausage
  ctx.fillStyle = '#c0a050';
  ctx.fillRect(x,      y+3*s, 15*s, 8*s);

  // DARK CROSSBANDS — very prominent, key bluetongue identifier
  ctx.fillStyle = '#2c1608';
  ctx.fillRect(x+s,    y+3*s,  2*s, 8*s);
  ctx.fillRect(x+5*s,  y+3*s,  2*s, 8*s);
  ctx.fillRect(x+9*s,  y+3*s,  2*s, 8*s);
  ctx.fillRect(x+13*s, y+3*s,  2*s, 8*s);
  // Pale belly
  ctx.fillStyle = '#f0e8c0';
  ctx.fillRect(x+s,    y+10*s, 13*s, s  );

  // NECK — noticeably narrower than both body and head
  ctx.fillStyle = '#b09848';
  ctx.fillRect(x+15*s, y+5*s,  3*s, 5*s);

  // HEAD — wide, flat, triangular (the most distinctive bluetongue feature)
  // Back of head wider than neck, top completely flat
  ctx.fillStyle = '#c8a058';
  ctx.fillRect(x+17*s, y+2*s, 10*s, 10*s);  // large head block
  ctx.fillStyle = '#d8b068';
  ctx.fillRect(x+17*s, y+2*s, 10*s, 2*s);   // flat head top
  // Snout tapers toward tip
  ctx.fillStyle = '#b89048';
  ctx.fillRect(x+25*s, y+4*s,  3*s, 6*s);
  ctx.fillStyle = '#a88040';
  ctx.fillRect(x+27*s, y+5*s,  s,   4*s);   // snout tip
  // Head spots/speckles
  ctx.fillStyle = '#805030';
  ctx.fillRect(x+19*s, y+2*s,  s,   s  );
  ctx.fillRect(x+22*s, y+2*s,  s,   s  );
  ctx.fillRect(x+24*s, y+2*s,  s,   s  );

  // EYE — beady but visible (bluetongue skink eye with scaly eyelid rim)
  ctx.fillStyle = '#3a2800';                 // outer scaly rim
  ctx.fillRect(x+19*s, y+3*s,  5*s, 5*s);
  ctx.fillStyle = '#1a1000';                 // eye socket
  ctx.fillRect(x+20*s, y+4*s,  4*s, 4*s);
  ctx.fillStyle = '#e8c030';                 // bright golden iris
  ctx.fillRect(x+20*s, y+4*s,  3*s, 3*s);
  ctx.fillStyle = C.black;
  ctx.fillRect(x+20*s, y+4*s,  2*s, 2*s);   // round pupil
  ctx.fillStyle = '#fff';
  ctx.fillRect(x+21*s, y+4*s,  s,   s  );   // highlight (top-right of pupil)

  // FRONT LEGS — very short and stubby (almost comically short)
  ctx.fillStyle = '#a88840';
  ctx.fillRect(x+19*s, y+12*s, 4*s, 2*s);   // front leg (wide & short)
  ctx.fillRect(x+18*s, y+13*s, 5*s, s  );   // front foot (wide toes)
  // BACK LEGS — also very short
  ctx.fillRect(x+3*s,  y+11*s, 4*s, 2*s);
  ctx.fillRect(x+2*s,  y+12*s, 5*s, s  );

  // MOUTH + TONGUE
  if (!anim.sleeping && threatening) {
    ctx.fillStyle = '#c83020';
    ctx.fillRect(x+18*s, y+10*s, 10*s, 4*s);  // wide open gape
    // BLUE TONGUE — the signature feature
    ctx.fillStyle = '#1848c0';
    ctx.fillRect(x+27*s, y+11*s, 6*s, 2*s);
    ctx.fillStyle = '#1040a8';
    ctx.fillRect(x+32*s, y+10*s, 2*s, s  );   // tongue fork top
    ctx.fillRect(x+32*s, y+12*s, 2*s, s  );   // tongue fork bottom
    ctx.fillStyle = '#f0f0e0';
    ctx.fillRect(x+20*s, y+10*s, s,   s  );   // teeth
    ctx.fillRect(x+22*s, y+10*s, s,   s  );
    ctx.fillRect(x+24*s, y+10*s, s,   s  );
  } else {
    ctx.fillStyle = '#907040';
    ctx.fillRect(x+19*s, y+11*s, 8*s, s  );   // closed mouth line
  }

  // SLEEPING — override eyes, draw Zzz
  if (anim.sleeping) {
    // closed eyes (cover with lid over the larger eye area)
    ctx.fillStyle = '#3a2800';
    ctx.fillRect(x+19*s, y+3*s,  5*s, 5*s);  // eyelid rim stays
    ctx.fillStyle = '#805030';
    ctx.fillRect(x+20*s, y+5*s, 4*s, 2*s);   // shut eyelid
    ctx.fillStyle = '#1a1000';
    ctx.fillRect(x+20*s, y+5*s, 4*s, s);     // closed line
    drawZzz(x + 28*s, y - s);
  }
}

function drawBornAnim(cx, cy) {
  if (bornAnim.phase === 0) {
    // Show egg
    if (lizardType === 'crestie') drawEgg(cx-40, cy-50, 'orange', false);
    else {
      // Blue tongue: egg turns yellow/opaque first
      ctx.save();
      ctx.globalAlpha = 0.9;
      drawEgg(cx-40, cy-50, 'yellow_bt', false);
      ctx.restore();
    }
  } else if (bornAnim.phase === 1) {
    // Cracking effect
    const eggColor = lizardType === 'crestie' ? 'orange' : 'blue';
    drawEgg(cx-40, cy-50, eggColor, false);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx-20, cy-50);
    ctx.lineTo(cx-15, cy-20);
    ctx.lineTo(cx, cy-35);
    ctx.lineTo(cx+5, cy-10);
    ctx.stroke();
  } else if (bornAnim.phase === 2) {
    // Emerging
    ctx.save(); ctx.globalAlpha = 0.7+Math.sin(Date.now()/200)*0.15; ctx.restore();
    if (lizardType === 'crestie') drawCrestie(cx-30, cy-40, { threatening: false });
    else drawBluetongue(cx-40, cy-40, { threatening: false });
    // Crack pieces
    ctx.fillStyle = lizardType === 'crestie' ? '#e87820' : '#5a7ab8';
    ctx.fillRect(cx-50, cy+10, 20, 15);
    ctx.fillRect(cx+20, cy+5, 18, 12);
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
  if (lizardType === 'crestie') { showMsg(t('feed_crestie_only_cricket')); return; }
  const currentDay = gs.gameDaysPassed;
  if (currentDay - gs.lastFedGameDay < 2) {
    showMsg(t('feed_no')); return;
  }
  gs.lastFedGameDay = currentDay;
  gs.hunger = Math.min(100, gs.hunger + 40);
  gs.happy = Math.min(100, gs.happy + 10);
  gs.weight = Math.min(600, gs.weight + 4);
  showMsg(t('feed_ok'));
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
  } else if (scene === SCENE.ROOM) {
    drawRoom();
    // Born animation progression
    if (!gs.bornAnim) {
      bornAnim.timer += dt;
      if (bornAnim.phase === 0 && bornAnim.timer > 1500) { bornAnim.phase = 1; bornAnim.timer = 0; }
      else if (bornAnim.phase === 1 && bornAnim.timer > 1200) { bornAnim.phase = 2; bornAnim.timer = 0; }
      else if (bornAnim.phase === 2 && bornAnim.timer > 1800) {
        gs.bornAnim = true;
        lizardAnim.threatening = true;
        if (!gs.introShown) {
          const key = lizardType === 'crestie' ? 'room_intro_crestie' : 'room_intro_blue';
          showMsg(t(key), 4000);
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
  setInterval(() => {
    if (scene === SCENE.ROOM && gs) {
      updateGameTime();
      const gd = getGameDate();
      document.getElementById('date-display').textContent = formatDate(gd);
      updateTimeDisplay();
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
    }
  }, 5000);
});

canvas_click = function(e) {
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const my = (e.clientY - rect.top) * (canvas.height / rect.height);
  const W = canvas.width, H = canvas.height;

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
  lizardType = type;
  // Show name modal
  document.getElementById('name-modal').style.display = 'flex';
  document.getElementById('modal-title').textContent = t('name_title');
  document.getElementById('modal-prompt').textContent = t('name_prompt');
  document.getElementById('lizard-name-input').placeholder = t('name_placeholder');
  document.getElementById('modal-confirm').textContent = t('name_btn');
}

function confirmName() {
  const name = document.getElementById('lizard-name-input').value.trim();
  if (!name) return;
  lizardName = name;
  AUTH.saveLizardName(name);
  document.getElementById('name-modal').style.display = 'none';
  // Init game state
  gs = newGameState(lizardType);
  gs.lizardName = name;
  scene = SCENE.ROOM;
  gs.scene = SCENE.ROOM;
  saveGame();
  document.getElementById('date-display').style.display = 'block';
  updateTimeDisplay();
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
  const cx = W / 2, groundY = H - 22;
  if (state === 'none') {
    c.fillStyle = '#555';
    c.font = "7px 'Press Start 2P', monospace";
    c.textAlign = 'center';
    c.fillText(currentLang === 'ko' ? '미심재' : 'not planted', W/2, H/2 + 4);
    c.textAlign = 'left';
  } else if (state === 'growing') {
    if (growthDays <= 1) drawChicorySprout(c, cx, groundY);
    else if (growthDays <= 3) drawChicorySmall(c, cx, groundY);
    else drawChicoryMedium(c, cx, groundY);
  } else if (state === 'ready') {
    drawChicoryFull(c, cx, groundY);
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
  document.getElementById('tab-btn-cricket').className = 'tab-btn active';
  document.getElementById('tab-btn-chicory').className = 'tab-btn';
  document.getElementById('tab-btn-cgestie').className = 'tab-btn';
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
  document.getElementById('tab-btn-cricket').className = 'tab-btn' + (tab === 'cricket' ? ' active' : '');
  document.getElementById('tab-btn-chicory').className = 'tab-btn' + (tab === 'chicory' ? ' active' : '');
  document.getElementById('tab-btn-cgestie').className = 'tab-btn' + (tab === 'cgestie' ? ' active' : '');
  drawFarmCricketCanvas();
  drawFarmChicoryCanvas();
}

function updateFarmUI() {
  document.getElementById('farm-title').textContent = t('farm_title');
  document.getElementById('tab-btn-cricket').textContent = t('farm_tab_cricket');
  document.getElementById('tab-btn-chicory').textContent = t('farm_tab_chicory');
  document.getElementById('tab-btn-cgestie').textContent = t('farm_tab_cgestie');
  document.getElementById('lbl-cricket-count').textContent = t('cricket_count_label');
  document.getElementById('lbl-chicory-stage').textContent = t('chicory_stage_label');
  document.getElementById('btn-cricket-get').textContent = t('cricket_get_btn');
  document.getElementById('btn-cricket-feed').textContent = t('cricket_feed_btn');
  document.getElementById('btn-chicory-plant').textContent = t('chicory_plant_btn');
  document.getElementById('btn-chicory-water').textContent = t('chicory_water_btn');
  document.getElementById('btn-chicory-harvest').textContent = t('chicory_harvest_btn');
  document.getElementById('btn-chicory-feed-lizard').textContent = t('chicory_feed_lizard_btn');
  document.getElementById('lbl-pellet').textContent = t('pellet_label');
  document.getElementById('btn-pellet-get').textContent = t('pellet_get_btn');
  document.getElementById('btn-cricket-care').textContent = t('cricket_care_btn');
  document.getElementById('lbl-chicory-stock').textContent = t('chicory_stock_label');
  document.getElementById('lbl-cgestie-food').textContent = t('cgestie_food_label');
  document.getElementById('btn-cgestie-food-get').textContent = t('cgestie_food_get_btn');
  document.getElementById('btn-cgestie-feed-lizard').textContent = t('cgestie_feed_lizard_btn');
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
  document.getElementById('chicory-info').textContent =
    chicState === 'growing' ? t('chicory_info_growing') + ` (${growthDays}/5)` :
    chicState === 'ready' ? t('chicory_info_ready') : '';
  document.getElementById('chicory-stock-text').textContent = chicStock;
  // Button enable/disable
  document.getElementById('btn-chicory-plant').disabled = chicState !== 'none';
  document.getElementById('btn-chicory-water').disabled = chicState !== 'growing';
  document.getElementById('btn-chicory-harvest').disabled = chicState !== 'ready';
  document.getElementById('btn-chicory-feed-lizard').disabled = chicStock < 1;
  // Cgestie food stats
  const cgestieFood = gs ? (gs.cgestieFoodCount || 0) : 0;
  document.getElementById('bar-cgestie-food').style.width = (cgestieFood / 10 * 100) + '%';
  document.getElementById('cgestie-food-count-text').textContent = cgestieFood + ' / 10';
  document.getElementById('btn-cgestie-feed-lizard').disabled = cgestieFood < 1;
  drawFarmCricketCanvas();
  drawFarmChicoryCanvas();
}

function doCricketGet() {
  if (!gs) return;
  if ((gs.cricketCount || 0) >= 150) { showMsg(t('cricket_get_max')); return; }
  gs.cricketCount = Math.min(150, (gs.cricketCount || 0) + 20);
  gs.lastCricketBreedDay = gs.gameDaysPassed;
  if ((gs.lastCricketCareDay || -1) < 0) gs.lastCricketCareDay = gs.gameDaysPassed;
  showMsg(t('cricket_get_ok'));
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
  if (gs.chicoryState !== 'none') { showMsg(t('chicory_plant_already')); return; }
  gs.chicoryState = 'growing';
  gs.chicoryPlantedDay = gs.gameDaysPassed;
  gs.chicoryWateredDays = 0;
  gs.chicoryLastWateredDay = -1;
  showMsg(t('chicory_plant_ok'));
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
  gs.chicoryState = 'none';
  gs.chicoryStock = (gs.chicoryStock || 0) + 1;
  showMsg(t('chicory_harvest_ok'));
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
  gs.cgestieFoodCount = Math.min(10, (gs.cgestieFoodCount || 0) + 3);
  showMsg(t('cgestie_food_get_ok'));
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
