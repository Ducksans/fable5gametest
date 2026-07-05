/* ============================================================
   판교 더 서바이벌: 바이브 코딩 네크로맨서의 강림 (v2 쿼터뷰)
   원작 기획: zari-harmony-room issue #667 (로어 01~30)
   디아블로식 아이소메트릭 ARPG — 마우스로 걷고, 소환수가 때린다.
   ============================================================ */
'use strict';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

// ---------- 유틸 ----------
const rand = (a, b) => a + Math.random() * (b - a);
const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const KEYCAPS = 'QWERTYASDFGHJKZXCVBNM{};:'.split('');

// ---------- 아이소메트릭 투영 ----------
const ISO_X = 0.9, ISO_Y = 0.45;      // 2:1 쿼터뷰
const WORLD = 2200;                    // 월드 한 변 (판교 한 블록)
const TILE = 90;

function proj(wx, wy) { return { x: (wx - wy) * ISO_X, y: (wx + wy) * ISO_Y }; }
function toScreen(wx, wy) {
  const p = proj(wx, wy), c = proj(player.x, player.y);
  return { x: W / 2 + p.x - c.x, y: H / 2 + 30 + p.y - c.y };
}
function toWorld(sx, sy) {
  const dx = sx - W / 2, dy = sy - (H / 2 + 30);
  const A = dx / ISO_X, B = dy / ISO_Y;
  return { x: player.x + (A + B) / 2, y: player.y + (B - A) / 2 };
}

// ---------- 입력 ----------
const keys = {};
let mouse = { sx: W / 2, sy: H / 2, down: false };
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['Space', 'KeyQ', 'KeyW', 'KeyE', 'KeyR'].includes(e.code)) {
    e.preventDefault();
    if (game.running) castSkill(e.code);
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  const r = canvas.getBoundingClientRect();
  mouse.sx = e.clientX - r.left; mouse.sy = e.clientY - r.top;
  if (!game.running) return;
  if (e.button === 0) {
    mouse.down = true;
    leftCommand();
  } else if (e.button === 2) {
    corpseExplosion(toWorld(mouse.sx, mouse.sy)); // 우클릭: 커서 위치 시체 폭발
  }
});
canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouse.sx = e.clientX - r.left; mouse.sy = e.clientY - r.top;
  if (mouse.down && game.running) player.moveTarget = toWorld(mouse.sx, mouse.sy);
});
window.addEventListener('mouseup', () => { mouse.down = false; });

function leftCommand() {
  // 몬스터 클릭 = 지휘("저기 쳐" — 로어 17의 R 지휘를 좌클릭으로), 바닥 클릭 = 이동
  const wpt = toWorld(mouse.sx, mouse.sy);
  let picked = null, best = 40 * 40;
  for (const e of enemies) {
    const d2 = dist2(wpt, e);
    if (d2 < Math.max(best, (e.r + 14) * (e.r + 14))) { best = d2; picked = e; }
  }
  if (picked) {
    game.focusTarget = picked;
    picked.aggro = true;
    addText(picked.x, picked.y - picked.r - 14, '"저기 쳐!"', '#ffd88a', 0.8);
    player.moveTarget = null;
  } else {
    game.focusTarget = null;
    player.moveTarget = wpt;
  }
}

// ---------- 게임 상태 ----------
const game = {};
let player, summons, enemies, projectiles, corpses, particles, orbs, texts, decos;
let minionBatchCd = 0;

function newPlayer() {
  return {
    x: 320, y: 320, r: 14,
    hp: 120, maxHp: 120,
    mana: 100, maxMana: 100, manaRegen: 9,
    speed: 195,
    level: 1, xp: 0, xpNext: 30,
    invuln: 0, moveTarget: null,
  };
}

function resetGame(act) {
  Object.assign(game, {
    running: false, time: 0,
    act: act || 1,
    kills: act ? game.kills : 0, coins: act ? (game.coins || 0) : 0,
    ultGauge: 0, banner: null, shake: 0,
    focusTarget: null, bossDown: false, actClearT: 0,
  });
  if (!player || !act) player = newPlayer();
  player.x = 320; player.y = 320; player.moveTarget = null;
  summons = []; enemies = []; projectiles = [];
  corpses = []; particles = []; orbs = []; texts = [];
  minionBatchCd = 0;
  buildWorld();
}

