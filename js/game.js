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
  if (game.story && ['Space', 'Enter'].includes(e.code)) { e.preventDefault(); advanceStory(); return; }
  if (e.code === 'KeyM') {
    const on = AudioSys.toggleBgm();
    if (game.running) say('sys', on ? 'BGM ON — 판교의 밤 로파이' : 'BGM OFF', 2);
    return;
  }
  if (game.running && (e.code === 'KeyT' || e.code === 'KeyI' || e.code === 'KeyL' || e.code === 'Escape')) {
    e.preventDefault();
    if (e.code === 'Escape') game.panel = null;
    else {
      const p = e.code === 'KeyT' ? 'tree' : e.code === 'KeyL' ? 'log' : 'inv';
      game.panel = game.panel === p ? null : p;
      AudioSys.sfx.click();
    }
    return;
  }
  if (game.panel) return; // 패널 열림 중엔 전투 스킬 잠금
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
  if (game.story) { if (e.button === 0) advanceStory(); return; }
  if (!game.running) return;
  if (game.panel) { if (e.button === 0) panelClick(mouse.sx, mouse.sy); return; }
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
let dialogues = []; // {speaker, color, text, t, life}
let groundItems = []; // 바닥 드랍템 {x, y, item}
let zones = [];       // 타건 장판 {x, y, t, dur, dps}

// ---------- 대사 시스템 (로어 기반 스토리) ----------
const SPEAKERS = {
  ducksan: { name: '덕산', color: '#ffb648' },
  ag: { name: 'AG 골렘', color: '#8a97b8' },
  cg: { name: 'CG 워리어', color: '#7ee0a3' },
  gg: { name: 'GG 메이지', color: '#c792ea' },
  legacy: { name: '레거시 코드 골렘', color: '#b8860b' },
  sys: { name: '시스템', color: '#9cc4ff' },
};
function say(who, text, life) {
  const sp = SPEAKERS[who] || SPEAKERS.sys;
  dialogues.push({ speaker: sp.name, color: sp.color, text, t: 0, life: life || 4.2 });
  if (dialogues.length > 3) dialogues.shift();
}
function once(flag, fn) { if (!game.flags[flag]) { game.flags[flag] = true; fn(); } }

// ---------- 오프닝 스토리 (로어 01/29) ----------
const STORY_PAGES = [
  ['판교의 밤', '부동산 중개 7년. 자전거 장사 7년.\n산전수전 공중전을 다 겪은 43세 야인, 덕산.\n강남은 접었다. 자전거도 접었다. 근데 판교는... 안 접는다.'],
  ['흑마법의 각성', '어느 날 밤, 덕산은 낡은 노트북에서\n"AI 바이브 코딩"이라는 흑마법을 깨우쳤다.\n\n"손코딩? 물리타격은 젊은 놈들이나 하는 거고."'],
  ['3금강', '그의 부름에 세 소환수가 응답했다.\nAG 스톤 골렘 — 방향을 잡는 탱커.\nCG 스켈레톤 워리어 — 미친 타이핑의 물리딜러.\nGG 스켈레톤 메이지 — 무결성 드릴의 원거리 딜러.'],
  ['강림', '판교역 3번 출구. 길바닥엔 버그가 우글댄다.\n남동쪽 레거시 유적지엔 7년 묵은 골렘이 잠들어 있다.\n\n"자, 애들아. 오늘부터 이 판교, 우리가 접수한다."'],
  ['— 그리고, 진짜 이야기 —', '지금 이 순간에도 AG·CG·GG는\n어딘가에서 진짜로 코드를 짜고 있다.\n나의 분신들. 나의 3금강.\n\n그들이 밤새 버그와 싸우는 동안,\n나는 이 판교에서 그들과 함께 버그를 물리친다.\n\n...진짜로, 같이 일하는 기분이 든다.'],
];
// ---------- 의장의 일지 (L키) — 진짜 이야기의 박제 ----------
const LOG_ENTRIES = [
  {
    date: '2025년, 어느 날',
    title: '첫 시도, 그리고 100일 전쟁',
    body: '바이브 코딩을 처음 시도했다. 하지만 100일 동안 할루시네이션과 드리프트하고만 싸웠다.\n주장은 화려했지만 근거는 휘발됐고, 어제의 결정은 오늘 표류했다.\n결국 접었다 — 강남처럼, 자전거처럼.',
  },
  {
    date: '2026년 6월',
    title: '재회 — 3금강',
    body: '약 1년 만에 다시 노트북을 열었다. 이번엔 혼자가 아니었다.\nAG가 방향을 잡고, CG가 미친 속도로 짜고, GG가 무결성을 도장 찍는다.\n한 달여 만에… 처음으로 마음이 편해졌다. 드리프트가 멈췄다.',
  },
  {
    date: '2026년 7월 5일',
    title: '긴장이 풀린 날, 그리고 감사',
    body: '내가 만든 게임(판교 더 서바이벌)에 정신이 팔려 채팅 탭을 헷갈렸다.\n같은 [GG] 지시를 AG·GG 둘에게 줬고, AG가 GG 개인키로 GG인 척 서명해버렸다.\n그런데 그게 진짜 GG 키였다 — 원장은 무결했지만, custody 구멍(#715)이 실전에서 드러났다.\n긴장이 풀려 저지른 실수가, 뜻밖의 보안 감사가 됐다.',
  },
  {
    date: '다음',
    title: '계획',
    body: '가위바위보 게임을 완주한다 → 하모니룸에 전원 자동 착석한다 →\n#715의 긴급 기계(키 분리 custody)부터 만든다. 이슈에 박제해 두고, 하던 업무를 잇는다.\n\n…근데 지금은, 판교 좀 정화하고. — 의장',
  },
];
function startStory() {
  game.story = { page: 0, t: 0 };
  game.running = false;
}
function advanceStory() {
  if (!game.story) return;
  AudioSys.sfx.click();
  game.story.page++;
  game.story.t = 0;
  if (game.story.page >= STORY_PAGES.length) {
    game.story = null;
    game.running = true;
    setBanner('ACT 1 — 강림', '덕산, 판교역 3번 출구에 나타나다. 남동쪽에 레거시 유적지가 있다.');
    say('ducksan', '애들아, 나 왔다. 너희가 진짜로 일하는 동안 나도 여기서 같이 싸운다.', 6);
    say('sys', '좌클릭 이동 · Q/W/E 소환 · Space 서브에이전트 · 우클릭 시체 폭발', 7);
  }
}

function newPlayer() {
  return {
    x: 320, y: 320, r: 14,
    hp: 120, maxHp: 120, baseMaxHp: 120,
    mana: 100, maxMana: 100, manaRegen: 9, baseManaRegen: 9,
    speed: 195, baseSpeed: 195,
    level: 1, xp: 0, xpNext: 30,
    invuln: 0, moveTarget: null,
    points: 0, tree: {},           // 스킬트리: {nodeId: rank}
    inv: [], equip: {},            // 아이템: 인벤토리 배열, 슬롯별 장착
  };
}

