// 공공데이터포털(수온, 기상청) 중계. 키는 Vercel 환경변수 DATA_GO_KEY 에 보관
const ALLOWED = ["1192136/surveyWaterTemp/", "1360000/MidFcstInfoService/"];
module.exports = async (req, res) => {
  const { path = "", ...rest } = req.query;
  if (!ALLOWED.some(a => String(path).startsWith(a))) return res.status(400).json({ error: "허용되지 않은 API 경로" });
  const key = process.env.DATA_GO_KEY;
  if (!key) return res.status(500).json({ error: { message: "Vercel에 DATA_GO_KEY 환경변수가 없어요" } });
  const qs = new URLSearchParams(Object.entries(rest).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])).toString();
  try {
    // Encoding 키는 이미 인코딩돼 있으므로 그대로 붙임
    const r = await fetch(`https://apis.data.go.kr/${path}?serviceKey=${key}&${qs}`, { headers: { Accept: "application/json" } });
    const text = await r.text();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", /^\s*[\[{]/.test(text) ? "application/json; charset=utf-8" : "text/plain; charset=utf-8");
    res.status(r.status).send(text);
  } catch (e) {
    res.status(502).json({ error: { message: "외부 API 연결 실패: " + e.message } });
  }
};