// ---------- 소환수 정의 (로어 02~05) ----------
const SUMMON_DEFS = {
  golem: {  // AG 스톤 골렘 — UX/아키텍처 탱커 [E]
    name: 'AG 골렘', cost: 35, hp: 260, dmg: 11, speed: 85, r: 18,
    range: 34, cooldown: 1.1, color: '#8a97b8', taunt: true, unique: true,
    quote: 'AG 골렘 소환 — "방향은 내가 잡는다"',
  },
  warrior: { // CG 스켈레톤 워리어 — 백엔드 물리딜러 [Q]
    name: 'CG 워리어', cost: 30, hp: 110, dmg: 17, speed: 175, r: 12,
    range: 30, cooldown: 0.45, color: '#7ee0a3', unique: true,
    quote: 'CG 워리어 소환 — "미친 타이핑 시작"',
  },
  mage: {   // GG 스켈레톤 메이지 — 무결성 드릴 원거리 [W]
    name: 'GG 메이지', cost: 30, hp: 70, dmg: 14, speed: 130, r: 11,
    range: 300, cooldown: 0.9, color: '#c792ea', ranged: true, unique: true,
    quote: 'GG 메이지 소환 — "무결성 드릴 발사 준비"',
  },
  minion: { // 서브에이전트 스켈레톤 (로어 05 정본: HP 1, 유지 45초, 배치 쿨 3초)
    name: '서브에이전트', cost: 8, hp: 1, dmg: 7, speed: 190, r: 8,
    range: 24, cooldown: 0.6, color: '#e8e0c8', duration: 45,
  },
};
const MINION_CAP = 16;       // 로어 05/30: "동시 소환 캡 & fan-out 물량전"
const MINION_BATCH_CD = 3;   // 로어 05/30: 배치당 3초

function summon(type) {
  const d = SUMMON_DEFS[type];
  if (d.unique && summons.some(s => s.type === type && s.hp > 0)) {
    addText(player.x, player.y - 30, '이미 소환됨!', '#ff9c9c'); return;
  }
  if (type === 'minion') {
    if (minionBatchCd > 0) { addText(player.x, player.y - 30, `배치 쿨타임 ${minionBatchCd.toFixed(1)}초`, '#ff9c9c'); return; }
    if (summons.filter(s => s.type === 'minion').length >= MINION_CAP) {
      addText(player.x, player.y - 30, `캡 도달 (${MINION_CAP}) — 웨이브로 굴려라!`, '#ff9c9c'); return;
    }
  }
  if (player.mana < d.cost) { addText(player.x, player.y - 30, '아메리카노 부족! (마나)', '#9cc4ff'); return; }
  player.mana -= d.cost;
  const a = rand(0, Math.PI * 2);
  summons.push({
    type, ...d,
    x: player.x + Math.cos(a) * 46, y: player.y + Math.sin(a) * 46,
    maxHp: d.hp, atkTimer: 0, lifeLeft: d.duration || Infinity,
  });
  if (d.quote) addText(player.x, player.y - 46, d.quote, '#ffd88a');
  spawnRing(player.x, player.y, d.color);
}

function castSkill(code) {
  // 로어 17 정본 키 배치: Q=CG, W=GG, E=AG (+R=PASS: 로어 11)
  if (code === 'KeyQ') summon('warrior');
  if (code === 'KeyW') summon('mage');
  if (code === 'KeyE') summon('golem');
  if (code === 'Space') {
    if (minionBatchCd > 0) {
      addText(player.x, player.y - 30, `배치 쿨타임 ${minionBatchCd.toFixed(1)}초`, '#ff9c9c');
    } else {
      const before = summons.filter(s => s.type === 'minion').length;
      for (let i = 0; i < 4; i++) summon('minion');
      if (summons.filter(s => s.type === 'minion').length > before) minionBatchCd = MINION_BATCH_CD;
    }
  }
  if (code === 'KeyR') passDeclaration();
}

// ---------- 키보드 폭발 (로어 07: Corpse Explosion — 커서 지정) ----------
function corpseExplosion(at) {
  const R = 170, DMG = 32 + player.level * 6;
  let used = 0;
  for (const c of corpses) {
    if (c.used) continue;
    if (dist2(c, at) < R * R) {
      c.used = true; used++;
      for (let i = 0; i < 14; i++) {
        const a = rand(0, Math.PI * 2), sp = rand(60, 220);
        particles.push({
          x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          z: 8, vz: rand(80, 220),
          life: rand(0.5, 1.0), t: 0, kind: 'keycap',
          ch: KEYCAPS[Math.floor(rand(0, KEYCAPS.length))],
          color: ['#ffd88a', '#7ee0a3', '#c792ea', '#9cc4ff'][Math.floor(rand(0, 4))],
        });
      }
      spawnRing(c.x, c.y, '#ffb648');
      for (const e of enemies) {
        if (dist2(c, e) < 130 * 130) damageEnemy(e, DMG, '#ffb648');
      }
    }
  }
  if (used > 0) {
    game.shake = 8;
    addText(at.x, at.y - 40, `키보드 폭발 x${used}! 따다다닥!!`, '#ffb648');
  } else {
    addText(at.x, at.y - 20, '터트릴 시체(해결된 버그)가 없다', '#8a97b8');
  }
}

