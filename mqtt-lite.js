// mqtt-lite.js — 브라우저용 아주 작은 MQTT 3.1.1 클라이언트 (WebSocket, QoS 0 만)
//
// 보드와 폰은 같은 공개 MQTT 중계 서버에 붙어서 주제(topic)로 말을 주고받는다.
// 큰 라이브러리(mqtt.js, 300KB 안팎)를 폰에 내려받지 않으려고 필요한 것만 직접 짰다:
// CONNECT(유언 메시지 포함) / SUBSCRIBE / PUBLISH / PINGREQ. 끊기면 다시 붙는다.
(function (G) {
  'use strict';
  const te = new TextEncoder(), td = new TextDecoder();

  function str(s) { const b = te.encode(s); return [b.length >> 8, b.length & 255, ...b]; }
  function remLen(n) { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return o; }
  function packet(type, body) { return new Uint8Array([type, ...remLen(body.length), ...body]); }

  class MqttLite {
    // opt: { urls: [...], clientId, keepalive, will: {topic, payload, retain}, onMessage(topic, text), onState(state) }
    constructor(opt) {
      this.o = Object.assign({ keepalive: 30 }, opt);
      this.subs = new Set();
      this.state = 'idle';
      this.urlIdx = 0;
      this.pid = 1;
      this.buf = new Uint8Array(0);
      this.closedByUser = false;
    }
    setState(s) { if (this.state !== s) { this.state = s; this.o.onState && this.o.onState(s); } }
    connect() {
      this.closedByUser = false;
      const url = this.o.urls[this.urlIdx % this.o.urls.length];
      this.setState('connecting');
      let ws;
      try { ws = new WebSocket(url, ['mqtt']); } catch (e) { return this.retry(); }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      const t0 = Date.now();
      this.connTimer = setTimeout(() => { if (this.state !== 'online') { try { ws.close(); } catch (e) {} } }, 8000);
      ws.onopen = () => {
        const w = this.o.will;
        let flags = 0x02;                                   // clean session
        if (w) flags |= 0x04 | (w.retain ? 0x20 : 0);       // 유언(끊기면 서버가 대신 보내는 메시지)
        const body = [...str('MQTT'), 4, flags, this.o.keepalive >> 8, this.o.keepalive & 255, ...str(this.o.clientId)];
        if (w) body.push(...str(w.topic), ...str(w.payload));
        ws.send(packet(0x10, body));
      };
      ws.onmessage = (ev) => this.feed(new Uint8Array(ev.data), t0);
      ws.onclose = () => {
        clearTimeout(this.connTimer); clearInterval(this.pinger);
        const was = this.state;
        this.ws = null;
        if (this.closedByUser) { this.setState('idle'); return; }
        if (was !== 'online') this.urlIdx++;               // 붙지도 못했으면 다음 서버로
        this.retry();
      };
      ws.onerror = () => {};
    }
    retry() {
      this.setState('offline');
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this.connect(), 1500);
    }
    feed(chunk, t0) {
      const b = new Uint8Array(this.buf.length + chunk.length); b.set(this.buf); b.set(chunk, this.buf.length);
      let p = 0;
      while (true) {
        if (b.length - p < 2) break;
        let mul = 1, len = 0, i = p + 1, d;
        do { if (i >= b.length) { this.buf = b.slice(p); return; } d = b[i++]; len += (d & 127) * mul; mul *= 128; } while (d & 128);
        if (b.length - i < len) break;
        this.handle(b[p], b.subarray(i, i + len), t0);
        p = i + len;
      }
      this.buf = b.slice(p);
    }
    handle(h, body, t0) {
      const type = h >> 4;
      if (type === 2) {                                     // CONNACK
        if (body[1] !== 0) { try { this.ws.close(); } catch (e) {} return; }
        clearTimeout(this.connTimer);
        this.connectMs = Date.now() - t0;
        this.setState('online');
        for (const t of this.subs) this.sendSub(t);
        clearInterval(this.pinger);
        this.pinger = setInterval(() => this.raw(new Uint8Array([0xC0, 0])), this.o.keepalive * 1000 * 0.6);
      } else if (type === 3) {                              // PUBLISH (QoS 0)
        const tl = (body[0] << 8) | body[1];
        const topic = td.decode(body.subarray(2, 2 + tl));
        let off = 2 + tl;
        if ((h >> 1) & 3) off += 2;                         // QoS>0 이면 패킷 번호 (쓰지 않지만 건너뛴다)
        const text = td.decode(body.subarray(off));
        this.o.onMessage && this.o.onMessage(topic, text, !!(h & 1));
      }
    }
    raw(p) { if (this.ws && this.ws.readyState === 1) { this.ws.send(p); return true; } return false; }
    sendSub(t) { const id = this.pid++ & 0xFFFF || 1; this.raw(packet(0x82, [id >> 8, id & 255, ...str(t), 0])); }
    subscribe(t) { this.subs.add(t); if (this.state === 'online') this.sendSub(t); }
    publish(topic, text, retain) {
      if (this.state !== 'online') return false;
      return this.raw(packet(0x30 | (retain ? 1 : 0), [...str(topic), ...te.encode(text)]));
    }
    close() { this.closedByUser = true; clearTimeout(this.retryTimer); clearInterval(this.pinger); if (this.ws) { this.raw(new Uint8Array([0xE0, 0])); this.ws.close(); } }
  }
  G.MqttLite = MqttLite;
})(typeof window !== 'undefined' ? window : globalThis);
