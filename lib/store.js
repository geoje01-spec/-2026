// JSON 파일 하나에 모든 데이터를 저장하는 간단한 저장소.
// 시제품용이며, 실제 서비스에서는 데이터베이스(PostgreSQL, Firebase 등)로 바꾸면 된다.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

const EMPTY = { products: [], reservations: [], experiences: [], bookings: [] };

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let db = load();

function load() {
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } catch {
    return structuredClone(EMPTY);
  }
}

function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

const newId = () => crypto.randomUUID();
const now = () => new Date().toISOString();

// ---------- 해산물 상품 ----------

function listProducts() {
  return [...db.products].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getProduct(id) {
  return db.products.find((p) => p.id === id);
}

// 상품을 등록하고, 같은 품목을 먼저 예약한 손님이 있으면 가장 오래 기다린 손님과 바로 매칭한다.
function createProduct(input) {
  const product = {
    id: newId(),
    itemName: input.itemName,
    detail: input.detail || '',
    count: input.count ?? null,
    weightKg: input.weightKg ?? null,
    condition: input.condition || '',
    price: input.price,
    priceBasis: input.priceBasis || null,
    photo: input.photo || null,
    haenyeoName: input.haenyeoName || '',
    status: 'available', // available | reserved | sold
    reservationId: null,
    createdAt: now(),
  };
  db.products.push(product);
  const reservation = matchProduct(product);
  save();
  return { product, matchedReservation: reservation };
}

function matchProduct(product) {
  const waiting = db.reservations
    .filter((r) => r.status === 'pending' && r.itemName === product.itemName)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const reservation = waiting[0];
  if (!reservation) return null;
  reservation.status = 'matched';
  reservation.productId = product.id;
  reservation.matchedAt = now();
  product.status = 'reserved';
  product.reservationId = reservation.id;
  return reservation;
}

function updateProduct(id, changes) {
  const product = getProduct(id);
  if (!product) return null;
  for (const key of ['price', 'status', 'detail', 'weightKg', 'count']) {
    if (changes[key] !== undefined) product[key] = changes[key];
  }
  if (product.status === 'sold' && product.reservationId) {
    const r = db.reservations.find((x) => x.id === product.reservationId);
    if (r) r.status = 'completed';
  }
  save();
  return product;
}

function deleteProduct(id) {
  const product = getProduct(id);
  if (!product) return false;
  // 매칭된 예약은 다시 대기 상태로 돌려서 다음 상품이 올라오면 다시 매칭되게 한다.
  const r = db.reservations.find((x) => x.id === product.reservationId);
  if (r && r.status === 'matched') {
    r.status = 'pending';
    r.productId = null;
    r.matchedAt = null;
  }
  db.products = db.products.filter((p) => p.id !== id);
  if (product.photo) fs.rm(path.join(UPLOAD_DIR, path.basename(product.photo)), { force: true }, () => {});
  save();
  return true;
}

// ---------- 손님 예약 (사용자 웹앱에서 호출) ----------

function listReservations() {
  return [...db.reservations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// 예약이 들어왔을 때 이미 판매 중인 같은 품목이 있으면 바로 매칭한다.
function createReservation(input) {
  const reservation = {
    id: newId(),
    customerName: input.customerName,
    contact: input.contact || '',
    itemName: input.itemName,
    quantity: input.quantity || '',
    memo: input.memo || '',
    status: 'pending', // pending | matched | completed | cancelled
    productId: null,
    createdAt: now(),
    matchedAt: null,
  };
  db.reservations.push(reservation);
  const product = db.products
    .filter((p) => p.status === 'available' && p.itemName === reservation.itemName)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (product) {
    reservation.status = 'matched';
    reservation.productId = product.id;
    reservation.matchedAt = now();
    product.status = 'reserved';
    product.reservationId = reservation.id;
  }
  save();
  return reservation;
}

function cancelReservation(id) {
  const r = db.reservations.find((x) => x.id === id);
  if (!r) return null;
  const product = r.productId && getProduct(r.productId);
  if (product && product.status === 'reserved') {
    product.status = 'available';
    product.reservationId = null;
    matchProduct(product);
  }
  r.status = 'cancelled';
  save();
  return r;
}

// ---------- 해녀 체험 ----------

function bookedCount(experienceId) {
  return db.bookings
    .filter((b) => b.experienceId === experienceId && b.status !== 'cancelled')
    .reduce((sum, b) => sum + b.people, 0);
}

function withCounts(e) {
  const booked = bookedCount(e.id);
  return { ...e, booked, remaining: Math.max(0, e.capacity - booked) };
}

function listExperiences() {
  return [...db.experiences]
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    .map(withCounts);
}

function createExperience(input) {
  const experience = {
    id: newId(),
    title: input.title,
    date: input.date,
    time: input.time,
    durationMin: input.durationMin ?? null,
    capacity: input.capacity,
    pricePerPerson: input.pricePerPerson,
    location: input.location || '',
    description: input.description || '',
    preparation: input.preparation || '',
    haenyeoName: input.haenyeoName || '',
    createdAt: now(),
  };
  db.experiences.push(experience);
  save();
  return withCounts(experience);
}

function deleteExperience(id) {
  const before = db.experiences.length;
  db.experiences = db.experiences.filter((e) => e.id !== id);
  db.bookings = db.bookings.filter((b) => b.experienceId !== id);
  save();
  return db.experiences.length !== before;
}

function listBookings(experienceId) {
  return db.bookings
    .filter((b) => !experienceId || b.experienceId === experienceId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function createBooking(experienceId, input) {
  const experience = db.experiences.find((e) => e.id === experienceId);
  if (!experience) return { error: '체험을 찾을 수 없어요.', status: 404 };
  const remaining = experience.capacity - bookedCount(experienceId);
  if (input.people > remaining) {
    return { error: `남은 자리가 ${remaining}명뿐이에요.`, status: 409 };
  }
  const booking = {
    id: newId(),
    experienceId,
    customerName: input.customerName,
    contact: input.contact || '',
    people: input.people,
    memo: input.memo || '',
    status: 'confirmed',
    createdAt: now(),
  };
  db.bookings.push(booking);
  save();
  return { booking };
}

function savePhoto(buffer, ext) {
  const name = `${newId()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  return `/uploads/${name}`;
}

module.exports = {
  UPLOAD_DIR,
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  listReservations,
  createReservation,
  cancelReservation,
  listExperiences,
  createExperience,
  deleteExperience,
  listBookings,
  createBooking,
  savePhoto,
};