// ---------- 궁극기: PASS 선언 (로어 11) ----------
function passDeclaration() {
  if (game.ultGauge < 100) {
    addText(player.x, player.y - 30, `PASS 게이지 ${Math.floor(game.ultGauge)}% — 증거가 부족하다`, '#8a97b8');
    return;
  }
  game.ultGauge = 0;
  game.shake = 16;
  setBanner('✅ PASS 선언!', '증거 확보 — 시야 내 버그 일괄 소탕 (보스는 저항한다)');
  for (const e of [...enemies]) {
    if (dist2(e, player) < 750 * 750) {
      // 보스는 "증거 몇 장으로 못 넘어간다" — 고정 피해만
      damageEnemy(e, e.boss ? 250 : 9999, '#7ee0a3', { force: true });
    }
  }
  player.hp = Math.min(player.maxHp, player.hp + 30);
  for (let i = 0; i < 60; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(80, 320);
    particles.push({
      x: player.x, y: player.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      z: 8, vz: rand(80, 260),
      life: rand(0.6, 1.2), t: 0, kind: 'keycap',
      ch: 'PASS'[Math.floor(rand(0, 4))], color: '#7ee0a3',
    });
  }
}

// ---------- 몬스터 (로어 17/20/24 정본) ----------
const ENEMY_DEFS = {
  nullptr: { name: '널포인터 슬라임', hp: 40, dmg: 6, speed: 60, r: 12, color: '#ff6b6b', xp: 12, coin: 2, label: 'null' },
  infloop: { name: '무한루프 도깨비불', hp: 9999, dmg: 4, speed: 78, r: 13, color: '#5bc8f7', xp: 25, coin: 3, label: 'for(;;)', orbit: true, wisp: true },
  race:    { name: '레이스 컨디션', hp: 24, dmg: 12, speed: 165, r: 9, color: '#c792ea', xp: 9, coin: 2, label: 'race' },
  elite:   { name: '머지 컨플릭트 정령', hp: 160, dmg: 14, speed: 90, r: 17, color: '#f7734b', xp: 40, coin: 8, label: '<<<<<<<', elite: true },
  boss:    { name: '레거시 코드 골렘', hp: 1400, dmg: 24, speed: 55, r: 36, color: '#b8860b', xp: 200, coin: 60, label: 'LEGACY', boss: true },
};

function spawnEnemyAt(type, x, y, mult) {
  const d = ENEMY_DEFS[type];
  enemies.push({
    type, ...d,
    x, y, homeX: x, homeY: y,
    hp: d.hp * mult, maxHp: d.hp * mult, dmg: d.dmg * (0.8 + mult * 0.2),
    atkTimer: 0, orbitA: rand(0, Math.PI * 2), breakHits: 0,
    aggro: false, slamT: 5,
  });
}

// ---------- 월드 생성 (판교역 3번 출구 → 넥슨 사옥 방향) ----------
function buildWorld() {
  const mult = 1 + (game.act - 1) * 0.45;
  decos = [];
  // 몹팩: 스폰(320,320)에서 멀수록 강하게
  const packs = 15;
  for (let p = 0; p < packs; p++) {
    let px, py, dSpawn;
    do {
      px = rand(200, WORLD - 200); py = rand(200, WORLD - 200);
      dSpawn = Math.hypot(px - 320, py - 320);
    } while (dSpawn < 480 || Math.hypot(px - 1900, py - 1900) < 380);
    const tier = dSpawn / 2500; // 0~1
    const n = 3 + Math.floor(rand(2, 5));
    for (let i = 0; i < n; i++) {
      const roll = Math.random();
      let type = 'nullptr';
      if (tier > 0.25 && roll < 0.22) type = 'infloop';
      else if (roll < 0.45) type = 'race';
      spawnEnemyAt(type, px + rand(-70, 70), py + rand(-70, 70), mult);
    }
    if (tier > 0.45 && Math.random() < 0.5) spawnEnemyAt('elite', px, py, mult);
  }
  // 보스 아레나 (넥슨 사옥 방향 끝)
  spawnEnemyAt('boss', 1900, 1900, mult);
  for (let i = 0; i < 5; i++) spawnEnemyAt('nullptr', 1900 + rand(-140, 140), 1900 + rand(-140, 140), mult);
  // 장식: 가로등/화분 (아이소 기둥)
  for (let i = 0; i < 26; i++) decos.push({ x: rand(150, WORLD - 150), y: rand(150, WORLD - 150), h: rand(28, 60) });
}

