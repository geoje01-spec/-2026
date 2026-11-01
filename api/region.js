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
    if (!codes.length || !/^\d{8}$/.test(day)) return res.status(502).json({ error: "최근 시세에서 품목 코드를 얻지 못했어요", log });
    // 2) 지역별 가격: 기능 이름 찾기
    const base0 = "https://apis.data.go.kr/B552845/perRegion";
    // 지역별 가격은 매일 모든 지역이 올라오지 않아서 최근 30일을 받아 지역마다 가장 최근 값을 씀
    const d0 = new Date(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8)) - 30 * 864e5);
    const from = d0.toISOString().slice(0, 10).replace(/-/g, "");
    const params = (c) => ({ "cond[exmn_ymd::GTE]": from, "cond[exmn_ymd::LTE]": day, "cond[ctgry_cd::EQ]": "600", "cond[item_cd::EQ]": c });
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
      const all = r.items.map((it) => ({ se: String(pick(it, /se_nm/i) || ""), sgg: pick(it, /sgg_nm/i) || pick(it, /mrkt_nm/i), unit: pick(it, /^unit$/i), vr: pick(it, /vrty_cd/i), gr: pick(it, /grd_cd/i), ymd: String(pick(it, /exmn_ymd/i) || ""), p: price(it) })).filter((x) => x.p && x.sgg);
      // 같은 지역·구분·품종·등급·단위는 가장 최근 조사일 값 하나만
      const latest = {};
      for (const x of all) { const k = [x.sgg, x.se, x.vr, x.gr, x.unit].join("|"); if (!latest[k] || x.ymd > latest[k].ymd) latest[k] = x; }
      const list = Object.values(latest);
      const retail = list.filter((x) => /소매/.test(x.se));
      const use = retail.length >= 3 ? retail : list;
      // 같은 품종·등급·단위끼리 전국 중앙값과 비교
      const groups = {};
      for (const x of use) (groups[[x.se, x.vr, x.gr, x.unit].join("|")] = groups[[x.se, x.vr, x.gr, x.unit].join("|")] || []).push(x);
      for (const g of Object.values(groups)) {
        if (g.length < 3) continue;
        const nat = median(g.map((x) => x.p));
        rows += g.length;
        for (const x of g) { const k = regionOf(x.sgg); if (k) (ratios[k] = ratios[k] || []).push(x.p / nat); }
      }
    }
    const factors = {};
    for (const [g, a] of Object.entries(ratios)) factors[g] = Math.round(median(a) * 100) / 100;
    const data = { ok: Object.keys(factors).length > 0, date: day, from, factors, rows, op: OP, how: "지역 수산물 소매가 ÷ 전국 중앙값 (품목별 비율의 중앙값)" };
    if (raw) return res.status(200).json({ ...data, 원본_예시: sample, log });
    if (!data.ok) return res.status(502).json({ error: "지역별 가격 자료가 없어요", log });
    cache = { at: Date.now(), data };
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: "지역별 가격 API 연결 실패: " + e.message, log });
  }
};
