// 해녀바당: 해산물 사진을 Gemini로 판별 (품목, 세부 품종, 개수, 무게, 등급, 신선도) + 홍보 글 초안
const SPECIES = {
  abalone: "전복", obunjagi: "오분자기", turban: "소라", octopus: "문어", seacucumber: "해삼",
  urchinroe: "성게알", urchin: "성게(통)", seaweed: "미역", hijiki: "톳", agar: "우뭇가사리",
  bomal: "보말(고둥류)", mussel: "홍합(섭)", oyster: "굴", seasquirt: "멍게", sealhare: "군소",
  barnacle: "거북손", gulfweed: "모자반", ecklonia: "감태",
  other: "기타(위 목록에 없는 해산물)",
};
// 세부 품종과 구분하는 특징 (AI가 근거를 들어 고르게 함)
const VARIETY_GUIDE = `
- 전복: 참전복(껍데기 녹갈색, 호흡구멍 4~5개 돌출, 가장 흔함) / 까막전복(껍데기·살이 검고 두꺼움, 크게 자람) / 말전복(크고 납작, 껍데기 주름 굵음) / 시볼트전복(껍데기 둥글고 크며 붉은 기)
- 오분자기: 전복보다 작고(10cm 이하) 호흡구멍이 7~8개, 구멍이 거의 평평함 — 작은 전복과 헷갈리지 말 것
- 소라: 뿔소라(껍데기에 뿔 같은 가시가 줄지어 남, 제주산 대부분) / 민소라(가시가 없거나 거의 없음)
- 문어: 돌문어(참문어, 몸 작고 다리 짧은 편) / 대문어(피문어, 크고 붉은 갈색) / 왜문어(작고 다리 가늘며 몸이 작음)
- 해삼: 홍해삼(붉은·주황빛, 가장 비쌈) / 청해삼(청록·푸른 회색) / 흑해삼(검은빛)
- 성게(통): 보라성게(가시 길고 검보라) / 말똥성게(가시 짧고 촘촘, 녹갈색) / 둥근성게
- 성게알: 보라성게알(노랑~주황, 알이 큼) / 말똥성게알(진한 주황)
- 미역: 돌미역(자연산, 잎이 두껍고 줄기 굵음) / 양식 미역(잎이 넓고 얇음)
- 보말: 밤고둥(검고 둥근 원뿔) / 팽이고둥(팽이 모양, 줄무늬) / 눈알고둥(뚜껑이 흰 눈알 모양) / 울타리고둥
- 홍합: 참홍합(섭, 껍데기 크고 두꺼움, 수염 굵음) / 진주담치(작고 얇은 양식 홍합)
- 굴: 참굴 / 바위굴(크고 껍데기 두꺼움)
- 멍게: 붉은멍게(돌기 많고 붉음) / 돌멍게(껍데기 단단하고 거침)
- 군소: 군소(갈색에 흰 점) / 검은군소
- 모자반: 참모자반(몸, 몸국 재료) / 괭생이모자반(떠밀려 온 것, 식용 아님)`;

