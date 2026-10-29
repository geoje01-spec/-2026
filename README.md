# 숨비 지킴이

해녀 건강 관제(마이크로비트) + 실측 수온·기상청 해상예보 기반 물질 판단 AI 에이전트. 데모데이 시연용이며 응급 신고는 모의 신고입니다.

## 구성
- `index.html` 웹앱
- `api/` 키를 숨긴 채 공공데이터·Gemini를 불러주는 중계 (Vercel)
- `haenyeo_sender_makecode.ts` 해녀용 마이크로비트, `receiver_makecode.ts` 수신용 마이크로비트
- `server.py` 인터넷 배포 없이 내 PC에서 실행할 때

## 키
API 키는 이 저장소에 넣지 않습니다. Vercel 환경변수로 넣습니다.
- `DATA_GO_KEY` 공공데이터포털 일반 인증키(Encoding)
- `GEMINI_KEY` Google AI Studio Gemini 키
