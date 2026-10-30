// 해녀바당 공유 게시판 저장소 (Upstash Redis, Vercel Marketplace에서 무료로 연결)
// 연결 안 돼 있으면 501을 돌려주고, 웹앱은 각 기기에만 저장하는 방식으로 동작함
const KEY = "haenyeobadang:board";
function cfg() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}
async function redis(c, cmd) {
  const r = await fetch(c.url, { method: "POST", headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || "Redis " + r.status);
  return j.result;
}
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const c = cfg();
  if (!c) return res.status(501).json({ error: "공유 저장소가 연결되지 않았어요." });
  try {
    if (req.method === "GET") {
      const v = await redis(c, ["GET", KEY]);
      return res.status(200).json({ data: v ? JSON.parse(v) : null });
    }
    if (req.method === "PUT") {
      const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
      const d = JSON.parse(body);
      if (!d || !Array.isArray(d.posts)) return res.status(400).json({ error: "게시판 형식이 아니에요." });
      if (body.length > 900000) return res.status(413).json({ error: "사진이 너무 많아요. 오래된 글을 내려 주세요." });
      await redis(c, ["SET", KEY, body]);
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ error: "GET, PUT만 가능" });
  } catch (e) {
    res.status(502).json({ error: "저장소 오류: " + e.message });
  }
};
