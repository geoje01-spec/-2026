// 해녀바당: 후기 검사 에이전트. 1차 규칙(욕설·비하·범죄 단정) → 2차 Gemini가 문맥으로 일방적 비방을 봄
// 정당한 불만(맛·양·신선도·응대, 낮은 별점)은 통과시키고, 막을 때는 사실만 남긴 고쳐 쓰기 예를 줌
// 확인용: POST /api/moderate {"text":"...","stars":1,"item":"전복"}
//        또는 브라우저로 /api/moderate?text=후기글&stars=1
const A = require("../market/agents.js");

const PROMPT = (b) => `너는 해녀가 직접 파는 해산물 직거래 게시판의 후기 검사 담당이다. 해녀 어르신을 일방적인 비방과 욕설에서 지키되, 손님의 정당한 불만은 그대로 남겨야 한다.

막을 것(block):
- 욕설, 비속어, 초성 욕(ㅅㅂ 등), 나이·외모·성별·지역을 낮춰 부르는 말
- 근거 없이 범죄자로 단정(사기꾼, 도둑), 협박, "망해라" 같은 저주, 불매·신상 공개 선동
- 해산물·거래와 상관없는 인신공격
- 전화번호·주소 같은 남의 개인정보

통과시킬 것(ok):
- 맛·양·크기·신선도·냄새·가격·연락·냉장고 상태에 대한 불만이나 아쉬움 (별점이 낮아도)
- 사실을 적은 비판 ("죽은 게 두 개 섞여 있었어요", "약속 시간보다 늦게 넣어 주셨어요")
- 칭찬, 요리 후기

품목: ${b.item || "해산물"}, 별점: ${b.stars || "?"}점
후기: """${String(b.text || "").slice(0, 600)}"""

JSON 하나만 답하라:
{"verdict": "ok" | "block",
 "kind": 막으면 "욕설" | "비방" | "개인정보" | "상관없는 말", 통과면 "",
 "reason": 막은 이유를 손님이 알아듣게 한 문장 (통과면 ""),
 "suggestion": 막았으면 불만의 사실은 살리고 욕·비방만 뺀 고쳐 쓴 후기 (손님 말투 유지, 통과면 "")}`;

const THINK = [{ thinkingLevel: "low" }, { thinkingBudget: 0 }, null];
async function ask(model, key, body, ms) {
  const until = Date.now() + ms;
  let last = null;
  for (const t of THINK) {
    const left = until - Date.now();
    if (left < 1500) break;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), left);
    try {
      const generationConfig = { temperature: 0.1, responseMimeType: "application/json" };
      if (t) generationConfig.thinkingConfig = t;
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", signal: ctl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: PROMPT(body) }] }], generationConfig }),
      });
      const json = await r.json().catch(() => ({}));
      last = { status: r.status, json };
      if (r.status === 400 && t) continue;   // 이 생각 설정을 안 받음 → 다음 형식
      return last;
    } catch (e) {
      return { status: 504, json: { error: { message: e.message } } };
    } finally { clearTimeout(timer); }
  }
  return last || { status: 504, json: {} };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const body = req.method === "GET" ? { text: req.query.text, stars: +req.query.stars || null, item: req.query.item }
    : typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const text = String(body.text || "").trim();
  if (!text) return res.status(400).json({ error: "후기 글이 없어요" });
  // 1) 규칙: 분명한 욕설·비방은 AI 없이 바로 막음
  const rule = A.checkReview(text);
  if (!rule.ok) return res.status(200).json({ ok: false, by: "rule", kind: rule.kind, reason: rule.reason, suggestion: "" });
  // 2) AI: 문맥으로 일방적 비방을 봄. AI가 안 되면 규칙만으로 통과
  const key = process.env.GEMINI_KEY;
  if (!key) return res.status(200).json({ ok: true, by: "rule" });
  let out = await ask("gemini-flash-lite-latest", key, body, 12000);
  if (out.status !== 200) out = await ask("gemini-flash-latest", key, body, 12000);
  if (out.status !== 200) return res.status(200).json({ ok: true, by: "rule", note: "AI 검사 실패: " + (out.json.error?.message || out.status) });
  try {
    const t = (out.json.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    const ai = JSON.parse(t.replace(/^```(json)?|```$/g, "").trim());
    if (ai.verdict === "block") return res.status(200).json({ ok: false, by: "ai", kind: ai.kind || "비방", reason: ai.reason || "일방적인 비방으로 보여요.", suggestion: A.maskPhone(ai.suggestion || "") });
    return res.status(200).json({ ok: true, by: "ai" });
  } catch (e) {
    return res.status(200).json({ ok: true, by: "rule", note: "AI 답을 읽지 못함" });
  }
};
