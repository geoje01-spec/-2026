// Gemini 중계. 키는 Vercel 환경변수 GEMINI_KEY 에 보관
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: { message: "POST만 가능" } });
  const key = process.env.GEMINI_KEY;
  if (!key) return res.status(500).json({ error: { message: "Vercel에 GEMINI_KEY 환경변수가 없어요" } });
  const model = String(req.query.model || "gemini-flash-latest").replace(/[^\w.-]/g, "");
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: typeof req.body === "string" ? req.body : JSON.stringify(req.body),
    });
    const text = await r.text();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(r.status).send(text);
  } catch (e) {
    res.status(502).json({ error: { message: "Gemini 연결 실패: " + e.message } });
  }
};