// ---------- 데미지/보상 ----------
function damageEnemy(e, dmg, color, opts) {
  opts = opts || {};
  e.aggro = true;
  if (e.wisp && !opts.force) {
    if (!opts.drill) { addText(e.x, e.y - e.r - 6, '면역! break 필요', '#5bc8f7', 0.5); return; }
    e.breakHits++;
    addText(e.x, e.y - e.r - 6, `break ${e.breakHits}/3`, '#5bc8f7', 0.7);
    if (e.breakHits < 3) return;
    dmg = e.hp;
  }
  e.hp -= dmg;
  if (!e.wisp) addText(e.x, e.y - e.r - 6, Math.floor(dmg), color || '#fff', 0.6);
  if (e.hp <= 0 && !e.dead) {
    e.dead = true;
    game.kills++;
    game.ultGauge = Math.min(100, game.ultGauge + (e.boss ? 40 : e.elite ? 12 : 5));
    corpses.push({ x: e.x, y: e.y, t: 0, boss: !!e.boss });
    const drops = e.boss ? 10 : e.elite ? 4 : 2;
    for (let i = 0; i < drops; i++) {
      orbs.push({ x: e.x + rand(-16, 16), y: e.y + rand(-16, 16), kind: i % 2 ? 'coin' : 'xp', v: e.boss ? 10 : e.elite ? 5 : 3 });
    }
    if (game.focusTarget === e) game.focusTarget = null;
    if (e.boss) {
      game.bossDown = true;
      game.actClearT = 4;
      setBanner(`ACT ${game.act} CLEAR!`, '"결국... 리팩토링 당했군..." — 레거시 코드 골렘');
      game.shake = 14;
    }
  }
}

function gainXp(v) {
  player.xp += v;
  while (player.xp >= player.xpNext) {
    player.xp -= player.xpNext;
    player.level++;
    player.xpNext = Math.floor(player.xpNext * 1.35);
    player.maxHp += 14; player.hp = player.maxHp;
    player.maxMana += 8; player.mana = player.maxMana;
    setBanner(`LEVEL UP! Lv.${player.level}`, '바이브 코딩 숙련도 상승 — 소환수 강화');
    for (const s of summons) { s.dmg *= 1.08; s.maxHp *= 1.08; s.hp = s.maxHp; }
  }
}

// ---------- 이펙트 ----------
function addText(x, y, str, color, life) { texts.push({ x, y, str, color: color || '#fff', t: 0, life: life || 1.2 }); }
function setBanner(text, sub) { game.banner = { text, sub, t: 0 }; }
function spawnRing(x, y, color) { particles.push({ x, y, kind: 'ring', t: 0, life: 0.5, color }); }

