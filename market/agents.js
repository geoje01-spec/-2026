/*
 * 해녀 마켓 에이전트 로직 (서버와 브라우저 데모 모드가 같이 씀)
 * - 가격 에이전트: 시세 + 등급 + 신선도 → 직거래 판매가
 * - 매칭 에이전트: 미리 예약한 손님에게 새로 올라온 해산물을 먼저 잡아줌
 * - 물류 에이전트: 품목·지역·시간에 맞춰 포장/집하/도착 일정을 짬
 */
(function (root) {
  'use strict';

  // 기본 참고가(원/kg). 실제 시세 API가 연결되기 전이나 실패했을 때만 씀. 예시 값임.
  const SPECIES = {
    abalone:     { ko: '전복',     type: 'live',    refPerKg: 38000,  shelfHours: 72 },
    obunjagi:    { ko: '오분자기', type: 'live',    refPerKg: 60000,  shelfHours: 48 },
    turban:      { ko: '소라',     type: 'live',    refPerKg: 12000,  shelfHours: 72 },
    octopus:     { ko: '문어',     type: 'live',    refPerKg: 22000,  shelfHours: 48 },
    seacucumber: { ko: '해삼',     type: 'live',    refPerKg: 26000,  shelfHours: 48 },
    urchinroe:   { ko: '성게알',   type: 'roe',     refPerKg: 150000, shelfHours: 36 },
    urchin:      { ko: '성게(통)', type: 'live',    refPerKg: 20000,  shelfHours: 36 },
    seaweed:     { ko: '미역',     type: 'seaweed', refPerKg: 6000,   shelfHours: 96 },
    hijiki:      { ko: '톳',       type: 'seaweed', refPerKg: 5000,   shelfHours: 96 },
    agar:        { ko: '우뭇가사리', type: 'seaweed', refPerKg: 9000, shelfHours: 120 }
  };

  const GRADES = { '특': 1.2, '상': 1.0, '중': 0.85 };
  const DIRECT_PREMIUM = 1.15;      // 위판장 낙찰가보다 해녀에게 15% 더
  const HOLD_MINUTES = 30;          // 매칭되면 예약 손님에게 30분 우선권
  const DAY = 24 * 3600 * 1000;

  const uid = (p) => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const round100 = (n) => Math.round(n / 100) * 100;
  const iso = (d) => new Date(d).toISOString();

  /* ---------------- 가격 에이전트 ---------------- */
  function price({ species, grade, weightKg, freshness, marketPerKg, source }) {
    const sp = SPECIES[species];
    if (!sp) throw new Error('모르는 품목입니다: ' + species);
    const base = marketPerKg || sp.refPerKg;
    const g = GRADES[grade] || 1;
    const f = freshness === '최상' ? 1.05 : freshness === '보통' ? 0.95 : 1;
    const perKg = round100(base * DIRECT_PREMIUM * g * f);
    const w = Math.max(0.1, Number(weightKg) || 0);
    return {
      marketPerKg: base,
      perKg,
      total: round100(perKg * w),
      source: marketPerKg ? (source || '산지 시세') : '기본 참고가',
      breakdown: [
        { label: marketPerKg ? '오늘 산지 시세' : '기본 참고가', value: base.toLocaleString('ko-KR') + '원/kg' },
        { label: '직거래 가산', value: '×' + DIRECT_PREMIUM },
        { label: '등급 ' + grade, value: '×' + g },
        { label: '신선도 ' + (freshness || '좋음'), value: '×' + f }
      ]
    };
  }

  /* ---------------- 물류 에이전트 ---------------- */
  function nextBusinessDay(d) {
    const x = new Date(d);
    while (x.getDay() === 6 || x.getDay() === 0) x.setTime(x.getTime() + DAY); // 토·일 집하는 월요일로
    return x;
  }
  function at(d, h, m) { const x = new Date(d); x.setHours(h, m || 0, 0, 0); return x; }

  function planShipment({ species, region, now }) {
    const sp = SPECIES[species];
    now = new Date(now || Date.now());
    const box = sp.type === 'roe' ? '0~2℃ 저온 보냉팩 (성게알 전용)'
      : sp.type === 'live' ? '산소 포장 + 아이스팩 스티로폼'
      : '냉장 보냉박스';
    let method, pickupAt, eta, note = '';

    if (region === '현장수령') {
      method = '어촌계 판매장 현장 수령';
      pickupAt = now.getHours() < 16 ? at(now, 16, 0) : at(new Date(now.getTime() + DAY), 10, 0);
      eta = pickupAt;
      note = '체험 프로그램과 같이 오시면 그 자리에서 받아 가실 수 있어요.';
    } else if (region === '제주' || region === '도내') {
      method = '도내 냉장 퀵';
      pickupAt = now.getHours() < 15 ? at(now, 15, 30) : at(new Date(now.getTime() + DAY), 9, 30);
      eta = new Date(pickupAt.getTime() + 3 * 3600 * 1000);
    } else {
      method = '냉장 택배 (익일 도착)';
      let p = now.getHours() < 14 ? at(now, 16, 0) : at(new Date(now.getTime() + DAY), 16, 0);
      // 살아있는 해산물·성게알은 금요일 발송하면 주말에 묶이므로 월요일로 미룸
      if (sp.type !== 'seaweed' && p.getDay() === 5) { p = at(new Date(p.getTime() + 3 * DAY), 16, 0); note = '금요일 발송 시 주말에 택배가 멈춰서 월요일 발송으로 잡았어요.'; }
      pickupAt = nextBusinessDay(p);
      eta = at(new Date(pickupAt.getTime() + DAY), 12, 0);
    }
    if (sp.type === 'roe' && region !== '현장수령' && region !== '제주' && region !== '도내') {
      note = (note ? note + ' ' : '') + '성게알은 36시간 안에 드셔야 해서 도착 당일 섭취를 안내해요.';
    }
    return {
      method, box, note,
      pickupAt: iso(pickupAt), eta: iso(eta),
      stepIndex: 0,
      steps: [
        { label: '포장 준비', at: iso(now) },
        { label: region === '현장수령' ? '수령 대기' : '집하', at: iso(pickupAt) },
        { label: region === '현장수령' ? '수령 완료' : '배송 중', at: iso(pickupAt) },
        { label: '도착', at: iso(eta) }
      ]
    };
  }

  /* ---------------- 매칭 에이전트 ---------------- */
  function expireHolds(state, now) {
    now = now || Date.now();
    for (const r of state.reservations) {
      if (r.status === '매칭됨' && new Date(r.holdUntil).getTime() < now) {
        const l = state.listings.find((x) => x.id === r.matchListingId);
        if (l) { l.heldKg = Math.max(0, +(l.heldKg - r.qtyKg).toFixed(2)); refreshListing(l); }
        r.status = '대기'; r.matchListingId = null; r.holdUntil = null;
        notice(state, 'match', `${r.customer}님 ${SPECIES[r.species].ko} 우선권이 지나서 다시 대기로 돌렸어요.`);
      }
    }
  }

  function availableKg(l) { return +(l.remainingKg - l.heldKg).toFixed(2); }
  function refreshListing(l) {
    if (l.remainingKg <= 0.001) l.status = '판매완료';
    else if (l.heldKg > 0) l.status = '예약 매칭';
    else l.status = '판매중';
  }

  function tryMatch(state, now) {
    now = now || Date.now();
    const made = [];
    const waiting = state.reservations
      .filter((r) => r.status === '대기')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); // 먼저 예약한 손님 먼저
    for (const r of waiting) {
      const cand = state.listings
        .filter((l) => l.species === r.species && l.status !== '판매완료' && availableKg(l) >= r.qtyKg)
        .filter((l) => !r.maxPerKg || l.perKg <= r.maxPerKg)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]; // 가장 신선한 것
      if (!cand) continue;
      cand.heldKg = +(cand.heldKg + r.qtyKg).toFixed(2);
      refreshListing(cand);
      r.status = '매칭됨';
      r.matchListingId = cand.id;
      r.holdUntil = iso(now + HOLD_MINUTES * 60000);
      made.push({ reservation: r, listing: cand });
      notice(state, 'match', `${r.customer}님이 미리 예약한 ${SPECIES[r.species].ko} ${r.qtyKg}kg을 먼저 잡아뒀어요. ${HOLD_MINUTES}분 안에 결제하면 확정돼요.`);
    }
    return made;
  }

  /* ---------------- 상태 변경 동작 ---------------- */
  function notice(state, kind, text) {
    state.notices.unshift({ id: uid('n'), at: iso(Date.now()), kind, text });
    state.notices = state.notices.slice(0, 40);
  }

  function createListing(state, input) {
    const now = Date.now();
    const sp = SPECIES[input.species];
    const p = input.priceInfo || price(input);
    const perKg = input.perKg ? round100(input.perKg) : p.perKg;
    const l = {
      id: uid('l'),
      species: input.species,
      grade: input.grade || '상',
      freshness: input.freshness || '좋음',
      weightKg: +(+input.weightKg).toFixed(2),
      remainingKg: +(+input.weightKg).toFixed(2),
      heldKg: 0,
      perKg,
      priceInfo: p,
      photo: input.photo || null,
      ai: input.ai || null,
      createdAt: iso(now),
      freshUntil: iso(now + sp.shelfHours * 3600 * 1000),
      status: '판매중'
    };
    state.listings.unshift(l);
    notice(state, 'listing', `${sp.ko} ${l.weightKg}kg을 kg당 ${perKg.toLocaleString('ko-KR')}원에 올렸어요.`);
    const matches = tryMatch(state, now);
    return { listing: l, matches };
  }

  function createReservation(state, input) {
    const r = {
      id: uid('r'),
      customer: input.customer || '손님',
      species: input.species,
      qtyKg: +(+input.qtyKg).toFixed(2),
      maxPerKg: input.maxPerKg ? +input.maxPerKg : null,
      region: input.region || '육지',
      createdAt: iso(Date.now()),
      status: '대기', matchListingId: null, holdUntil: null
    };
    state.reservations.unshift(r);
    notice(state, 'reservation', `${r.customer}님이 ${SPECIES[r.species].ko} ${r.qtyKg}kg을 미리 예약했어요.`);
    const matches = tryMatch(state);
    return { reservation: r, matches };
  }

  function makeOrder(state, { listing, qtyKg, customer, region, reservationId }) {
    const o = {
      id: uid('o'),
      listingId: listing.id, reservationId: reservationId || null,
      species: listing.species, qtyKg, customer, region,
      amount: round100(listing.perKg * qtyKg),
      createdAt: iso(Date.now()),
      shipment: planShipment({ species: listing.species, region })
    };
    state.orders.unshift(o);
    notice(state, 'order', `${customer}님 주문 확정: ${SPECIES[listing.species].ko} ${qtyKg}kg, ${o.shipment.method}.`);
    return o;
  }

  function confirmReservation(state, id) {
    const r = state.reservations.find((x) => x.id === id);
    if (!r || r.status !== '매칭됨') throw new Error('결제할 수 있는 매칭이 없어요. 우선권 시간이 지났을 수 있어요.');
    const l = state.listings.find((x) => x.id === r.matchListingId);
    l.heldKg = Math.max(0, +(l.heldKg - r.qtyKg).toFixed(2));
    l.remainingKg = Math.max(0, +(l.remainingKg - r.qtyKg).toFixed(2));
    refreshListing(l);
    r.status = '완료';
    return makeOrder(state, { listing: l, qtyKg: r.qtyKg, customer: r.customer, region: r.region, reservationId: r.id });
  }

  function buyNow(state, { listingId, qtyKg, customer, region }) {
    const l = state.listings.find((x) => x.id === listingId);
    qtyKg = +(+qtyKg).toFixed(2);
    if (!l || availableKg(l) < qtyKg) throw new Error('남은 양이 부족해요. 수량을 줄여 주세요.');
    l.remainingKg = +(l.remainingKg - qtyKg).toFixed(2);
    refreshListing(l);
    return makeOrder(state, { listing: l, qtyKg, customer: customer || '손님', region });
  }

  function advanceShipment(state, orderId) {
    const o = state.orders.find((x) => x.id === orderId);
    if (!o) throw new Error('주문을 찾을 수 없어요.');
    if (o.shipment.stepIndex < o.shipment.steps.length - 1) o.shipment.stepIndex++;
    o.shipment.steps[o.shipment.stepIndex].at = iso(Date.now());
    notice(state, 'ship', `${o.customer}님 ${SPECIES[o.species].ko}: ${o.shipment.steps[o.shipment.stepIndex].label}`);
    return o;
  }

  function createBooking(state, input) {
    const p = state.programs.find((x) => x.id === input.programId);
    if (!p) throw new Error('없는 체험 프로그램이에요.');
    const people = Math.max(1, parseInt(input.people, 10) || 1);
    const taken = state.bookings
      .filter((b) => b.programId === p.id && b.date === input.date && b.time === input.time && b.status !== '취소')
      .reduce((s, b) => s + b.people, 0);
    if (taken + people > p.capacity) throw new Error(`그 시간은 ${p.capacity - taken}자리만 남았어요.`);
    const b = {
      id: uid('b'), programId: p.id, date: input.date, time: input.time,
      people, customer: input.customer || '손님', status: '신청', createdAt: iso(Date.now()),
      amount: p.price * people
    };
    state.bookings.unshift(b);
    notice(state, 'booking', `${b.customer}님 ${p.title} ${b.date} ${b.time} ${people}명 신청.`);
    return b;
  }

  function setBookingStatus(state, id, status) {
    const b = state.bookings.find((x) => x.id === id);
    if (!b) throw new Error('예약을 찾을 수 없어요.');
    b.status = status;
    const p = state.programs.find((x) => x.id === b.programId);
    notice(state, 'booking', `${b.customer}님 ${p ? p.title : '체험'} ${status}.`);
    return b;
  }

  /* ---------------- 처음 데이터 (예시) ---------------- */
  function seed() {
    const now = Date.now();
    const h = (n) => iso(now - n * 3600 * 1000);
    const d = (n) => { const x = new Date(now + n * DAY); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    const state = {
      haenyeo: { id: 'h1', name: '김순덕', village: '하도 어촌계', years: 41, example: true },
      listings: [], reservations: [], orders: [], bookings: [], notices: [],
      programs: [
        { id: 'p1', title: '해녀와 함께하는 물질 체험', desc: '해녀 삼촌에게 테왁 잡는 법과 숨 고르는 법을 배우고 얕은 바다에서 소라를 직접 찾아봐요.', durationMin: 120, price: 70000, capacity: 8, times: ['10:00', '14:00'], season: '5~10월, 물때와 날씨에 따라 취소될 수 있어요' },
        { id: 'p2', title: '불턱 이야기와 해녀 밥상', desc: '물질 뒤 몸을 녹이던 불턱에 둘러앉아 해녀 이야기를 듣고, 그날 잡은 해산물로 차린 밥상을 함께 먹어요.', durationMin: 90, price: 45000, capacity: 12, times: ['12:00', '17:30'], season: '사계절' },
        { id: 'p3', title: '테왁·망사리 만들기', desc: '해녀가 바다에서 쓰는 부표 테왁과 그물망 망사리를 작게 만들어 기념품으로 가져가요.', durationMin: 60, price: 30000, capacity: 10, times: ['11:00', '15:00'], season: '사계절, 비 오는 날 추천' }
      ]
    };
    const l1 = createListing(state, { species: 'abalone', grade: '특', weightKg: 3, freshness: '최상' }).listing;
    l1.createdAt = h(3);
    createListing(state, { species: 'turban', grade: '상', weightKg: 5 });
    state.reservations.push(
      { id: 'r-seed1', customer: '박지은 (서울)', species: 'urchinroe', qtyKg: 0.5, maxPerKg: null, region: '육지', createdAt: h(20), status: '대기', matchListingId: null, holdUntil: null },
      { id: 'r-seed2', customer: '이도윤 (제주시)', species: 'octopus', qtyKg: 2, maxPerKg: 30000, region: '제주', createdAt: h(9), status: '대기', matchListingId: null, holdUntil: null },
      { id: 'r-seed3', customer: '최하린 (부산)', species: 'abalone', qtyKg: 1, maxPerKg: null, region: '육지', createdAt: h(30), status: '대기', matchListingId: null, holdUntil: null }
    );
    tryMatch(state);
    const r3 = state.reservations.find((r) => r.id === 'r-seed3');
    if (r3.status === '매칭됨') confirmReservation(state, r3.id);
    buyNow(state, { listingId: l1.id, qtyKg: 0.5, customer: '정민수 (현장)', region: '현장수령' });
    state.bookings.push(
      { id: 'b-seed1', programId: 'p1', date: d(1), time: '10:00', people: 4, customer: '한가족 4명 (대구)', status: '확정', createdAt: h(40), amount: 280000 },
      { id: 'b-seed2', programId: 'p2', date: d(1), time: '12:00', people: 6, customer: '여행사 단체 (예시)', status: '신청', createdAt: h(5), amount: 270000 },
      { id: 'b-seed3', programId: 'p3', date: d(2), time: '15:00', people: 2, customer: '커플 2명 (서울)', status: '신청', createdAt: h(2), amount: 60000 }
    );
    state.notices = [];
    notice(state, 'info', '예시 데이터로 시작했어요. 사진을 올려서 해산물을 등록해 보세요.');
    return state;
  }

  const api = {
    SPECIES, GRADES, HOLD_MINUTES,
    price, planShipment, tryMatch, expireHolds, availableKg,
    createListing, createReservation, confirmReservation, buyNow,
    advanceShipment, createBooking, setBookingStatus, seed
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Agents = api;
})(typeof window !== 'undefined' ? window : globalThis);
