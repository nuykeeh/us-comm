# U.S. 통신기

We, Our, Earth 아트토이(본보드 DFR1221)와 교신하는 무전기 웹 — https://nuykeeh.github.io/us-comm/

- `index.html` 무전기: 버튼을 누른 채로 말하고 떼면 보낸다. 폰이 받아쓰기를 지원하면 폰이 글자로 바꿔 보내고, 아니면 보드 마이크가 듣는다
- `settings.html` 설정: 채널(캐릭터), 말 받는 방법, 화면 방향, 음량, 표정 시험
- 보드와는 공개 MQTT 중계 서버(EMQX·HiveMQ, WebSocket)로 주고받는다 (`mqtt-lite.js`, `app.js`). 채널 코드는 `config.js` — 보드 펌웨어 `remote.h` 의 `REMOTE_STATION` 과 같아야 한다
- 공개 서버라 내용이 암호화되지 않는다. 와이파이 비밀번호·API 키는 이 길로 보내지 않는다 (보드 IP 의 `/config` 에서만)

펌웨어와 자세한 기록은 본보드 폴더의 README.
