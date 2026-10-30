// 해녀바당: 지역 물가 계수 = 지역별 수산물 소매가 ÷ 전국 평균
// 자료: aT 「지역별 품목별 도·소매 가격정보」(B552845/perRegion). 공공데이터포털에서 이 API도 활용신청해야 함
// 확인용: /api/region?raw=1
const KEY_REGIONS = {
  jeju: ["제주", "서귀포"], busan: ["부산"], ulsan: ["울산"], gyeongbuk: ["포항", "안동", "경주", "경북", "대구"],
  gangwon: ["강릉", "춘천", "원주", "강원", "속초", "삼척"], gyeongnam: ["창원", "진주", "통영", "거제", "경남", "김해"],
  jeonnam: ["순천", "목포", "여수", "전남", "광주"], chungnam: ["천안", "서산", "충남", "대전", "보령"],
};
const OPS = ["/price", "/prices", "/list", ""];
let cache = { at: 0, data: null };
let OP = null;

function findItems(o) {
  if (Array.isArray(o)) return o.length && typeof o[0] === "object" ? o : null;
  if (o && typeof o === "object") {
    if (o.item && !Array.isArray(o.item) && typeof o.item === "object") return [o.item];
    for (const v of Object.values(o)) { const f = findItems(v); if (f) return f; }
  }
  return null;
}
const num = (v) => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
const PAST = /(bfr|ago|prev|dd1|ww1|mm1|yy1|1일|1주|1개월|1년)/i;
function price(o) {
  const ks = Object.keys(o).filter((k) => !PAST.test(k));
  const k = ks.find((k) => /(cnvs|환산)/i.test(k) && /(avg|평균)/i.test(k)) || ks.find((k) => /(avg|평균)/i.test(k) && /(prc|가격)/i.test(k)) || ks.find((k) => /(cnvs|환산)/i.test(k));
  return k ? num(o[k]) : null;
}
const pick = (o, re) => { const k = Object.keys(o).find((k) => re.test(k)); return k ? o[k] : null; };
const regionOf = (name) => Object.keys(KEY_REGIONS).find((k) => KEY_REGIONS[k].some((w) => String(name || "").includes(w))) || null;
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
async function get(base, key, params) {
  const qs = new URLSearchParams({ pageNo: "1", numOfRows: "1000", returnType: "json", ...params }).toString();
  const r = await fetch(`${base}?serviceKey=${key}&${qs}`, { headers: { Accept: "application/json" } });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: r.status, text, items: j ? findItems(j) || [] : [] };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const key = process.env.DATA_GO_KEY;
  if (!key) return res.status(500).json({ error: "Vercel에 DATA_GO_KEY 환경변수가 없어요" });
  const raw = !!req.query.raw;
  if (!raw && cache.data && Date.now() - cache.at < 12 * 3600 * 1000) return res.status(200).json(cache.data);
  const log = [];
  try {
    // 1) 최근 수산물 시세에서 품목 코드와 조사일을 얻음
    const rec = await get("https://apis.data.go.kr/B552845/recent/price", key, { "cond[ctgry_cd::EQ]": "600" });
    const codes = [...new Set(rec.items.map((it) => pick(it, /^item_cd$/i)).filter(Boolean))].slice(0, 10);
    const day = String(pick(rec.items[0] || {}, /exmn_ymd/i) || "").replace(/-/g, "");
    log.push({ 단계: "최근 시세", status: rec.status, 품목코드: codes, 조사일: day });
    if (!codes.length || !day) return res.status(502).json({ error: "최근 시세에서 품목 코드를 얻지 못했어요", log });
    // 2) 지역별 가격: 기능 이름 찾기
    const base0 = "https://apis.data.go.kr/B552845/perRegion";
    const params = (c) => ({ "cond[exmn_ymd::GTE]": day, "cond[exmn_ymd::LTE]": day, "cond[ctgry_cd::EQ]": "600", "cond[item_cd::EQ]": c });
    if (OP === null) {
      for (const op of OPS) {
        const t = await get(base0 + op, key, params(codes[0]));
        log.push({ 기능: op || "(없음)", status: t.status, 건수: t.items.length, 응답: t.text.slice(0, 300) });
        if (!/NO_OPENAPI_SERVICE|returnReasonCode"\s*:\s*"12"/.test(t.text)) { OP = op; break; }
      }
      if (OP === null) return res.status(502).json({ error: "지역별 가격 API 주소를 찾지 못했어요", log });
    }
    // 3) 품목마다 지역별 가격을 받아 "지역 가격 ÷ 전국 중앙값" 비율을 모음
    const results = await Promise.all(codes.map((c) => get(base0 + OP, key, params(c)).then((r) => ({ c, ...r }))));
    const ratios = {};
    let sample = null, rows = 0;
    for (const r of results) {
      if (!r.items.length) { if (log.length < 8) log.push({ 품목코드: r.c, status: r.status, 응답: r.text.slice(0, 200) }); continue; }
      sample = sample || r.items.slice(0, 3);
      // 소매 위주로, 같은 단위끼리 비교
      const list = r.items.map((it) => ({ se: String(pick(it, /se_nm/i) || ""), sgg: pick(it, /sgg_nm/i) || pick(it, /mrkt_nm/i), unit: pick(it, /^unit$/i), p: price(it) })).filter((x) => x.p && x.sgg);
      const retail = list.filter((x) => /소매/.test(x.se));
      const use = retail.length >= 3 ? retail : list;
      const nat = median(use.map((x) => x.p));
      if (!nat) continue;
      rows += use.length;
      for (const x of use) { const g = regionOf(x.sgg); if (g) (ratios[g] = ratios[g] || []).push(x.p / nat); }
    }
    const factors = {};
    for (const [g, a] of Object.entries(ratios)) factors[g] = Math.round(median(a) * 100) / 100;
    const data = { ok: Object.keys(factors).length > 0, date: day, factors, rows, op: OP, how: "지역 수산물 소매가 ÷ 전국 중앙값 (품목별 비율의 중앙값)" };
    if (raw) return res.status(200).json({ ...data, 원본_예시: sample, log });
    if (!data.ok) return res.status(502).json({ error: "지역별 가격 자료가 없어요", log });
    cache = { at: Date.now(), data };
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: "지역별 가격 API 연결 실패: " + e.message, log });
  }
};
