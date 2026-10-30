// 해녀바당: aT(한국농수산식품유통공사) 「최근일자 도·소매가격정보」에서 수산물 kg당 시세를 가져옴
// 키는 Vercel 환경변수 DATA_GO_KEY (숨비 지킴이 수온 API와 같은 공공데이터포털 키)
// 응답 항목 이름이 문서에 공개돼 있지 않아서, 이름을 보고 자동으로 찾음. 확인용: /api/price?raw=1
const BASE = "https://apis.data.go.kr/B552845/recent";
let cache = { at: 0, data: null };

function findItems(o) {
  if (Array.isArray(o)) return o.length && typeof o[0] === "object" ? o : null;
  if (o && typeof o === "object") {
    if (o.item && !Array.isArray(o.item) && typeof o.item === "object") return [o.item];
    for (const v of Object.values(o)) { const f = findItems(v); if (f) return f; }
  }
  return null;
}
const num = (v) => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
function pick(o, res) {
  for (const re of res) { const k = Object.keys(o).find((k) => re.test(k)); if (k && o[k] !== null && o[k] !== "") return o[k]; }
  return null;
}
// 조사일 kg환산 가격 (1일전·1주일전 같은 과거 값은 제외)
const PAST = /(bfr|ago|prev|befr|dd1|wk|week|mm1|mon|yy1|year|yr|1일|1주|1개월|1년)/i;
function kgPrice(o) {
  const keys = Object.keys(o).filter((k) => /(kg|cnvs|환산)/i.test(k) && !PAST.test(k));
  const best = keys.find((k) => /(exmn|avg|평균|dd)/i.test(k)) || keys[0];
  return best ? num(o[best]) : null;
}
function unitPrice(o) {
  const keys = Object.keys(o).filter((k) => /(prc|price|가격)/i.test(k) && !/(kg|cnvs|환산)/i.test(k) && !PAST.test(k));
  const best = keys.find((k) => /(exmn|avg|평균)/i.test(k)) || keys[0];
  return best ? num(o[best]) : null;
}
function normalize(it) {
  return {
    date: pick(it, [/exmn_ymd/i, /ymd/i, /조사일자/]),
    se: pick(it, [/se_nm/i, /구분명/]),
    seCd: pick(it, [/se_cd/i, /구분코드/]),
    cls: pick(it, [/ctgry_nm/i, /부류명/]),
    clsCd: pick(it, [/ctgry_cd/i, /부류코드/]),
    item: pick(it, [/^item_nm$/i, /item.*nm/i, /품목명/]),
    kind: pick(it, [/vrty_nm/i, /품종명/]),
    grade: pick(it, [/grd_nm/i, /등급명/]),
    unit: pick(it, [/^unit$/i, /unit_nm/i, /^단위$/]),
    size: pick(it, [/unit_sz/i, /sz/i, /단위크기/]),
    perKg: kgPrice(it),
    price: unitPrice(it),
  };
}
async function call(key, extra) {
  const qs = new URLSearchParams({ pageNo: "1", numOfRows: "1000", returnType: "json", ...extra }).toString();
  const r = await fetch(`${BASE}?serviceKey=${key}&${qs}`, { headers: { Accept: "application/json" } });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, j, text };
}

// 수산물 부류(600)의 품목 코드 후보. 이 API가 품목 코드를 꼭 요구하면 하나씩 물어봄
const ITEM_CODES = Array.from({ length: 60 }, (_, i) => String(601 + i));

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const key = process.env.DATA_GO_KEY;
  if (!key) return res.status(500).json({ error: "Vercel에 DATA_GO_KEY 환경변수가 없어요" });
  const raw = !!req.query.raw;
  if (!raw && cache.data && Date.now() - cache.at < 3 * 3600 * 1000) return res.status(200).json(cache.data);
  const log = [];
  const done = (items, how) => {
    const rows = items.map(normalize).filter((r) => r.item && (r.perKg || r.price));
    const fish = rows.filter((r) => /수산/.test(r.cls || "") || /^6/.test(String(r.clsCd || "")));
    const data = { ok: true, source: "aT 최근일자 도·소매가격", how, date: (fish[0] || rows[0] || {}).date || null, rows: fish.length ? fish : rows, filtered: !!fish.length };
    cache = { at: Date.now(), data };
    if (raw) return res.status(200).json({ how, 원본_예시: items.slice(0, 5), 해석_예시: items.slice(0, 5).map(normalize), 수산물_건수: fish.length, log });
    return res.status(200).json(data);
  };
  try {
    // 1) 부류만 주고 한 번에 받기
    for (const extra of [{ "cond[ctgry_cd::EQ]": "600" }, {}]) {
      const { status, j, text } = await call(key, extra);
      const items = j ? findItems(j) || [] : [];
      log.push({ 조건: extra, status, 건수: items.length, 응답: text.slice(0, 400) });
      if (items.length) return done(items, "부류 조회");
    }
    // 2) 품목 코드가 필요하면 수산물 품목을 하나씩 (동시에 10개씩)
    const all = [];
    for (let i = 0; i < ITEM_CODES.length; i += 10) {
      const part = await Promise.all(ITEM_CODES.slice(i, i + 10).map((c) =>
        call(key, { "cond[ctgry_cd::EQ]": "600", "cond[item_cd::EQ]": c }).then((r) => ({ c, ...r })).catch((e) => ({ c, status: 0, text: String(e) }))));
      for (const r of part) {
        const items = r.j ? findItems(r.j) || [] : [];
        if (items.length) all.push(...items);
        else if (log.length < 6) log.push({ 품목코드: r.c, status: r.status, 응답: (r.text || "").slice(0, 200) });
      }
    }
    if (all.length) return done(all, "품목별 조회");
    return res.status(502).json({ error: "시세 자료를 찾지 못했어요", log });
  } catch (e) {
    return res.status(502).json({ error: "시세 API 연결 실패: " + e.message, log });
  }
};