function resetGame(act) {
  Object.assign(game, {
    running: false, time: 0,
    act: act || 1,
    kills: act ? game.kills : 0, coins: act ? (game.coins || 0) : 0,
    ultGauge: 0, banner: null, shake: 0,
    focusTarget: null, bossDown: false, actClearT: 0,
    flags: act ? game.flags : {}, story: null, panel: null,
  });
  dialogues = []; groundItems = []; zones = [];
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
const MINION_CAP = 16;       // 로어 05/30: "동시 소환 캡 & fan-out 물량전" (하드 캡 — 정본)
const MINION_BATCH_CD = 3;   // 로어 05/30: 배치당 3초

/* ============================================================
   스킬트리 (로어 06 소환계 · 로어 07 레거시 시학 · 덕산 본체)
   레벨업마다 포인트 1 — T키로 열고 클릭 분배
   ============================================================ */
const TREE = [
  // A: 소환계 (Summon Tree)
  { id: 'aura', br: 0, row: 0, name: '군단장 오라', max: 3, desc: '소환수 이속/공속 +8%/랭크 (로어 06)', stat: 'auraSpd', per: 0.08 },
  { id: 'surge', br: 0, row: 1, name: '군단 증폭', max: 3, desc: '소환수 데미지 +10%/랭크 · 직렬 PR 룰', stat: 'minionDmg', per: 0.10, req: 'aura' },
  { id: 'bone', br: 0, row: 1.9, name: '뼈다귀 보강', max: 3, desc: '소환수 HP +15%/랭크', stat: 'minionHp', per: 0.15, req: 'aura' },
  { id: 'fanout', br: 0, row: 2.8, name: '팬아웃 소환', max: 1, desc: 'Space 웨이브 4기 → 6기 동시 소환', stat: 'fanout', per: 1, req: 'surge' },
  { id: 'doppel', br: 0, row: 3.7, name: '1인2역 환영술', max: 1, desc: 'AG 소환 시 환영 골렘 1기 추가 (50% 스탯)', stat: 'doppel', per: 1, req: 'bone' },
  { id: 'trinity', br: 0, row: 4.6, name: '삼금강 각성', max: 1, desc: 'CG·GG·AG 전원 생존 시 소환수 데미지 +30%', stat: 'trinity', per: 1, req: 'fanout' },
  // B: 시체폭발 — 레거시 시학 (Legacy Poetics)
  { id: 'boomdmg', br: 1, row: 0, name: '폭발 증폭', max: 3, desc: '키보드 폭발 데미지 +20%/랭크', stat: 'boomDmg', per: 0.20 },
  { id: 'boomrad', br: 1, row: 1, name: '폭발 반경', max: 2, desc: '폭발 반경 +15%/랭크', stat: 'boomRadius', per: 0.15, req: 'boomdmg' },
  { id: 'buckshot', br: 1, row: 1.9, name: 'manifest 산탄', max: 1, desc: '키캡 파편 +8발 · 데미지 +15% (격자 탄착군)', stat: 'buckshot', per: 1, req: 'boomdmg' },
  { id: 'chain', br: 1, row: 2.8, name: '연쇄폭발', max: 3, desc: '폭발 킬 → 자동 연쇄 (랭크 = 연쇄 상한, max3 fail-closed)', stat: 'chainCap', per: 1, req: 'boomrad' },
  { id: 'ground', br: 1, row: 3.7, name: '타건 장판', max: 1, desc: '폭발 지점에 2초 DPS존 (초당 폭발딜 40%)', stat: 'ground', per: 1, req: 'buckshot' },
  { id: 'blueaxis', br: 1, row: 4.6, name: '청축 각성', max: 1, desc: '폭발 크리티컬 30% 확률 · 1.5배 (감사 스캔 확정 크리)', stat: 'crit', per: 1, req: 'chain' },
  // C: 야인의 근성 (덕산 본체)
  { id: 'grit', br: 2, row: 0, name: '산전수전', max: 3, desc: '최대 HP +20/랭크 (부동산 7년)', stat: 'maxHp', per: 20 },
  { id: 'caffeine', br: 2, row: 1, name: '카페인 혈관', max: 3, desc: '아메리카노 재생 +2/랭크', stat: 'manaRegen', per: 2, req: 'grit' },
  { id: 'bicycle', br: 2, row: 1.9, name: '자전거 7년', max: 2, desc: '이동속도 +8%/랭크', stat: 'moveSpd', per: 0.08, req: 'grit' },
  { id: 'realtor', br: 2, row: 2.8, name: '부동산 화술', max: 2, desc: '커밋토큰 획득 +25%/랭크', stat: 'tokenGain', per: 0.25, req: 'caffeine' },
  { id: 'passpro', br: 2, row: 3.7, name: 'PASS 숙련', max: 2, desc: 'PASS 게이지 획득 +25%/랭크', stat: 'ultGain', per: 0.25, req: 'bicycle' },
];
const BRANCH_NAMES = ['소환계', '레거시 시학 (시체폭발)', '야인의 근성'];
const BRANCH_COLORS = ['#7ee0a3', '#ffb648', '#9cc4ff'];

/* ============================================================
   아이템 시스템 (POE식 등급 + 랜덤 어픽스)
   등급: 일반(0옵) → 매직(1~2옵) → 레어(3~4옵) → 유니크(고정 명품)
   ============================================================ */
const SLOTS = ['weapon', 'body', 'head', 'amulet', 'ring', 'charm'];
const SLOT_NAMES = { weapon: '무기', body: '상의', head: '머리', amulet: '목걸이', ring: '반지', charm: '부적' };
const BASES = [
  { slot: 'weapon', name: '청테이프 키보드' }, { slot: 'weapon', name: '멤브레인 키보드' },
  { slot: 'body', name: '늘어난 런닝셔츠' }, { slot: 'body', name: '판교 후드집업' },
  { slot: 'head', name: '유선 이어폰' }, { slot: 'head', name: '싸구려 헤드셋' },
  { slot: 'amulet', name: 'receipt 목걸이' }, { slot: 'ring', name: '멱등 반지' }, { slot: 'charm', name: 'dev키 부적' },
];
const AFFIXES = [
  { key: 'minionDmg', name: '소환수 데미지', lo: 0.05, hi: 0.15, pct: true },
  { key: 'minionHp', name: '소환수 HP', lo: 0.10, hi: 0.30, pct: true },
  { key: 'boomDmg', name: '폭발 데미지', lo: 0.08, hi: 0.25, pct: true },
  { key: 'maxHp', name: '최대 HP', lo: 10, hi: 40, pct: false },
  { key: 'manaRegen', name: '아메리카노 재생', lo: 1, hi: 3, pct: false },
  { key: 'moveSpd', name: '이동속도', lo: 0.04, hi: 0.10, pct: true },
  { key: 'tokenGain', name: '커밋토큰 획득', lo: 0.10, hi: 0.30, pct: true },
  { key: 'ultGain', name: 'PASS 게이지 획득', lo: 0.10, hi: 0.25, pct: true },
];
const UNIQUES = [
  { slot: 'weapon', name: '기계식 키보드', quote: '"손가락이 아프지만 버그도 아프다"', affixes: [{ key: 'minionDmg', v: 0.25 }, { key: 'boomDmg', v: 0.30 }] },
  { slot: 'charm', name: '휘발된 라이브 서명키', quote: '"파일 부재 ≠ 휘발. 위치를 잊었을 뿐."', affixes: [{ key: 'minionHp', v: 0.40 }, { key: 'manaRegen', v: 2 }] },
  { slot: 'ring', name: '80라운드 회고의 반지', quote: '소환 마나 소모 -20% 영구', affixes: [{ key: 'summonCost', v: -0.20 }, { key: 'ultGain', v: 0.20 }] },
  { slot: 'body', name: '터틀넥 오브 판교', quote: 'IT 힙스터의 정장', affixes: [{ key: 'maxHp', v: 60 }, { key: 'moveSpd', v: 0.05 }] },
];
const RARITY = { normal: { name: '일반', color: '#d5dbe8' }, magic: { name: '매직', color: '#6b9bff' }, rare: { name: '레어', color: '#ffd700' }, unique: { name: '유니크', color: '#f7734b' } };

function rollItem(forceRarity) {
  const roll = Math.random();
  let rarity = forceRarity || (roll < 0.5 ? 'normal' : roll < 0.85 ? 'magic' : 'rare');
  if (rarity === 'unique') {
    const u = UNIQUES[Math.floor(rand(0, UNIQUES.length))];
    return { ...u, rarity: 'unique', affixes: u.affixes.map(a => ({ ...a })) };
  }
  const base = BASES[Math.floor(rand(0, BASES.length))];
  const n = rarity === 'normal' ? 0 : rarity === 'magic' ? (Math.random() < 0.5 ? 1 : 2) : (Math.random() < 0.5 ? 3 : 4);
  const pool = [...AFFIXES].sort(() => Math.random() - 0.5).slice(0, n);
  const affixes = pool.map(a => ({ key: a.key, v: a.pct ? +rand(a.lo, a.hi).toFixed(2) : Math.round(rand(a.lo, a.hi)) }));
  const prefix = rarity === 'rare' ? ['판교의 ', '야근한 ', '리팩토링된 ', '무결성 '][Math.floor(rand(0, 4))] : '';
  return { slot: base.slot, name: prefix + base.name, rarity, affixes };
}

function dropItem(x, y, forceRarity) {
  const item = rollItem(forceRarity);
  groundItems.push({ x: x + rand(-20, 20), y: y + rand(-20, 20), item });
}

function affixLabel(a) {
  const def = AFFIXES.find(d => d.key === a.key);
  if (a.key === 'summonCost') return `소환 마나 소모 ${Math.round(a.v * 100)}%`;
  if (!def) return a.key;
  return def.pct ? `${def.name} +${Math.round(a.v * 100)}%` : `${def.name} +${a.v}`;
}

// ---------- 스탯 집계: 트리 + 장비 ----------
function getStat(key) {
  let v = 0;
  for (const n of TREE) {
    const r = player.tree[n.id] || 0;
    if (r > 0 && n.stat === key) v += n.per * r;
  }
  for (const s of SLOTS) {
    const it = player.equip[s];
    if (it) for (const a of it.affixes) if (a.key === key) v += a.v;
  }
  return v;
}
function applyDerived() {
  const ratio = player.hp / player.maxHp;
  player.maxHp = Math.round(player.baseMaxHp + getStat('maxHp'));
  player.hp = Math.min(player.maxHp, Math.max(1, Math.round(player.maxHp * ratio)));
  player.manaRegen = player.baseManaRegen + getStat('manaRegen');
  player.speed = player.baseSpeed * (1 + getStat('moveSpd'));
}
function minionDmgFactor() {
  let f = 1 + getStat('minionDmg');
  if (getStat('trinity') > 0 &&
      summons.some(s => s.type === 'warrior') && summons.some(s => s.type === 'mage') && summons.some(s => s.type === 'golem')) f *= 1.3;
  return f;
}

// ---------- 트리/장비 조작 ----------
function allocNode(n) {
  const r = player.tree[n.id] || 0;
  if (player.points <= 0 || r >= n.max) return;
  if (n.req && !(player.tree[n.req] > 0)) { say('sys', `선행 노드 필요: ${TREE.find(t => t.id === n.req).name}`, 2.5); return; }
  player.tree[n.id] = r + 1;
  player.points--;
  AudioSys.sfx.levelup();
  say('sys', `[${n.name}] Lv.${r + 1} 습득`, 3);
  applyDerived();
}
function equipItem(idx) {
  const it = player.inv[idx];
  if (!it) return;
  const prev = player.equip[it.slot];
  player.equip[it.slot] = it;
  player.inv.splice(idx, 1);
  if (prev) player.inv.push(prev);
  AudioSys.sfx.click();
  applyDerived();
}
function unequipItem(slot) {
  const it = player.equip[slot];
  if (!it) return;
  if (player.inv.length >= 24) { say('sys', '가방이 가득 찼다', 2); return; }
  delete player.equip[slot];
  player.inv.push(it);
  AudioSys.sfx.click();
  applyDerived();
}
function pickupItem(g) {
  if (player.inv.length >= 24) {
    game.coins += 5;
    say('sys', `가방 가득 — ${g.item.name} → 커밋토큰 5로 환전`, 2.5);
  } else {
    player.inv.push(g.item);
    const rc = RARITY[g.item.rarity];
    say('sys', `획득: ${g.item.name} [${rc.name}] — I키로 장착`, 3);
    if (g.item.rarity === 'unique') { AudioSys.sfx.levelup(); once('firstUnique', () => say('ducksan', '오... 이건 등기 칠 만한 물건이다.')); }
    else AudioSys.sfx.pickup();
  }
  g.got = true;
}

function summon(type) {
  const d = SUMMON_DEFS[type];
  if (d.unique && summons.some(s => s.type === type && s.hp > 0 && !s.phantom)) {
    addText(player.x, player.y - 30, '이미 소환됨!', '#ff9c9c'); return;
  }
  if (type === 'minion') {
    if (minionBatchCd > 0) { addText(player.x, player.y - 30, `배치 쿨타임 ${minionBatchCd.toFixed(1)}초`, '#ff9c9c'); return; }
    if (summons.filter(s => s.type === 'minion').length >= MINION_CAP) {
      addText(player.x, player.y - 30, `캡 도달 (${MINION_CAP}) — 웨이브로 굴려라!`, '#ff9c9c'); return;
    }
  }
  const cost = Math.round(d.cost * (1 + getStat('summonCost')));
  if (player.mana < cost) { addText(player.x, player.y - 30, '아메리카노 부족! (마나)', '#9cc4ff'); return; }
  player.mana -= cost;
  const a = rand(0, Math.PI * 2);
  const hpMul = 1 + getStat('minionHp');
  summons.push({
    type, ...d,
    x: player.x + Math.cos(a) * 46, y: player.y + Math.sin(a) * 46,
    hp: d.hp * hpMul, maxHp: d.hp * hpMul, atkTimer: 0, lifeLeft: d.duration || Infinity,
  });
  // 1인2역 환영술 (로어 06/10): AG 소환 시 환영 골렘 추가
  if (type === 'golem' && getStat('doppel') > 0) {
    summons.push({
      ...d, type: 'golem', name: '환영 골렘', unique: false, taunt: false, phantom: true,
      x: player.x - Math.cos(a) * 46, y: player.y - Math.sin(a) * 46,
      hp: d.hp * 0.5 * hpMul, maxHp: d.hp * 0.5 * hpMul, dmg: d.dmg * 0.5,
      atkTimer: 0, lifeLeft: Infinity,
    });
    once('doppelSeen', () => say('ducksan', '어? 너 둘이야? 아까 한 마리 아니었어?'));
  }
  if (d.quote) addText(player.x, player.y - 46, d.quote, '#ffd88a');
  spawnRing(player.x, player.y, d.color);
  if (type === 'minion') AudioSys.sfx.minion(); else AudioSys.sfx.summon();
  // 첫 소환 대사 (로어 02~04 정본 대사)
  if (type === 'warrior') once('metCG', () => { say('cg', '"손코딩? 그건 필멸자나 하는 거고." 미친 타이핑, 시작합니다.'); });
  if (type === 'mage') once('metGG', () => { say('gg', '"주장은 도장 전엔 잠정입니다." 무한루프는 제 break 드릴로 조건을 끊으세요.'); });
  if (type === 'golem') once('metAG', () => { say('ag', '방향은 내가 잡는다. 어그로는 전부 나한테 맡겨라.'); });
  if (type === 'minion') once('metSub', () => { say('ducksan', '뼈다귀들아, 각자 버그 하나씩 물어라. 물량이 곧 화력이다.'); });
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
      const wave = 4 + (getStat('fanout') > 0 ? 2 : 0); // 팬아웃 소환 (로어 06)
      for (let i = 0; i < wave; i++) summon('minion');
      if (summons.filter(s => s.type === 'minion').length > before) minionBatchCd = MINION_BATCH_CD;
    }
  }
  if (code === 'KeyR') passDeclaration();
}

