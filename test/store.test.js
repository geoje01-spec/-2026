const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'haenyeo-test-'));
const store = require('../lib/store');

test('상품이 올라오면 같은 품목을 가장 먼저 예약한 손님과 매칭된다', () => {
  const first = store.createReservation({ customerName: '첫손님', itemName: '전복' });
  const second = store.createReservation({ customerName: '둘째손님', itemName: '전복' });
  store.createReservation({ customerName: '소라손님', itemName: '소라' });

  const { product, matchedReservation } = store.createProduct({ itemName: '전복', price: 30000 });
  assert.strictEqual(matchedReservation.id, first.id);
  assert.strictEqual(product.status, 'reserved');

  const next = store.createProduct({ itemName: '전복', price: 30000 });
  assert.strictEqual(next.matchedReservation.id, second.id);

  const unmatched = store.createProduct({ itemName: '전복', price: 30000 });
  assert.strictEqual(unmatched.matchedReservation, null);
  assert.strictEqual(unmatched.product.status, 'available');
});

test('판매 중인 상품이 있으면 새 예약이 바로 연결된다', () => {
  store.createProduct({ itemName: '성게', price: 20000 });
  const r = store.createReservation({ customerName: '늦은손님', itemName: '성게' });
  assert.strictEqual(r.status, 'matched');
});

test('매칭된 상품을 지우면 예약은 다시 대기 상태가 된다', () => {
  store.createReservation({ customerName: '문어손님', itemName: '문어' });
  const { product, matchedReservation } = store.createProduct({ itemName: '문어', price: 15000 });
  store.deleteProduct(product.id);
  const r = store.listReservations().find((x) => x.id === matchedReservation.id);
  assert.strictEqual(r.status, 'pending');
});

test('체험 정원을 넘는 예약은 막는다', () => {
  const e = store.createExperience({ title: '물질 체험', date: '2026-11-05', time: '10:00', capacity: 3, pricePerPerson: 50000 });
  assert.ok(store.createBooking(e.id, { customerName: 'A', people: 2 }).booking);
  assert.strictEqual(store.createBooking(e.id, { customerName: 'B', people: 2 }).status, 409);
  assert.ok(store.createBooking(e.id, { customerName: 'C', people: 1 }).booking);
});
