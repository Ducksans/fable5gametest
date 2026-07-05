/* ============================================================
   사운드 엔진 — Web Audio 절차 생성 (에셋 파일 없음)
   컨셉: 기계식 키보드 타건음이 곧 타격음이다 (로어 07)
   ============================================================ */
'use strict';

const AudioSys = (() => {
  let ac = null, master = null, bgmGain = null;
  let bgmOn = true, bgmTimer = null, bgmStep = 0;
  let lastHit = 0, lastPick = 0;

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
    bgmGain = ac.createGain(); bgmGain.gain.value = 0.14; bgmGain.connect(master);
    startBgm();
  }

  function osc(freq, dur, type, vol, dest, when) {
    if (!ac) return;
    const t0 = ac.currentTime + (when || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(Math.max(vol || 0.2, 0.001), t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(dest || master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, freq, when) {
    if (!ac) return;
    const t0 = ac.currentTime + (when || 0);
    const src = ac.createBufferSource();
    const buf = ac.createBuffer(1, Math.max(1, ac.sampleRate * dur), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    src.buffer = buf;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq || 1400;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0);
  }

  // 기계식 타건: 짧은 노이즈 + 저음 클릭
  function thock(vol, pitch, when) {
    noise(0.045, (vol || 0.30), 3200, when);
    osc(pitch || 150, 0.05, 'square', (vol || 0.3) * 0.5, master, when);
  }

  const sfx = {
    hit() { const n = performance.now(); if (n - lastHit < 70) return; lastHit = n; thock(0.22, 130 + Math.random() * 60); },
    kill() { thock(0.3, 100); osc(520, 0.10, 'triangle', 0.12, master, 0.02); },
    pickup() { const n = performance.now(); if (n - lastPick < 90) return; lastPick = n; osc(880 + Math.random() * 220, 0.07, 'sine', 0.10); },
    summon() { osc(220, 0.18, 'sawtooth', 0.12); osc(330, 0.22, 'sawtooth', 0.10, master, 0.05); noise(0.25, 0.06, 700); },
    minion() { osc(180 + Math.random() * 80, 0.10, 'square', 0.08); },
    explosion() { // 키보드 폭발: 타건음 연타 + 붐
      noise(0.35, 0.5, 900);
      for (let i = 0; i < 7; i++) thock(0.25, 120 + Math.random() * 160, 0.03 + i * 0.045);
    },
    drill() { osc(1400, 0.06, 'sawtooth', 0.05); },
    hurt() { noise(0.12, 0.3, 500); osc(90, 0.15, 'sawtooth', 0.15); },
    levelup() { [523, 659, 784, 1047].forEach((f, i) => osc(f, 0.22, 'triangle', 0.16, master, i * 0.09)); },
    pass() { [392, 494, 587, 784].forEach((f, i) => osc(f, 0.5, 'triangle', 0.15, master, i * 0.04)); noise(0.5, 0.15, 2000, 0.1); },
    bossRoar() { osc(55, 0.9, 'sawtooth', 0.3); osc(41, 1.1, 'sawtooth', 0.25, master, 0.1); noise(0.8, 0.2, 300); },
    slam() { noise(0.3, 0.5, 400); osc(60, 0.35, 'sine', 0.4); },
    dead() { [330, 262, 196, 131].forEach((f, i) => osc(f, 0.4, 'triangle', 0.18, master, i * 0.22)); },
    click() { thock(0.18, 200); },
  };

  // 로파이 BGM: 8스텝 베이스 + 코드 패드 루프 (판교의 밤 감성)
  const BASS = [110, 0, 82.4, 0, 98, 0, 73.4, 87.3];
  const PAD = [[220, 261.6, 329.6], null, [196, 246.9, 293.7], null];
  function startBgm() {
    if (bgmTimer) return;
    bgmTimer = setInterval(() => {
      if (!bgmOn || !ac || ac.state !== 'running') return;
      const b = BASS[bgmStep % 8];
      if (b) osc(b, 0.42, 'triangle', 0.5, bgmGain);
      if (bgmStep % 2 === 0) {
        const chord = PAD[(bgmStep / 2) % 4];
        if (chord) chord.forEach(f => osc(f, 0.9, 'sine', 0.12, bgmGain));
      }
      if (bgmStep % 4 === 2) noise(0.03, 0.05, 6000); // 하이햇 틱
      bgmStep++;
    }, 280);
  }

  function toggleBgm() { bgmOn = !bgmOn; return bgmOn; }
  let vol = 0.5;
  function setVolume(v) { vol = Math.max(0, Math.min(1, v)); if (master) master.gain.value = vol; return vol; }

  return { init, sfx, toggleBgm, setVolume, get on() { return bgmOn; }, get volume() { return vol; } };
})();
