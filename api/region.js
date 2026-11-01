// 해녀바당: 지역 물가 계수 = 지역별 수산물 소매가 ÷ 전국 평균
// 자료: aT 「지역별 품목별 도·소매 가격정보」(B552845/perRegion). 공공데이터포털에서 이 API도 활용신청해야 함
// 확인용: /api/region?raw=1
const KEY_REGIONS = {
  jeju: ["제주", "서귀포"], busan: ["부산"], ulsan: ["울산"], gyeongbuk: ["포항", "안동", "경주", "경북", "대구"],
  gangwon: ["강릉", "춘천", "원주", "강원", "속초", "삼척"], gyeongnam: ["창원", "진주", "통영", "거제", "경남", "김해"],
  jeonnam: ["순천", "목포", "여수", "전남", "광주"], chungnam: ["천안", "서산", "충남", "대전", "보령"],
};
// 일별 시세에 있는 해녀 품목: 전복·굴·홍합 (2026-11-01 확인). 품목별 지역 계수도 따로 계산
const HAENYEO_CODES = ["653", "644", "658"];
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
  // 진단: 여러 조건 조합을 한 번에 시험 (/api/region?probe=1)
  if (req.query.probe) {
    const base = "https://apis.data.go.kr/B552845/perRegion/price";
    const today = new Date(Date.now() + 9 * 3600e3), ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
    const t = ymd(today), m1 = ymd(new Date(today - 30 * 864e5)), dash = (x) => `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6)}`;
    const tries = {
      "농산물 예시(쌀 100/111, 30일)": { "cond[exmn_ymd::GTE]": m1, "cond[exmn_ymd::LTE]": t, "cond[ctgry_cd::EQ]": "100", "cond[item_cd::EQ]": "111" },
      "수산물 전복 653 (30일)": { "cond[exmn_ymd::GTE]": m1, "cond[exmn_ymd::LTE]": t, "cond[ctgry_cd::EQ]": "600", "cond[item_cd::EQ]": "653" },
      "수산물 고등어 611 (30일)": { "cond[exmn_ymd::GTE]": m1, "cond[exmn_ymd::LTE]": t, "cond[ctgry_cd::EQ]": "600", "cond[item_cd::EQ]": "611" },
      "수산물 부류만 (30일)": { "cond[exmn_ymd::GTE]": m1, "cond[exmn_ymd::LTE]": t, "cond[ctgry_cd::EQ]": "600" },
      "날짜 하이픈 형식 (고등어)": { "cond[exmn_ymd::GTE]": dash(m1), "cond[exmn_ymd::LTE]": dash(t), "cond[ctgry_cd::EQ]": "600", "cond[item_cd::EQ]": "611" },
      "조건 없음": {},
    };
    const fish = { "cond[exmn_ymd::GTE]": m1, "cond[exmn_ymd::LTE]": t, "cond[ctgry_cd::EQ]": "600", "cond[item_cd::EQ]": "611" };
    const jobs = Object.entries(tries).map(([name, prm]) => [name, base, prm]);
    // perRegion의 다른 기능 이름
    for (const op of ["", "/prices", "/list", "/info"]) jobs.push([`perRegion${op || "(기능 없음)"} 고등어`, "https://apis.data.go.kr/B552845/perRegion" + op, fish]);
    // 같은 기관의 일별 도·소매 가격(perDay): 지역 이름(시군구)도 함께 줌
    jobs.push(["perDay/price 고등어 (30일)", "https://apis.data.go.kr/B552845/perDay/price", fish]);
    jobs.push(["perDay/price 쌀 예시 (30일)", "https://apis.data.go.kr/B552845/perDay/price", { "cond[exmn_ymd::GTE]": m1, "cond[exmn_ymd::LTE]": t, "cond[ctgry_cd::EQ]": "100", "cond[item_cd::EQ]": "111" }]);
    const out = {};
    await Promise.all(jobs.map(async ([name, url, prm]) => {
      try { const r = await get(url, key, prm); out[name] = { status: r.status, 건수: r.items.length, 예시: r.items[0] || r.text.slice(0, 200) }; }
      catch (e) { out[name] = { 오류: e.message }; }
    }));
    return res.status(200).json(out);
  }
  if (!raw && cache.data && Date.now() - cache.at < 12 * 3600 * 1000) return res.status(200).json(cache.data);
  const log = [];
  try {
    // 1) 최근 수산물 시세에서 품목 코드와 조사일을 얻음
    const rec = await get("https://apis.data.go.kr/B552845/recent/price", key, { "cond[ctgry_cd::EQ]": "600" });
    const recentCodes = [...new Set(rec.items.map((it) => pick(it, /^item_cd$/i)).filter(Boolean))].slice(0, 10);
    const codes = recentCodes.length ? [...new Set([...recentCodes, ...HAENYEO_CODES])] : [];
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
    // perRegion은 2026-11-01까지 어떤 조건(조건 없음 포함)에도 0건 → 첫 품목으로 한 번만 보고, 비었으면 나머지는 부르지 않음
    const first = await get(base0 + OP, key, params(codes[0]));
    log.push({ 단계: "perRegion 확인", 품목코드: codes[0], status: first.status, 건수: first.items.length });
    let results = first.items.length
      ? [{ c: codes[0], ...first }, ...(await Promise.all(codes.slice(1).map((c) => get(base0 + OP, key, params(c)).then((r) => ({ c, ...r })))))]
      : [{ c: codes[0], ...first }];
    let source = "perRegion";
    // perRegion에 자료가 없으면 같은 기관의 「일별 도·소매 가격정보」(perDay)로: 시군구별 가격을 함께 줌
    if (!results.some((r) => r.items.length)) {
      const alt = await Promise.all(codes.map((c) => get("https://apis.data.go.kr/B552845/perDay/price", key, params(c)).then((r) => ({ c, ...r }))));
      log.push({ 단계: "perDay로 대신 조회", 결과: alt.map((r) => ({ 품목코드: r.c, status: r.status, 건수: r.items.length, 응답: r.items.length ? undefined : r.text.slice(0, 160) })) });
      if (alt.some((r) => r.items.length)) { results = alt; source = "perDay"; }
    }
    const ratios = {}, itemRatios = {}, itemNames = {};
    let sample = null, rows = 0;
    for (const r of results) {
      if (!r.items.length) { if (log.length < 8) log.push({ 품목코드: r.c, status: r.status, 응답: r.text.slice(0, 200) }); continue; }
      sample = sample || r.items.slice(0, 3);
      itemNames[r.c] = pick(r.items[0], /^item_nm$/i);
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
        for (const x of g) {
          const k = regionOf(x.sgg); if (!k) continue;
          (ratios[k] = ratios[k] || []).push(x.p / nat);
          const ir = (itemRatios[r.c] = itemRatios[r.c] || {});
          (ir[k] = ir[k] || []).push(x.p / nat);
        }
      }
    }
    const round2 = (a) => Math.round(median(a) * 100) / 100;
    const factors = {};
    for (const [g, a] of Object.entries(ratios)) factors[g] = round2(a);
    // 해녀 품목은 그 품목만의 지역 계수 (예: 제주 굴 소매가 ÷ 전국 굴 중앙값)
    const byItem = {};
    for (const c of HAENYEO_CODES) {
      if (!itemRatios[c]) continue;
      const f = {};
      for (const [g, a] of Object.entries(itemRatios[c])) f[g] = round2(a);
      byItem[c] = { name: itemNames[c], factors: f };
    }
    const data = { ok: Object.keys(factors).length > 0, source, date: day, from, factors, byItem, rows, op: OP, how: "지역 수산물 소매가 ÷ 전국 중앙값 (품목별 비율의 중앙값)" };
    if (raw) return res.status(200).json({ ...data, 원본_예시: sample, log });
    if (!data.ok) return res.status(502).json({ error: "지역별 가격 자료가 없어요", log });
    cache = { at: Date.now(), data };
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: "지역별 가격 API 연결 실패: " + e.message, log });
  }
};
