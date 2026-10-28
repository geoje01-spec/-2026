// 공공데이터포털 농수산물 가격 API(/B552845/recent/price)로 해산물 시세를 조회하고 추천 가격을 계산한다.
const API_URL = process.env.PRICE_API_URL || 'https://apis.data.go.kr/B552845/recent/price';
const CACHE_MS = 3 * 60 * 60 * 1000; // 시세는 하루 단위로 바뀌므로 3시간 캐시
const STALE_DAYS = 365; // 1년 넘게 갱신되지 않은 시세는 쓰지 않는다
const MARKUP = Number(process.env.PRICE_MARKUP || 1.0); // 추천가 = 시세 × MARKUP

// 앱에서 쓰는 품목 이름 → API의 item_nm. 목록에 없거나 비어 있으면 시세가 없어 해녀가 직접 가격을 입력한다.
const ITEM_MAP = {
  전복: ['전복'],
  소라: [],
  성게: [],
  문어: [],
  해삼: [],
  멍게: [],
  굴: ['굴'],
  홍합: ['홍합'],
  가리비: ['가리비'],
  미역: [],
  톳: [],
  우뭇가사리: [],
  오징어: ['물오징어'],
  갈치: ['갈치'],
  고등어: ['고등어'],
  삼치: ['삼치'],
  우럭: ['우럭'],
  넙치: ['넙치'],
  새우: ['새우'],
};
const ITEMS = Object.keys(ITEM_MAP);

let cache = { at: 0, rows: null };

// 공공데이터 서버는 연결이 가끔 끊기므로 몇 번 다시 시도하고, 그래도 안 되면 마지막으로 받은 시세를 쓴다.
async function fetchAll() {
  if (cache.rows && Date.now() - cache.at < CACHE_MS) return cache.rows;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));
    try {
      return await fetchFromApi();
    } catch (err) {
      lastError = err;
      if (err.fatal) break;
    }
  }
  if (cache.rows) return cache.rows;
  throw lastError;
}

async function fetchFromApi() {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) throw Object.assign(new Error('DATA_GO_KR_KEY 환경 변수가 없어요.'), { fatal: true });
  // 포털에서 받은 '인코딩' 키는 이미 URL 인코딩되어 있어 그대로 붙이고, '디코딩' 키면 인코딩한다.
  const serviceKey = key.includes('%') ? key : encodeURIComponent(key);
  const url = `${API_URL}?serviceKey=${serviceKey}&pageNo=1&numOfRows=1000&type=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`시세 API 응답을 읽을 수 없어요 (HTTP ${res.status})`);
  }
  const header = body.response?.header;
  if (!header || header.resultCode !== '0') {
    const msg = header?.resultMsg || body.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnAuthMsg || `HTTP ${res.status}`;
    throw new Error(`시세 API 오류: ${msg}`);
  }
  let rows = body.response.body?.items?.item || [];
  if (!Array.isArray(rows)) rows = [rows];
  cache = { at: Date.now(), rows: rows.filter((r) => r.ctgry_nm === '수산물') };
  return cache.rows;
}

const ymdToDate = (ymd) => new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

function toReference(r) {
  const perKg = r.unit === 'kg' || r.unit === 'g';
  const total = num(r.exmn_dd_prc);
  const converted = num(r.exmn_dd_cnvs_prc); // kg·g 단위는 1kg당, 그 외(마리 등)는 1단위당 가격
  const ratio = total ? converted / total : 1;
  const conv = (v) => (num(v) === null ? null : Math.round(num(v) * ratio));
  return {
    apiItem: r.item_nm,
    variety: r.vrty_nm,
    grade: r.grd_nm,
    market: r.se_nm, // 소매 | 중도매
    unit: perKg ? 'kg' : r.unit,
    price: converted,
    surveyDate: r.exmn_ymd,
    previous: {
      day: conv(r.dd1_bfr_prc),
      week: conv(r.ww1_bfr_prc),
      month: conv(r.mm1_bfr_prc),
      year: conv(r.yy1_bfr_prc),
    },
  };
}

// 해녀가 파는 건 국산 활·생물이므로 kg 단위, 국산/냉장/생선, 최신 자료를 우선한다.
function score(ref) {
  let s = 0;
  if (ref.unit === 'kg') s += 100;
  if (/국산|냉장|생선|신선|활어/.test(ref.variety)) s += 20;
  if (/냉동|수입|원양|염장/.test(ref.variety)) s -= 20;
  if (ref.market === '중도매') s += 5;
  s += Number(ref.surveyDate) / 1e8; // 같은 점수면 최신 자료
  return s;
}

async function getPrice(itemName) {
  if (!ITEM_MAP[itemName] || ITEM_MAP[itemName].length === 0) {
    return { item: itemName, found: false, reason: '이 품목은 시세 API에 없어요. 가격을 직접 입력해 주세요.' };
  }
  const rows = await fetchAll();
  const cutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
  const refs = rows
    .filter((r) => ITEM_MAP[itemName].includes(r.item_nm) && ymdToDate(r.exmn_ymd).getTime() >= cutoff)
    .map(toReference)
    .filter((ref) => ref.price > 0)
    .sort((a, b) => score(b) - score(a));
  if (refs.length === 0) {
    return { item: itemName, found: false, reason: '최근 1년 안의 시세 자료가 없어요. 가격을 직접 입력해 주세요.' };
  }
  const base = refs[0];
  return {
    item: itemName,
    found: true,
    base,
    references: refs,
    markup: MARKUP,
    suggestedUnitPrice: Math.round((base.price * MARKUP) / 100) * 100,
    unit: base.unit,
  };
}

module.exports = { ITEMS, getPrice };
