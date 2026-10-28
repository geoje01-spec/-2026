// Gemini로 해산물 사진을 판별한다. 앞 모델이 바쁘면(503 등) 다음 모델로 자동 전환한다.
const { ITEMS } = require('./price');

const MODELS = (
  process.env.GEMINI_MODELS ||
  'gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash,gemini-flash-latest,gemini-3.5-flash-lite,gemini-3.1-flash-lite'
)
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
const AUTH_ERRORS = new Set([401, 403]);
const ROUNDS = 2; // 모든 모델이 바쁘면 잠깐 쉬었다가 한 번 더 돌아본다
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_seafood: { type: 'BOOLEAN' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', enum: [...ITEMS, '기타'] },
          name_detail: { type: 'STRING' },
          count: { type: 'INTEGER' },
          estimated_weight_kg: { type: 'NUMBER' },
          condition: { type: 'STRING', enum: ['좋음', '보통', '나쁨'] },
          confidence: { type: 'NUMBER' },
        },
        required: ['name', 'name_detail', 'count', 'estimated_weight_kg', 'condition', 'confidence'],
      },
    },
    note: { type: 'STRING' },
  },
  required: ['is_seafood', 'items', 'note'],
};

const PROMPT = `너는 제주·남해 해녀가 잡은 해산물을 판별하는 도우미야.
사진 속 해산물을 품목별로 나눠서 알려줘.
- name: 다음 중 하나 (${ITEMS.join(', ')}, 기타)
- name_detail: 더 구체적인 이름 (예: 참전복, 보라성게, 돌문어). 모르면 name과 같게.
- count: 보이는 개수 (셀 수 없는 해조류 등은 0)
- estimated_weight_kg: 사진으로 추정한 전체 무게(kg). 크기 기준이 없으면 일반적인 크기로 추정.
- condition: 신선도 (좋음/보통/나쁨)
- confidence: 판별 확신도 0~1
해산물이 아니면 is_seafood=false, items=[]로 답해.
note에는 해녀에게 보여줄 짧은 한국어 안내(확신이 낮은 이유, 확인할 점 등)를 적어.`;

async function identifySeafood(imageBase64, mimeType) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 환경 변수가 없어요.');
  const body = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: imageBase64 } }, { text: PROMPT }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.2 },
  });

  let lastError;
  for (let round = 0; round < ROUNDS; round++) {
    if (round > 0) await sleep(2000);
    for (const model of MODELS) {
      let res;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body,
          signal: AbortSignal.timeout(60000),
        });
      } catch (err) {
        lastError = new Error(`${model}: ${err.message}`);
        continue;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastError = new Error(`${model}: ${data.error?.message || `HTTP ${res.status}`}`);
        // 키 문제는 다른 모델로 바꿔도 해결되지 않으므로 바로 알린다. 그 외(바쁨, 없는 모델 등)는 다음 모델로.
        if (AUTH_ERRORS.has(res.status)) throw lastError;
        continue;
      }
      const text = data.candidates?.[0]?.content?.parts
        ?.filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join('');
      if (!text) {
        lastError = new Error(`${model}: 응답이 비어 있어요.`);
        continue;
      }
      const result = JSON.parse(text);
      for (const item of result.items) {
        item.confidence = Math.min(1, Math.max(0, item.confidence));
      }
      return { model, ...result };
    }
  }
  throw lastError || new Error('사용할 수 있는 Gemini 모델이 없어요.');
}

module.exports = { identifySeafood, MODELS };
