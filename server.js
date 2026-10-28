const path = require('node:path');
const express = require('express');
const store = require('./lib/store');
const { ITEMS, getPrice } = require('./lib/price');
const { identifySeafood } = require('./lib/gemini');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(store.UPLOAD_DIR));

// async 핸들러의 오류를 한 곳에서 처리한다.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

class BadRequest extends Error {
  status = 400;
}

const text = (v, name, { required = true, max = 200 } = {}) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new BadRequest(`${name} 항목을 입력해 주세요.`);
  return s.slice(0, max);
};
const number = (v, name, { required = true, min = 0, int = false } = {}) => {
  if ((v === undefined || v === null || v === '') && !required) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || (int && !Number.isInteger(n))) {
    throw new BadRequest(`${name} 항목을 올바르게 입력해 주세요.`);
  }
  return n;
};

const DATA_URL = /^data:(image\/(jpeg|png|webp));base64,(.+)$/;

function parseImage(dataUrl) {
  const m = typeof dataUrl === 'string' && dataUrl.match(DATA_URL);
  if (!m) throw new BadRequest('사진 형식이 올바르지 않아요 (jpeg, png, webp).');
  return { mimeType: m[1], ext: m[2] === 'jpeg' ? 'jpg' : m[2], base64: m[3] };
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    gemini: Boolean(process.env.GEMINI_API_KEY),
    priceApi: Boolean(process.env.DATA_GO_KR_KEY),
  });
});

// ---------- AI 판별 · 시세 ----------

app.post('/api/identify', wrap(async (req, res) => {
  const { mimeType, base64 } = parseImage(req.body.image);
  res.json(await identifySeafood(base64, mimeType));
}));

app.get('/api/items', (req, res) => res.json(ITEMS));

app.get('/api/price', wrap(async (req, res) => {
  res.json(await getPrice(text(req.query.item, '품목')));
}));

// ---------- 해산물 상품 ----------

app.get('/api/products', (req, res) => {
  const { status } = req.query;
  res.json(store.listProducts().filter((p) => !status || p.status === status));
});

app.post('/api/products', wrap(async (req, res) => {
  const b = req.body;
  let photo = null;
  if (b.image) {
    const { ext, base64 } = parseImage(b.image);
    photo = store.savePhoto(Buffer.from(base64, 'base64'), ext);
  }
  const result = store.createProduct({
    itemName: text(b.itemName, '품목', { max: 30 }),
    detail: text(b.detail, '상세 이름', { required: false, max: 50 }),
    count: number(b.count, '개수', { required: false, int: true }),
    weightKg: number(b.weightKg, '무게', { required: false }),
    condition: text(b.condition, '상태', { required: false, max: 10 }),
    price: number(b.price, '가격', { int: true, min: 1 }),
    priceBasis: b.priceBasis ?? null,
    haenyeoName: text(b.haenyeoName, '해녀 이름', { required: false, max: 30 }),
    photo,
  });
  res.status(201).json(result);
}));

app.patch('/api/products/:id', (req, res) => {
  const b = req.body;
  const changes = {};
  if (b.status !== undefined) {
    if (!['available', 'reserved', 'sold'].includes(b.status)) throw new BadRequest('상태 값이 올바르지 않아요.');
    changes.status = b.status;
  }
  if (b.price !== undefined) changes.price = number(b.price, '가격', { int: true, min: 1 });
  const product = store.updateProduct(req.params.id, changes);
  if (!product) return res.status(404).json({ error: '상품을 찾을 수 없어요.' });
  res.json(product);
});

app.delete('/api/products/:id', (req, res) => {
  if (!store.deleteProduct(req.params.id)) return res.status(404).json({ error: '상품을 찾을 수 없어요.' });
  res.status(204).end();
});

// ---------- 손님 예약 (사용자 웹앱용) ----------

app.get('/api/reservations', (req, res) => res.json(store.listReservations()));

app.post('/api/reservations', (req, res) => {
  const b = req.body;
  const reservation = store.createReservation({
    customerName: text(b.customerName, '손님 이름', { max: 30 }),
    contact: text(b.contact, '연락처', { required: false, max: 50 }),
    itemName: text(b.itemName, '품목', { max: 30 }),
    quantity: text(b.quantity, '수량', { required: false, max: 30 }),
    memo: text(b.memo, '메모', { required: false, max: 300 }),
  });
  res.status(201).json(reservation);
});

app.post('/api/reservations/:id/cancel', (req, res) => {
  const r = store.cancelReservation(req.params.id);
  if (!r) return res.status(404).json({ error: '예약을 찾을 수 없어요.' });
  res.json(r);
});

// ---------- 해녀 체험 ----------

app.get('/api/experiences', (req, res) => res.json(store.listExperiences()));

app.post('/api/experiences', (req, res) => {
  const b = req.body;
  const date = text(b.date, '날짜', { max: 10 });
  const time = text(b.time, '시간', { max: 5 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new BadRequest('날짜와 시간을 올바르게 입력해 주세요.');
  }
  const experience = store.createExperience({
    title: text(b.title, '체험 이름', { max: 60 }),
    date,
    time,
    durationMin: number(b.durationMin, '소요 시간', { required: false, int: true, min: 1 }),
    capacity: number(b.capacity, '정원', { int: true, min: 1 }),
    pricePerPerson: number(b.pricePerPerson, '1인 가격', { int: true }),
    location: text(b.location, '장소', { max: 100 }),
    description: text(b.description, '설명', { required: false, max: 1000 }),
    preparation: text(b.preparation, '준비물', { required: false, max: 300 }),
    haenyeoName: text(b.haenyeoName, '해녀 이름', { required: false, max: 30 }),
  });
  res.status(201).json(experience);
});

app.delete('/api/experiences/:id', (req, res) => {
  if (!store.deleteExperience(req.params.id)) return res.status(404).json({ error: '체험을 찾을 수 없어요.' });
  res.status(204).end();
});

app.get('/api/experiences/:id/bookings', (req, res) => res.json(store.listBookings(req.params.id)));

app.post('/api/experiences/:id/bookings', (req, res) => {
  const b = req.body;
  const result = store.createBooking(req.params.id, {
    customerName: text(b.customerName, '손님 이름', { max: 30 }),
    contact: text(b.contact, '연락처', { required: false, max: 50 }),
    people: number(b.people, '인원', { int: true, min: 1 }),
    memo: text(b.memo, '메모', { required: false, max: 300 }),
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(201).json(result.booking);
});

app.use('/api', (req, res) => res.status(404).json({ error: '없는 API예요.' }));

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || '서버 오류가 났어요.' });
});

const PORT = Number(process.env.PORT || 3000);
if (require.main === module) {
  app.listen(PORT, () => console.log(`해녀 앱 실행 중: http://localhost:${PORT}`));
}

module.exports = app;
