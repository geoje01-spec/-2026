# 🌊 해녀 장터

해녀가 잡은 해산물을 사진 한 장으로 판매 등록하고, 관광객을 위한 해녀 체험을 올리는 웹앱입니다.

- 📷 **사진으로 판매 등록**: 사진을 찍으면 AI(Gemini)가 품목·개수·무게·신선도를 판별합니다.
- 💰 **시세 기반 추천 가격**: 공공데이터포털 농수산물 가격 API의 최신 시세로 가격을 추천합니다. 해녀가 확인하고 고칠 수 있습니다.
- 🤝 **예약 손님 우선 매칭**: 같은 품목을 미리 예약한 손님이 있으면, 상품이 올라오는 순간 가장 먼저 예약한 손님에게 연결됩니다.
- 🤿 **해녀 체험 등록**: 날짜·시간·정원·가격·장소를 올리고, 예약 인원을 확인합니다. 정원을 넘는 예약은 막습니다.

## 실행 방법

Node.js 22 이상이 필요합니다. GitHub Codespaces에는 이미 설치되어 있습니다.

```bash
npm install
cp .env.example .env    # .env 를 열어 키 두 개를 채워 넣기
npm start
```

브라우저에서 http://localhost:3000 을 엽니다. Codespaces에서는 오른쪽 아래에 뜨는 **"브라우저에서 열기"**를 누르면 됩니다.

### 필요한 키

| 환경 변수 | 어디서 받나요 |
|---|---|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com) → API 키 (무료 등급 가능) |
| `DATA_GO_KR_KEY` | [공공데이터포털](https://www.data.go.kr) → 농수산물 가격 API(`/B552845/recent/price`) 활용 신청 → 인증키 |

> ⚠️ 키는 절대 코드나 GitHub에 올리지 마세요. `.env` 파일은 `.gitignore`에 들어 있어 올라가지 않습니다.
> Codespaces에서는 GitHub **Settings → Codespaces → Secrets**에 같은 이름으로 넣어두면 `.env` 없이도 됩니다.

## 시세가 없는 품목

시세 API에는 전복·굴·홍합·가리비·오징어·갈치·고등어 등은 있지만 **소라·성게·문어·해삼·멍게·미역·톳은 없습니다.**
이 품목들은 해녀가 가격을 직접 입력합니다. 품목과 API 이름의 연결은 `lib/price.js`의 `ITEM_MAP`에서 바꿀 수 있습니다.

## 사용자(관광객) 웹앱에서 쓸 API

관광객용 앱은 아래 API를 호출하면 됩니다. 요청·응답은 모두 JSON입니다.

| 기능 | 요청 | 보내는 값 |
|---|---|---|
| 판매 중인 상품 | `GET /api/products?status=available` | |
| 해산물 예약 (우선 매칭) | `POST /api/reservations` | `customerName`, `itemName`, `quantity`, `contact`, `memo` |
| 예약 취소 | `POST /api/reservations/:id/cancel` | |
| 체험 목록 (남은 자리 포함) | `GET /api/experiences` | |
| 체험 예약 | `POST /api/experiences/:id/bookings` | `customerName`, `people`, `contact`, `memo` |
| 품목 목록 | `GET /api/items` | |

예약의 `status`는 `pending`(대기) → `matched`(상품 연결됨) → `completed`(거래 완료) 또는 `cancelled`(취소)로 바뀝니다.

## 해녀 앱이 쓰는 API

| 기능 | 요청 |
|---|---|
| 사진 판별 | `POST /api/identify` `{ image: "data:image/jpeg;base64,..." }` |
| 시세·추천 가격 | `GET /api/price?item=전복` |
| 상품 등록 | `POST /api/products` |
| 상품 상태·가격 변경 | `PATCH /api/products/:id` `{ status: "sold" }` |
| 상품 삭제 | `DELETE /api/products/:id` |
| 체험 등록·삭제 | `POST /api/experiences`, `DELETE /api/experiences/:id` |

## 폴더 구조

```
server.js          서버와 API
lib/gemini.js      AI 사진 판별 (모델이 바쁘면 다음 모델로 자동 전환)
lib/price.js       시세 조회와 추천 가격 계산
lib/store.js       데이터 저장과 예약 우선 매칭
public/            해녀용 화면 (index.html, app.js, style.css)
test/              자동 테스트 (npm test)
data/              저장된 데이터와 사진 (GitHub에 올라가지 않음)
```

## 아직 시제품이라 남은 일

- **로그인**: 지금은 누구나 상품·체험을 올리고 지울 수 있습니다. 실제 운영 전에 해녀 계정 로그인이 필요합니다.
- **데이터베이스**: 지금은 `data/db.json` 파일 하나에 저장합니다. 실제 서비스는 PostgreSQL, Firebase 같은 DB로 옮겨야 합니다.
- **결제**: 아직 없습니다.
- **금어기·금지체장 안내**: 법령(수산자원관리법 시행령) 기준으로 등록 전에 경고하는 기능을 넣으면 좋습니다.
