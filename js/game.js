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
    lastFedGameDay: -2,
    lastFedWeekDay: [],
    isAdult: false,
    adultNotified: false,
    scene: SCENE.SHOP,
    lizardName: '',
    hydration: 80,    // 0-100, crested gecko needs misting, bluetongue needs water bowl
    bornAnim: false,
    shopEnterAnim: true,
    introShown: false,
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
    gs.hydration = Math.max(0, (gs.hydration || 80) - daysElapsed * 12);
    if (gs.hydration < 20) gs.happy = Math.max(0, gs.happy - daysElapsed * 3);
    gs.handleCountToday = 0; // reset daily handles
    if (!gs.isAdult && gs.gameDaysPassed >= ADULT_GAME_DAYS) {
      gs.isAdult = true;
    }
    saveGame();
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

// ─── DRAW SCENES ─────────────────────────────────────────────────────────────
function drawShop() {
  const W = canvas.width, H = canvas.height;
  // Floor
  px(0, H*0.6, W, H*0.4, '#3a2d1a');
  // Wall
  px(0, 0, W, H*0.6, '#2a1f0e');
  // Wall bricks
  ctx.fillStyle = '#3d2e15';
  for (let r = 0; r < 6; r++) for (let c = 0; c < 20; c++) {
    const off = r % 2 === 0 ? 0 : 40;
    ctx.strokeStyle = '#4a3820';
    ctx.lineWidth = 2;
    ctx.strokeRect(c * 80 + off, r * 56, 78, 54);
  }
  // Shop sign
  const sx = W/2 - 180, sy = 30, sw = 360, sh = 80;
  px(sx-6, sy-6, sw+12, sh+12, '#5c3a10'); // border
  px(sx, sy, sw, sh, '#e8a020');
  // Sign text
  ctx.font = "bold 22px 'Press Start 2P', Galmuri11, monospace";
  ctx.fillStyle = '#1a0a00';
  ctx.textAlign = 'center';
  ctx.fillText('HAVE REPTILE', W/2, sy+32);
  ctx.fillText('GAME', W/2, sy+62);
  ctx.textAlign = 'left';
  // Door
  const dx = W/2 - 60, dy = H*0.3, dw = 120, dh = H*0.31;
  px(dx-8, dy-8, dw+16, dh+16, C.wood2);
  px(dx, dy, dw, dh, '#8B4513');
  px(dx+10, dy+10, dw-20, dh/2 - 10, '#a0561a');
  px(dx+10, dy + dh/2+5, dw-20, dh/2 - 20, '#a0561a');
  // door knob
  px(dx+dw-22, dy+dh/2-8, 12, 12, '#e8c050');
  // windows
  for (let wi = 0; wi < 2; wi++) {
    const wx = wi === 0 ? W/2 - 260 : W/2 + 140;
    const wy = H*0.25;
    px(wx-4, wy-4, 108, 88, C.wood2);
    px(wx, wy, 100, 80, '#6ab8d4');
    // window cross
    px(wx+48, wy, 4, 80, C.wood2);
    px(wx, wy+38, 100, 4, C.wood2);
  }
  // Shopkeeper (pixel man)
  drawShopkeeper(W/2 - 140, H*0.35);
  // Enter text
  ctx.font = "11px 'Press Start 2P', Galmuri11, monospace";
  ctx.fillStyle = '#e8a020';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#000';
  ctx.fillText(currentLang === 'ko' ? '▼ 가게에 들어가기' : '▼ ENTER SHOP', W/2+1, H-26);
  ctx.fillStyle = '#e8d050';
  ctx.fillText(currentLang === 'ko' ? '▼ 가게에 들어가기' : '▼ ENTER SHOP', W/2, H-27);
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
  // Background - inside shop
  px(0, 0, W, H, '#2a1f0e');
  // Floor
  px(0, H*0.7, W, H*0.3, '#4a3820');
  // Counter
  px(W/2 - 200, H*0.5, 400, 30, C.wood);
  px(W/2 - 200, H*0.53, 400, 60, C.wood2);
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
  ctx.bezierCurveTo(W+10, 5, W+15, 60, W/2, H);
  ctx.bezierCurveTo(-15, 60, -10, 5, W/2, 2);
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
  // Room background
  px(0, 0, W, H*0.65, '#3a3050'); // wall
  px(0, H*0.65, W, H*0.35, '#2a2538'); // floor
  // Wallpaper pattern
  ctx.strokeStyle = '#4a4060';
  ctx.lineWidth = 1;
  for (let i = 0; i < W; i += 40) ctx.strokeRect(i, 0, 38, H*0.65);
  // Baseboard
  px(0, H*0.65-6, W, 10, '#5a4a70');

  // Enclosure
  if (lizardType === 'crestie') drawCrestieEnclosure(W/2 - 180, H*0.15, W*0.75, H*0.48);
  else drawBluetongueEnclosure(W/2 - 200, H*0.15, W*0.8, H*0.48);

  // Born animation
  if (!gs.bornAnim) {
    drawBornAnim(W/2, H*0.38);
  }
}

