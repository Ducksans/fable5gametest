/* ============================================================
   판교 더 서바이벌: 바이브 코딩 네크로맨서의 강림
   원작 기획: zari-harmony-room issue #667 (로어 01~30)
   덕산은 직접 때리지 않는다. 소환수가 때린다.
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

// ---------- 입력 ----------
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['Space', 'KeyE', 'KeyR', 'Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
    e.preventDefault();
    if (game.running) castSkill(e.code);
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

// ---------- 게임 상태 ----------
const game = {};

function resetGame() {
  Object.assign(game, {
    running: false,
    time: 0,
    wave: 0,
    kills: 0,
    coins: 0,
    ultGauge: 0,        // 100이면 PASS 선언 가능
    banner: null,       // {text, sub, t}
    waveTimer: 0,
    betweenWaves: true,
    shake: 0,
  });
  player = {
    x: W / 2, y: H / 2, r: 14,
    hp: 100, maxHp: 100,
    mana: 100, maxMana: 100, manaRegen: 8,
    speed: 175,
    level: 1, xp: 0, xpNext: 30,
    invuln: 0,
  };
  summons = []; enemies = []; projectiles = [];
  corpses = []; particles = []; orbs = []; texts = [];
}

let player, summons, enemies, projectiles, corpses, particles, orbs, texts;
resetGame();

// ---------- 소환수 정의 (로어 02~05) ----------
const SUMMON_DEFS = {
  golem: {  // AG 스톤 골렘 — UX/아키텍처 탱커
    name: 'AG 골렘', cost: 35, hp: 220, dmg: 10, speed: 70, r: 18,
    range: 30, cooldown: 1.1, color: '#8a97b8', taunt: true, unique: true,
    quote: 'AG 골렘 소환 — "방향은 내가 잡는다"',
  },
  warrior: { // CG 스켈레톤 워리어 — 백엔드 물리딜러
    name: 'CG 워리어', cost: 30, hp: 90, dmg: 16, speed: 150, r: 12,
    range: 26, cooldown: 0.45, color: '#7ee0a3', unique: true,
    quote: 'CG 워리어 소환 — "미친 타이핑 시작"',
  },
  mage: {   // GG 스켈레톤 메이지 — 무결성 드릴 원거리
    name: 'GG 메이지', cost: 30, hp: 60, dmg: 13, speed: 110, r: 11,
    range: 260, cooldown: 0.9, color: '#c792ea', ranged: true, unique: true,
    quote: 'GG 메이지 소환 — "무결성 드릴 발사 준비"',
  },
  minion: { // 서브에이전트 스켈레톤 (로어 05: 동시 캡 16, 웨이브 운용)
    name: '서브에이전트', cost: 8, hp: 30, dmg: 6, speed: 165, r: 8,
    range: 22, cooldown: 0.6, color: '#e8e0c8',
  },
};
const MINION_CAP = 16; // 로어 05/30: "동시 소환 캡 & fan-out 물량전"

function summon(type) {
  const d = SUMMON_DEFS[type];
  if (d.unique && summons.some(s => s.type === type && s.hp > 0)) {
    addText(player.x, player.y - 30, '이미 소환됨!', '#ff9c9c'); return;
  }
  if (type === 'minion' && summons.filter(s => s.type === 'minion').length >= MINION_CAP) {
    addText(player.x, player.y - 30, `캡 도달 (${MINION_CAP}) — 웨이브로 굴려라!`, '#ff9c9c'); return;
  }
  if (player.mana < d.cost) {
    addText(player.x, player.y - 30, '아메리카노 부족! (마나)', '#9cc4ff'); return;
  }
  player.mana -= d.cost;
  const a = rand(0, Math.PI * 2);
  summons.push({
    type, ...d,
    x: player.x + Math.cos(a) * 40, y: player.y + Math.sin(a) * 40,
    maxHp: d.hp, atkTimer: 0,
  });
  if (d.quote) addText(player.x, player.y - 44, d.quote, '#ffd88a');
  spawnRing(player.x, player.y, d.color);
}

function castSkill(code) {
  if (code === 'Digit1') summon('golem');
  if (code === 'Digit2') summon('warrior');
  if (code === 'Digit3') summon('mage');
  if (code === 'Space') { // 스켈레톤 웨이브: 한 번에 4기
    for (let i = 0; i < 4; i++) summon('minion');
  }
  if (code === 'KeyE') corpseExplosion();
  if (code === 'KeyR') passDeclaration();
}

// ---------- 키보드 폭발 (로어 07: Corpse Explosion 오마주) ----------
function corpseExplosion() {
  const R = 200, DMG = 30 + player.level * 6;
  let used = 0;
  for (const c of corpses) {
    if (c.used) continue;
    if (dist2(c, player) < R * R) {
      c.used = true; used++;
      // 키캡 파편 (Shrapnel)
      for (let i = 0; i < 14; i++) {
        const a = rand(0, Math.PI * 2), sp = rand(80, 300);
        particles.push({
          x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: rand(0.5, 1.0), t: 0, kind: 'keycap',
          ch: KEYCAPS[Math.floor(rand(0, KEYCAPS.length))],
          color: ['#ffd88a', '#7ee0a3', '#c792ea', '#9cc4ff'][Math.floor(rand(0, 4))],
        });
      }
      spawnRing(c.x, c.y, '#ffb648');
      for (const e of enemies) {
        if (dist2(c, e) < 120 * 120) damageEnemy(e, DMG, '#ffb648');
      }
    }
  }
  if (used > 0) {
    game.shake = 8;
    addText(player.x, player.y - 44, `키보드 폭발 x${used}! 따다다닥!!`, '#ffb648');
  } else {
    addText(player.x, player.y - 30, '터트릴 시체(해결된 버그)가 없다', '#8a97b8');
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
  setBanner('✅ PASS 선언!', '증거 확보 — 라운드 강제 클리어');
  for (const e of [...enemies]) damageEnemy(e, 9999, '#7ee0a3');
  player.hp = Math.min(player.maxHp, player.hp + 30);
  for (let i = 0; i < 60; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(100, 400);
    particles.push({
      x: player.x, y: player.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: rand(0.6, 1.2), t: 0, kind: 'keycap',
      ch: 'PASS'[Math.floor(rand(0, 4))], color: '#7ee0a3',
    });
  }
}

// ---------- 몬스터 (로어 22/24: 버그류 잡몹 도감) ----------
const ENEMY_DEFS = {
  nullptr: { name: 'Null Pointer', hp: 26, dmg: 8, speed: 95, r: 11, color: '#ff6b6b', xp: 6, coin: 1, label: 'null' },
  infloop: { name: '무한 루프', hp: 44, dmg: 10, speed: 70, r: 13, color: '#f7c948', xp: 10, coin: 2, label: 'for(;;)', orbit: true },
  race:    { name: '레이스 컨디션', hp: 20, dmg: 12, speed: 150, r: 9, color: '#c792ea', xp: 9, coin: 2, label: 'race' },
  boss:    { name: '레거시 코드 골렘', hp: 900, dmg: 22, speed: 45, r: 34, color: '#b8860b', xp: 120, coin: 40, label: 'LEGACY', boss: true },
};

function spawnEnemy(type, mult) {
  const d = ENEMY_DEFS[type];
  const side = Math.floor(rand(0, 4));
  let x, y;
  if (side === 0) { x = rand(0, W); y = -30; }
  else if (side === 1) { x = rand(0, W); y = H + 30; }
  else if (side === 2) { x = -30; y = rand(0, H); }
  else { x = W + 30; y = rand(0, H); }
  enemies.push({
    type, ...d,
    x, y, hp: d.hp * mult, maxHp: d.hp * mult, dmg: d.dmg * (0.8 + mult * 0.2),
    atkTimer: 0, orbitA: rand(0, Math.PI * 2),
  });
}

function startWave() {
  game.wave++;
  game.betweenWaves = false;
  const w = game.wave;
  const mult = 1 + (w - 1) * 0.25;
  if (w % 5 === 0) {
    setBanner(`WAVE ${w} — 보스 출현`, '레거시 코드 골렘: "고치지 마... 돌아는 가잖아..."');
    spawnEnemy('boss', 1 + (w / 5 - 1) * 0.6);
    for (let i = 0; i < 4 + w; i++) spawnEnemy('nullptr', mult);
  } else {
    setBanner(`WAVE ${w}`, w === 1 ? '판교역 3번 출구 — 길바닥 버그 파밍 시작' : '버그 스폰 감지');
    const n = 5 + w * 2;
    for (let i = 0; i < n; i++) {
      const roll = Math.random();
      spawnEnemy(roll < 0.5 ? 'nullptr' : roll < 0.8 ? 'infloop' : 'race', mult);
    }
  }
}

// ---------- 데미지/보상 ----------
function damageEnemy(e, dmg, color) {
  e.hp -= dmg;
  addText(e.x, e.y - e.r - 6, Math.floor(dmg), color || '#fff', 0.6);
  if (e.hp <= 0 && !e.dead) {
    e.dead = true;
    game.kills++;
    game.ultGauge = Math.min(100, game.ultGauge + (e.boss ? 40 : 5));
    corpses.push({ x: e.x, y: e.y, t: 0, boss: !!e.boss });
    for (let i = 0; i < (e.boss ? 8 : 2); i++) {
      orbs.push({ x: e.x + rand(-14, 14), y: e.y + rand(-14, 14), kind: i % 2 ? 'coin' : 'xp', v: e.boss ? 8 : 3 });
    }
    if (e.boss) {
      setBanner('보스 처치!', '"결국... 리팩토링 당했군..." — 레거시 코드 골렘');
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
    player.maxHp += 12; player.hp = player.maxHp;
    player.maxMana += 8; player.mana = player.maxMana;
    setBanner(`LEVEL UP! Lv.${player.level}`, '바이브 코딩 숙련도 상승 — 소환수 강화');
    for (const s of summons) { s.dmg *= 1.08; s.maxHp *= 1.08; s.hp = s.maxHp; }
  }
}

// ---------- 이펙트 ----------
function addText(x, y, str, color, life) {
  texts.push({ x, y, str, color: color || '#fff', t: 0, life: life || 1.2 });
}
function setBanner(text, sub) { game.banner = { text, sub, t: 0 }; }
function spawnRing(x, y, color) { particles.push({ x, y, kind: 'ring', t: 0, life: 0.5, color }); }

// ---------- 업데이트 ----------
function update(dt) {
  game.time += dt;
  game.shake = Math.max(0, game.shake - dt * 30);

  // 플레이어 이동 (덕산은 때리지 않는다. 도망칠 뿐.)
  let dx = 0, dy = 0;
  if (keys['KeyW'] || keys['ArrowUp']) dy -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) dy += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) dx -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) dx += 1;
  if (dx || dy) {
    const m = Math.hypot(dx, dy);
    player.x = clamp(player.x + dx / m * player.speed * dt, player.r, W - player.r);
    player.y = clamp(player.y + dy / m * player.speed * dt, player.r, H - player.r);
  }
  player.mana = Math.min(player.maxMana, player.mana + player.manaRegen * dt);
  player.invuln = Math.max(0, player.invuln - dt);

  // 소환수 AI
  for (const s of summons) {
    s.atkTimer -= dt;
    let target = null, best = Infinity;
    for (const e of enemies) {
      const d2 = dist2(s, e);
      if (d2 < best) { best = d2; target = e; }
    }
    if (target) {
      const d = Math.sqrt(best);
      const inRange = d < s.range + target.r;
      if (!inRange) {
        s.x += (target.x - s.x) / d * s.speed * dt;
        s.y += (target.y - s.y) / d * s.speed * dt;
      } else if (s.atkTimer <= 0) {
        s.atkTimer = s.cooldown;
        if (s.ranged) {
          projectiles.push({
            x: s.x, y: s.y, tx: target.x, ty: target.y,
            vx: (target.x - s.x) / d * 340, vy: (target.y - s.y) / d * 340,
            dmg: s.dmg, life: 1.2, t: 0, color: s.color,
          });
        } else {
          damageEnemy(target, s.dmg, s.color);
        }
      }
    } else {
      // 대기: 덕산 주변 배회
      const d = Math.sqrt(dist2(s, player));
      if (d > 70) {
        s.x += (player.x - s.x) / d * s.speed * dt;
        s.y += (player.y - s.y) / d * s.speed * dt;
      }
    }
  }
  summons = summons.filter(s => s.hp > 0);

  // 투사체 (GG 무결성 드릴)
  for (const p of projectiles) {
    p.t += dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    for (const e of enemies) {
      if (!e.dead && dist2(p, e) < (e.r + 5) * (e.r + 5)) {
        damageEnemy(e, p.dmg, p.color);
        p.t = 99; break;
      }
    }
  }
  projectiles = projectiles.filter(p => p.t < p.life);

  // 몬스터 AI: 골렘(탱커) 어그로 우선, 없으면 가까운 소환수/플레이어
  const golem = summons.find(s => s.taunt);
  for (const e of enemies) {
    e.atkTimer -= dt;
    let target = golem || null;
    if (!target) {
      let best = dist2(e, player) * 0.6; // 플레이어 약간 선호 (긴장감)
      target = player;
      for (const s of summons) {
        const d2 = dist2(e, s);
        if (d2 < best) { best = d2; target = s; }
      }
    }
    const d = Math.sqrt(dist2(e, target)) || 1;
    if (e.orbit) { // 무한 루프: 빙글빙글 돌며 접근
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

  // 오브 흡수 (XP/코인)
  for (const o of orbs) {
    const d = Math.sqrt(dist2(o, player));
    if (d < 120) { o.x += (player.x - o.x) / d * 260 * dt; o.y += (player.y - o.y) / d * 260 * dt; }
    if (d < player.r + 8) {
      o.got = true;
      if (o.kind === 'xp') gainXp(o.v); else game.coins += o.v;
    }
  }
  orbs = orbs.filter(o => !o.got);

  // 시체 소멸 (20초)
  for (const c of corpses) c.t += dt;
  corpses = corpses.filter(c => !c.used && c.t < 20);

  // 파티클/텍스트
  for (const p of particles) { p.t += dt; if (p.kind === 'keycap') { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; } }
  particles = particles.filter(p => p.t < p.life);
  for (const t of texts) { t.t += dt; t.y -= 26 * dt; }
  texts = texts.filter(t => t.t < t.life);
  if (game.banner) { game.banner.t += dt; if (game.banner.t > 3) game.banner = null; }

  // 웨이브 진행
  if (!game.betweenWaves && enemies.length === 0) {
    game.betweenWaves = true;
    game.waveTimer = 3;
    if (game.wave > 0) setBanner(`WAVE ${game.wave} 클리어`, '3초 후 다음 웨이브 — 아메리카노 한 모금');
  }
  if (game.betweenWaves) {
    game.waveTimer -= dt;
    if (game.waveTimer <= 0) startWave();
  }
}

function gameOver() {
  game.running = false;
  document.getElementById('goTitle').textContent = 'YOU DIED';
  document.getElementById('goDesc').textContent =
    `WAVE ${game.wave} · 처치 ${game.kills} · 코인 ${game.coins} — 덕산은 다시 부동산으로 돌아갔다...`;
  document.getElementById('gameOverScreen').classList.remove('hidden');
}

// ---------- 렌더 ----------
function drawBackground() {
  // 판교역 3번 출구 — 다크 보도블럭
  ctx.fillStyle = '#12161f';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(60,72,100,0.25)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  // 3번 출구 표지판
  ctx.fillStyle = 'rgba(30,40,60,0.9)';
  ctx.fillRect(W / 2 - 90, 8, 180, 26);
  ctx.fillStyle = '#9cc4ff';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('판교역 3번 출구 ▶', W / 2, 26);
}

function drawEntity(e, label) {
  ctx.beginPath();
  ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
  ctx.fillStyle = e.color;
  ctx.fill();
  if (label) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.font = `bold ${e.r > 20 ? 12 : 9}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(label, e.x, e.y + 3);
  }
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
  drawBackground();

  // 시체 (해결된 버그 = 폭발 재료)
  for (const c of corpses) {
    ctx.globalAlpha = clamp(1 - c.t / 20, 0.2, 0.8);
    ctx.fillStyle = c.boss ? '#8a6d1f' : '#4a5266';
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, c.boss ? 24 : 10, c.boss ? 12 : 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 오브
  for (const o of orbs) {
    ctx.beginPath();
    ctx.arc(o.x, o.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = o.kind === 'coin' ? '#ffd700' : '#7ee0a3';
    ctx.fill();
  }

  // 소환수
  for (const s of summons) {
    drawEntity(s, s.type === 'golem' ? 'AG' : s.type === 'warrior' ? 'CG' : s.type === 'mage' ? 'GG' : 'sub');
    drawBar(s.x - s.r, s.y - s.r - 7, s.r * 2, 3, s.hp / s.maxHp, '#7ee0a3');
  }

  // 몬스터
  for (const e of enemies) {
    drawEntity(e, e.label);
    drawBar(e.x - e.r, e.y - e.r - 8, e.r * 2, e.boss ? 5 : 3, e.hp / e.maxHp, '#ff6b6b');
  }

  // 투사체
  for (const p of projectiles) {
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
    ctx.stroke();
  }

  // 덕산 (흰 런닝의 네크로맨서)
  ctx.save();
  if (player.invuln > 0 && Math.floor(game.time * 20) % 2) ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
  ctx.fillStyle = '#f5f5f0';
  ctx.fill();
  ctx.strokeStyle = '#ffb648';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#12161f';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('덕산', player.x, player.y + 3);
  ctx.restore();

  // 파티클
  for (const p of particles) {
    const a = 1 - p.t / p.life;
    if (p.kind === 'ring') {
      ctx.globalAlpha = a;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10 + p.t / p.life * 60, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(p.ch, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  // 플로팅 텍스트
  for (const t of texts) {
    ctx.globalAlpha = clamp(1 - t.t / t.life, 0, 1);
    ctx.fillStyle = t.color;
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t.str, t.x, t.y);
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
  ctx.fillText(`WAVE ${game.wave}`, W - 16, 26);
  ctx.font = '11px sans-serif';
  ctx.fillText(`처치 ${game.kills} · 코인 ${game.coins}`, W - 16, 44);
  const mc = summons.filter(s => s.type === 'minion').length;
  ctx.fillText(`서브에이전트 ${mc}/${MINION_CAP}`, W - 16, 60);

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
requestAnimationFrame(loop);

// ---------- 시작 ----------
document.getElementById('startBtn').addEventListener('click', () => {
  document.getElementById('titleScreen').classList.add('hidden');
  resetGame();
  game.running = true;
  setBanner('강림', '덕산, 판교역 3번 출구에 나타나다');
});
document.getElementById('retryBtn').addEventListener('click', () => {
  document.getElementById('gameOverScreen').classList.add('hidden');
  resetGame();
  game.running = true;
  setBanner('재강림', '"이번엔 안 죽는다" — 덕산');
});