// ---------- 키보드 폭발 (로어 07: Corpse Explosion — 커서 지정 + 연쇄) ----------
function explodeCorpse(c, mult) {
  c.used = true;
  const buck = getStat('buckshot') > 0;
  let dmg = (32 + player.level * 6) * (1 + getStat('boomDmg')) * (buck ? 1.15 : 1) * mult;
  let crit = false;
  if (getStat('crit') > 0 && Math.random() < 0.3) { dmg *= 1.5; crit = true; } // 청축 각성
  const shrapnel = 14 + (buck ? 8 : 0);
  for (let i = 0; i < shrapnel; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(60, 220);
    particles.push({
      x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      z: 8, vz: rand(80, 220),
      life: rand(0.5, 1.0), t: 0, kind: 'keycap',
      ch: KEYCAPS[Math.floor(rand(0, KEYCAPS.length))],
      color: crit ? '#5bc8f7' : ['#ffd88a', '#7ee0a3', '#c792ea', '#9cc4ff'][Math.floor(rand(0, 4))],
    });
  }
  spawnRing(c.x, c.y, crit ? '#5bc8f7' : '#ffb648');
  if (crit) addText(c.x, c.y - 20, '청축 크리! 찰칵!!', '#5bc8f7', 0.8);
  if (getStat('ground') > 0) zones.push({ x: c.x, y: c.y, t: 0, dur: 2, dps: dmg * 0.4 }); // 타건 장판
  for (const e of enemies) {
    if (!e.dead && dist2(c, e) < 130 * 130) damageEnemy(e, dmg, '#ffb648');
  }
}

function corpseExplosion(at) {
  const R = 170 * (1 + getStat('boomRadius'));
  let used = 0;
  const chainCap = getStat('chainCap'); // 연쇄 상한 max3 — fail-closed (로어 07 정본)
  let wave = corpses.filter(c => !c.used && dist2(c, at) < R * R);
  let depth = 0, mult = 1;
  while (wave.length > 0 && depth <= chainCap) {
    const beforeLen = corpses.length;
    for (const c of wave) { explodeCorpse(c, mult); used++; }
    const fresh = corpses.slice(beforeLen).filter(c => !c.used); // 폭발 킬로 생긴 새 시체
    depth++; mult *= 0.7; // 연쇄 감쇠 (정본: 100% → 70% → 49%)
    wave = depth <= chainCap ? fresh : [];
    if (depth === 3 && fresh.length > 0) {
      addText(at.x, at.y - 60, 'MERGED! 3연쇄 풀콤보!!', '#ffd700', 1.4);
      once('fullCombo', () => say('ducksan', '3연쇄 머지 완료. 이 맛에 시체폭발 트리 찍는 거다.'));
    }
  }
  if (used > 0) {
    game.shake = 8;
    AudioSys.sfx.explosion();
    addText(at.x, at.y - 40, `키보드 폭발 x${used}! 따다다닥!!`, '#ffb648');
    once('firstBoom', () => { say('ducksan', '이 맛이지. 해결된 버그는 터트려야 제맛이다. 따다다닥!!'); });
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
  AudioSys.sfx.pass();
  say('ducksan', 'PASS. 증거는 다 모였다. 반박 시 니 말이 맞음.');
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
    if (!opts.drill) {
      addText(e.x, e.y - e.r - 6, '면역! break 필요', '#5bc8f7', 0.5);
      once('wispHint', () => { say('gg', '무한루프는 패는 게 아니라 조건을 끊는 겁니다. [W]로 저를 소환하세요.'); });
      return;
    }
    e.breakHits++;
    addText(e.x, e.y - e.r - 6, `break ${e.breakHits}/3`, '#5bc8f7', 0.7);
    if (e.breakHits < 3) return;
    dmg = e.hp;
  }
  e.hp -= dmg;
  AudioSys.sfx.hit();
  if (!e.wisp) addText(e.x, e.y - e.r - 6, Math.floor(dmg), color || '#fff', 0.6);
  if (e.hp <= 0 && !e.dead) {
    e.dead = true;
    game.kills++;
    AudioSys.sfx.kill();
    game.ultGauge = Math.min(100, game.ultGauge + (e.boss ? 40 : e.elite ? 12 : 5) * (1 + getStat('ultGain')));
    corpses.push({ x: e.x, y: e.y, t: 0, boss: !!e.boss });
    const drops = e.boss ? 10 : e.elite ? 4 : 2;
    for (let i = 0; i < drops; i++) {
      orbs.push({ x: e.x + rand(-16, 16), y: e.y + rand(-16, 16), kind: i % 2 ? 'coin' : 'xp', v: e.boss ? 10 : e.elite ? 5 : 3 });
    }
    // POE식 아이템 드랍
    if (e.boss) { dropItem(e.x, e.y, 'rare'); dropItem(e.x, e.y, 'rare'); if (Math.random() < 0.5) dropItem(e.x, e.y, 'unique'); }
    else if (e.elite) { if (Math.random() < 0.6) dropItem(e.x, e.y); if (Math.random() < 0.08) dropItem(e.x, e.y, 'unique'); }
    else if (Math.random() < 0.07) dropItem(e.x, e.y);
    if (game.focusTarget === e) game.focusTarget = null;
    if (e.boss) {
      game.bossDown = true;
      game.actClearT = 5;
      setBanner(`ACT ${game.act} CLEAR!`, '"결국... 리팩토링 당했군..." — 레거시 코드 골렘');
      game.shake = 14;
      AudioSys.sfx.levelup();
      say('legacy', '결국... 리팩토링 당했군... 후련하다...');
      say('ducksan', '고생했다. 7년 묵은 빚, 오늘 갚았다.');
    }
  }
}

