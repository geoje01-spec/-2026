// 해녀바당 마켓: 해산물 사진을 Gemini로 판별 (품목, 개수, 무게, 등급, 신선도)
const SPECIES = {
  abalone: "전복", obunjagi: "오분자기", turban: "소라", octopus: "문어", seacucumber: "해삼",
  urchinroe: "성게알", urchin: "성게(통)", seaweed: "미역", hijiki: "톳", agar: "우뭇가사리",
};
const PROMPT = `해녀가 잡은 해산물 사진이다. 사진을 보고 아래 JSON 하나만 답하라.
{"isSeafood": 해산물이 보이면 true,
 "species": 다음 중 하나의 영어 키 ${Object.entries(SPECIES).map(([k, v]) => `${k}(${v})`).join(", ")},
 "count": 보이는 개수(정수, 미역·톳처럼 셀 수 없으면 0),
 "estWeightKg": 전체 무게 추정(kg, 소수 한 자리),
 "grade": "특" | "상" | "중" (크기와 상태 기준),
 "freshness": "최상" | "좋음" | "보통",
 "confidence": 0~1 사이 확신도,
 "notes": 해녀 어르신이 읽을 쉬운 한국어 한두 문장 (무엇으로 보았는지, 확인할 점)}`;

async function call(model, key, body) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: body.mime || "image/jpeg", data: body.image } }, { text: PROMPT }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    }),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 가능" });
  const key = process.env.GEMINI_KEY;
  if (!key) return res.status(500).json({ error: "Vercel에 GEMINI_KEY 환경변수가 없어요" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  if (!body.image) return res.status(400).json({ error: "사진이 없어요" });
  try {
    let out = await call("gemini-flash-lite-latest", key, body);
    if (out.status === 404 || out.status === 400) out = await call("gemini-flash-latest", key, body);
    if (out.status !== 200) return res.status(out.status).json({ error: out.json.error?.message || "Gemini 오류" });
    const text = (out.json.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    const ai = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
    res.status(200).json({ ai });
  } catch (e) {
    res.status(502).json({ error: "사진 판별 실패: " + e.message });
  }
};
