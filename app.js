// app.js — 보드와 주고받기 + 무전기·설정 화면 공통
//
// 보드와 폰은 공개 MQTT 중계 서버로 주고받는다 (보드 펌웨어 remote.h 참고).
//   woe-us/<채널>/dev/<보드 id>/state  보존: 켜짐/꺼짐, 캐릭터, 회전, 음량, IP
//                               /live   지금 하는 일 (idle·listening·thinking·speaking·text) + 소리 크기
//                               /log    대화 한 줄 {q, a} / 오류 {err}
//                               /cmd    폰 -> 보드 명령
// 중계 서버 두 곳에 동시에 붙고, 보드가 어느 쪽에 있든 받는다. 명령은 두 곳에 다 보낸다.
(function (G) {
  'use strict';
  const CFG = G.US_CONFIG;

  // 보드 펌웨어 characters.h 순서 (CH 번호가 이 순서)
  const CHARS = [
    { id: 'frog',   name: '샐리', full: '샐리 프로그',   accent: '#2ee6d6', bg: '#00262e', glow: 'rgba(46,230,214,.55)' },
    { id: 'rabbit', name: '버니', full: '버니 토스트롱', accent: '#ff8ccf', bg: '#372b2e', glow: 'rgba(255,140,207,.55)' },
    { id: 'monkey', name: '침프', full: '침프 알버트',   accent: '#ff5a7e', bg: '#370019', glow: 'rgba(255,90,126,.55)' },
  ];
  const charById = (id) => CHARS.find((c) => c.id === id) || null;

  class Link {
    // h: { onChange(), onLog(devId, msg), onLink(onlineCount) }
    constructor(h) {
      this.h = h;
      this.base = 'woe-us/' + CFG.station;
      this.devices = new Map();      // id -> { id, st: {brokerIdx: state}, live, liveAt }
      this.clients = [];
      this.sel = localStorage.getItem('us.dev') || '';
    }
    start() {
      CFG.brokers.forEach((url, i) => {
        const c = new G.MqttLite({
          urls: [url],
          clientId: 'web-' + Math.random().toString(36).slice(2, 10),
          keepalive: 30,
          onState: () => this.h.onLink && this.h.onLink(this.linked()),
          onMessage: (topic, text) => this.onMessage(i, topic, text),
        });
        c.subscribe(this.base + '/dev/+/state');
        c.subscribe(this.base + '/dev/+/live');
        c.subscribe(this.base + '/dev/+/log');
        c.connect();
        this.clients.push(c);
      });
      // 보드 살아 있는지 주기적으로 다시 판단 (live 가 오래 안 오면 대기로)
      setInterval(() => this.h.onChange && this.h.onChange(), 2000);
    }
    linked() { return this.clients.filter((c) => c.state === 'online').length; }
    dev(id) {
      if (!this.devices.has(id)) this.devices.set(id, { id, st: {}, live: null, liveAt: 0 });
      return this.devices.get(id);
    }
    onMessage(bi, topic, text) {
      const p = topic.split('/');            // woe-us / 채널 / dev / id / 종류
      if (p.length < 5 || p[2] !== 'dev') return;
      let j;
      try { j = JSON.parse(text); } catch (e) { return; }
      const d = this.dev(p[3]);
      if (p[4] === 'state') { d.st[bi] = j; this.h.onChange && this.h.onChange(); }
      else if (p[4] === 'live') { d.live = j; d.liveAt = Date.now(); this.h.onChange && this.h.onChange(); }
      else if (p[4] === 'log') { this.h.onLog && this.h.onLog(p[3], j); }
    }
    // 여러 서버의 보존 상태 중 "켜짐" 을 우선한다 (예전에 붙었던 서버엔 꺼짐이 남아 있을 수 있다)
    state(d) {
      let best = null;
      for (const k in d.st) { const s = d.st[k]; if (!best || (s.online && !best.online)) best = s; }
      return best || { online: 0 };
    }
    list() {
      return [...this.devices.values()].map((d) => ({ id: d.id, state: this.state(d), live: d.live, liveAt: d.liveAt }));
    }
    current() {
      const all = this.list();
      const on = all.filter((d) => d.state.online);
      let d = all.find((x) => x.id === this.sel && x.state.online) || on[0] || all.find((x) => x.id === this.sel) || all[0] || null;
      if (!d) return null;
      const live = d.live && Date.now() - d.liveAt < 12000 ? d.live : { m: d.state.online ? 'idle' : 'off', lv: 0, s: 0 };
      return Object.assign({}, d, { live });
    }
    select(id) { this.sel = id; localStorage.setItem('us.dev', id); this.h.onChange && this.h.onChange(); }
    send(cmd) {
      const d = this.current();
      if (!d) return false;
      const t = this.base + '/dev/' + d.id + '/cmd', s = JSON.stringify(cmd);
      let ok = false;
      for (const c of this.clients) ok = c.publish(t, s) || ok;
      return ok;
    }
  }

  // 무전기 효과음 (WebAudio 로 그때그때 만든다 — 파일 없음)
  class Sfx {
    constructor() { this.ctx = null; this.on = localStorage.getItem('us.sfx') !== '0'; }
    ready() {
      if (!this.ctx) { const AC = G.AudioContext || G.webkitAudioContext; if (AC) this.ctx = new AC(); }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    tone(f, t0, dur, vol, type) {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
      g.gain.setValueAtTime(vol, t0 + dur - 0.02); g.gain.linearRampToValueAtTime(0, t0 + dur);
      o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    }
    noise(t0, dur, vol) {
      const c = this.ctx, n = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.8; g.gain.value = vol;
      s.buffer = b; s.connect(f).connect(g).connect(c.destination); s.start(t0);
    }
    press() { if (!this.on || !this.ready()) return; const t = this.ctx.currentTime; this.noise(t, 0.09, 0.22); this.tone(1650, t + 0.02, 0.05, 0.12, 'square'); }
    release() { if (!this.on || !this.ready()) return; const t = this.ctx.currentTime; this.tone(1200, t, 0.07, 0.1, 'sine'); this.tone(1800, t + 0.08, 0.09, 0.1, 'sine'); this.noise(t + 0.17, 0.12, 0.12); }
    incoming() { if (!this.on || !this.ready()) return; const t = this.ctx.currentTime; this.noise(t, 0.16, 0.12); }
    error() { if (!this.on || !this.ready()) return; const t = this.ctx.currentTime; this.tone(420, t, 0.12, 0.12, 'triangle'); this.tone(320, t + 0.14, 0.16, 0.12, 'triangle'); }
  }

  // 화면 꺼짐 막기 (전시 중 폰이 잠들지 않게). 지원하는 브라우저에서만
  async function keepAwake() {
    try {
      if (!('wakeLock' in navigator)) return;
      let lock = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible' && (!lock || lock.released)) { try { lock = await navigator.wakeLock.request('screen'); } catch (e) {} }
      });
    } catch (e) {}
  }

  function applyTheme(ch) {
    const c = charById(ch) || CHARS[1];
    const r = document.documentElement.style;
    r.setProperty('--accent', c.accent);
    r.setProperty('--char-bg', c.bg);
    r.setProperty('--glow', c.glow);
  }

  G.US = { CHARS, charById, Link, Sfx, keepAwake, applyTheme };
})(window);