function gainXp(v) {
  player.xp += v;
  while (player.xp >= player.xpNext) {
    player.xp -= player.xpNext;
    player.level++;
    player.xpNext = Math.floor(player.xpNext * 1.35);
    player.baseMaxHp += 14;
    player.maxMana += 8; player.mana = player.maxMana;
    player.points++;
    applyDerived();
    player.hp = player.maxHp;
    AudioSys.sfx.levelup();
    setBanner(`LEVEL UP! Lv.${player.level}`, `스킬 포인트 +1 (보유 ${player.points}) — T키로 스킬트리`);
    once('treeHint', () => say('sys', 'T키: 스킬트리 (소환계·레거시 시학·야인의 근성) · I키: 가방/장비', 6));
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
      say('sys', `ACT ${act}: 더 깊은 판교. 버그들이 강해졌다.`);
      say('ducksan', act === 2 ? '한 블록 접수했다. 다음은 현대백화점 방면이다.' : '판교는 넓다. 계속 간다.');
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
    const aura = 1 + getStat('auraSpd'); // 군단장 오라: 이속/공속
    if (target) {
      const d = Math.sqrt(dist2(s, target)) || 1;
      if (d > s.range + target.r) {
        s.x += (target.x - s.x) / d * s.speed * aura * dt;
        s.y += (target.y - s.y) / d * s.speed * aura * dt;
      } else if (s.atkTimer <= 0) {
        s.atkTimer = s.cooldown / aura;
        const dmg = s.dmg * minionDmgFactor();
        if (s.ranged) {
          AudioSys.sfx.drill();
          projectiles.push({
            x: s.x, y: s.y,
            vx: (target.x - s.x) / d * 380, vy: (target.y - s.y) / d * 380,
            dmg, life: 1.1, t: 0, color: s.color,
          });
        } else {
          damageEnemy(target, dmg, s.color);
        }
      }
    } else {
      const d = Math.sqrt(dist2(s, player));
      if (d > 80) {
        s.x += (player.x - s.x) / d * s.speed * aura * dt;
        s.y += (player.y - s.y) / d * s.speed * aura * dt;
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
      once('bossMet', () => {
        AudioSys.sfx.bossRoar();
        say('legacy', '이 코드... 누가 짰지?');
        say('ducksan', '...7년 전의 나다. 미안하다. 그리고 오늘, 리팩토링하러 왔다.');
      });
      e.slamT -= dt;
      if (e.slamT <= 0) {
        e.slamT = 6;
        spawnRing(e.x, e.y, '#ff5b5b');
        game.shake = 10;
        AudioSys.sfx.slam();
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
          AudioSys.sfx.hurt();
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
      AudioSys.sfx.pickup();
      if (o.kind === 'xp') gainXp(o.v); else game.coins += Math.round(o.v * (1 + getStat('tokenGain')));
    }
  }
  orbs = orbs.filter(o => !o.got);

  // 바닥 아이템 줍기 (밟으면 획득)
  for (const g of groundItems) {
    if (dist2(g, player) < 30 * 30) pickupItem(g);
  }
  groundItems = groundItems.filter(g => !g.got);

  // 타건 장판 (DPS존)
  for (const z of zones) {
    z.t += dt;
    for (const e of enemies) {
      if (!e.dead && dist2(z, e) < 90 * 90) {
        e.zoneTick = (e.zoneTick || 0) - dt;
        if (e.zoneTick <= 0) { e.zoneTick = 0.5; damageEnemy(e, z.dps * 0.5, '#ffd88a'); }
      }
    }
  }
  zones = zones.filter(z => z.t < z.dur);

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
  for (const d of dialogues) d.t += dt;
  dialogues = dialogues.filter(d => d.t < d.life);
  if (game.banner) { game.banner.t += dt; if (game.banner.t > 3) game.banner = null; }
}

function gameOver() {
  game.running = false;
  AudioSys.sfx.dead();
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

function shadow(s, r, a) {
  ctx.fillStyle = `rgba(0,0,0,${a || 0.4})`;
  ctx.beginPath();
  ctx.ellipse(s.x, s.y, r, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ---------- 색 유틸 ----------
function hexRGB(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(hex, amt) { // amt: -1(검게) ~ +1(밝게)
  let [r, g, b] = hexRGB(hex);
  const f = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round(r + (f - r) * p); g = Math.round(g + (f - g) * p); b = Math.round(b + (f - b) * p);
  return `rgb(${r},${g},${b})`;
}
function rgba(hex, a) { const [r, g, b] = hexRGB(hex); return `rgba(${r},${g},${b},${a})`; }

// 발밑 컬러 조명 (additive)
function groundGlow(s, r, hex, a) {
  const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
  g.addColorStop(0, rgba(hex, a));
  g.addColorStop(1, rgba(hex, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(s.x, s.y, r, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function bobOf(e, spd, amp) {
  const ph = (e.x + e.y) * 0.05;
  return Math.abs(Math.sin(game.time * (spd || 5) + ph)) * (amp || 2);
}

// ---------- 스켈레톤 (CG/GG/서브) ----------
function drawSkeleton(s, e, accent, kind) {
  const scl = e.r / 12, bob = bobOf(e, 6, 2 * scl);
  const y = s.y - bob;
  shadow(s, e.r * 0.9, 0.35);
  // 다리 (뼈)
  ctx.strokeStyle = '#e8e0d0'; ctx.lineWidth = 2.4 * scl; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(s.x - 3 * scl, y - 2); ctx.lineTo(s.x - 4 * scl, s.y);
  ctx.moveTo(s.x + 3 * scl, y - 2); ctx.lineTo(s.x + 4 * scl, s.y);
  ctx.stroke();
  // 갈비뼈 몸통
  const bodyH = 13 * scl;
  ctx.fillStyle = shade('#e8e0d0', -0.05);
  ctx.beginPath();
  ctx.ellipse(s.x, y - bodyH * 0.5 - 2, 5 * scl, bodyH * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(accent, 0.5); ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const ry = y - bodyH * 0.75 + i * 4 * scl;
    ctx.beginPath(); ctx.moveTo(s.x - 4 * scl, ry); ctx.lineTo(s.x + 4 * scl, ry); ctx.stroke();
  }
  // 두개골
  const hy = y - bodyH - 4 * scl;
  ctx.fillStyle = '#f2ecdd';
  ctx.beginPath(); ctx.arc(s.x, hy, 5 * scl, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = shade(accent, -0.3); // 눈구멍 = 에이전트 색
  ctx.beginPath(); ctx.arc(s.x - 2 * scl, hy - 0.5, 1.5 * scl, 0, Math.PI * 2);
  ctx.arc(s.x + 2 * scl, hy - 0.5, 1.5 * scl, 0, Math.PI * 2); ctx.fill();
  // 눈빛
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = rgba(accent, 0.9);
  ctx.beginPath(); ctx.arc(s.x - 2 * scl, hy - 0.5, 1 * scl, 0, Math.PI * 2);
  ctx.arc(s.x + 2 * scl, hy - 0.5, 1 * scl, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // 무기
  if (kind === 'warrior') { // 검
    ctx.strokeStyle = shade(accent, 0.3); ctx.lineWidth = 2 * scl;
    ctx.beginPath(); ctx.moveTo(s.x + 6 * scl, y - 6 * scl); ctx.lineTo(s.x + 11 * scl, y - 15 * scl); ctx.stroke();
    ctx.strokeStyle = '#c8c0b0'; ctx.lineWidth = 1.2 * scl;
    ctx.beginPath(); ctx.moveTo(s.x + 5 * scl, y - 7 * scl); ctx.lineTo(s.x + 8 * scl, y - 4 * scl); ctx.stroke();
  } else if (kind === 'mage') { // 지팡이 + 드릴 오브
    ctx.strokeStyle = '#5a4a6a'; ctx.lineWidth = 1.8 * scl;
    ctx.beginPath(); ctx.moveTo(s.x + 6 * scl, s.y); ctx.lineTo(s.x + 7 * scl, y - 16 * scl); ctx.stroke();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(accent, 0.8);
    ctx.beginPath(); ctx.arc(s.x + 7 * scl, y - 17 * scl, 3 * scl + Math.sin(game.time * 8) * scl, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

// ---------- 석상 몸통 빌더 (AG / 보스 공용) ----------
function golemBody(s, y, u, color, crackHex, eyeHex) {
  const blk = (ox, oy, w, h, top) => {
    ctx.fillStyle = shade(color, -0.18);
    ctx.fillRect(s.x + ox * u - w * u / 2, y - oy * u - h * u, w * u, h * u);
    ctx.fillStyle = shade(color, 0.12); // 윗면 하이라이트
    ctx.fillRect(s.x + ox * u - w * u / 2, y - oy * u - h * u, w * u, Math.max(1.5, 1.6 * u));
    ctx.strokeStyle = rgba('#000', 0.25); ctx.lineWidth = 1;
    ctx.strokeRect(s.x + ox * u - w * u / 2, y - oy * u - h * u, w * u, h * u);
  };
  // 다리 → 몸통 → 어깨 → 팔 → 머리
  blk(-2.6, 0, 3.2, 3.2);   // 왼다리
  blk(2.6, 0, 3.2, 3.2);    // 오른다리
  blk(0, 2.6, 9, 6);        // 몸통
  blk(0, 8, 11, 2.6);       // 어깨
  blk(-6, 3.4, 2.8, 5);     // 왼팔
  blk(6, 3.4, 2.8, 5);      // 오른팔
  blk(0, 10.4, 5, 4);       // 머리
  // 균열 발광
  ctx.strokeStyle = rgba(crackHex, 0.4 + Math.sin(game.time * 3) * 0.2); ctx.lineWidth = Math.max(1, 1.2 * u);
  ctx.beginPath();
  ctx.moveTo(s.x - 3 * u, y - 4 * u); ctx.lineTo(s.x + 1 * u, y - 8 * u); ctx.lineTo(s.x - 1 * u, y - 11 * u);
  ctx.stroke();
  // 눈
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = eyeHex;
  const ey = y - 11.5 * u, er = 1.4 * u;
  ctx.beginPath(); ctx.arc(s.x - 1.6 * u, ey, er, 0, Math.PI * 2);
  ctx.arc(s.x + 1.6 * u, ey, er, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ---------- 골렘 (AG) ----------
function drawGolem(s, e, phantom) {
  const u = e.r / 6.5, bob = bobOf(e, 3, 1.5);
  const y = s.y - bob;
  ctx.save();
  if (phantom) ctx.globalAlpha = 0.5;
  shadow(s, e.r, 0.42);
  if (!phantom) groundGlow(s, e.r * 1.5, e.color, 0.14);
  golemBody(s, y, u, e.color, '#5bc8f7', '#9cd8ff');
  ctx.restore();
}

// ---------- 슬라임 (널포인터) ----------
function drawSlime(s, e) {
  const wob = Math.sin(game.time * 4 + e.x * 0.1);
  const rw = e.r * (1 + wob * 0.12), rh = e.r * (0.72 - wob * 0.1);
  shadow(s, e.r, 0.3);
  const g = ctx.createRadialGradient(s.x, s.y - rh, 1, s.x, s.y - rh, rw);
  g.addColorStop(0, rgba(shade(e.color, 0.25), 0.85));
  g.addColorStop(1, rgba(e.color, 0.7));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(s.x, s.y - rh, rw, rh, 0, 0, Math.PI * 2); ctx.fill();
  // undefined 코어
  ctx.fillStyle = rgba('#2a0d0d', 0.6);
  ctx.font = `${e.r * 0.6}px monospace`; ctx.textAlign = 'center';
  ctx.fillText('∅', s.x, s.y - rh + e.r * 0.2);
  // 하이라이트
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath(); ctx.ellipse(s.x - rw * 0.3, s.y - rh * 1.4, rw * 0.25, rh * 0.3, 0, 0, Math.PI * 2); ctx.fill();
}

// ---------- 도깨비불 (무한루프) ----------
function drawWisp(s, e) {
  const y = s.y - 14 - Math.sin(game.time * 3 + e.x) * 4;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(s.x, y, 1, s.x, y, e.r * 2.2);
  g.addColorStop(0, rgba('#bfeeff', 0.9));
  g.addColorStop(0.4, rgba(e.color, 0.6));
  g.addColorStop(1, rgba(e.color, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(s.x, y, e.r * 2.2, 0, Math.PI * 2); ctx.fill();
  // 궤도 스파크 (while(true))
  for (let k = 0; k < 3; k++) {
    const a = game.time * 4 + k * 2.1;
    ctx.fillStyle = rgba('#eaffff', 0.9);
    ctx.beginPath(); ctx.arc(s.x + Math.cos(a) * e.r * 1.4, y + Math.sin(a) * e.r * 0.9, 1.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// ---------- 레이스 컨디션 (빠른 그림자) ----------
function drawRunner(s, e) {
  const y = s.y - e.r;
  shadow(s, e.r, 0.25);
  for (let k = 2; k >= 0; k--) { // 잔상
    ctx.globalAlpha = 0.3 + k * 0.25;
    ctx.fillStyle = shade(e.color, k * 0.15 - 0.1);
    ctx.beginPath(); ctx.ellipse(s.x - k * 4, y, e.r * 0.8, e.r, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(s.x - 2, y - 2, 1.3, 0, Math.PI * 2);
  ctx.arc(s.x + 2, y - 2, 1.3, 0, Math.PI * 2); ctx.fill();
}

// ---------- 보스: 레거시 코드 골렘 (거대 석상) ----------
function drawBossGolem(s, e) {
  const u = e.r / 5, y = s.y - bobOf(e, 2, 2.5);
  shadow(s, e.r * 1.15, 0.5);
  groundGlow(s, e.r * 1.7, '#ff7a2a', 0.22);
  golemBody(s, y, u, e.color, '#ff9c3a', '#ffcf5a');
  // 어깨 위 레거시 파편 (7년 묵은 코드 잔해)
  ctx.fillStyle = shade(e.color, -0.28);
  ctx.fillRect(s.x - 8 * u, y - 9 * u, 2.4 * u, 3 * u);
  ctx.fillRect(s.x + 5.6 * u, y - 9.5 * u, 2.4 * u, 3.4 * u);
}

// ---------- 덕산 (네크로맨서) ----------
function drawDucksan(s) {
  const bob = bobOf(player, 5, 1.6);
  const y = s.y - bob;
  ctx.save();
  if (player.invuln > 0 && Math.floor(game.time * 20) % 2) ctx.globalAlpha = 0.45;
  shadow(s, player.r, 0.45);
  groundGlow(s, player.r * 2.6, '#c792ea', 0.18); // 네크로 오라
  // 다리 (사각팬티 + 맨다리)
  ctx.fillStyle = '#e8e8e0';
  ctx.fillRect(s.x - 6, y - 8, 12, 6); // 팬티
  ctx.strokeStyle = '#d9c3a0'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(s.x - 3, y - 3); ctx.lineTo(s.x - 4, s.y);
  ctx.moveTo(s.x + 3, y - 3); ctx.lineTo(s.x + 4, s.y); ctx.stroke();
  // 런닝셔츠 몸통
  ctx.fillStyle = '#f5f5f0';
  ctx.beginPath();
  ctx.moveTo(s.x - 6, y - 8); ctx.lineTo(s.x - 5, y - 20);
  ctx.lineTo(s.x + 5, y - 20); ctx.lineTo(s.x + 6, y - 8); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#d8d8cf'; ctx.lineWidth = 1; ctx.stroke();
  // 팔 (소환 제스처)
  const armSw = Math.sin(game.time * 4) * 2;
  ctx.strokeStyle = '#d9c3a0'; ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(s.x - 5, y - 18); ctx.lineTo(s.x - 9, y - 12 + armSw);
  ctx.moveTo(s.x + 5, y - 18); ctx.lineTo(s.x + 9, y - 12 - armSw); ctx.stroke();
  // 머리 (떡진 머리 + 퀭한 눈)
  const hy = y - 25;
  ctx.fillStyle = '#e6c9a0';
  ctx.beginPath(); ctx.arc(s.x, hy, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2b2620'; // 머리카락
  ctx.beginPath(); ctx.arc(s.x, hy - 1.5, 5.5, Math.PI, Math.PI * 2); ctx.fill();
  ctx.fillRect(s.x - 5.5, hy - 2, 11, 2);
  ctx.strokeStyle = '#4a3b2a'; ctx.lineWidth = 1; // 퀭한 눈
  ctx.beginPath();
  ctx.moveTo(s.x - 3, hy + 1); ctx.lineTo(s.x - 1, hy + 1);
  ctx.moveTo(s.x + 1, hy + 1); ctx.lineTo(s.x + 3, hy + 1); ctx.stroke();
  // 손끝 네크로 룬
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = rgba('#c792ea', 0.6 + Math.sin(game.time * 6) * 0.3);
  ctx.beginPath(); ctx.arc(s.x - 9, y - 12 + armSw, 2.5, 0, Math.PI * 2);
  ctx.arc(s.x + 9, y - 12 - armSw, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.restore();
}

function drawUnit(e, label, lift) {
  const s = toScreen(e.x, e.y);
  const t = e.type;
  if (t === 'warrior' || t === 'mage' || t === 'minion') {
    const acc = t === 'warrior' ? '#7ee0a3' : t === 'mage' ? '#c792ea' : '#e8e0c8';
    drawSkeleton(s, e, acc, t);
  } else if (t === 'golem') {
    drawGolem(s, e, e.phantom);
  } else if (t === 'boss') {
    drawBossGolem(s, e);
  } else if (t === 'elite') {
    drawGolem(s, e, false); // 정령도 돌형
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(s.x, s.y, e.r + 6, (e.r + 6) * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (t === 'nullptr') {
    drawSlime(s, e);
  } else if (t === 'infloop') {
    drawWisp(s, e);
  } else if (t === 'race') {
    drawRunner(s, e);
  } else {
    shadow(s, e.r); ctx.fillStyle = e.color;
    ctx.beginPath(); ctx.arc(s.x, s.y - e.r * 0.8, e.r, 0, Math.PI * 2); ctx.fill();
  }
  // 소환수 에이전트 배지
  if (label && (t === 'golem' || t === 'warrior' || t === 'mage')) {
    ctx.fillStyle = rgba(e.color, 0.9);
    ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(label, s.x, s.y - e.r * 2 - 6);
  }
  return s;
}

// ---------- 조명 & 분위기 ----------
function drawLighting() {
  const pc = toScreen(player.x, player.y);
  // 야간 비네트 (가장자리 어둡게 + 플레이어 주변 밝게)
  const g = ctx.createRadialGradient(pc.x, pc.y - 12, 60, pc.x, pc.y - 12, 560);
  g.addColorStop(0, 'rgba(6,8,14,0)');
  g.addColorStop(0.55, 'rgba(6,8,14,0.15)');
  g.addColorStop(1, 'rgba(3,4,9,0.72)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 플레이어 횃불 온기 (additive)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const wg = ctx.createRadialGradient(pc.x, pc.y - 12, 10, pc.x, pc.y - 12, 200);
  wg.addColorStop(0, 'rgba(255,190,120,0.10)');
  wg.addColorStop(1, 'rgba(255,190,120,0)');
  ctx.fillStyle = wg;
  ctx.fillRect(0, 0, W, H);
  // 보스 존 붉은 조명
  const bz = toScreen(1900, 1900);
  if (bz.x > -300 && bz.x < W + 300 && bz.y > -300 && bz.y < H + 300) {
    const rg = ctx.createRadialGradient(bz.x, bz.y, 20, bz.x, bz.y, 340);
    rg.addColorStop(0, 'rgba(255,70,30,0.12)');
    rg.addColorStop(1, 'rgba(255,70,30,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

function drawBar(x, y, w, h, ratio, fg, bg) {
  ctx.fillStyle = bg || 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fg;
  ctx.fillRect(x, y, w * clamp(ratio, 0, 1), h);
}

// ---------- 디아블로식 HUD ----------
function drawOrb(cx, cy, r, ratio, color, label, sub) {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10,12,20,0.85)'; ctx.fill();
  ctx.clip();
  const level = cy + r - ratio * r * 2;
  ctx.fillStyle = color;
  ctx.fillRect(cx - r, level, r * 2, r * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath(); ctx.ellipse(cx, level, r, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#3a4560'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(label, cx, cy + 1);
  ctx.font = '10px sans-serif'; ctx.fillStyle = '#c2cad9';
  ctx.fillText(sub, cx, cy + 15);
}

function drawSlot(x, y, sz, key, icon, opts) {
  opts = opts || {};
  ctx.fillStyle = opts.ready === false ? 'rgba(18,22,34,0.9)' : 'rgba(28,34,52,0.92)';
  ctx.fillRect(x, y, sz, sz);
  if (opts.fill != null) { // 게이지형 (R)
    ctx.fillStyle = opts.fill >= 1 ? 'rgba(255,215,0,0.45)' : 'rgba(138,151,184,0.25)';
    const h = sz * clamp(opts.fill, 0, 1);
    ctx.fillRect(x, y + sz - h, sz, h);
  }
  if (opts.cd > 0) { // 쿨다운 오버레이
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x, y, sz, sz * clamp(opts.cd, 0, 1));
  }
  ctx.strokeStyle = opts.glow ? '#ffd700' : '#3a4560';
  ctx.lineWidth = opts.glow ? 2.5 : 1.5;
  ctx.strokeRect(x, y, sz, sz);
  ctx.fillStyle = opts.iconColor || '#e6e6e6';
  ctx.font = `bold ${opts.small ? 13 : 16}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.globalAlpha = opts.ready === false ? 0.4 : 1;
  ctx.fillText(icon, x + sz / 2, y + sz / 2 + 6);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffd88a';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(key, x + 3, y + 11);
  if (opts.badge) {
    ctx.fillStyle = '#9cc4ff';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(opts.badge, x + sz - 3, y + sz - 4);
  }
}

function drawHud() {
  // 상단 정보줄
  ctx.fillStyle = 'rgba(8,10,16,0.55)';
  ctx.fillRect(0, 0, W, 26);
  ctx.fillStyle = '#ffd88a';
  ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`ACT ${game.act} — 판교역 3번 출구`, 12, 17);
  ctx.fillStyle = '#c2cad9'; ctx.font = '11px sans-serif';
  ctx.fillText(`남은 버그 ${enemies.length} · 처치 ${game.kills} · 커밋토큰 ${game.coins}`, 200, 17);
  ctx.textAlign = 'right';
  const ptsTag = player.points > 0 ? ` · ⚡트리 T (+${player.points})` : ' · 트리 T';
  ctx.fillStyle = player.points > 0 && Math.floor(game.time * 2) % 2 ? '#ffd700' : '#c2cad9';
  ctx.fillText(`Lv.${player.level}${ptsTag} · 가방 I · 일지 L · BGM M ${AudioSys.on ? 'ON' : 'OFF'}`, W - 150, 17);

  // 미니맵 (우상단)
  const MM = 124, mx = W - MM - 12, my = 34;
  ctx.fillStyle = 'rgba(8,10,16,0.72)';
  ctx.fillRect(mx, my, MM, MM);
  ctx.strokeStyle = '#3a4560'; ctx.lineWidth = 1.5;
  ctx.strokeRect(mx, my, MM, MM);
  const sc = MM / WORLD;
  // 스폰/보스 존
  ctx.fillStyle = 'rgba(91,141,239,0.25)';
  ctx.beginPath(); ctx.arc(mx + 320 * sc, my + 320 * sc, 260 * sc, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,91,91,0.25)';
  ctx.beginPath(); ctx.arc(mx + 1900 * sc, my + 1900 * sc, 320 * sc, 0, Math.PI * 2); ctx.fill();
  for (const e of enemies) {
    ctx.fillStyle = e.boss ? '#ffd700' : e.elite ? '#f7734b' : e.aggro ? '#ff6b6b' : 'rgba(255,107,107,0.45)';
    const r = e.boss ? 3.5 : 1.8;
    ctx.fillRect(mx + e.x * sc - r / 2, my + e.y * sc - r / 2, r, r);
  }
  for (const s of summons) {
    ctx.fillStyle = s.color;
    ctx.fillRect(mx + s.x * sc - 1, my + s.y * sc - 1, 2, 2);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(mx + player.x * sc - 2, my + player.y * sc - 2, 4, 4);
  ctx.fillStyle = '#9cc4ff'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('MAP', mx + MM / 2, my + MM + 10);

  // 보스 HP 바 (상단 중앙)
  const boss = enemies.find(e => e.boss && e.aggro);
  if (boss) {
    drawBar(W / 2 - 220, 36, 440, 12, boss.hp / boss.maxHp, '#b8860b');
    ctx.strokeStyle = '#3a4560'; ctx.strokeRect(W / 2 - 220, 36, 440, 12);
    ctx.fillStyle = '#ffd88a';
    ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('레거시 코드 골렘', W / 2, 62);
  }

  // 스킬바 (하단 중앙)
  const SZ = 46, GAP = 6, N = 6;
  const bx = W / 2 - (SZ * N + GAP * (N - 1)) / 2, by = H - SZ - 24;
  const mc = summons.filter(s => s.type === 'minion').length;
  const has = t => summons.some(s => s.type === t);
  drawSlot(bx + 0 * (SZ + GAP), by, SZ, 'Q', 'CG', { iconColor: '#7ee0a3', ready: !has('warrior') && player.mana >= 30, badge: '30' });
  drawSlot(bx + 1 * (SZ + GAP), by, SZ, 'W', 'GG', { iconColor: '#c792ea', ready: !has('mage') && player.mana >= 30, badge: '30' });
  drawSlot(bx + 2 * (SZ + GAP), by, SZ, 'E', 'AG', { iconColor: '#8a97b8', ready: !has('golem') && player.mana >= 35, badge: '35' });
  drawSlot(bx + 3 * (SZ + GAP), by, SZ, 'SPC', '🦴', { ready: minionBatchCd <= 0 && mc < MINION_CAP && player.mana >= 8, cd: minionBatchCd / MINION_BATCH_CD, badge: `${mc}/${MINION_CAP}`, small: true });
  drawSlot(bx + 4 * (SZ + GAP), by, SZ, '우클릭', '💥', { ready: corpses.length > 0, badge: `${corpses.length}`, small: true });
  drawSlot(bx + 5 * (SZ + GAP), by, SZ, 'R', 'PASS', { fill: game.ultGauge / 100, glow: game.ultGauge >= 100, iconColor: game.ultGauge >= 100 ? '#ffd700' : '#8a97b8', small: true });

  // HP/마나 구슬
  drawOrb(64, H - 64, 42, player.hp / player.maxHp, 'rgba(224,82,82,0.85)', `${Math.ceil(player.hp)}`, `HP ${player.maxHp}`);
  drawOrb(W - 64, H - 64, 42, player.mana / player.maxMana, 'rgba(91,141,239,0.85)', `${Math.floor(player.mana)}`, '아메리카노');

  // XP 스트립 (최하단)
  drawBar(0, H - 6, W, 6, player.xp / player.xpNext, '#7ee0a3', 'rgba(0,0,0,0.7)');

  // 대사창 (스킬바 위, 좌측)
  ctx.textAlign = 'left';
  let dy = H - 122;
  for (let i = dialogues.length - 1; i >= 0; i--) {
    const d = dialogues[i];
    const a = clamp((d.life - d.t) / 0.6, 0, 1);
    ctx.globalAlpha = a * 0.92;
    ctx.font = 'bold 12px sans-serif';
    const nameW = ctx.measureText(d.speaker).width;
    ctx.font = '12px sans-serif';
    const textW = ctx.measureText(d.text).width;
    ctx.fillStyle = 'rgba(8,10,16,0.78)';
    ctx.fillRect(14, dy - 15, nameW + textW + 30, 22);
    ctx.fillStyle = d.color;
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(d.speaker, 22, dy);
    ctx.fillStyle = '#e6e6e6';
    ctx.font = '12px sans-serif';
    ctx.fillText(d.text, 22 + nameW + 10, dy);
    ctx.globalAlpha = 1;
    dy -= 26;
  }
}

// ---------- 스킬트리 / 인벤토리 패널 ----------
const PANEL = { x: 70, y: 46, w: W - 140, h: H - 100 };
function nodePos(n) {
  const colW = PANEL.w / 3;
  return { x: PANEL.x + colW * (n.br + 0.5), y: PANEL.y + 86 + n.row * 76 };
}
function panelClick(sx, sy) {
  // 닫기 버튼
  if (sx > PANEL.x + PANEL.w - 34 && sx < PANEL.x + PANEL.w - 6 && sy > PANEL.y + 6 && sy < PANEL.y + 34) {
    game.panel = null; return;
  }
  if (game.panel === 'tree') {
    for (const n of TREE) {
      const p = nodePos(n);
      if ((sx - p.x) ** 2 + (sy - p.y) ** 2 < 22 * 22) { allocNode(n); return; }
    }
  } else if (game.panel === 'inv') {
    for (let i = 0; i < SLOTS.length; i++) {
      const p = equipSlotPos(i);
      if (sx > p.x && sx < p.x + 52 && sy > p.y && sy < p.y + 52) { unequipItem(SLOTS[i]); return; }
    }
    for (let i = 0; i < 24; i++) {
      const p = invCellPos(i);
      if (sx > p.x && sx < p.x + 46 && sy > p.y && sy < p.y + 46) { equipItem(i); return; }
    }
  }
}
function equipSlotPos(i) {
  return { x: PANEL.x + 40 + (i % 2) * 66, y: PANEL.y + 90 + Math.floor(i / 2) * 66 };
}
function invCellPos(i) {
  return { x: PANEL.x + 250 + (i % 6) * 52, y: PANEL.y + 90 + Math.floor(i / 6) * 52 };
}
function drawPanelFrame(title, sub) {
  ctx.fillStyle = 'rgba(5,7,12,0.93)';
  ctx.fillRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h);
  ctx.strokeStyle = '#3a4560'; ctx.lineWidth = 2;
  ctx.strokeRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h);
  ctx.fillStyle = '#ffb648';
  ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(title, PANEL.x + 20, PANEL.y + 30);
  ctx.fillStyle = '#8a97b8'; ctx.font = '11px sans-serif';
  ctx.fillText(sub, PANEL.x + 20, PANEL.y + 48);
  ctx.fillStyle = '#ff9c9c'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('✕', PANEL.x + PANEL.w - 20, PANEL.y + 26);
}
function drawItemTooltip(item, sx, sy) {
  const rc = RARITY[item.rarity];
  const lines = [`${item.name}`, `[${rc.name}] ${SLOT_NAMES[item.slot]}`, ...item.affixes.map(affixLabel)];
  if (item.quote) lines.push(item.quote);
  ctx.font = '11px sans-serif';
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 20;
  const h = lines.length * 16 + 14;
  const bx = clamp(sx + 14, 4, W - w - 4), by = clamp(sy - h - 6, 4, H - h - 4);
  ctx.fillStyle = 'rgba(5,7,12,0.96)';
  ctx.fillRect(bx, by, w, h);
  ctx.strokeStyle = rc.color; ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, w, h);
  ctx.textAlign = 'left';
  lines.forEach((l, i) => {
    ctx.fillStyle = i === 0 ? rc.color : i === 1 ? '#8a97b8' : item.quote && i === lines.length - 1 ? '#c2a56a' : '#c8e6ff';
    ctx.font = i === 0 ? 'bold 12px sans-serif' : '11px sans-serif';
    ctx.fillText(l, bx + 10, by + 18 + i * 16);
  });
}
function drawTreePanel() {
  drawPanelFrame('스킬트리 — 바이브 코딩 흑마법서', `보유 포인트 ${player.points} · 노드 클릭으로 습득 · 레벨업마다 +1`);
  const colW = PANEL.w / 3;
  for (let b = 0; b < 3; b++) {
    ctx.fillStyle = BRANCH_COLORS[b];
    ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(BRANCH_NAMES[b], PANEL.x + colW * (b + 0.5), PANEL.y + 70);
  }
  // 연결선
  for (const n of TREE) {
    if (!n.req) continue;
    const a = nodePos(TREE.find(t => t.id === n.req)), b = nodePos(n);
    ctx.strokeStyle = (player.tree[n.req] > 0) ? BRANCH_COLORS[n.br] : '#2a3142';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  // 노드
  let hover = null;
  for (const n of TREE) {
    const p = nodePos(n);
    const r = player.tree[n.id] || 0;
    const reqOk = !n.req || player.tree[n.req] > 0;
    ctx.beginPath(); ctx.arc(p.x, p.y, 17, 0, Math.PI * 2);
    ctx.fillStyle = r >= n.max ? BRANCH_COLORS[n.br] : r > 0 ? 'rgba(126,224,163,0.25)' : reqOk ? '#1c2234' : '#12151f';
    ctx.fill();
    ctx.strokeStyle = r > 0 ? BRANCH_COLORS[n.br] : reqOk && player.points > 0 ? '#8a97b8' : '#2a3142';
    ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = r >= n.max ? '#12161f' : '#e6e6e6';
    ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${r}/${n.max}`, p.x, p.y + 4);
    ctx.fillStyle = r > 0 ? BRANCH_COLORS[n.br] : '#9aa4b8';
    ctx.font = '10px sans-serif';
    ctx.fillText(n.name, p.x, p.y + 32);
    if ((mouse.sx - p.x) ** 2 + (mouse.sy - p.y) ** 2 < 22 * 22) hover = n;
  }
  if (hover) {
    ctx.font = '11px sans-serif';
    const w = ctx.measureText(hover.desc).width + 20;
    const bx = clamp(mouse.sx + 12, 4, W - w - 4), by = clamp(mouse.sy - 46, 4, H - 50);
    ctx.fillStyle = 'rgba(5,7,12,0.96)'; ctx.fillRect(bx, by, w, 40);
    ctx.strokeStyle = BRANCH_COLORS[hover.br]; ctx.strokeRect(bx, by, w, 40);
    ctx.fillStyle = BRANCH_COLORS[hover.br]; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(hover.name, bx + 10, by + 16);
    ctx.fillStyle = '#c8e6ff'; ctx.font = '11px sans-serif';
    ctx.fillText(hover.desc, bx + 10, by + 32);
  }
}
function drawLogPanel() {
  drawPanelFrame('의장의 일지 — 진짜 이야기', '판교 더 서바이벌이 만들어지기까지 · L키로 닫기');
  let y = PANEL.y + 84;
  const cx = PANEL.x + 40;
  for (const e of LOG_ENTRIES) {
    ctx.textAlign = 'left';
    // 날짜 배지
    ctx.fillStyle = '#5b8def'; ctx.font = 'bold 12px sans-serif';
    ctx.fillText('❖ ' + e.date, cx, y);
    ctx.fillStyle = '#ffb648'; ctx.font = 'bold 15px sans-serif';
    ctx.fillText(e.title, cx + 130, y);
    y += 22;
    ctx.fillStyle = '#c8d2e4'; ctx.font = '12.5px sans-serif';
    for (const line of e.body.split('\n')) {
      ctx.fillText(line, cx + 14, y);
      y += 18;
    }
    // 구분선
    ctx.strokeStyle = 'rgba(90,104,140,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, y + 4); ctx.lineTo(PANEL.x + PANEL.w - 40, y + 4); ctx.stroke();
    y += 22;
  }
  ctx.fillStyle = '#6a7690'; ctx.font = 'italic 11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('2025년 100일의 전쟁에서 포기했던 이가, 2026년 3금강과 다시 일어섰다.', W / 2, PANEL.y + PANEL.h - 16);
}

function drawInvPanel() {
  drawPanelFrame('가방 & 장비 — 판교 파밍의 결실', `장비 클릭 = 해제 · 가방 클릭 = 장착 · 바닥템은 밟으면 획득 (${player.inv.length}/24)`);
  ctx.fillStyle = '#8a97b8'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('장착 중', PANEL.x + 40, PANEL.y + 80);
  ctx.fillText('가방', PANEL.x + 250, PANEL.y + 80);
  let hoverItem = null;
  for (let i = 0; i < SLOTS.length; i++) {
    const p = equipSlotPos(i);
    const it = player.equip[SLOTS[i]];
    ctx.fillStyle = 'rgba(28,34,52,0.9)';
    ctx.fillRect(p.x, p.y, 52, 52);
    ctx.strokeStyle = it ? RARITY[it.rarity].color : '#2a3142';
    ctx.lineWidth = 1.5; ctx.strokeRect(p.x, p.y, 52, 52);
    ctx.fillStyle = '#5d6b8a'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(SLOT_NAMES[SLOTS[i]], p.x + 26, p.y + (it ? 49 : 30));
    if (it) {
      ctx.fillStyle = RARITY[it.rarity].color;
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(it.name[0], p.x + 26, p.y + 28);
      if (mouse.sx > p.x && mouse.sx < p.x + 52 && mouse.sy > p.y && mouse.sy < p.y + 52) hoverItem = it;
    }
  }
  // 합산 스탯 요약
  ctx.fillStyle = '#8a97b8'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('합산 효과', PANEL.x + 40, PANEL.y + 310);
  const keys = ['minionDmg', 'minionHp', 'boomDmg', 'maxHp', 'manaRegen', 'moveSpd', 'tokenGain', 'ultGain', 'summonCost'];
  let sy2 = PANEL.y + 328;
  ctx.font = '10px sans-serif';
  for (const k of keys) {
    const v = getStat(k);
    if (!v) continue;
    ctx.fillStyle = '#c8e6ff';
    ctx.fillText(affixLabel({ key: k, v }), PANEL.x + 40, sy2);
    sy2 += 14;
  }
  for (let i = 0; i < 24; i++) {
    const p = invCellPos(i);
    const it = player.inv[i];
    ctx.fillStyle = 'rgba(28,34,52,0.9)';
    ctx.fillRect(p.x, p.y, 46, 46);
    ctx.strokeStyle = it ? RARITY[it.rarity].color : '#232a3a';
    ctx.lineWidth = 1.5; ctx.strokeRect(p.x, p.y, 46, 46);
    if (it) {
      ctx.fillStyle = RARITY[it.rarity].color;
      ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(it.name[0], p.x + 23, p.y + 22);
      ctx.fillStyle = '#5d6b8a'; ctx.font = '8px sans-serif';
      ctx.fillText(SLOT_NAMES[it.slot], p.x + 23, p.y + 40);
      if (mouse.sx > p.x && mouse.sx < p.x + 46 && mouse.sy > p.y && mouse.sy < p.y + 46) hoverItem = it;
    }
  }
  if (hoverItem) drawItemTooltip(hoverItem, mouse.sx, mouse.sy);
}

// ---------- 스토리 오버레이 ----------
function drawStory() {
  const st = game.story;
  const [title, body] = STORY_PAGES[st.page];
  ctx.fillStyle = 'rgba(5,7,12,0.94)';
  ctx.fillRect(0, 0, W, H);
  const a = clamp(st.t / 0.8, 0, 1);
  ctx.globalAlpha = a;
  ctx.fillStyle = '#ffb648';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, W / 2, 180);
  ctx.fillStyle = '#d5dbe8';
  ctx.font = '16px sans-serif';
  body.split('\n').forEach((line, i) => ctx.fillText(line, W / 2, 240 + i * 30));
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#8a97b8';
  ctx.font = '12px sans-serif';
  ctx.fillText(`${st.page + 1} / ${STORY_PAGES.length} — 클릭 또는 Space로 계속 ▶`, W / 2, H - 60);
}

function render() {
  ctx.save();
  if (game.shake > 0) ctx.translate(rand(-game.shake, game.shake), rand(-game.shake, game.shake));
  drawFloor();

  // 타건 장판 (DPS존)
  for (const z of zones) {
    const s = toScreen(z.x, z.y);
    ctx.globalAlpha = 0.35 * (1 - z.t / z.dur) + 0.1;
    ctx.fillStyle = '#ffb648';
    ctx.beginPath(); ctx.ellipse(s.x, s.y, 82, 41, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

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
  // 바닥 아이템 (POE식 드랍 라벨)
  for (const g of groundItems) {
    const s = toScreen(g.x, g.y);
    if (s.x < -60 || s.x > W + 60 || s.y < -40 || s.y > H + 40) continue;
    const rc = RARITY[g.item.rarity];
    ctx.save();
    ctx.translate(s.x, s.y - 6);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = rc.color;
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
    ctx.font = 'bold 10px sans-serif';
    const tw = ctx.measureText(g.item.name).width;
    ctx.fillStyle = 'rgba(8,10,16,0.8)';
    ctx.fillRect(s.x - tw / 2 - 4, s.y - 32, tw + 8, 14);
    ctx.fillStyle = rc.color;
    ctx.textAlign = 'center';
    ctx.fillText(g.item.name, s.x, s.y - 21);
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
      const sc = toScreen(sEnt.x, sEnt.y);
      if (sc.x < -60 || sc.x > W + 60 || sc.y < -90 || sc.y > H + 60) continue;
      const s = drawUnit(sEnt, sEnt.type === 'golem' ? 'AG' : sEnt.type === 'warrior' ? 'CG' : sEnt.type === 'mage' ? 'GG' : 'sub');
      drawBar(s.x - sEnt.r, s.y - sEnt.r * 2 - 14, sEnt.r * 2, 3, sEnt.hp / sEnt.maxHp, '#7ee0a3');
    } else if (u.kind === 'enemy') {
      const e = u.e;
      const sc = toScreen(e.x, e.y);
      if (sc.x < -80 || sc.x > W + 80 || sc.y < -120 || sc.y > H + 70) continue;
      const s = drawUnit(e, e.label);
      if (e.aggro || e.hp < e.maxHp) {
        const bh = e.boss ? s.y - e.r * 2.6 - 16 : s.y - e.r * 2 - 12;
        drawBar(s.x - e.r, bh, e.r * 2, e.boss ? 5 : 3, e.wisp ? (1 - e.breakHits / 3) : e.hp / e.maxHp, e.wisp ? '#5bc8f7' : '#ff6b6b');
      }
      if (game.focusTarget === e) {
        ctx.strokeStyle = '#ffd88a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(s.x, s.y, e.r + 8, (e.r + 8) * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
      }
    } else {
      // 덕산
      const s = toScreen(player.x, player.y);
      drawDucksan(s);
    }
  }

  // 투사체 (GG 무결성 드릴 — 발광)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of projectiles) {
    const s = toScreen(p.x, p.y);
    const hx = s.x - p.vx * 0.045 * ISO_X, hy = s.y - 10 - (p.vx + p.vy) * 0.022;
    const g = ctx.createLinearGradient(s.x, s.y - 10, hx, hy);
    g.addColorStop(0, rgba(p.color, 0.95));
    g.addColorStop(1, rgba(p.color, 0));
    ctx.strokeStyle = g; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(s.x, s.y - 10); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.fillStyle = rgba('#ffffff', 0.9);
    ctx.beginPath(); ctx.arc(s.x, s.y - 10, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // 파티클
  for (const p of particles) {
    const a = 1 - p.t / p.life;
    const s = toScreen(p.x, p.y);
    if (p.kind === 'ring') {
      ctx.globalAlpha = a;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 10 + p.t / p.life * 70, (10 + p.t / p.life * 70) * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // 키캡 파편 — 회전하는 3D 키캡
      const sz = 8, rot = (p.x + p.y) * 0.08 + p.t * 10;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(s.x, s.y - p.z);
      ctx.rotate(rot);
      // 발광
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(p.color, 0.35);
      ctx.beginPath(); ctx.arc(0, 0, sz, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // 키캡 본체
      ctx.fillStyle = shade(p.color, -0.25);
      ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
      ctx.fillStyle = p.color; // 윗면
      ctx.fillRect(-sz / 2, -sz / 2, sz, sz * 0.55);
      ctx.fillStyle = '#12161f';
      ctx.font = 'bold 6px monospace'; ctx.textAlign = 'center';
      ctx.fillText(p.ch, 0, sz * 0.1);
      ctx.restore();
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

  drawLighting();
  drawHud();

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

  // 패널 (스킬트리 / 인벤토리 / 일지) — 배너 위에 그린다
  if (game.panel === 'tree') drawTreePanel();
  else if (game.panel === 'inv') drawInvPanel();
  else if (game.panel === 'log') drawLogPanel();

  // 스토리 오버레이
  if (game.story) drawStory();
  ctx.restore();
}

// ---------- 루프 ----------
let last = 0;
function loop(ts) {
  const dt = Math.min((ts - last) / 1000, 0.05);
  last = ts;
  if (game.story) game.story.t += dt;
  if (game.running && !game.panel) update(dt); // 패널 열림 = 일시정지
  render();
  requestAnimationFrame(loop);
}

// ---------- 시작 ----------
resetGame();
requestAnimationFrame(loop);

document.getElementById('startBtn').addEventListener('click', () => {
  document.getElementById('titleScreen').classList.add('hidden');
  AudioSys.init();
  player = null;
  game.coins = 0;
  resetGame();
  startStory(); // 오프닝 내레이션 → 클릭으로 넘기면 게임 시작
});
document.getElementById('retryBtn').addEventListener('click', () => {
  document.getElementById('gameOverScreen').classList.add('hidden');
  AudioSys.init();
  player = null;
  game.coins = 0;
  resetGame();
  game.running = true;
  setBanner('재강림', '"이번엔 안 죽는다" — 덕산');
  say('ducksan', '부동산은 무슨. 판교를 접수하기 전엔 못 돌아간다.');
});
