// settings.js — 설정 화면
(function () {
  'use strict';
  const { CHARS, charById, Link, applyTheme } = window.US;
  const $ = (id) => document.getElementById(id);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const FX = ['기본', '웃음', '당혹·지루함', '슬픔', '화남', '집중', '놀람', '딴청', '곤란'];
  let rotHold = 0, volHold = 0;

  const link = new Link({ onChange: render, onLink: render });
  link.start();

  CHARS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'btn'; b.dataset.id = c.id;
    b.innerHTML = 'CH' + (i + 1) + ' ' + c.name + '<small>' + c.full + '</small>';
    b.onclick = () => link.send({ c: 'char', id: c.id });
    $('chars').appendChild(b);
  });
  FX.forEach((n, i) => {
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = n;
    b.onclick = () => link.send({ c: 'face', e: i });
    $('faces').appendChild(b);
  });

  // 말 받는 방법 (이 폰에만 저장)
  function renderInput() {
    const v = localStorage.getItem('us.input') || 'auto';
    [...$('input').children].forEach((b) => b.classList.toggle('sel', b.dataset.v === v));
    $('inputNote').textContent = SR
      ? '이 브라우저는 받아쓰기를 할 수 있어요. 폰 마이크면 녹음을 올리지 않아서 대답이 몇 초 빨라요. 처음 한 번 마이크 권한을 물어봐요.'
      : '이 브라우저는 받아쓰기를 못 해요 (아이폰은 Safari, 안드로이드는 Chrome 에서 돼요). 지금은 보드 마이크로 들어요.';
  }
  [...$('input').children].forEach((b) => { b.onclick = () => { localStorage.setItem('us.input', b.dataset.v); renderInput(); }; });
  renderInput();

  // 효과음 (이 폰에만 저장)
  function renderSfx() { const on = localStorage.getItem('us.sfx') !== '0'; $('sfx').textContent = on ? '효과음 켜짐' : '효과음 꺼짐'; $('sfx').classList.toggle('sel', on); }
  $('sfx').onclick = () => { localStorage.setItem('us.sfx', localStorage.getItem('us.sfx') === '0' ? '1' : '0'); renderSfx(); };
  renderSfx();

  $('clear').onclick = () => { if (link.send({ c: 'clear' })) $('clear').textContent = '지웠어요'; setTimeout(() => { $('clear').textContent = '대화 기록 지우기'; }, 2000); };

  // 화면 방향
  let rotT = 0;
  function setRot(v) {
    v = Math.round(v); if (v > 180) v -= 360; if (v < -180) v += 360;
    $('rot').value = v; $('rotV').textContent = v + '°'; rotHold = Date.now();
    clearTimeout(rotT); rotT = setTimeout(() => link.send({ c: 'rot', deg: (v + 360) % 360 }), 120);
  }
  $('rot').oninput = () => setRot(+$('rot').value);
  document.querySelectorAll('.slider .btn[data-d]').forEach((b) => { b.onclick = () => setRot(+$('rot').value + +b.dataset.d); });

  // 음량
  let volT = 0;
  $('vol').oninput = () => {
    const v = +$('vol').value; $('volV').textContent = v + '%'; volHold = Date.now();
    clearTimeout(volT); volT = setTimeout(() => link.send({ c: 'vol', v: v / 100 }), 150);
  };

  function render() {
    const linked = link.linked();
    $('link').className = 'link ' + (linked ? 'ok' : 'bad');
    $('linkText').textContent = linked ? 'LINK' : '연결 중';
    const d = link.current();
    const all = link.list();
    $('foot').textContent = '채널 코드 ' + window.US_CONFIG.station + ' · 중계 서버 ' + linked + '/' + window.US_CONFIG.brokers.length + ' 연결';
    if (!d) { $('board').innerHTML = '<dt>상태</dt><dd>' + (linked ? '보드를 찾는 중… 보드가 인터넷에 붙어 있어야 해요' : '중계 서버에 연결하는 중…') + '</dd>'; return; }
    const st = d.state, ch = charById(st.ch);
    if (ch) applyTheme(ch.id);
    const net = { online: '인터넷 연결됨', wifi: '와이파이만 (인터넷 확인 중)', offline: '와이파이 없음' }[st.net] || '-';
    const rows = [
      ['상태', st.online ? (st.ready ? '켜짐 · 대화 가능' : '켜짐 · AI 연결 안 됨') : '꺼짐 / 신호 없음'],
      ['캐릭터', ch ? ch.full : '-'],
      ['네트워크', st.online ? net + (st.rssi ? ' (' + st.rssi + 'dBm)' : '') : '-'],
      ['보드 주소', st.ip && st.ip !== '-' ? '<a href="http://' + st.ip + '/config" target="_blank" rel="noopener">http://' + st.ip + '/config</a> <span style="color:var(--faint)">(같은 와이파이에서)</span>' : '-'],
      ['보드 id', d.id + (st.fw ? ' · ' + st.fw : '')],
    ];
    $('board').innerHTML = rows.map((r) => '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>').join('');
    // 보드가 여러 개면 고를 수 있게
    $('devs').innerHTML = '';
    if (all.length > 1) {
      all.forEach((x) => {
        const c = charById(x.state.ch);
        const b = document.createElement('button');
        b.className = 'btn dev' + (x.id === d.id ? ' sel' : '');
        b.innerHTML = '<span class="dot ' + (x.state.online ? 'ok' : '') + '"></span>' + (c ? c.name : '?') + ' · ' + x.id + (x.state.online ? '' : ' (꺼짐)');
        b.onclick = () => link.select(x.id);
        $('devs').appendChild(b);
      });
    }
    [...$('chars').children].forEach((b) => b.classList.toggle('sel', b.dataset.id === st.ch));
    if (Date.now() - rotHold > 2500 && typeof st.rot === 'number') { const v = st.rot > 180 ? st.rot - 360 : st.rot; $('rot').value = v; $('rotV').textContent = v + '°'; }
    if (Date.now() - volHold > 2500 && typeof st.vol === 'number') { const v = Math.round(st.vol * 100); $('vol').value = v; $('volV').textContent = v + '%'; }
    document.querySelectorAll('#chars .btn, #faces .btn, .slider input, .slider .btn, #clear').forEach((el) => { el.disabled = !st.online; });
  }
  render();
})();