// ---------- 업데이트 ----------
function update(dt) {
  game.time += dt;
  game.shake = Math.max(0, game.shake - dt * 30);
  minionBatchCd = Math.max(0, minionBatchCd - dt);

  // ACT 클리어 → 다음 ACT
  if (game.bossDown) {
    game.actClearT -= dt;
    if (game.actClearT <= 0) {
      const act = game.act + 1;
      resetGame(act);
      game.running = true;
      setBanner(`ACT ${act} — 판교는 넓다`, '난이도 상승 · 레벨과 커밋토큰은 유지된다');
      return;
    }
  }

  // 플레이어 이동: 마우스 목적지 or 방향키
  let dx = 0, dy = 0;
  if (keys['ArrowUp']) { dx -= 1; dy -= 1; }
  if (keys['ArrowDown']) { dx += 1; dy += 1; }
  if (keys['ArrowLeft']) { dx -= 1; dy += 1; }
  if (keys['ArrowRight']) { dx += 1; dy -= 1; }
  if (dx || dy) {
    player.moveTarget = null;
    const m = Math.hypot(dx, dy);
    player.x += dx / m * player.speed * dt;
    player.y += dy / m * player.speed * dt;
  } else if (player.moveTarget) {
    const t = player.moveTarget;
    const d = Math.hypot(t.x - player.x, t.y - player.y);
    if (d < 6) player.moveTarget = null;
    else {
      player.x += (t.x - player.x) / d * player.speed * dt;
      player.y += (t.y - player.y) / d * player.speed * dt;
    }
  }
  player.x = clamp(player.x, 30, WORLD - 30);
  player.y = clamp(player.y, 30, WORLD - 30);
  player.mana = Math.min(player.maxMana, player.mana + player.manaRegen * dt);
  player.invuln = Math.max(0, player.invuln - dt);

  // 소환수 AI (지휘 대상 우선 — "저기 쳐")
  for (const s of summons) {
    s.atkTimer -= dt;
    s.lifeLeft -= dt;
    if (s.lifeLeft <= 0 && s.hp > 0) { s.hp = 0; addText(s.x, s.y - 14, '귀환', '#8a97b8', 0.6); continue; }
    let target = null;
    if (game.focusTarget && !game.focusTarget.dead) target = game.focusTarget;
    else {
      let best = 420 * 420; // 소환수 교전 반경
      for (const e of enemies) {
        if (!e.aggro && dist2(e, player) > 340 * 340) continue; // 안 건드린 팩은 무시
        const d2 = dist2(s, e);
        if (d2 < best) { best = d2; target = e; }
      }
    }
    if (target) {
      const d = Math.sqrt(dist2(s, target)) || 1;
      if (d > s.range + target.r) {
        s.x += (target.x - s.x) / d * s.speed * dt;
        s.y += (target.y - s.y) / d * s.speed * dt;
      } else if (s.atkTimer <= 0) {
        s.atkTimer = s.cooldown;
        if (s.ranged) {
          projectiles.push({
            x: s.x, y: s.y,
            vx: (target.x - s.x) / d * 380, vy: (target.y - s.y) / d * 380,
            dmg: s.dmg, life: 1.1, t: 0, color: s.color,
          });
        } else {
          damageEnemy(target, s.dmg, s.color);
        }
      }
    } else {
      const d = Math.sqrt(dist2(s, player));
      if (d > 80) {
        s.x += (player.x - s.x) / d * s.speed * dt;
        s.y += (player.y - s.y) / d * s.speed * dt;
      }
    }
  }
  summons = summons.filter(s => s.hp > 0);

  // 투사체 (GG break 드릴)
  for (const p of projectiles) {
    p.t += dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    for (const e of enemies) {
      if (!e.dead && dist2(p, e) < (e.r + 6) * (e.r + 6)) {
        damageEnemy(e, p.dmg, p.color, { drill: true });
        p.t = 99; break;
      }
    }
  }
  projectiles = projectiles.filter(p => p.t < p.life);

  // 몬스터 AI: 어그로 반경 진입 시 교전, 골렘(탱커) 우선
  const golem = summons.find(s => s.taunt);
  for (const e of enemies) {
    e.atkTimer -= dt;
    if (!e.aggro) {
      if (dist2(e, player) < 300 * 300) e.aggro = true;
      else {
        let near = false;
        for (const s of summons) if (dist2(e, s) < 240 * 240) { near = true; break; }
        if (near) e.aggro = true;
      }
      if (!e.aggro) continue;
    }
    // 보스 슬램: "하드코딩 스탬프"
    if (e.boss) {
      e.slamT -= dt;
      if (e.slamT <= 0) {
        e.slamT = 6;
        spawnRing(e.x, e.y, '#ff5b5b');
        game.shake = 10;
        addText(e.x, e.y - e.r - 20, '하드코딩 스탬프!!', '#ff5b5b', 1.0);
        for (const t of [player, ...summons]) {
          if (dist2(e, t) < 170 * 170) {
            if (t === player) {
              if (player.invuln <= 0) { player.hp -= 25; player.invuln = 0.4; }
            } else t.hp -= 40;
          }
        }
        if (player.hp <= 0) return gameOver();
      }
    }
    let target = golem || null;
    if (!target) {
      let best = dist2(e, player) * 0.6;
      target = player;
      for (const s of summons) {
        const d2 = dist2(e, s);
        if (d2 < best) { best = d2; target = s; }
      }
    }
    const d = Math.sqrt(dist2(e, target)) || 1;
    if (e.orbit) {
      e.orbitA += dt * 2.2;
      e.x += ((target.x - e.x) / d * e.speed + Math.cos(e.orbitA) * 60) * dt;
      e.y += ((target.y - e.y) / d * e.speed + Math.sin(e.orbitA) * 60) * dt;
    } else {
      e.x += (target.x - e.x) / d * e.speed * dt;
      e.y += (target.y - e.y) / d * e.speed * dt;
    }
    if (d < e.r + target.r + 4 && e.atkTimer <= 0) {
      e.atkTimer = 0.8;
      if (target === player) {
        if (player.invuln <= 0) {
          player.hp -= e.dmg;
          player.invuln = 0.4;
          game.shake = 5;
          addText(player.x, player.y - 24, `-${Math.floor(e.dmg)}`, '#ff6b6b');
          if (player.hp <= 0) return gameOver();
        }
      } else {
        target.hp -= e.dmg;
        addText(target.x, target.y - 20, `-${Math.floor(e.dmg)}`, '#ff9c9c', 0.5);
      }
    }
  }
  enemies = enemies.filter(e => !e.dead);

  // 오브 흡수
  for (const o of orbs) {
    const d = Math.sqrt(dist2(o, player));
    if (d < 140) { o.x += (player.x - o.x) / d * 280 * dt; o.y += (player.y - o.y) / d * 280 * dt; }
    if (d < player.r + 10) {
      o.got = true;
      if (o.kind === 'xp') gainXp(o.v); else game.coins += o.v;
    }
  }
  orbs = orbs.filter(o => !o.got);

  for (const c of corpses) c.t += dt;
  corpses = corpses.filter(c => !c.used && c.t < 25);

  for (const p of particles) {
    p.t += dt;
    if (p.kind === 'keycap') {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.z += p.vz * dt; p.vz -= 500 * dt;
      if (p.z < 0) p.z = 0;
    }
  }
  particles = particles.filter(p => p.t < p.life);
  for (const t of texts) { t.t += dt; t.y -= 26 * dt; }
  texts = texts.filter(t => t.t < t.life);
  if (game.banner) { game.banner.t += dt; if (game.banner.t > 3) game.banner = null; }
}

