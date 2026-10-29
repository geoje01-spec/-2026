// 해녀바당 마켓: 사진 판별(Gemini)이 켜져 있는지 알려줌
module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ gemini: !!process.env.GEMINI_KEY, price: false });
};