function drawCrestieEnclosure(x, y, w, h) {
  // JIF small enclosure - front-open mesh top
  px(x-6, y-6, w+12, h+12, '#4a3820'); // outer frame shadow
  px(x, y, w, h, '#e8d8a0'); // walls (cream/beige)
  // Glass front (slightly tinted)
  px(x+6, y+6, w-12, h-30, 'rgba(180,220,255,0.15)');
  ctx.strokeStyle = '#8a7840';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
  // Mesh top
  px(x, y, w, 20, '#aaa');
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 1;
  for (let i = 0; i < w; i += 8) ctx.strokeRect(x+i, y, 6, 20);
  // Label
  ctx.font = "7px 'Press Start 2P', Galmuri11, monospace";
  ctx.fillStyle = '#5a4820';
  ctx.fillText('JIF ENCLOSURE', x+10, y+h-8);
  // Substrate (coco fiber - dark brown)
  px(x+6, y+h-50, w-12, 44, '#5a3820');
  // Cozy egg hide
  drawCrestieHide(x + 20, y + h - 95, false);
  drawCrestieHide(x + w - 110, y + h - 80, true); // backup hide
  // Plants/decor
  drawLeaf(x+w-50, y+h-90);
  // Lizard
  if (gs.bornAnim) drawCrestie(x+w/2-20, y+h-90, lizardAnim);
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
  // Label
  ctx.font = "5px 'Press Start 2P', Galmuri11, monospace"; ctx.fillStyle = '#e8d0a0';
  ctx.fillText('COZY', 22, 30);
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
  // Crested gecko pixel art
  const s = 3;
  // Body
  ctx.fillStyle = '#c07020';
  ctx.fillRect(x, y+4*s, 12*s, 7*s);
  // Head
  ctx.fillStyle = '#d08030';
  ctx.fillRect(x+8*s, y, 10*s, 8*s);
  // Crest on head
  ctx.fillStyle = '#e8a040';
  for (let i = 0; i < 4; i++) ctx.fillRect(x+9*s+i*2*s, y-2*s, s, 3*s+i*s);
  // Tail (curled)
  ctx.fillStyle = '#b06010';
  ctx.fillRect(x-4*s, y+6*s, 5*s, 3*s);
  ctx.fillRect(x-6*s, y+8*s, 3*s, 4*s);
  // Legs
  ctx.fillStyle = '#c07020';
  ctx.fillRect(x+2*s, y+10*s, 2*s, 4*s);
  ctx.fillRect(x+7*s, y+10*s, 2*s, 4*s);
  // Eye
  ctx.fillStyle = C.black;
  ctx.fillRect(x+14*s, y+2*s, 3*s, 3*s);
  ctx.fillStyle = '#ffff80';
  ctx.fillRect(x+15*s, y+2*s, s, s);
  // Mouth - open if threatening
  if (threatening) {
    ctx.fillStyle = '#ff2020';
    ctx.fillRect(x+10*s, y+5*s, 8*s, 4*s);
    ctx.fillStyle = '#ffff80';
    // teeth
    ctx.fillRect(x+11*s, y+5*s, s, 2*s);
    ctx.fillRect(x+13*s, y+5*s, s, 2*s);
    ctx.fillRect(x+15*s, y+5*s, s, 2*s);
    ctx.fillRect(x+17*s, y+5*s, s, 2*s);
  } else {
    ctx.fillStyle = '#c06010';
    ctx.fillRect(x+10*s, y+6*s, 8*s, 2*s);
  }
}

