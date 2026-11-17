// config.js — 보드 펌웨어(remote.h)와 같은 값이어야 한다
window.US_CONFIG = {
  station: 'hyapa1x8',                       // 채널 코드 (REMOTE_STATION)
  brokers: [                                 // 두 곳에 동시에 붙는다. 보드는 되는 쪽 하나에 붙어 있다
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
  ],
};
