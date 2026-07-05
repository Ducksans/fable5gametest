#!/usr/bin/env node
/* ============================================================
   판교 더 서바이벌 — 반드리프트·반환각 가드 (fail-closed)
   "기억이 아니라 도구를 고쳐라." 커밋 전 기계가 진실을 검문한다.
   하나라도 깨지면 exit 1 → 커밋 차단. Fable 5(CG)를 GG 없이도 검문.
   실행: node tools/guard.mjs   (pre-commit 훅이 자동 호출)
   ============================================================ */
import fs from 'node:fs';
import vm from 'node:vm';

const ok = [];
const fails = [];
const must = (cond, label, detail) => { cond ? ok.push(label) : fails.push(`${label} — ${detail || '실패'}`); };
const read = (f) => fs.readFileSync(f, 'utf8');

// P4 불변식: 필수 파일 존재 (구조 드리프트 방지)
const required = ['index.html', 'style.css', 'js/game.js', 'js/audio.js',
  'docs/session-stream.json', 'docs/issue_667_full.md', 'README.md', 'PROTOCOL.md'];
for (const f of required) must(fs.existsSync(f), `파일 존재: ${f}`, '누락');

// P1 검증우선: JS 문법 (vm.Script = 컴파일만, 실행 안 함 → 브라우저 전역 무관)
for (const f of ['js/game.js', 'js/audio.js']) {
  if (!fs.existsSync(f)) continue;
  try { new vm.Script(read(f), { filename: f }); must(true, `JS 문법: ${f}`); }
  catch (e) { must(false, `JS 문법: ${f}`, String(e.message).split('\n')[0]); }
}

// P1/P3 검증우선: session-stream JSON 유효성 + 스키마 (내가 실제로 깨뜨렸던 지점)
try {
  const d = JSON.parse(read('docs/session-stream.json'));
  const stream = d.stream || d;
  must(Array.isArray(stream), 'session-stream: 배열', 'stream 아님');
  must(stream.length >= 40, 'session-stream: 유실 없음', `길이 ${stream.length} < 40 (잘림 의심)`);
  const badWho = stream.filter((e) => e.who !== '의장' && e.who !== 'CG');
  must(badWho.length === 0, 'session-stream: who ∈ {의장,CG}', `${badWho.length}건 위반`);
  const badTxt = stream.filter((e) => typeof e.text !== 'string' || !e.text.trim());
  must(badTxt.length === 0, 'session-stream: text 채움', `${badTxt.length}건 빈 text`);
} catch (e) { must(false, 'session-stream JSON 파싱', String(e.message).split('\n')[0]); }

// P4 불변식: 캔버스 960x600 미스케일 (마우스→월드 좌표 정확성의 근거)
try {
  const html = read('index.html');
  must(/id="game"[^>]*width="960"[^>]*height="600"/.test(html), '캔버스 960x600 불변', '캔버스 크기 변경됨');
} catch { must(false, 'index.html 읽기', '실패'); }

// P4 불변식: 게임 척추 함수 존재 (핵심 삭제/드리프트 방지)
try {
  const g = read('js/game.js');
  for (const fn of ['function update', 'function render', 'function resetGame',
    'function castSkill', 'function damageEnemy', 'function drawUnit']) {
    must(g.includes(fn), `척추 함수: ${fn.replace('function ', '')}()`, '사라짐');
  }
} catch { must(false, 'js/game.js 읽기', '실패'); }

// P2 범위·보안: 키/토큰/하모니룸 개인키 경로 커밋 금지 (모든 필수 텍스트 파일 스캔)
const secret = /-----BEGIN[ A-Z]*PRIVATE KEY|BEGIN OPENSSH PRIVATE|gg-sign-key|harmony_gg|CHAIR_KEY\s*=|GG_KEY\s*=|gho_[A-Za-z0-9]{20}/;
for (const f of required) {
  if (!fs.existsSync(f)) continue;
  must(!secret.test(read(f)), `비밀 없음: ${f}`, '키/토큰 의심 문자열');
}

// ── P8 코드 건강 (병목/거대함수/고아 기계 강제) ──
// 파일 줄수 예산: 초과하면 커밋 차단(=쪼개기 강제). 함수는 경고. 고아는 차단.
const LINE_BUDGET = { 'js/game.js': 3000, 'js/audio.js': 200, 'tools/guard.mjs': 200 };
const warnHealth = [];
for (const f of ['js/game.js', 'js/audio.js', 'tools/guard.mjs']) {
  if (!fs.existsSync(f)) continue;
  const src = read(f), n = src.split('\n').length;
  const budget = LINE_BUDGET[f] || 500;
  must(n <= budget, `줄수 예산: ${f} (${n}/${budget})`, `예산 초과 — 쪼개라`);
  // 최대 함수 길이 (경고)
  const lines = src.split('\n'); let cur = null, start = 0, maxLen = 0, maxName = '';
  lines.forEach((ln, i) => { if (/^function /.test(ln)) { if (cur) { const len = i - start; if (len > maxLen) { maxLen = len; maxName = cur; } } cur = ln.slice(9).split('(')[0]; start = i; } });
  if (maxLen > 250) warnHealth.push(`거대 함수: ${f} ${maxName}() ${maxLen}줄 (>250 — 쪼갤 것)`);
}
// 고아 파일: js는 index.html/tools에서 참조돼야
for (const f of ['js/game.js', 'js/audio.js']) {
  const base = f.split('/').pop();
  const refd = fs.existsSync('index.html') && read('index.html').includes(base);
  must(refd, `참조됨(고아 아님): ${f}`, 'index.html에서 미참조');
}

// 결과 보고 (정직: PASS/FAIL을 근거와 함께)
console.log('── 판교 가드 · 반드리프트·반환각 + 코드건강 (fail-closed) ──');
for (const o of ok) console.log('  ✅ ' + o);
for (const w of warnHealth) console.log('  ⚠️  ' + w);
for (const f of fails) console.log('  🔴 ' + f);
if (fails.length) {
  console.log(`\n🔴 가드 실패 ${fails.length}건 — 커밋 차단. 도구가 잡았다, 내 기억이 아니라.`);
  process.exit(1);
}
console.log(`\n✅ 가드 통과 (${ok.length} 검사). 이 커밋은 검증된 진실이다. 坐卽板橋.`);