function drawBluetongueEnclosure(x, y, w, h) {
  // 3 size Formax enclosure
  px(x-6, y-6, w+12, h+12, '#303030');
  px(x, y, w, h, '#e0e0c8'); // formax white walls
  ctx.strokeStyle = '#404040';
  ctx.lineWidth = 4;
  ctx.strokeRect(x, y, w, h);
  // Sliding glass panels
  px(x+6, y+6, (w-12)/2-2, h-30, 'rgba(180,220,255,0.12)');
  px(x+(w-12)/2+8, y+6, (w-12)/2-2, h-30, 'rgba(180,220,255,0.12)');
  ctx.strokeStyle = '#aaa'; ctx.lineWidth = 2;
  ctx.strokeRect(x+6, y+6, (w-12)/2-2, h-30);
  ctx.strokeRect(x+(w-12)/2+8, y+6, (w-12)/2-2, h-30);
  ctx.font = "7px 'Press Start 2P', Galmuri11, monospace"; ctx.fillStyle = '#303030';
  ctx.fillText('3-SIZE FORMAX', x+10, y+h-8);
  // Substrate (newspaper/paper)
  px(x+6, y+h-55, w-12, 49, '#f0e8c0');
  // Hide (rock cave)
  drawBluetongueHide(x+20, y+h-100);
  drawLeaf(x+w-60, y+h-100);
  // Lizard
  if (gs.bornAnim) drawBluetongue(x+w/2-30, y+h-95, lizardAnim);
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
  // Longer, flatter body
  ctx.fillStyle = '#5a8a6a';
  ctx.fillRect(x, y+4*s, 16*s, 5*s);
  // Head (broader)
  ctx.fillStyle = '#6a9a7a';
  ctx.fillRect(x+12*s, y+s, 9*s, 7*s);
  // Scales pattern
  ctx.fillStyle = '#4a7a5a';
  for (let i = 0; i < 7; i++) ctx.fillRect(x+i*2*s, y+4*s, s, 2*s);
  // Side stripes
  ctx.fillStyle = '#8ab070';
  ctx.fillRect(x, y+4*s, 16*s, s);
  // Tail
  ctx.fillStyle = '#4a7a5a';
  ctx.fillRect(x-6*s, y+5*s, 7*s, 3*s);
  ctx.fillRect(x-9*s, y+6*s, 4*s, 2*s);
  // Legs (stubby)
  ctx.fillStyle = '#5a8a6a';
  ctx.fillRect(x+2*s, y+9*s, 3*s, 3*s);
  ctx.fillRect(x+9*s, y+9*s, 3*s, 3*s);
  // Eye
  ctx.fillStyle = C.black;
  ctx.fillRect(x+17*s, y+2*s, 3*s, 3*s);
  ctx.fillStyle = '#f0f000';
  ctx.fillRect(x+18*s, y+2*s, s, s);
  // Mouth + tongue
  if (threatening) {
    ctx.fillStyle = '#e03030';
    ctx.fillRect(x+13*s, y+6*s, 8*s, 3*s);
    // Blue tongue extended
    ctx.fillStyle = '#4a90d9';
    ctx.fillRect(x+21*s, y+6*s, 5*s, 2*s);
    ctx.fillRect(x+24*s, y+5*s, 3*s, s);
    ctx.fillRect(x+24*s, y+8*s, 3*s, s);
  } else {
    ctx.fillStyle = '#5a8070';
    ctx.fillRect(x+13*s, y+6*s, 8*s, 2*s);
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
  // Date
  const gd = getGameDate();
  document.getElementById('date-display').textContent = formatDate(gd);
  // Age stage
  const ageEl = document.getElementById('age-label');
  if (gs.isAdult) ageEl.textContent = t('age_adult');
  else if (gs.gameDaysPassed > 180) ageEl.textContent = t('age_juvenile');
  else ageEl.textContent = t('age_baby');
  // Lizard name
  document.getElementById('lizard-name-label').textContent = lizardName || '???';
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
  gs.lastFedGameDay = currentDay;
  gs.hunger = Math.min(100, gs.hunger + 40);
  gs.happy = Math.min(100, gs.happy + 10);
  // Growth
  if (lizardType === 'crestie') gs.weight = Math.min(50, gs.weight + 0.3);
  else gs.weight = Math.min(600, gs.weight + 4);
  showMsg(t('feed_ok'));
  saveGame();
}

function doWater() {
  if (!gs || !gs.bornAnim) return;
  if ((gs.hydration || 0) > 70) { showMsg(t('water_no')); return; }
  gs.hydration = Math.min(100, (gs.hydration || 0) + 50);
  gs.happy = Math.min(100, gs.happy + 5);
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
    // Adult notification
    if (gs.isAdult && !gs.adultNotified) {
      gs.adultNotified = true;
      showMsg(t('adult_msg'), 5000);
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

  // Setinterval to update date display
  setInterval(() => {
    if (scene === SCENE.ROOM && gs) {
      updateGameTime();
      const gd = getGameDate();
      document.getElementById('date-display').textContent = formatDate(gd);
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
}
