// talk.js — 무전기 화면
//
// 버튼을 누르고 있는 동안 말하고, 떼면 보낸다.
//   폰 받아쓰기(기본): 폰 브라우저가 말을 글자로 바꿔 보드에 보낸다. 보드는 "듣는 표정"만 짓는다.
//                     녹음 파일을 올리지 않아 대답이 빨라진다 (https 고정 주소라서 마이크를 쓸 수 있다)
//   보드 마이크      : 폰이 받아쓰기를 못 하면(지원 안 하는 브라우저, 권한 거부) 버튼을 누르는 동안
//                     보드 마이크가 녹음한다.
(function () {
  'use strict';
  const { CHARS, charById, Link, Sfx, keepAwake, applyTheme } = window.US;
  const $ = (id) => document.getElementById(id);
  const ptt = $('ptt'), sfx = new Sfx();
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const MAX_TX_MS = 15000;                    // 보드 녹음 한도와 같게

  let srBroken = false;                       // 이번에 폰 받아쓰기를 못 쓰게 됨 (권한 거부 등)
  const inputPref = () => localStorage.getItem('us.input') || 'auto';
  const phoneMode = () => !!SR && !srBroken && inputPref() !== 'board';

  let tx = null;                              // 송신 중 상태
  let lastMode = '', sentText = '', reply = '', replyAt = 0, flashMsg = '', flashUntil = 0, devId = '';

  const link = new Link({ onChange: render, onLog, onLink: render });
  link.start();

  for (let i = 0; i < 20; i++) $('meter').appendChild(document.createElement('i'));

  // ---------------------------------------------------------------- 화면
  const STATUS = {
    off: '보드 신호 없음',
    idle: '대기 중',
    listening: '보드가 듣는 중',
    thinking: '수신 대기…',
    speaking: '수신 중 — 이어폰으로 들려줘요',
    text: '화면에 글자로 답했어요',
    boot: '보드가 켜지는 중',
    setup: '보드가 설정 모드예요',
  };

  function flash(msg, ms) { flashMsg = msg; flashUntil = Date.now() + (ms || 3500); render(); }

  function render() {
    const linked = link.linked();
    $('link').className = 'link ' + (linked ? 'ok' : 'bad');
    $('linkText').textContent = linked ? 'LINK' : '연결 중';
    const d = link.current();
    if (!d) {
      $('status').textContent = linked ? '보드를 찾는 중… (보드가 인터넷에 붙어 있어야 해요)' : '중계 서버에 연결하는 중…';
      $('dot').className = 'dot';
      ptt.disabled = !tx;
      return;
    }
    if (d.id !== devId) { devId = d.id; }
    const st = d.state, live = d.live;
    const ch = charById(st.ch) || CHARS[1];
    applyTheme(ch.id);
    $('ch').textContent = 'CH ' + (CHARS.indexOf(ch) + 1) + '  ·  ' + (st.online ? 'ON AIR' : 'NO SIGNAL');
    $('name').textContent = ch.name;
    $('full').textContent = ch.full;
    const bars = !st.online ? 0 : st.rssi > -55 ? 4 : st.rssi > -65 ? 3 : st.rssi > -75 ? 2 : 1;
    [...$('sig').children].forEach((b, i) => b.classList.toggle('on', i < bars));

    const mode = st.online ? live.m : 'off';
    if (mode !== lastMode) {
      if (mode === 'speaking') sfx.incoming();
      lastMode = mode;
    }
    let status = STATUS[mode] || mode;
    if (mode === 'idle' && !st.ready) status = 'AI 연결 안 됨 · 표정만 움직여요';
    if (tx) status = tx.phone ? '송신 중 — 말하세요' : '송신 중 (보드 마이크)';
    if (Date.now() < flashUntil) status = flashMsg;
    $('status').textContent = status;
    $('dot').className = 'dot ' + (tx ? 'tx' : mode === 'speaking' || mode === 'thinking' ? 'rx' : st.online ? 'ok' : '');
    $('timer').textContent = tx ? fmt(Date.now() - tx.t0) : (mode === 'listening' && live.s ? fmt(live.s * 1000) : '');

    const canTalk = st.online && st.ready && (mode === 'idle' || mode === 'text');
    ptt.disabled = !(canTalk || tx);
    $('pttSub').textContent = tx ? '놓으면 전송' : canTalk ? '누른 채로 말하기' : !st.online ? '보드 꺼짐' : !st.ready ? '대기' : '응답 중';
    $('hint').textContent = phoneMode() ? '폰이 받아써서 보내요 · 설정에서 바꿀 수 있어요' : SR ? '보드 마이크로 들어요' : '이 브라우저는 받아쓰기를 못 해서 보드 마이크로 들어요';

    // 글자 칸: 말하는 중엔 받아쓰기, 기다리는 중엔 보낸 말, 그다음엔 답
    let txt = '', cls = '';
    if (tx && tx.phone) { txt = (tx.final + ' ' + tx.interim).trim() || '…'; cls = 'mine'; }
    else if (tx) { txt = '보드에 대고 말하세요'; cls = 'mine'; }
    else if (mode === 'thinking' && sentText) { txt = '▶ ' + sentText; cls = 'mine'; }
    else if (reply) { txt = reply.slice(0, Math.max(1, Math.floor((Date.now() - replyAt) / 35))); }
    $('text').textContent = txt;
    $('text').className = 'lcd-text ' + cls;

    // 소리 크기 막대: 보드 마이크면 보드가 보낸 크기, 폰 받아쓰기면 말이 들어올 때 출렁
    let lv = 0;
    if (tx && tx.phone) lv = Math.max(0, 0.75 - (Date.now() - (tx.wordAt || 0)) / 600) * 255 * (0.6 + 0.4 * Math.random());
    else if (mode === 'listening' || mode === 'speaking') lv = live.lv || 0;
    const n = Math.round((lv / 255) * 20 * 1.4);
    [...$('meter').children].forEach((b, i) => b.classList.toggle('on', i < n));
    document.body.classList.toggle('tx', !!tx);
    document.body.classList.toggle('rx', mode === 'speaking');
  }
  const fmt = (ms) => { const s = Math.floor(ms / 1000); return '0' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  setInterval(() => { if (tx || reply) render(); }, 80);

  // ---------------------------------------------------------------- 교신 기록
  function addLog(cls, who, text) {
    const p = document.createElement('p');
    p.className = cls;
    if (who) { const b = document.createElement('b'); b.textContent = who; p.appendChild(b); }
    p.appendChild(document.createTextNode(text));
    const L = $('log');
    L.appendChild(p);
    while (L.children.length > 30) L.removeChild(L.firstChild);
    L.scrollTop = L.scrollHeight;
  }
  function onLog(id, j) {
    const d = link.current();
    if (!d || d.id !== id) return;
    const ch = charById(d.state.ch) || CHARS[1];
    if (j.a !== undefined) {
      addLog('me', '나', j.q || '');
      addLog('ai', ch.name, j.a);
      reply = j.a; replyAt = Date.now(); sentText = '';
    } else if (j.err) {
      addLog('err', '', j.err);
      flash(j.err, 5000);
      sfx.error();
      sentText = '';
    } else if (j.sys) {
      addLog('sys', '', j.sys);
    }
    render();
  }

  // ---------------------------------------------------------------- 누르고 말하기
  function press(e) {
    if (e) e.preventDefault();
    if (tx || ptt.disabled) return;
    sfx.ready();
    keepAwake();
    if (navigator.vibrate) navigator.vibrate(18);
    sfx.press();
    tx = { t0: Date.now(), phone: phoneMode(), final: '', interim: '', wordAt: 0 };
    reply = '';
    ptt.classList.add('on');
    if (tx.phone && !startPhone()) tx.phone = false;
    if (!tx.phone) link.send({ c: 'ptt', on: 1 });
    tx.limit = setTimeout(release, MAX_TX_MS);
    render();
  }

  function release() {
    if (!tx || tx.releasing) return;
    tx.releasing = true;
    clearTimeout(tx.limit);
    ptt.classList.remove('on');
    sfx.release();
    if (navigator.vibrate) navigator.vibrate(10);
    if (tx.phone) {
      // 받아쓰기는 멈추라고 한 뒤 마지막 글자가 조금 늦게 온다 → onend 에서 마무리 (안 오면 1.8초 뒤)
      try { tx.rec.stop(); } catch (e) {}
      tx.endTimer = setTimeout(finishPhone, 1800);
    } else {
      link.send({ c: 'ptt', on: 0 });
      tx = null;
    }
    render();
  }

  function startPhone() {
    let rec;
    try { rec = new SR(); } catch (e) { srBroken = true; return false; }
    rec.lang = 'ko-KR';
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    const t = tx;
    t.rec = rec;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) t.final += r[0].transcript + ' ';
        else interim += r[0].transcript;
      }
      t.interim = interim;
      t.wordAt = Date.now();
      render();
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
        t.denied = true;
        srBroken = true;
      }
    };
    rec.onend = () => {
      if (tx !== t) return;
      if (t.releasing) { finishPhone(); return; }
      if (t.denied) {
        // 마이크·받아쓰기 권한이 없다 → 이번 송신부터 보드 마이크로
        flash('폰 마이크를 쓸 수 없어 보드 마이크로 바꿨어요', 4000);
        t.phone = false;
        link.send({ c: 'listen', on: 0 });
        setTimeout(() => link.send({ c: 'ptt', on: 1 }), 300);
        return;
      }
      try { rec.start(); } catch (e) {}       // 아이폰은 말이 잠깐 끊기면 혼자 멈춘다 — 누르고 있는 동안 다시
    };
    try { rec.start(); } catch (e) { srBroken = true; return false; }
    link.send({ c: 'listen', on: 1 });
    return true;
  }

  function finishPhone() {
    const t = tx;
    if (!t || !t.phone) return;
    clearTimeout(t.endTimer);
    tx = null;
    const text = (t.final + ' ' + t.interim).replace(/\s+/g, ' ').trim();
    if (text) {
      sentText = text;
      link.send({ c: 'ask', q: text });
    } else {
      link.send({ c: 'listen', on: 0 });
      flash('잘 안 들렸어요. 버튼을 누른 채로 말해 주세요', 4000);
      sfx.error();
    }
    render();
  }

  ptt.addEventListener('pointerdown', (e) => { try { ptt.setPointerCapture(e.pointerId); } catch (x) {} press(e); });
  ptt.addEventListener('pointerup', release);
  ptt.addEventListener('pointercancel', release);
  ptt.addEventListener('lostpointercapture', release);
  ptt.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat) press(e); });
  document.addEventListener('keyup', (e) => { if (e.code === 'Space') release(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });

  // 시험용 (헤드리스 브라우저에서 화면 상태를 확인할 때)
  window.__talk = { link, press, release, render, send: (q) => { sentText = q; link.send({ c: 'ask', q }); render(); } };
  render();
})();
