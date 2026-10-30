// 해녀바당: 사진 판별(Gemini)과 공유 게시판(Upstash)이 켜져 있는지 알려줌
module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const shared = !!((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) && (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN));
  res.status(200).json({ gemini: !!process.env.GEMINI_KEY, shared, price: !!process.env.DATA_GO_KEY });
};
