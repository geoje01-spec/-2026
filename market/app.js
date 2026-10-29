(() => {
  'use strict';
  const A = window.Agents;
  const SP = A.SPECIES;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
  const kg = (n) => (+(+n).toFixed(2)) + 'kg';
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const hm = (d) => { d = new Date(d); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const when = (d) => {
    d = new Date(d); const t = new Date(); const diff = Math.round((new Date(d.toDateString()) - new Date(t.toDateString())) / 864e5);
    const day = diff === 0 ? '오늘' : diff === 1 ? '내일' : diff === -1 ? '어제' : `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`;
    return day + ' ' + hm(d);
  };
  const left = (d) => {
    const ms = new Date(d) - Date.now();
    if (ms <= 0) return '지남';
    const m = Math.round(ms / 60000);
    if (m < 60) return m + '분 남음';
    const h = Math.floor(m / 60);
    return h < 48 ? h + '시간 남음' : Math.floor(h / 24) + '일 남음';
  };
  const todayStr = (plus) => { const d = new Date(Date.now() + (plus || 0) * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 안 되는 환경이면 메모리만 씀 */ } }
  };

  /* ---------- 서버 또는 미리보기(브라우저 저장) ---------- */
  let MODE = 'local';
  let CONFIG = { gemini: false, price: false };
  const Local = {
    state: null,
    load() { this.state = store.get('hb-state', null) || A.seed(); },
    save() { store.set('hb-state', this.state); }
  };
  async function localApi(path, body) {
    const s = Local.state;
    A.expireHolds(s);
    let out;
    switch (path) {
      case '/state': return s;
      case '/analyze': {
        if (CONFIG.gemini) {
          try {
            const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(j.error || '사진 판별 서버 오류');
            const ai = j.ai || {};
            if (!SP[ai.species]) ai.species = 'abalone';
            if (!A.GRADES[ai.grade]) ai.grade = '상';
            if (!['최상', '좋음', '보통'].includes(ai.freshness)) ai.freshness = '좋음';
            if (ai.isSeafood === false) ai.notes = '해산물이 잘 안 보여요. 다시 찍거나 아래에서 직접 골라 주세요. ' + (ai.notes || '');
            return { ai, priceInfo: A.price({ species: ai.species, grade: ai.grade, weightKg: ai.estWeightKg || 1, freshness: ai.freshness }) };
          } catch (e) {
            const ai = { demo: true, isSeafood: true, species: 'abalone', count: 0, estWeightKg: 1, grade: '상', freshness: '좋음', confidence: 0,
              notes: '사진 판별에 실패했어요(' + e.message + '). 아래에서 직접 골라 주세요.' };
            return { ai, priceInfo: A.price({ species: ai.species, grade: ai.grade, weightKg: ai.estWeightKg, freshness: ai.freshness }) };
          }
        }
        await new Promise((r) => setTimeout(r, 1400));
        const ai = { demo: true, isSeafood: true, species: 'abalone', count: 12, estWeightKg: 1.5, grade: '상', freshness: '좋음', confidence: 0.5,
          notes: '미리보기라서 실제 판별은 하지 않았어요. 서버에 Gemini 키를 넣으면 사진으로 품목·크기·등급을 잡아요. 아래에서 직접 고쳐 주세요.' };
        return { ai, priceInfo: A.price({ species: ai.species, grade: ai.grade, weightKg: ai.estWeightKg, freshness: ai.freshness }) };
      }
      case '/price': return A.price(body);
      case '/listings': out = A.createListing(s, body); break;
      case '/reservations': out = A.createReservation(s, body); break;
      case '/reservations/confirm': out = A.confirmReservation(s, body.id); break;
      case '/buy': out = A.buyNow(s, body); break;
      case '/orders/advance': out = A.advanceShipment(s, body.id); break;
      case '/bookings': out = A.createBooking(s, body); break;
      case '/bookings/status': out = A.setBookingStatus(s, body.id, body.status); break;
      case '/reset': Local.state = A.seed(); Local.save(); return Local.state;
      default: throw new Error('없는 기능이에요.');
    }
    Local.save();
    return out;
  }
  async function api(path, body) {
    if (MODE === 'local') return localApi(path, body);
    const res = await fetch('/api' + path, body !== undefined
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const j = await res.json().catch(() => ({ error: '서버 응답을 읽지 못했어요.' }));
    if (!res.ok) throw new Error(j.error || '요청이 실패했어요.');
    return j;
  }

  /* ---------- 화면 상태 ---------- */
  let S = null;                     // 서버에서 받은 데이터
  const ui = {
    role: store.get('hb-role', 'h'),
    tab: { h: 'upload', c: 'market' },
    draft: { status: 'idle' },
    lastPost: null,
    me: store.get('hb-name', '여행자(나)'),
    resv: { species: 'urchinroe', qtyKg: 0.5, maxPerKg: '', region: '육지' },
    book: {}
  };

  async function refresh() { S = await api('/state'); render(); }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  async function run(fn) {
    try { await fn(); } catch (e) { toast(e.message); }
  }

  /* ---------- 아이콘 ---------- */
  const I = {
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>',
    truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M2 6h12v10H2zM14 10h4l3 3v3h-7z"/><circle cx="6" cy="18" r="2" fill="var(--surface)"/><circle cx="17" cy="18" r="2" fill="var(--surface)"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.2c2.8.3 5 2.6 5 5.8"/></svg>',
    shop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 9h16l-1.5 11h-13z"/><path d="M8 9a4 4 0 0 1 8 0"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>'
  };
  const waves = '<svg class="waves" viewBox="0 0 400 46" preserveAspectRatio="none"><path d="M0 20 Q25 6 50 20 T100 20 T150 20 T200 20 T250 20 T300 20 T350 20 T400 20 V46 H0z" fill="#fff"/></svg>';

  /* ---------- 공용 조각 ---------- */
  const thumb = (l) => l.photo ? `<img class="thumb" src="${esc(l.photo)}" alt="">` : `<div class="thumb" aria-hidden="true">${esc(SP[l.species].ko.slice(0, 1))}</div>`;
  const statusPill = (s) => {
    const cls = { '판매중': 'ok', '예약 매칭': 'warn', '판매완료': 'off', '대기': 'info', '매칭됨': 'warn', '완료': 'ok', '신청': 'warn', '확정': 'ok', '취소': 'off' }[s] || 'info';
    return `<span class="pill ${cls}">${esc(s)}</span>`;
  };
  function track(o) {
    const sh = o.shipment;
    return `<div class="track" role="list">${sh.steps.map((st, i) =>
      `<div role="listitem" class="${i < sh.stepIndex ? 'done' : i === sh.stepIndex ? 'now' : ''}"><i></i>${esc(st.label)}<span class="muted num" style="font-weight:400">${i <= sh.stepIndex || i === 1 || i === 3 ? esc(when(st.at)) : ''}</span></div>`).join('')}</div>`;
  }
  function feed(n) {
    if (!S.notices.length) return '<div class="empty">아직 알림이 없어요.</div>';
    return `<ul class="feed">${S.notices.slice(0, n).map((x) => `<li><time class="num">${esc(hm(x.at))}</time><span>${esc(x.text)}</span></li>`).join('')}</ul>`;
  }
  const waitingFor = (species) => S.reservations.filter((r) => r.species === species && r.status === '대기');

  /* ---------- 해녀: 올리기 ---------- */
  function hUpload() {
    const d = ui.draft;
    let html = '';
    if (ui.lastPost) {
      const lp = ui.lastPost;
      html += `<section class="card ${lp.matches.length ? 'match' : ''}">
        <div class="eyebrow">방금 올렸어요</div>
        <h2>${esc(SP[lp.listing.species].ko)} ${kg(lp.listing.weightKg)} · kg당 ${won(lp.listing.perKg)}</h2>
        ${lp.matches.length
          ? `<div class="banner">미리 예약한 손님 ${lp.matches.length}명에게 먼저 연결했어요. ${lp.matches.map((m) => esc(m.reservation.customer) + ' ' + kg(m.reservation.qtyKg)).join(', ')}. 손님이 ${A.HOLD_MINUTES}분 안에 결제하면 배송이 잡혀요.</div>`
          : '<p class="muted small" style="margin:0">기다리는 예약 손님이 없어서 마켓에 바로 올렸어요.</p>'}
        <button class="btn sm" data-act="dismiss-post">확인</button>
      </section>`;
    }
    if (d.status === 'idle') {
      html += `<div class="stack"><div class="eyebrow">${esc(S.haenyeo.village)} · ${esc(S.haenyeo.name)} 해녀</div>
        <h1>오늘 잡은 해산물을<br>찍어 주세요</h1>
        <p class="muted" style="margin:0">사진 한 장이면 AI가 품목과 무게를 보고, 오늘 시세로 값을 매겨서 올려 드려요.</p></div>
        <label class="shoot" for="cam">
          <input id="cam" type="file" accept="image/*" capture="environment" aria-label="해산물 사진 찍기">
          <span class="ring">${I.camera.replace('<svg', '<svg width="38" height="38" style="color:#fff"')}</span>
          <strong>사진 찍기</strong>
          <span class="small" style="opacity:.8">망사리째 찍어도 돼요</span>
          ${waves}
        </label>`;
    } else {
      html += `<img class="photo" src="${esc(d.photo)}" alt="방금 찍은 해산물 사진">`;
      if (d.status === 'analyzing') {
        html += `<div class="card"><div class="loading"><span class="spin" aria-hidden="true"></span>AI가 품목과 크기를 보고 있어요</div></div>`;
      } else if (d.status === 'error') {
        html += `<div class="card"><div class="banner">${esc(d.error)}</div><button class="btn big" data-act="retake">다시 찍기</button></div>`;
      } else {
        const p = d.priceInfo;
        const perKg = d.perKg;
        const total = Math.round(perKg * d.weightKg / 100) * 100;
        const wait = waitingFor(d.species);
        html += `
        <section class="card">
          <div class="row between"><div class="eyebrow">AI가 본 결과</div>${d.ai.demo ? '<span class="pill info">데모</span>' : `<span class="pill ${d.ai.confidence >= .7 ? 'ok' : 'warn'}">확신 ${Math.round((d.ai.confidence || 0) * 100)}%</span>`}</div>
          ${d.ai.isSeafood === false ? '<div class="banner">해산물이 잘 안 보여요. 가까이서 다시 찍어 주세요.</div>' : ''}
          <p style="margin:0">${esc(d.ai.notes || '')}</p>
          <h3>품목</h3>
          <div class="chips">${Object.entries(SP).map(([k, v]) => `<button type="button" class="chip" data-act="d-species" data-v="${k}" aria-pressed="${k === d.species}">${esc(v.ko)}</button>`).join('')}</div>
          <h3>등급</h3>
          <div class="chips">${Object.keys(A.GRADES).map((g) => `<button type="button" class="chip" data-act="d-grade" data-v="${g}" aria-pressed="${g === d.grade}">${g}</button>`).join('')}</div>
          <h3>무게 <span class="muted small" style="font-weight:400">저울에 단 값으로 맞춰 주세요</span></h3>
          <div class="stepper"><button type="button" data-act="d-w" data-v="-0.1" aria-label="0.1kg 빼기">−</button><output class="num" id="wout">${d.weightKg.toFixed(1)}kg</output><button type="button" data-act="d-w" data-v="0.1" aria-label="0.1kg 더하기">+</button></div>
          <h3>신선도</h3>
          <div class="chips">${['최상', '좋음', '보통'].map((f) => `<button type="button" class="chip" data-act="d-fresh" data-v="${f}" aria-pressed="${f === d.freshness}">${f}</button>`).join('')}</div>
        </section>
        <section class="card">
          <div class="eyebrow">AI가 매긴 값</div>
          <div class="price num">${won(perKg).replace('원', '')}<small>원 / kg</small></div>
          <div class="row"><button class="btn sm" data-act="d-adj" data-v="-1000">1,000원 내리기</button><button class="btn sm" data-act="d-adj" data-v="1000">1,000원 올리기</button></div>
          <div class="breakdown">${p.breakdown.map((b) => `<span>${esc(b.label)}</span><span>${esc(b.value)}</span>`).join('')}${perKg !== p.perKg ? `<span>해녀님이 고친 값</span><span>${won(perKg)}</span>` : ''}</div>
          <p class="muted small" style="margin:0">${p.source === '기본 참고가' ? '시세 API가 연결되지 않아 기본 참고가로 계산했어요.' : esc(p.source) + ' 기준이에요.'} 위판장 낙찰가보다 15% 높게 잡아 해녀님 몫을 늘렸어요.</p>
          <hr>
          <div class="row between"><span>모두 ${kg(d.weightKg)}</span><strong class="num" style="font-size:1.3em">${won(total)}</strong></div>
          ${wait.length ? `<div class="banner">이 해산물을 기다리는 손님이 ${wait.length}명 있어요 (모두 ${kg(wait.reduce((s, r) => s + r.qtyKg, 0))}). 올리면 먼저 예약한 순서대로 연결해 드려요.</div>` : ''}
          <button class="btn primary big" data-act="publish">이 값으로 올리기</button>
          <button class="btn" data-act="retake">다시 찍기</button>
        </section>`;
      }
    }
    html += `<section class="card"><div class="row between"><h2>오늘 알림</h2><button class="btn sm" data-act="reset">예시 데이터로 되돌리기</button></div>${feed(8)}</section>`;
    return html;
  }

  /* ---------- 해녀: 판매 ---------- */
  function hSales() {
    const today = new Date().toDateString();
    const sold = S.orders.filter((o) => new Date(o.createdAt).toDateString() === today).reduce((s, o) => s + o.amount, 0);
    const waiting = S.reservations.filter((r) => r.status === '대기');
    const groups = {};
    for (const r of waiting) (groups[r.species] = groups[r.species] || []).push(r);
    return `
      <h1>판매 현황</h1>
      <div class="card"><div class="row between"><span class="muted">오늘 판 금액</span><strong class="price num" style="font-size:34px">${won(sold)}</strong></div></div>
      <section class="stack">
        <h2>손님들이 기다리는 해산물</h2>
        <p class="muted small" style="margin:0">물질 나가기 전에 보세요. 이 품목을 올리면 바로 연결돼요.</p>
        ${Object.keys(groups).length ? Object.entries(groups).map(([sp, rs]) => `
          <div class="card"><div class="item"><div class="thumb" aria-hidden="true">${esc(SP[sp].ko.slice(0, 1))}</div><div class="body">
            <div class="row between"><h3>${esc(SP[sp].ko)}</h3><strong class="num">${kg(rs.reduce((s, r) => s + r.qtyKg, 0))}</strong></div>
            <div class="kv"><span>예약 <b>${rs.length}명</b></span><span>가장 먼저 <b>${esc(when(rs.map((r) => r.createdAt).sort()[0]))}</b></span>${rs.some((r) => r.maxPerKg) ? `<span>희망가 <b>${won(Math.min(...rs.filter((r) => r.maxPerKg).map((r) => r.maxPerKg)))}/kg 이하</b> 있음</span>` : ''}</div>
          </div></div></div>`).join('') : '<div class="empty">지금 기다리는 예약이 없어요.</div>'}
      </section>
      <section class="stack">
        <h2>올린 해산물</h2>
        ${S.listings.length ? S.listings.map((l) => `
          <div class="card"><div class="item">${thumb(l)}<div class="body">
            <div class="row between"><h3>${esc(SP[l.species].ko)} · ${esc(l.grade)}</h3>${statusPill(l.status)}</div>
            <div class="kv"><span>kg당 <b>${won(l.perKg)}</b></span><span>남음 <b>${kg(l.remainingKg)}</b> / ${kg(l.weightKg)}</span>${l.heldKg ? `<span>예약 잡힘 <b>${kg(l.heldKg)}</b></span>` : ''}</div>
            <div class="kv"><span>올린 시각 ${esc(when(l.createdAt))}</span>${l.status !== '판매완료' ? `<span>신선 기한 <b data-until="${esc(l.freshUntil)}">${esc(left(l.freshUntil))}</b></span>` : ''}</div>
          </div></div></div>`).join('') : '<div class="empty">아직 올린 해산물이 없어요.</div>'}
      </section>`;
  }

  /* ---------- 해녀: 배송 ---------- */
  function hShip() {
    const open = S.orders.filter((o) => o.shipment.stepIndex < o.shipment.steps.length - 1);
    const done = S.orders.filter((o) => o.shipment.stepIndex >= o.shipment.steps.length - 1);
    const card = (o, mine) => {
      const sh = o.shipment;
      const next = sh.steps[sh.stepIndex + 1];
      return `<div class="card">
        <div class="row between"><h3>${esc(o.customer)}</h3><strong class="num">${won(o.amount)}</strong></div>
        <div class="kv"><span>${esc(SP[o.species].ko)} <b>${kg(o.qtyKg)}</b></span><span>${esc(sh.method)}</span>${o.reservationId ? '<span class="pill warn">미리 예약</span>' : ''}</div>
        ${track(o)}
        <div class="kv"><span>포장 <b>${esc(sh.box)}</b></span><span>${o.region === '현장수령' ? '수령' : '집하'} <b>${esc(when(sh.pickupAt))}</b></span></div>
        ${sh.note ? `<p class="muted small" style="margin:0">${esc(sh.note)}</p>` : ''}
        ${mine && next ? `<button class="btn primary" data-act="advance" data-id="${esc(o.id)}">${esc(sh.steps[sh.stepIndex].label)} 끝, 다음은 ${esc(next.label)}</button>` : ''}
      </div>`;
    };
    return `<h1>배송</h1>
      <p class="muted" style="margin:0">AI가 품목과 손님 지역을 보고 포장 방법과 집하 시간을 잡아 뒀어요. 한 단계 끝날 때마다 눌러 주세요.</p>
      <section class="stack"><h2>보낼 것 ${open.length}건</h2>${open.length ? open.map((o) => card(o, true)).join('') : '<div class="empty">보낼 주문이 없어요.</div>'}</section>
      ${done.length ? `<section class="stack"><h2>끝난 배송</h2>${done.map((o) => card(o, false)).join('')}</section>` : ''}`;
  }

  /* ---------- 해녀: 체험 ---------- */
  function hExp() {
    const up = S.bookings.filter((b) => b.date >= todayStr()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const prog = (id) => S.programs.find((p) => p.id === id) || { title: '체험' };
    return `<h1>체험 손님</h1>
      <section class="stack">${up.length ? up.map((b) => `
        <div class="card">
          <div class="row between"><h3>${esc(prog(b.programId).title)}</h3>${statusPill(b.status)}</div>
          <div class="kv"><span><b>${esc(when(b.date + 'T' + b.time))}</b></span><span>${esc(b.customer)}</span><span><b>${b.people}명</b></span><span>${won(b.amount)}</span></div>
          ${b.status === '신청' ? `<div class="row"><button class="btn primary sm" data-act="bk" data-id="${esc(b.id)}" data-v="확정">받기</button><button class="btn sm" data-act="bk" data-id="${esc(b.id)}" data-v="취소">못 받아요</button></div>` : ''}
        </div>`).join('') : '<div class="empty">다가오는 체험 예약이 없어요.</div>'}</section>
      <section class="stack"><h2>내 체험 프로그램</h2>${S.programs.map((p) => `
        <div class="card"><h3>${esc(p.title)}</h3><div class="kv"><span>${p.durationMin}분</span><span>1인 <b>${won(p.price)}</b></span><span>한 번에 <b>${p.capacity}명</b>까지</span><span>${esc(p.times.join(' · '))}</span></div><p class="muted small" style="margin:0">${esc(p.season)}</p></div>`).join('')}</section>`;
  }

  /* ---------- 손님: 마켓 ---------- */
  const regionSel = (id, v) => `<select id="${id}">${[['육지', '육지 택배'], ['제주', '제주 도내 퀵'], ['현장수령', '어촌계 현장 수령']].map(([k, t]) => `<option value="${k}"${k === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  const meField = () => `<label class="field">주문하는 분 이름<input type="text" id="me" value="${esc(ui.me)}" autocomplete="name"></label>`;

  function cMarket() {
    const live = S.listings.filter((l) => l.status !== '판매완료' && A.availableKg(l) > 0);
    return `<div class="stack"><div class="eyebrow">${esc(S.haenyeo.village)}</div><h1>오늘 바다에서<br>올라온 해산물</h1>
      <p class="muted" style="margin:0">해녀가 직접 잡아 바로 올린 것만 있어요. 찾는 게 없으면 미리 예약해 두세요. 올라오는 즉시 먼저 연결해 드려요.</p></div>
      ${meField()}
      ${live.length ? live.map((l) => {
        const av = A.availableKg(l);
        const opts = []; for (let q = 0.5; q <= av + 1e-9; q += 0.5) opts.push(q);
        if (!opts.length) opts.push(av);
        return `<div class="card">
          ${l.photo ? `<img class="photo" src="${esc(l.photo)}" alt="${esc(SP[l.species].ko)} 사진">` : ''}
          <div class="row between"><h2>${esc(SP[l.species].ko)} <span class="muted small">${esc(l.grade)}등급 · 신선도 ${esc(l.freshness)}</span></h2></div>
          <div class="kv"><span>${esc(S.haenyeo.name)} 해녀</span><span>${esc(when(l.createdAt))} 물질</span><span>남은 양 <b>${kg(av)}</b></span><span>신선 기한 <b data-until="${esc(l.freshUntil)}">${esc(left(l.freshUntil))}</b></span></div>
          <div class="price num" style="font-size:34px">${won(l.perKg).replace('원', '')}<small>원 / kg</small></div>
          <div class="grid2">
            <label class="field">수량<select id="q-${esc(l.id)}">${opts.map((q) => `<option value="${q}">${kg(q)} · ${won(Math.round(l.perKg * q / 100) * 100)}</option>`).join('')}</select></label>
            <label class="field">받는 방법${regionSel('g-' + l.id, '육지')}</label>
          </div>
          <button class="btn primary" data-act="buy" data-id="${esc(l.id)}">사기</button>
        </div>`;
      }).join('') : '<div class="empty">지금은 올라온 해산물이 없어요. 미리 예약 탭에서 원하는 해산물을 예약해 두세요.</div>'}`;
  }

  /* ---------- 손님: 미리 예약 ---------- */
  function cReserve() {
    const r = ui.resv;
    const mine = S.reservations.filter((x) => x.customer === ui.me);
    return `<h1>미리 예약</h1>
      <p class="muted" style="margin:0">원하는 해산물을 적어 두면, 해녀가 그 해산물을 올리는 순간 먼저 예약한 순서대로 연결해 드려요. 연결되면 ${A.HOLD_MINUTES}분 동안 손님 몫으로 잡아 둬요.</p>
      <section class="card">
        ${meField()}
        <h3>해산물</h3>
        <div class="chips">${Object.entries(SP).map(([k, v]) => `<button type="button" class="chip" data-act="r-species" data-v="${k}" aria-pressed="${k === r.species}">${esc(v.ko)}</button>`).join('')}</div>
        <div class="grid2">
          <label class="field">수량(kg)<input type="number" id="r-qty" min="0.1" step="0.1" value="${esc(r.qtyKg)}"></label>
          <label class="field">kg당 최대 가격 (선택)<input type="number" id="r-max" min="0" step="1000" placeholder="상관없음" value="${esc(r.maxPerKg)}"></label>
        </div>
        <label class="field">받는 방법${regionSel('r-region', r.region)}</label>
        <p class="muted small" style="margin:0">오늘 시세로 보면 ${esc(SP[r.species].ko)}은 kg당 약 ${won(A.price({ species: r.species, grade: '상', weightKg: 1 }).perKg)}이에요.</p>
        <button class="btn primary big" data-act="reserve">예약하기</button>
      </section>
      <section class="stack"><h2>내 예약</h2>${mine.length ? mine.map((x) => {
        const l = S.listings.find((y) => y.id === x.matchListingId);
        return `<div class="card ${x.status === '매칭됨' ? 'match' : ''}">
          <div class="row between"><h3>${esc(SP[x.species].ko)} ${kg(x.qtyKg)}</h3>${statusPill(x.status)}</div>
          <div class="kv"><span>${esc(when(x.createdAt))} 예약</span><span>${esc(x.region)}</span>${x.maxPerKg ? `<span>kg당 ${won(x.maxPerKg)} 이하</span>` : ''}</div>
          ${x.status === '매칭됨' && l ? `<div class="banner">해녀가 방금 올렸어요. kg당 ${won(l.perKg)}, 모두 ${won(Math.round(l.perKg * x.qtyKg / 100) * 100)}. 우선권 <span data-until="${esc(x.holdUntil)}">${esc(left(x.holdUntil))}</span></div>
            <button class="btn primary" data-act="confirm" data-id="${esc(x.id)}">결제하고 확정</button>` : ''}
          ${x.status === '대기' ? '<p class="muted small" style="margin:0">해녀가 올리면 바로 알려 드려요.</p>' : ''}
        </div>`;
      }).join('') : '<div class="empty">아직 예약한 해산물이 없어요.</div>'}</section>`;
  }

  /* ---------- 손님: 체험 ---------- */
  function cExp() {
    const mine = S.bookings.filter((b) => b.customer === ui.me);
    return `<h1>해녀 문화 체험</h1>
      <p class="muted" style="margin:0">해녀 삼촌들이 직접 진행해요. 물때와 바다 날씨에 따라 해녀가 확정해 드려요.</p>
      ${meField()}
      ${S.programs.map((p) => {
        const f = ui.book[p.id] || (ui.book[p.id] = { date: todayStr(1), time: p.times[0], people: 2 });
        const taken = S.bookings.filter((b) => b.programId === p.id && b.date === f.date && b.time === f.time && b.status !== '취소').reduce((s, b) => s + b.people, 0);
        const remain = p.capacity - taken;
        return `<div class="card">
          <h2>${esc(p.title)}</h2>
          <p style="margin:0">${esc(p.desc)}</p>
          <div class="kv"><span>${p.durationMin}분</span><span>1인 <b>${won(p.price)}</b></span><span>${esc(p.season)}</span></div>
          <div class="grid2">
            <label class="field">날짜<input type="date" id="bd-${p.id}" data-pid="${p.id}" min="${todayStr()}" value="${esc(f.date)}"></label>
            <label class="field">인원<input type="number" id="bp-${p.id}" data-pid="${p.id}" min="1" max="${p.capacity}" value="${f.people}"></label>
          </div>
          <div class="chips">${p.times.map((t) => `<button type="button" class="chip" data-act="b-time" data-pid="${p.id}" data-v="${t}" aria-pressed="${t === f.time}">${t}</button>`).join('')}</div>
          <div class="row between"><span class="muted small">이 시간 남은 자리 <b class="num">${Math.max(0, remain)}</b> / ${p.capacity}</span><strong class="num">${won(p.price * f.people)}</strong></div>
          <button class="btn primary" data-act="book" data-pid="${p.id}" ${remain < f.people ? 'disabled' : ''}>체험 신청</button>
        </div>`;
      }).join('')}
      <section class="stack"><h2>내 체험 신청</h2>${mine.length ? mine.map((b) => `<div class="card"><div class="row between"><h3>${esc((S.programs.find((p) => p.id === b.programId) || {}).title)}</h3>${statusPill(b.status)}</div><div class="kv"><span><b>${esc(when(b.date + 'T' + b.time))}</b></span><span>${b.people}명</span><span>${won(b.amount)}</span></div></div>`).join('') : '<div class="empty">아직 신청한 체험이 없어요.</div>'}</section>`;
  }

  /* ---------- 손님: 주문 ---------- */
  function cOrders() {
    const mine = S.orders.filter((o) => o.customer === ui.me);
    return `<h1>내 주문</h1>${meField()}
      ${mine.length ? mine.map((o) => `<div class="card">
        <div class="row between"><h3>${esc(SP[o.species].ko)} ${kg(o.qtyKg)}</h3><strong class="num">${won(o.amount)}</strong></div>
        <div class="kv"><span>${esc(o.shipment.method)}</span><span>도착 예정 <b>${esc(when(o.shipment.eta))}</b></span></div>
        ${track(o)}
        ${o.shipment.note ? `<p class="muted small" style="margin:0">${esc(o.shipment.note)}</p>` : ''}
      </div>`).join('') : '<div class="empty">아직 주문이 없어요.</div>'}`;
  }

  /* ---------- 탭과 그리기 ---------- */
  const TABS = {
    h: [
      { id: 'upload', label: '올리기', icon: I.camera, view: hUpload },
      { id: 'sales', label: '판매', icon: I.list, view: hSales, badge: () => S.reservations.filter((r) => r.status === '대기').length },
      { id: 'ship', label: '배송', icon: I.truck, view: hShip, badge: () => S.orders.filter((o) => o.shipment.stepIndex < o.shipment.steps.length - 1).length },
      { id: 'exp', label: '체험', icon: I.people, view: hExp, badge: () => S.bookings.filter((b) => b.status === '신청').length }
    ],
    c: [
      { id: 'market', label: '마켓', icon: I.shop, view: cMarket },
      { id: 'reserve', label: '미리 예약', icon: I.clock, view: cReserve, badge: () => S.reservations.filter((r) => r.customer === ui.me && r.status === '매칭됨').length },
      { id: 'exp', label: '체험', icon: I.people, view: cExp },
      { id: 'orders', label: '주문', icon: I.box, view: cOrders }
    ]
  };

  function render() {
    if (!S) return;
    document.body.classList.toggle('haenyeo', ui.role === 'h');
    $('#role-h').setAttribute('aria-pressed', ui.role === 'h');
    $('#role-c').setAttribute('aria-pressed', ui.role === 'c');
    $('#mode').innerHTML = MODE === 'local'
      ? `<span><i class="dot ${CONFIG.gemini ? 'on' : ''}"></i>사진 판별 ${CONFIG.gemini ? 'Gemini' : '데모'}</span><span><i class="dot"></i>데이터는 이 기기에 저장</span>`
      : `<span><i class="dot ${CONFIG.gemini ? 'on' : ''}"></i>사진 판별 ${CONFIG.gemini ? 'Gemini' : '데모'}</span><span><i class="dot ${CONFIG.price ? 'on' : ''}"></i>시세 ${CONFIG.price ? '공공데이터' : '기본 참고가'}</span>`;
    const tabs = TABS[ui.role];
    const cur = tabs.find((t) => t.id === ui.tab[ui.role]) || tabs[0];
    $('#tabs').innerHTML = tabs.map((t) => {
      const n = t.badge ? t.badge() : 0;
      return `<button type="button" data-act="tab" data-v="${t.id}" ${t.id === cur.id ? 'aria-current="page"' : ''}>${t.icon}${esc(t.label)}${n ? `<span class="badge num">${n}</span>` : ''}</button>`;
    }).join('');
    const y = window.scrollY;
    $('#view').innerHTML = cur.view();
    window.scrollTo(0, y);
  }

  /* ---------- 사진 줄이기 ---------- */
  function shrink(file, max, q) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', q));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('사진을 열 수 없어요. 다른 사진으로 해 주세요.')); };
      img.src = url;
    });
  }

  async function onPhoto(file) {
    const d = ui.draft = { status: 'analyzing' };
    try {
      const [big, small] = await Promise.all([shrink(file, 1024, 0.82), shrink(file, 360, 0.7)]);
      d.photo = big; d.thumb = small;
      render();
      const r = await api('/analyze', { image: big.split(',')[1], mime: 'image/jpeg' });
      Object.assign(d, {
        status: 'ready', ai: r.ai, priceInfo: r.priceInfo, perKg: r.priceInfo.perKg,
        species: r.ai.species, grade: r.ai.grade || '상', freshness: r.ai.freshness || '좋음',
        weightKg: Math.max(0.1, Math.round((r.ai.estWeightKg || 1) * 10) / 10)
      });
    } catch (e) {
      d.status = 'error'; d.error = e.message;
      if (!d.photo) d.photo = '';
    }
    render();
  }

  let priceTimer = null;
  function reprice() {
    clearTimeout(priceTimer);
    priceTimer = setTimeout(() => run(async () => {
      const d = ui.draft;
      d.priceInfo = await api('/price', { species: d.species, grade: d.grade, weightKg: d.weightKg, freshness: d.freshness });
      d.perKg = d.priceInfo.perKg;
      render();
    }), 250);
  }

  /* ---------- 이벤트 ---------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act], [data-role]');
    if (!b) return;
    if (b.dataset.role) { ui.role = b.dataset.role; store.set('hb-role', ui.role); window.scrollTo(0, 0); render(); return; }
    const v = b.dataset.v, d = ui.draft;
    switch (b.dataset.act) {
      case 'tab': ui.tab[ui.role] = v; window.scrollTo(0, 0); render(); break;
      case 'retake': ui.draft = { status: 'idle' }; render(); break;
      case 'dismiss-post': ui.lastPost = null; render(); break;
      case 'd-species': d.species = v; render(); reprice(); break;
      case 'd-grade': d.grade = v; render(); reprice(); break;
      case 'd-fresh': d.freshness = v; render(); reprice(); break;
      case 'd-w': d.weightKg = Math.max(0.1, Math.round((d.weightKg + +v) * 10) / 10); render(); reprice(); break;
      case 'd-adj': d.perKg = Math.max(1000, d.perKg + +v); render(); break;
      case 'publish': run(async () => {
        b.disabled = true;
        const r = await api('/listings', { species: d.species, grade: d.grade, freshness: d.freshness, weightKg: d.weightKg, perKg: d.perKg, priceInfo: d.priceInfo, photo: d.thumb, ai: { confidence: d.ai.confidence, notes: d.ai.notes, demo: !!d.ai.demo } });
        ui.lastPost = r; ui.draft = { status: 'idle' };
        await refresh(); window.scrollTo(0, 0);
        toast(r.matches.length ? `올렸어요. 예약 손님 ${r.matches.length}명에게 먼저 연결했어요.` : '마켓에 올렸어요.');
      }); break;
      case 'reset': run(async () => { S = await api('/reset', {}); ui.lastPost = null; render(); toast('예시 데이터로 되돌렸어요.'); }); break;
      case 'advance': run(async () => { await api('/orders/advance', { id: b.dataset.id }); await refresh(); }); break;
      case 'bk': run(async () => { await api('/bookings/status', { id: b.dataset.id, status: v }); await refresh(); toast(v === '확정' ? '체험 예약을 받았어요.' : '체험 예약을 취소했어요.'); }); break;
      case 'buy': run(async () => {
        const id = b.dataset.id;
        await api('/buy', { listingId: id, qtyKg: +$('#q-' + id).value, region: $('#g-' + id).value, customer: ui.me });
        await refresh(); toast('주문했어요. 주문 탭에서 배송을 볼 수 있어요.');
      }); break;
      case 'r-species': ui.resv.species = v; render(); break;
      case 'reserve': run(async () => {
        const r = await api('/reservations', { species: ui.resv.species, qtyKg: +$('#r-qty').value, maxPerKg: $('#r-max').value || null, region: $('#r-region').value, customer: ui.me });
        await refresh();
        toast(r.matches.some((m) => m.reservation.id === r.reservation.id) ? '지금 있는 해산물과 바로 연결됐어요. 결제해 주세요.' : '예약했어요. 해녀가 올리면 먼저 연결해 드려요.');
      }); break;
      case 'confirm': run(async () => { await api('/reservations/confirm', { id: b.dataset.id }); await refresh(); toast('확정됐어요. 주문 탭에서 배송을 볼 수 있어요.'); }); break;
      case 'b-time': ui.book[b.dataset.pid].time = v; render(); break;
      case 'book': run(async () => {
        const f = ui.book[b.dataset.pid];
        await api('/bookings', { programId: b.dataset.pid, date: f.date, time: f.time, people: f.people, customer: ui.me });
        await refresh(); toast('신청했어요. 해녀가 확정하면 알려 드려요.');
      }); break;
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'cam' && t.files && t.files[0]) onPhoto(t.files[0]);
    else if (t.id === 'me') { ui.me = t.value.trim() || '여행자(나)'; store.set('hb-name', ui.me); render(); }
    else if (t.id === 'r-region') ui.resv.region = t.value;
    else if (t.id && t.id.startsWith('bd-')) { ui.book[t.dataset.pid].date = t.value; render(); }
    else if (t.id && t.id.startsWith('bp-')) { ui.book[t.dataset.pid].people = Math.max(1, parseInt(t.value, 10) || 1); render(); }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'r-qty') ui.resv.qtyKg = e.target.value;
    if (e.target.id === 'r-max') ui.resv.maxPerKg = e.target.value;
  });

  // 남은 시간 표시만 주기적으로 갱신 (입력 중인 칸을 지우지 않게)
  setInterval(() => {
    document.querySelectorAll('[data-until]').forEach((el) => { el.textContent = left(el.dataset.until); });
  }, 30000);
  // 서버 모드에서는 다른 기기(손님/해녀)의 변화를 1분마다 받아옴
  setInterval(() => {
    const busy = document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName);
    if (!busy && ui.draft.status !== 'analyzing') run(refresh);
  }, 60000);

  /* ---------- 시작 ---------- */
  (async () => {
    try {
      const res = await fetch('/api/config');
      // Vercel 배포: 데이터는 이 브라우저에 저장하고, 사진 판별만 서버(Gemini)에 맡김
      if (res.ok && (res.headers.get('content-type') || '').includes('json')) { CONFIG = await res.json(); }
    } catch { /* 서버가 없으면 미리보기 모드 */ }
    if (MODE === 'local') Local.load();
    await run(refresh);
  })();
})();