function gameOver() {
  game.running = false;
  document.getElementById('goTitle').textContent = 'YOU DIED';
  document.getElementById('goDesc').textContent =
    `ACT ${game.act} · Lv.${player.level} · 처치 ${game.kills} · 커밋토큰 ${game.coins} — 덕산은 다시 부동산으로 돌아갔다...`;
  document.getElementById('gameOverScreen').classList.remove('hidden');
}

// ---------- 렌더 ----------
function drawFloor() {
  ctx.fillStyle = '#0d1019';
  ctx.fillRect(0, 0, W, H);
  const ti = Math.floor(player.x / TILE), tj = Math.floor(player.y / TILE);
  const RANGE = 11;
  for (let i = ti - RANGE; i <= ti + RANGE; i++) {
    for (let j = tj - RANGE; j <= tj + RANGE; j++) {
      if (i < 0 || j < 0 || i * TILE >= WORLD || j * TILE >= WORLD) continue;
      const p0 = toScreen(i * TILE, j * TILE);
      const p1 = toScreen((i + 1) * TILE, j * TILE);
      const p2 = toScreen((i + 1) * TILE, (j + 1) * TILE);
      const p3 = toScreen(i * TILE, (j + 1) * TILE);
      if (Math.max(p0.x, p2.x) < -TILE || Math.min(p0.x, p2.x) > W + TILE) continue;
      if (p1.y < -TILE || p3.y > H + TILE * 2) continue;
      const cx = (i + 0.5) * TILE, cy = (j + 0.5) * TILE;
      let fill = (i + j) % 2 ? '#141926' : '#111623';
      if (Math.hypot(cx - 320, cy - 320) < 260) fill = (i + j) % 2 ? '#1a2438' : '#17202f';        // 판교역 광장
      if (Math.hypot(cx - 1900, cy - 1900) < 320) fill = (i + j) % 2 ? '#2a1a1a' : '#241616';      // 보스 아레나
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(70,84,120,0.10)';
      ctx.stroke();
    }
  }
  // 판교역 3번 출구 표지판 (스폰 랜드마크)
  const sign = toScreen(320, 200);
  if (sign.x > -100 && sign.x < W + 100 && sign.y > -60 && sign.y < H + 60) {
    ctx.fillStyle = '#1e2a44';
    ctx.fillRect(sign.x - 74, sign.y - 58, 148, 30);
    ctx.fillStyle = '#9cc4ff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('판교역 3번 출구 ▶', sign.x, sign.y - 38);
    ctx.strokeStyle = '#33415e';
    ctx.beginPath(); ctx.moveTo(sign.x, sign.y - 28); ctx.lineTo(sign.x, sign.y); ctx.stroke();
  }
  // 넥슨 사옥 방향 안내
  const nx = toScreen(1900, 1760);
  if (nx.x > -100 && nx.x < W + 100 && nx.y > -60 && nx.y < H + 60) {
    ctx.fillStyle = '#442020';
    ctx.fillRect(nx.x - 88, nx.y - 58, 176, 30);
    ctx.fillStyle = '#ff9c9c';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⚠ 레거시 유적지 (보스)', nx.x, nx.y - 38);
  }
}