const PROMPT = `너는 제주 해녀가 잡은 해산물을 오래 다뤄 온 수산물 감별사다. 사진을 꼼꼼히 보고 아래 JSON 하나만 답하라.
목록에 없는 해산물(예: 가리비, 키조개, 낙지, 오징어, 갈치, 고등어, 해파리)이면 억지로 비슷한 품목에 넣지 말고 species는 "other", variety에는 그 해산물의 정확한 한국어 이름을 쓴다.
세부 품종은 껍데기 색·무늬·가시·호흡구멍 수·크기 같은 보이는 특징으로 구분하고, 근거를 basis에 쓴다. 특징이 안 보여 확실하지 않으면 variety는 "모름"으로 한다.
${VARIETY_GUIDE}

{"isSeafood": 해산물이 보이면 true,
 "species": 가장 많이 보이는 것의 영어 키. 다음 중 하나 ${Object.entries(SPECIES).map(([k, v]) => `${k}(${v})`).join(", ")},
 "variety": 세부 품종 한국어 이름 (위 목록 중 하나, 목록에 없으면 보이는 대로, 모르면 "모름". species가 "other"이면 그 해산물 이름),
 "basis": 그 품목·품종으로 본 근거를 해녀가 알아듣게 한 문장 (예: "껍데기에 뿔 같은 가시가 줄지어 있어 뿔소라로 봤어요"),
 "others": 함께 보이는 다른 해산물 목록 [{"name": 한국어 이름(세부 품종까지), "count": 개수}] (없으면 []),
 "count": 주 품목의 보이는 개수(정수, 미역·톳처럼 셀 수 없으면 0),
 "estWeightKg": 주 품목 전체 무게 추정(kg, 소수 한 자리),
 "grade": "특" | "상" | "중" (크기와 상태 기준),
 "freshness": "최상" | "좋음" | "보통" (색·윤기·상처 기준),
 "confidence": 0~1 사이 확신도,
 "notes": 해녀 어르신이 읽을 쉬운 한국어 한두 문장 (확인할 점, 깨진 껍데기·상처가 있으면 그것도),
 "promo": 손님에게 알리는 홍보 글. 제주 해녀 어르신의 따뜻한 말투로 2~3문장, 세부 품종 이름과 싱싱함을 살려서. 가격·전화번호·이모지·해시태그는 넣지 말 것}`;

// 모델 하나를 시간 제한을 두고 부름. 생각 단계 설정은 모델마다 받는 형식이 달라서,
// 거부(400)되면 다음 형식으로, 마지막엔 설정 없이 다시 보냄
const THINK = [{ thinkingLevel: "low" }, { thinkingBudget: 0 }, null];
async function call(model, key, body, ms) {
  const until = Date.now() + ms;
  let last = null;
  for (const t of THINK) {
    const left = until - Date.now();
    if (left < 1500) break;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), left);
    try {
      const generationConfig = { temperature: 0.2, responseMimeType: "application/json" };
      if (t) generationConfig.thinkingConfig = t;
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", signal: ctl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ inlineData: { mimeType: body.mime || "image/jpeg", data: body.image } }, { text: PROMPT }] }], generationConfig }),
      });
      const json = await r.json().catch(() => ({}));
      last = { status: r.status, json, model };
      if (r.status === 400 && t) continue;   // 이 생각 설정을 안 받음 → 다음 형식
      return last;
    } catch (e) {
      return { status: 504, json: { error: { message: e.name === "AbortError" ? `${model} 응답이 ${Math.round(ms / 1000)}초 넘게 걸림` : e.message } }, model };
    } finally { clearTimeout(timer); }
  }
  return last || { status: 504, json: { error: { message: `${model} 시간 부족` } }, model };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 가능" });
  const key = process.env.GEMINI_KEY;
  if (!key) return res.status(500).json({ error: "Vercel에 GEMINI_KEY 환경변수가 없어요" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  if (!body.image) return res.status(400).json({ error: "사진이 없어요" });
  try {
    // 세부 품종 구분은 정확도가 중요해서 Flash를 먼저, 안 되면(사용량 초과 등) 가벼운 Flash-Lite
    const tried = [];
    let out = await call("gemini-flash-latest", key, body, 30000);
    if (out.status !== 200) { tried.push(out.json.error?.message || out.status); out = await call("gemini-flash-lite-latest", key, body, 22000); }
    if (out.status !== 200) { tried.push(out.json.error?.message || out.status); return res.status(502).json({ error: "Gemini 오류: " + tried.join(" / ") }); }
    const text = (out.json.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    const ai = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
    res.status(200).json({ ai, model: out.model });
  } catch (e) {
    res.status(502).json({ error: "사진 판별 실패: " + e.message });
  }
};
