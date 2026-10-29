// 서버(키)가 연결됐는지 웹페이지에 알려줌
module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, datago: !!process.env.DATA_GO_KEY, gemini: !!process.env.GEMINI_KEY });
};