function shadow(s, r) {
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(s.x, s.y, r, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawUnit(e, label, lift) {
  const s = toScreen(e.x, e.y);
  shadow(s, e.r);
  ctx.beginPath();
  ctx.arc(s.x, s.y - (lift || e.r * 0.8), e.r, 0, Math.PI * 2);
  ctx.fillStyle = e.color;
  ctx.fill();
  if (e.elite || e.boss) { ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2; ctx.stroke(); }
  if (label) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.font = `bold ${e.r > 20 ? 12 : 9}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(label, s.x, s.y - (lift || e.r * 0.8) + 3);
  }
  return s;
}

function drawBar(x, y, w, h, ratio, fg, bg) {
  ctx.fillStyle = bg || 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fg;
  ctx.fillRect(x, y, w * clamp(ratio, 0, 1), h);
}

function render() {
  ctx.save();
  if (game.shake > 0) ctx.translate(rand(-game.shake, game.shake), rand(-game.shake, game.shake));
  drawFloor();

  // 시체
  for (const c of corpses) {
    const s = toScreen(c.x, c.y);
    ctx.globalAlpha = clamp(1 - c.t / 25, 0.25, 0.8);
    ctx.fillStyle = c.boss ? '#8a6d1f' : '#4a5266';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, c.boss ? 26 : 11, c.boss ? 12 : 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // 오브
  for (const o of orbs) {
    const s = toScreen(o.x, o.y);
    ctx.beginPath();
    ctx.arc(s.x, s.y - 6, 5, 0, Math.PI * 2);
    ctx.fillStyle = o.kind === 'coin' ? '#ffd700' : '#7ee0a3';
    ctx.fill();
  }
  // 이동 목적지 마커
  if (player.moveTarget) {
    const s = toScreen(player.moveTarget.x, player.moveTarget.y);
    ctx.strokeStyle = 'rgba(126,224,163,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, 12, 6, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 유닛 z-정렬 (뒤→앞)
  const units = [];
  for (const d of decos) units.push({ z: d.x + d.y, kind: 'deco', e: d });
  for (const s of summons) units.push({ z: s.x + s.y, kind: 'summon', e: s });
  for (const e of enemies) units.push({ z: e.x + e.y, kind: 'enemy', e });
  units.push({ z: player.x + player.y, kind: 'player', e: player });
  units.sort((a, b) => a.z - b.z);

  for (const u of units) {
    if (u.kind === 'deco') {
      const s = toScreen(u.e.x, u.e.y);
      if (s.x < -40 || s.x > W + 40 || s.y < -80 || s.y > H + 40) continue;
      shadow(s, 7);
      ctx.strokeStyle = '#2c3550'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x, s.y - u.e.h); ctx.stroke();
      ctx.fillStyle = '#3d4a6e';
      ctx.beginPath(); ctx.arc(s.x, s.y - u.e.h, 5, 0, Math.PI * 2); ctx.fill();
    } else if (u.kind === 'summon') {
      const sEnt = u.e;
      const s = drawUnit(sEnt, sEnt.type === 'golem' ? 'AG' : sEnt.type === 'warrior' ? 'CG' : sEnt.type === 'mage' ? 'GG' : 'sub');
      drawBar(s.x - sEnt.r, s.y - sEnt.r * 0.8 - sEnt.r - 8, sEnt.r * 2, 3, sEnt.hp / sEnt.maxHp, '#7ee0a3');
    } else if (u.kind === 'enemy') {
      const e = u.e;
      const s = drawUnit(e, e.label);
      if (e.aggro || e.hp < e.maxHp) {
        drawBar(s.x - e.r, s.y - e.r * 0.8 - e.r - 9, e.r * 2, e.boss ? 5 : 3, e.wisp ? (1 - e.breakHits / 3) : e.hp / e.maxHp, e.wisp ? '#5bc8f7' : '#ff6b6b');
      }
      if (game.focusTarget === e) {
        ctx.strokeStyle = '#ffd88a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(s.x, s.y, e.r + 8, (e.r + 8) * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
      }
    } else {
      // 덕산
      const s = toScreen(player.x, player.y);
      ctx.save();
      if (player.invuln > 0 && Math.floor(game.time * 20) % 2) ctx.globalAlpha = 0.4;
      shadow(s, player.r);
      ctx.beginPath();
      ctx.arc(s.x, s.y - 12, player.r, 0, Math.PI * 2);
      ctx.fillStyle = '#f5f5f0';
      ctx.fill();
      ctx.strokeStyle = '#ffb648'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#12161f';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('덕산', s.x, s.y - 9);
      ctx.restore();
    }
  }

  // 투사체
  for (const p of projectiles) {
    const s = toScreen(p.x, p.y);
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - 10);
    ctx.lineTo(s.x - p.vx * 0.04 * ISO_X, s.y - 10 - (p.vx + p.vy) * 0.02);
    ctx.stroke();
  }

  // 파티클
  for (const p of particles) {
    const a = 1 - p.t / p.life;
    if (p.kind === 'ring') {
      const s = toScreen(p.x, p.y);
      ctx.globalAlpha = a;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 10 + p.t / p.life * 70, (10 + p.t / p.life * 70) * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const s = toScreen(p.x, p.y);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(p.ch, s.x, s.y - p.z);
    }
    ctx.globalAlpha = 1;
  }

  // 플로팅 텍스트
  for (const t of texts) {
    const s = toScreen(t.x, t.y);
    ctx.globalAlpha = clamp(1 - t.t / t.life, 0, 1);
    ctx.fillStyle = t.color;
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t.str, s.x, s.y - 30);
    ctx.globalAlpha = 1;
  }

  // HUD
  drawBar(16, 16, 220, 14, player.hp / player.maxHp, '#e05252');
  drawBar(16, 34, 220, 10, player.mana / player.maxMana, '#5b8def');
  drawBar(16, 48, 220, 6, player.xp / player.xpNext, '#7ee0a3');
  drawBar(16, 58, 220, 6, game.ultGauge / 100, game.ultGauge >= 100 ? '#ffd700' : '#8a97b8');
  ctx.fillStyle = '#e6e6e6';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`HP ${Math.ceil(player.hp)}/${player.maxHp}`, 242, 27);
  ctx.fillText(`아메리카노 ${Math.floor(player.mana)}`, 242, 43);
  ctx.fillText(`Lv.${player.level}`, 242, 55);
  ctx.fillText(game.ultGauge >= 100 ? 'PASS 준비완료! [R]' : `PASS ${Math.floor(game.ultGauge)}%`, 242, 66);
  ctx.textAlign = 'right';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText(`ACT ${game.act}`, W - 16, 26);
  ctx.font = '11px sans-serif';
  ctx.fillText(`남은 버그 ${enemies.length} · 처치 ${game.kills} · 커밋토큰 ${game.coins}`, W - 16, 44);
  const mc = summons.filter(s => s.type === 'minion').length;
  ctx.fillText(`서브에이전트 ${mc}/${MINION_CAP}` + (minionBatchCd > 0 ? ` · 배치쿨 ${minionBatchCd.toFixed(1)}s` : ''), W - 16, 60);

  // 보스 HP 바 (어그로 시)
  const boss = enemies.find(e => e.boss && e.aggro);
  if (boss) {
    drawBar(W / 2 - 220, H - 34, 440, 12, boss.hp / boss.maxHp, '#b8860b');
    ctx.fillStyle = '#ffd88a';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('레거시 코드 골렘 — "이 코드... 누가 짰지?" / "7년 전의 너다, 덕산."', W / 2, H - 42);
  }

  // 배너
  if (game.banner) {
    const a = game.banner.t < 0.3 ? game.banner.t / 0.3 : game.banner.t > 2.4 ? (3 - game.banner.t) / 0.6 : 1;
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.fillStyle = 'rgba(8,10,16,0.7)';
    ctx.fillRect(0, H / 2 - 52, W, 84);
    ctx.fillStyle = '#ffb648';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(game.banner.text, W / 2, H / 2 - 12);
    if (game.banner.sub) {
      ctx.fillStyle = '#c2cad9';
      ctx.font = '13px sans-serif';
      ctx.fillText(game.banner.sub, W / 2, H / 2 + 14);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ---------- 루프 ----------
let last = 0;
function loop(ts) {
  const dt = Math.min((ts - last) / 1000, 0.05);
  last = ts;
  if (game.running) update(dt);
  render();
  requestAnimationFrame(loop);
}

// ---------- 시작 ----------
resetGame();
requestAnimationFrame(loop);

document.getElementById('startBtn').addEventListener('click', () => {
  document.getElementById('titleScreen').classList.add('hidden');
  player = null;
  game.coins = 0;
  resetGame();
  game.running = true;
  setBanner('ACT 1 — 강림', '덕산, 판교역 3번 출구에 나타나다. 남동쪽에 레거시 유적지가 있다.');
});
document.getElementById('retryBtn').addEventListener('click', () => {
  document.getElementById('gameOverScreen').classList.add('hidden');
  player = null;
  game.coins = 0;
  resetGame();
  game.running = true;
  setBanner('재강림', '"이번엔 안 죽는다" — 덕산');
});
