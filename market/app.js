(() => {
  'use strict';
  const A = window.Agents;
  const SP = A.SPECIES;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
  const kg = (n) => (+(+n).toFixed(1)) + 'kg';
  const ago = (d) => {
    const m = Math.round((Date.now() - new Date(d)) / 60000);
    if (m < 1) return '방금';
    if (m < 60) return m + '분 전';
    const h = Math.round(m / 60);
    return h < 24 ? h + '시간 전' : Math.round(h / 24) + '일 전';
  };
  const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1); return (c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28) ? a : b; };
  const digits = (p) => String(p || '').replace(/[^\d+]/g, '');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 안 되는 환경이면 메모리만 씀 */ } }
  };

  /* ---------- 데이터: 공유 게시판(서버) 또는 이 기기 ---------- */
  let CONFIG = { gemini: false, shared: false };
  let S = null;
  const DEV = store.get('hb-dev', null) || (() => { const id = A.uid('d'); store.set('hb-dev', id); return id; })();

  async function fetchShared() {
    const r = await fetch('/api/board', { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '게시판을 불러오지 못했어요.');
    return j.data;
  }
  async function pushShared() {
    const r = await fetch('/api/board', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '저장하지 못했어요.');
  }
  async function load() {
    if (CONFIG.shared) {
      try {
        const d = await fetchShared();
        if (d && d.v === 2) { S = d; return; }
        S = A.seed(); await pushShared(); return;
      } catch (e) { toast(e.message + ' 이 기기에만 저장할게요.'); CONFIG.shared = false; }
    }
    S = store.get('hb2-state', null) || A.seed();
  }
  function norm(s) {
    s.wants = (s.wants || []).filter((w) => Date.now() - new Date(w.createdAt) < A.WANT_DAYS * 864e5);
    s.wants.forEach((w) => {   // 예전 형식(해산물 하나만 고르던 예약) 맞추기
      if (!Array.isArray(w.species)) w.species = w.species ? [w.species] : [];
      if (!w.text) w.text = w.species.map((k) => SP[k] ? SP[k].ko : k).join(', ') + (w.memo ? ' · ' + w.memo : '');
    });
    return s;
  }
  // 바꾸기 전에 최신 게시판을 받아와서 다른 해녀가 올린 글을 덮어쓰지 않게 함
  async function mutate(fn) {
    if (CONFIG.shared) { const d = await fetchShared(); if (d && d.v === 2) S = d; }
    norm(S);
    const out = fn(S);
    S.posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    S.posts = S.posts.slice(0, A.MAX_POSTS);
    store.set('hb2-state', S);
    if (CONFIG.shared) await pushShared();
    render();
    return out;
  }

  /* ---------- 화면 상태 ---------- */
  const ui = {
    role: store.get('hb2-role', 'c'),
    tab: { h: 'upload', c: 'market' },
    draft: { status: 'idle' },
    lastPost: null,
    filter: 'all',
    me: store.get('hb2-me', null) || Object.assign({}, A.EXAMPLE_ME),
    delArm: null,
    newProg: false,
    rv: Object.assign({ name: '', phone: '', text: '' }, store.get('hb2-guest', null) || {})
  };

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  }
  async function run(fn) { try { await fn(); } catch (e) { toast(e.message); } }
  async function copy(text, done) {
    try { await navigator.clipboard.writeText(text); toast(done); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(done); } catch { toast('복사가 안 돼요. 길게 눌러 복사해 주세요.'); }
      ta.remove();
    }
  }

  /* ---------- 아이콘 ---------- */
  const I = {
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.2c2.8.3 5 2.6 5 5.8"/></svg>',
    shop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 9h16l-1.5 11h-13z"/><path d="M8 9a4 4 0 0 1 8 0"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>'
  };
  const waves = '<svg class="waves" viewBox="0 0 400 46" preserveAspectRatio="none"><path d="M0 20 Q25 6 50 20 T100 20 T150 20 T200 20 T250 20 T300 20 T350 20 T400 20 V46 H0z" fill="#fff"/></svg>';

  /* ---------- 공용 조각 ---------- */
  const isExample = (a) => /예시/.test((a && a.name) || '');
  function contact(a, what) {
    const ph = digits(a.phone);
    return `<div class="contact">
      <div class="row between"><div><b>${esc(a.name)} 해녀</b> <span class="muted small">${esc(a.village)}</span></div>${isExample(a) ? '<span class="pill info">예시 연락처</span>' : ''}</div>
      <div class="phone num">${esc(a.phone)}</div>
      <div class="row">
        <a class="btn primary sm" href="tel:${esc(ph)}">전화 걸기</a>
        <a class="btn sm" href="sms:${esc(ph)}?body=${encodeURIComponent('해녀바당에서 보고 연락드려요. ' + what + ' 아직 있나요?')}">문자 보내기</a>
        <button type="button" class="btn sm" data-act="copy" data-v="${esc(a.phone)}">번호 복사</button>
      </div>
      <div class="kv">${a.place ? `<span>만나는 곳 <b>${esc(a.place)}</b></span>` : ''}${a.hours ? `<span>판매 시간 <b>${esc(a.hours)}</b></span>` : ''}</div>
    </div>`;
  }
  function shareText(p) {
    const sp = SP[p.species], a = p.author;
    return `[해녀바당] ${p.promo}\n\n${A.label(p.species, p.variety)} ${p.grade}등급 ${kg(p.weightKg)}${p.askPerKg ? ` · kg당 ${won(p.askPerKg)}` : ''}\n연락: ${a.name} 해녀 ${a.phone}\n${a.place ? '만나는 곳: ' + a.place : ''}${a.hours ? ` (${a.hours})` : ''}\n${location.origin}/market/`;
  }
  /* ---------- 먼저 보기 예약 ---------- */
  const myWants = () => S.wants.filter((w) => w.ownerId === DEV);
  const isEarly = (p) => p.earlyUntil && new Date(p.earlyUntil) > Date.now();
  const canSeeEarly = (p) => p.ownerId === DEV || myWants().some((w) => w.matchedPostId === p.id);
  const minsLeft = (t) => Math.max(1, Math.ceil((new Date(t) - Date.now()) / 60000));
  function teaser(p) {
    const sp = SP[p.species];
    return `<article class="card teaser">
      <div class="row between"><h2>${esc(A.label(p.species, p.variety))} <span class="muted small">${esc(p.grade)}등급</span></h2><span class="pill warn">예약 손님 먼저 보는 중</span></div>
      <p style="margin:0">${esc(p.author.village)} 해녀가 방금 ${esc(sp.ko)}${josa(sp.ko, '을', '를')} 올렸어요. 미리 예약한 손님이 먼저 보고 있어요.</p>
      <p class="muted small" style="margin:0"><b class="num">${minsLeft(p.earlyUntil)}분</b> 뒤에 모두에게 공개돼요. 다음부터 먼저 보고 싶으면 📅 버튼으로 예약하세요.</p>
    </article>`;
  }

  function postCard(p, owner) {
    const sp = SP[p.species];
    const sold = p.status === 'sold';
    const ownerBtns = `<div class="row">
        <button type="button" class="btn sm" data-act="toggle" data-id="${esc(p.id)}">${sold ? '다시 있어요로 바꾸기' : '다 팔렸어요'}</button>
        <button type="button" class="btn sm" data-act="share" data-id="${esc(p.id)}">홍보 글 복사</button>
        ${ui.delArm === p.id
          ? `<button type="button" class="btn sm danger" data-act="del" data-id="${esc(p.id)}">정말 내리기</button><button type="button" class="btn sm" data-act="del-cancel">취소</button>`
          : `<button type="button" class="btn sm" data-act="del-arm" data-id="${esc(p.id)}">글 내리기</button>`}
      </div>`;
    const early = !owner && isEarly(p) && canSeeEarly(p);
    return `<article class="card ${sold ? 'sold' : ''} ${early ? 'match' : ''}">
      ${early ? `<div class="banner">📅 예약하신 ${esc(sp.ko)}${josa(sp.ko, '이', '가')} 올라왔어요! 다른 손님보다 먼저 보고 있어요. ${minsLeft(p.earlyUntil)}분 뒤 모두에게 공개돼요.</div>` : ''}
      ${owner && isEarly(p) ? `<div class="notice">예약 손님에게 먼저 보여주는 중 · ${minsLeft(p.earlyUntil)}분 뒤 모두에게 공개</div>` : ''}
      ${p.photo ? `<img class="photo" src="${esc(p.photo)}" alt="${esc(sp.ko)} 사진">` : ''}
      <div class="row between"><h2>${esc(A.label(p.species, p.variety))} <span class="muted small">${esc(p.grade)}등급 · 신선도 ${esc(p.freshness)}</span></h2>${sold ? '<span class="pill off">다 팔렸어요</span>' : '<span class="pill ok">있어요</span>'}</div>
      <div class="kv"><span>${esc(ago(p.createdAt))} 올림</span><span>양 <b>${kg(p.weightKg)}</b></span>${p.example ? '<span class="pill info">예시 글</span>' : ''}</div>
      ${p.promo ? `<p class="promo">${esc(p.promo)}</p>` : ''}
      <div class="row between" style="align-items:flex-end">
        ${p.askPerKg ? `<div class="price num" style="font-size:32px">${won(p.askPerKg).replace('원', '')}<small>원 / kg</small></div>` : '<strong>가격은 연락해서 물어보세요</strong>'}
        ${p.refPerKg ? `<span class="muted small">참고 시세 kg당 ${won(p.refPerKg)}${p.refLive ? ' (aT)' : ''}</span>` : ''}
      </div>
      ${owner ? ownerBtns : (sold ? '<p class="muted small" style="margin:0">이번 것은 다 팔렸어요. 다음 물질 때 연락해 보세요.</p>' + contact(p.author, A.label(p.species, p.variety)) : contact(p.author, A.label(p.species, p.variety)))}
    </article>`;
  }

  /* ---------- 해녀: 올리기 ---------- */
  function hUpload() {
    const d = ui.draft;
    let html = '';
    if (ui.lastPost) {
      const p = S.posts.find((x) => x.id === ui.lastPost);
      if (p) html += `<section class="card match">
        <div class="eyebrow">올렸어요</div>
        <h2>${esc(SP[p.species].ko)} 홍보 글이 손님 화면에 올라갔어요</h2>
        ${(() => { const ws = S.wants.filter((w) => w.matchedPostId === p.id); return ws.length ? `<div class="banner">이 해산물을 기다리던 손님 ${ws.length}명이 ${A.EARLY_MIN}분 먼저 보고 있어요.</div>
          <ul class="feed">${ws.map((w) => `<li><time>${esc(ago(w.createdAt))}</time><span><b>${esc(w.name)}</b> “${esc(w.text)}”${w.phone ? `<br><a href="tel:${esc(digits(w.phone))}">${esc(w.phone)}</a> <span class="muted small">먼저 전화해 보세요</span>` : '<br><span class="muted small">전화번호 없음, 손님이 연락해 올 거예요</span>'}</span></li>`).join('')}</ul>` : ''; })()}
        <p class="muted" style="margin:0">카카오톡 단체방이나 밴드에도 붙여 넣으면 더 많은 손님이 봐요. 거래는 손님 연락을 받고 직접 하시면 돼요.</p>
        <div class="row"><button type="button" class="btn primary" data-act="share" data-id="${esc(p.id)}">홍보 글 복사</button><button type="button" class="btn" data-act="dismiss-post">확인</button></div>
      </section>`;
    }
    if (d.status === 'idle') {
      html += `<div class="stack"><div class="eyebrow">${esc(ui.me.village)} · ${esc(ui.me.name)} 해녀</div>
        <h1>오늘 잡은 해산물을<br>찍어서 알리세요</h1>
        <p class="muted" style="margin:0">사진 한 장이면 AI가 품목을 알아보고 홍보 글을 써 드려요. 손님이 보고 해녀님께 직접 전화해요. 수수료는 없어요.</p></div>
        <label class="shoot" for="cam">
          <input id="cam" type="file" accept="image/*" capture="environment" aria-label="해산물 사진 찍기">
          <span class="ring">${I.camera.replace('<svg', '<svg width="38" height="38" style="color:#fff"')}</span>
          <strong>사진 찍기</strong>
          <span class="small" style="opacity:.8">망사리째 찍어도 돼요</span>
          ${waves}
        </label>`;
      const waits = {};
      S.wants.filter((w) => !w.matchedPostId).forEach((w) => { (w.species.length ? w.species : ['etc']).forEach((k) => { (waits[k] = waits[k] || []).push(w); }); });
      html += `<section class="card"><h2>📅 손님이 기다리는 해산물</h2>
        <p class="muted small" style="margin:0">물질 나가기 전에 보세요. 이 해산물을 올리면 예약한 손님이 ${A.EARLY_MIN}분 먼저 봐요.</p>
        ${Object.keys(waits).length ? Object.entries(waits).map(([k, ws]) => `<div class="item"><div class="thumb" aria-hidden="true">${k === 'etc' ? '?' : esc(SP[k].ko.slice(0, 1))}</div><div class="body">
          <div class="row between"><h3>${k === 'etc' ? '그 밖의 요청' : esc(SP[k].ko)}</h3><span class="pill warn">${ws.length}명</span></div>
          <div class="want-list">${ws.map((w) => `<span><b>${esc(w.name)}</b> “${esc(w.text)}”</span>`).join('')}</div></div></div>`).join('') : '<div class="empty">지금 기다리는 손님이 없어요.</div>'}
      </section>`;
      return html;
    }
    html += d.photo ? `<img class="photo" src="${esc(d.photo)}" alt="방금 찍은 해산물 사진">` : '';
    if (d.status === 'analyzing') return html + `<div class="card"><div class="loading"><span class="spin" aria-hidden="true"></span>AI가 품목을 보고 홍보 글을 쓰고 있어요</div></div>`;
    if (d.status === 'error') return html + `<div class="card"><div class="banner">${esc(d.error)}</div><button type="button" class="btn big" data-act="retake">다시 찍기</button></div>`;
    const ref = A.refPrice(d);
    html += `
      <section class="card">
        <div class="row between"><div class="eyebrow">AI가 본 결과</div>${d.ai.demo ? '<span class="pill info">데모</span>' : `<span class="pill ${d.ai.confidence >= .7 ? 'ok' : 'warn'}">확신 ${Math.round((d.ai.confidence || 0) * 100)}%</span>`}</div>
        ${d.ai.notes ? `<p style="margin:0">${esc(d.ai.notes)}</p>` : ''}
        ${d.ai.basis ? `<p class="muted small" style="margin:0">구분 근거: ${esc(d.ai.basis)}</p>` : ''}
        ${Array.isArray(d.ai.others) && d.ai.others.length ? `<p class="muted small" style="margin:0">함께 보여요: ${esc(d.ai.others.map((o) => (o.name || '') + (o.count ? ' ' + o.count + '개' : '')).join(', '))}. 따로 올리려면 다시 찍어 주세요.</p>` : ''}
        <h3>품목</h3>
        <div class="chips">${Object.entries(SP).map(([k, v]) => `<button type="button" class="chip" data-act="d-species" data-v="${k}" aria-pressed="${k === d.species}">${k === 'other' ? '기타 (직접 입력)' : esc(v.ko)}</button>`).join('')}</div>
        ${d.species === 'other' ? `<label class="field" for="other-name">해산물 이름 ${d.ai.variety && d.ai.species === 'other' ? '<span class="muted small" style="font-weight:400">AI가 본 이름, 맞는지 봐 주세요</span>' : ''}<input type="text" id="other-name" value="${esc(d.variety || '')}" placeholder="예: 가리비, 낙지, 오징어"></label>` : ''}
        ${(() => { const list = (A.VARIETIES[d.species] || []).slice(); if (d.variety && !list.includes(d.variety)) list.unshift(d.variety); return list.length ? `<h3>세부 품종 <span class="muted small" style="font-weight:400">${d.ai.variety ? 'AI가 고른 값, 맞는지 봐 주세요' : '아는 경우만 골라 주세요'}</span></h3>
        <div class="chips">${list.map((v) => `<button type="button" class="chip" data-act="d-variety" data-v="${esc(v)}" aria-pressed="${v === d.variety}">${esc(v)}</button>`).join('')}<button type="button" class="chip" data-act="d-variety" data-v="" aria-pressed="${!d.variety}">모름</button></div>` : ''; })()}
        <h3>등급</h3>
        <div class="chips">${Object.keys(A.GRADES).map((g) => `<button type="button" class="chip" data-act="d-grade" data-v="${g}" aria-pressed="${g === d.grade}">${g}</button>`).join('')}</div>
        <h3>양 <span class="muted small" style="font-weight:400">대충 맞춰도 돼요</span></h3>
        <div class="stepper"><button type="button" data-act="d-w" data-v="-0.5" aria-label="0.5kg 빼기">−</button><output class="num">${d.weightKg.toFixed(1)}kg</output><button type="button" data-act="d-w" data-v="0.5" aria-label="0.5kg 더하기">+</button></div>
        <h3>신선도</h3>
        <div class="chips">${['최상', '좋음', '보통'].map((f) => `<button type="button" class="chip" data-act="d-fresh" data-v="${f}" aria-pressed="${f === d.freshness}">${f}</button>`).join('')}</div>
      </section>
      <section class="card">
        <div class="eyebrow">가격 (손님에게 보여줄 값)</div>
        <div class="chips">
          <button type="button" class="chip" data-act="d-ask" data-v="on" aria-pressed="${d.askPerKg != null}">가격 적기</button>
          <button type="button" class="chip" data-act="d-ask" data-v="off" aria-pressed="${d.askPerKg == null}">전화로 정하기</button>
        </div>
        ${d.askPerKg != null ? `
          <div class="price num">${won(d.askPerKg).replace('원', '')}<small>원 / kg</small></div>
          <div class="row"><button type="button" class="btn sm" data-act="d-adj" data-v="-1000">1,000원 내리기</button><button type="button" class="btn sm" data-act="d-adj" data-v="1000">1,000원 올리기</button></div>` : ''}
        <p class="muted small" style="margin:0">${ref ? `추천 값은 kg당 ${won(ref)}이에요. ${esc(A.marketNote(d.species, d.variety))} 값은 손님과 직접 정하셔도 돼요.` : esc(A.marketNote(d.species, d.variety))}</p>
      </section>
      <section class="card">
        <div class="row between"><div class="eyebrow">홍보 글</div><button type="button" class="btn sm" data-act="rewrite" ${d.rewriting ? 'disabled' : ''}>${d.rewriting ? '쓰는 중…' : 'AI가 다시 쓰기'}</button></div>
        <label class="field" for="promo">손님에게 보일 글 (고쳐도 돼요)<textarea id="promo" rows="4">${esc(d.promo)}</textarea></label>
      </section>
      <section class="card">
        <div class="eyebrow">손님이 연락할 곳</div>
        <div class="kv"><span><b>${esc(ui.me.name)}</b> ${esc(ui.me.phone)}</span><span>${esc(ui.me.place)}</span><span>${esc(ui.me.hours)}</span></div>
        ${isExample(ui.me) ? '<div class="banner">지금은 예시 연락처예요. 내 정보에서 진짜 이름과 전화번호로 바꿔 주세요.</div>' : ''}
        <button type="button" class="btn sm" data-act="tab" data-v="me">내 정보 고치기</button>
        <button type="button" class="btn primary big" data-act="publish">홍보 올리기</button>
        <button type="button" class="btn" data-act="retake">다시 찍기</button>
      </section>`;
    return html;
  }

  /* ---------- 해녀: 내 글 ---------- */
  function hMine() {
    const mine = S.posts.filter((p) => p.ownerId === DEV);
    return `<h1>내가 올린 글</h1>
      <p class="muted" style="margin:0">다 팔리면 '다 팔렸어요'를 눌러 주세요. 손님이 헛걸음하지 않아요.</p>
      ${mine.length ? mine.map((p) => postCard(p, true)).join('') : '<div class="empty">아직 올린 글이 없어요. 올리기에서 사진을 찍어 보세요.</div>'}
      <button type="button" class="btn sm" data-act="reset">게시판을 예시 글로 되돌리기</button>`;
  }

  /* ---------- 해녀: 체험 ---------- */
  function hExp() {
    const mine = S.programs.filter((p) => p.ownerId === DEV);
    return `<h1>체험 알리기</h1>
      <p class="muted" style="margin:0">물질 체험, 해녀 밥상 같은 프로그램을 알리면 손님이 직접 연락해 날짜를 잡아요.</p>
      ${ui.newProg ? `<section class="card">
        <label class="field">체험 이름<input type="text" id="pg-title" placeholder="해녀와 함께하는 물질 체험"></label>
        <label class="field">무엇을 하나요<textarea id="pg-desc" rows="3" placeholder="손님이 무엇을 배우고 경험하는지 적어 주세요"></textarea></label>
        <div class="grid2">
          <label class="field">1인 가격(원, 선택)<input type="number" id="pg-price" min="0" step="1000"></label>
          <label class="field">시간<input type="text" id="pg-times" placeholder="오전 10시 (2시간)"></label>
        </div>
        <label class="field">운영 시기<input type="text" id="pg-season" placeholder="5~10월, 날씨에 따라 쉬어요"></label>
        <div class="row"><button type="button" class="btn primary" data-act="pg-save">알리기</button><button type="button" class="btn" data-act="pg-cancel">취소</button></div>
      </section>` : '<button type="button" class="btn primary big" data-act="pg-new">새 체험 알리기</button>'}
      <section class="stack"><h2>내가 알린 체험</h2>${mine.length ? mine.map((p) => `<div class="card"><h3>${esc(p.title)}</h3><p style="margin:0">${esc(p.desc)}</p>
        <div class="kv">${p.price ? `<span>1인 <b>${won(p.price)}</b></span>` : ''}${p.times ? `<span>${esc(p.times)}</span>` : ''}${p.season ? `<span>${esc(p.season)}</span>` : ''}</div>
        <button type="button" class="btn sm" data-act="pg-del" data-id="${esc(p.id)}">내리기</button></div>`).join('') : '<div class="empty">아직 알린 체험이 없어요.</div>'}</section>`;
  }

  /* ---------- 해녀: 내 정보 ---------- */
  function hMe() {
    const m = ui.me;
    return `<h1>내 정보</h1>
      <p class="muted" style="margin:0">여기 적은 이름과 전화번호가 손님 화면에 그대로 보여요. 손님은 이 번호로 직접 연락해요.</p>
      ${isExample(m) ? '<div class="banner">지금은 예시 정보예요. 진짜 정보로 바꿔 주세요.</div>' : ''}
      <section class="card">
        <label class="field">이름<input type="text" id="me-name" value="${esc(m.name)}" autocomplete="name"></label>
        <label class="field">어촌계<input type="text" id="me-village" value="${esc(m.village)}"></label>
        <label class="field">전화번호<input type="text" id="me-phone" value="${esc(m.phone)}" inputmode="tel" autocomplete="tel"></label>
        <label class="field">손님과 만나는 곳<input type="text" id="me-place" value="${esc(m.place)}"></label>
        <label class="field">판매 시간<input type="text" id="me-hours" value="${esc(m.hours)}"></label>
        <button type="button" class="btn primary big" data-act="me-save">저장</button>
      </section>`;
  }

  /* ---------- 손님: 해산물 ---------- */
  function cMarket() {
    const kinds = [...new Set(S.posts.map((p) => p.species))];
    const rank = (p) => (isEarly(p) && canSeeEarly(p) ? 0 : p.status === 'sold' ? 2 : 1);
    const list = S.posts.filter((p) => ui.filter === 'all' || p.species === ui.filter)
      .sort((a, b) => rank(a) - rank(b) || new Date(b.createdAt) - new Date(a.createdAt));
    const arrived = myWants().filter((w) => w.matchedPostId).length;
    return `<div class="row between" style="align-items:flex-start;flex-wrap:nowrap">
        <div class="stack"><div class="eyebrow">제주 해녀가 직접 알려요</div><h1>오늘 바다에서<br>올라온 해산물</h1></div>
        <button type="button" class="cal-btn" data-act="open-resv" aria-label="먼저 보기 예약${myWants().length ? ', 예약 ' + myWants().length + '개' : ''}" title="먼저 보기 예약"><span aria-hidden="true">📅</span>${arrived ? `<span class="badge num">${arrived}</span>` : myWants().length ? '<i class="cal-dot"></i>' : ''}</button>
      </div>
      <div class="notice">해녀바당은 알리기만 도와요. 사고파는 건 해녀에게 전화나 문자로 직접 하세요. 수수료가 없어요.</div>
      <div class="chips"><button type="button" class="chip" data-act="filter" data-v="all" aria-pressed="${ui.filter === 'all'}">전체</button>${kinds.map((k) => `<button type="button" class="chip" data-act="filter" data-v="${k}" aria-pressed="${ui.filter === k}">${esc(SP[k].ko)}</button>`).join('')}</div>
      ${list.length ? list.map((p) => (isEarly(p) && !canSeeEarly(p) ? teaser(p) : postCard(p, false))).join('') : '<div class="empty">아직 올라온 해산물이 없어요. 물질 끝나는 오후에 다시 봐 주세요.</div>'}`;
  }

  /* ---------- 손님: 먼저 보기 예약 ---------- */
  function cReserve() {
    const r = ui.rv, mine = myWants();
    return `<button type="button" class="btn sm" data-act="close-resv" style="align-self:flex-start">← 해산물로 돌아가기</button>
      <div class="stack"><div class="eyebrow">📅 먼저 보기 예약</div><h1>원하는 해산물을<br>미리 예약하세요</h1>
      <p class="muted" style="margin:0">예약한 해산물이 올라오면 다른 손님보다 ${A.EARLY_MIN}분 먼저 볼 수 있어요. 해녀에게도 기다리는 손님으로 알려져서 먼저 연락이 갈 수 있어요. 돈은 내지 않아요.</p></div>
      <section class="card">
        <label class="field" for="rv-text">무엇을 기다리세요?<textarea id="rv-text" rows="3" placeholder="예: 큰 전복 1kg, 뿔소라 조금. 주말에 받고 싶어요">${esc(r.text)}</textarea></label>
        <p class="muted small" style="margin:0" id="rv-detect">${detectLine(r.text)}</p>
        <div class="stack" style="gap:6px"><span class="muted small">빠르게 넣기 (선택) · 누르면 위 글에 들어가요</span>
        <div class="chips small-chips">${Object.entries(SP).map(([k, v]) => `<button type="button" class="chip" data-act="rv-chip" data-v="${esc(v.ko)}">${esc(v.ko)}</button>`).join('')}</div></div>
        <label class="field">이름<input type="text" id="rv-name" value="${esc(r.name)}" autocomplete="name" placeholder="해녀가 부를 이름"></label>
        <label class="field">전화번호 (선택)<input type="text" id="rv-phone" value="${esc(r.phone)}" inputmode="tel" autocomplete="tel" placeholder="적으면 해녀가 먼저 연락할 수 있어요"></label>
        <button type="button" class="btn primary big" data-act="rv-save">예약하기</button>
        <p class="muted small" style="margin:0">예약은 ${A.WANT_DAYS}일 동안 유지돼요. 전화번호는 해녀 화면에만 보여요.</p>
      </section>
      <section class="stack"><h2>내 예약</h2>${mine.length ? mine.map((w) => {
        const p = w.matchedPostId && S.posts.find((x) => x.id === w.matchedPostId);
        return `<div class="card ${p ? 'match' : ''}">
          <div class="row between" style="flex-wrap:nowrap;align-items:flex-start"><h3 class="grow">“${esc(w.text)}”</h3>${p ? '<span class="pill warn">올라왔어요</span>' : '<span class="pill info">기다리는 중</span>'}</div>
          <div class="kv"><span>${esc(ago(w.createdAt))} 예약</span><span>${w.species.length ? '알아본 해산물 <b>' + w.species.map((k) => esc(SP[k].ko)).join(', ') + '</b>' : '해산물을 못 알아봐서 해녀에게 요청으로만 보여요'}</span></div>
          <div class="row">${p ? `<button type="button" class="btn primary sm" data-act="rv-see" data-v="${esc(p.species)}">보러 가기</button>` : ''}<button type="button" class="btn sm" data-act="rv-cancel" data-id="${esc(w.id)}">${p ? '예약 끝내기' : '예약 취소'}</button></div>
        </div>`;
      }).join('') : '<div class="empty">아직 예약한 해산물이 없어요.</div>'}</section>`;
  }

  /* ---------- 손님: 체험 ---------- */
  function cExp() {
    return `<h1>해녀 문화 체험</h1>
      <p class="muted" style="margin:0">해녀 삼촌들이 직접 진행해요. 물때와 바다 날씨에 따라 날짜가 바뀌니 해녀에게 직접 연락해 정하세요.</p>
      ${S.programs.length ? S.programs.map((p) => `<div class="card">
        <div class="row between"><h2>${esc(p.title)}</h2>${p.example ? '<span class="pill info">예시</span>' : ''}</div>
        <p style="margin:0">${esc(p.desc)}</p>
        <div class="kv">${p.price ? `<span>1인 <b>${won(p.price)}</b></span>` : ''}${p.times ? `<span>${esc(p.times)}</span>` : ''}${p.season ? `<span>${esc(p.season)}</span>` : ''}</div>
        ${contact(p.author, p.title + ' 체험')}
      </div>`).join('') : '<div class="empty">아직 알린 체험이 없어요.</div>'}`;
  }

  /* ---------- 탭 ---------- */
  const TABS = {
    h: [
      { id: 'upload', label: '올리기', icon: I.camera, view: hUpload },
      { id: 'mine', label: '내 글', icon: I.list, view: hMine, badge: () => S.posts.filter((p) => p.ownerId === DEV && p.status !== 'sold').length },
      { id: 'exp', label: '체험', icon: I.people, view: hExp },
      { id: 'me', label: '내 정보', icon: I.user, view: hMe }
    ],
    c: [
      { id: 'market', label: '해산물', icon: I.shop, view: cMarket, badge: () => S.posts.filter((p) => p.status !== 'sold').length },
      { id: 'exp', label: '체험', icon: I.people, view: cExp }
    ]
  };
  const HIDDEN = {
    c: [{ id: 'reserve', view: cReserve }]
  };

  function render() {
    if (!S) return;
    document.body.classList.toggle('haenyeo', ui.role === 'h');
    $('#role-h').setAttribute('aria-pressed', ui.role === 'h');
    $('#role-c').setAttribute('aria-pressed', ui.role === 'c');
    $('#mode').innerHTML = `<span><i class="dot ${CONFIG.gemini ? 'on' : ''}"></i>사진 판별 ${CONFIG.gemini ? 'Gemini' : '데모'}</span><span><i class="dot ${CONFIG.priceN ? 'on' : ''}"></i>시세 ${CONFIG.priceN ? 'aT ' + CONFIG.priceN + '품목' : '기본 참고가'}</span><span><i class="dot ${CONFIG.shared ? 'on' : ''}"></i>${CONFIG.shared ? '모든 손님에게 공유' : '이 기기에만 저장'}</span>`;
    const tabs = TABS[ui.role];
    const cur = tabs.find((t) => t.id === ui.tab[ui.role]) || (HIDDEN[ui.role] || []).find((t) => t.id === ui.tab[ui.role]) || tabs[0];
    const ti = $('#tabs');
    ti.style.gridTemplateColumns = `repeat(${tabs.length}, minmax(0, 1fr))`;
    ti.innerHTML = tabs.map((t) => {
      const n = t.badge ? t.badge() : 0;
      return `<button type="button" data-act="tab" data-v="${t.id}" ${t.id === cur.id ? 'aria-current="page"' : ''}>${t.icon}${esc(t.label)}${n ? `<span class="badge num">${n}</span>` : ''}</button>`;
    }).join('');
    const y = window.scrollY;
    $('#view').innerHTML = cur.view();
    window.scrollTo(0, y);
  }

  /* ---------- 사진 ---------- */
  function shrink(file, max, q) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
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
  async function analyze(big) {
    if (CONFIG.gemini) {
      try {
        const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: big.split(',')[1], mime: 'image/jpeg' }) });
        const txt = await res.text(); let j = {}; try { j = JSON.parse(txt); } catch { /* 오류 화면 */ }
        if (!res.ok) throw new Error(j.error || `서버 응답 ${res.status}${/TIMEOUT/i.test(txt) ? ', 시간 초과' : ''}${/PAYLOAD|too large/i.test(txt) ? ', 사진이 너무 큼' : ''}`);
        return j.ai || {};
      } catch (e) {
        return { demo: true, species: 'abalone', estWeightKg: 1, grade: '상', freshness: '좋음', confidence: 0, notes: '사진 판별에 실패했어요(' + e.message + '). 아래에서 직접 골라 주세요.' };
      }
    }
    await new Promise((r) => setTimeout(r, 1200));
    return { demo: true, isSeafood: true, species: 'abalone', estWeightKg: 1.5, grade: '상', freshness: '좋음', confidence: 0.5, notes: '데모라서 실제 판별은 하지 않았어요. 아래에서 직접 고쳐 주세요.' };
  }
  async function onPhoto(file) {
    const d = ui.draft = { status: 'analyzing', variant: 0 };
    ui.lastPost = null;
    try {
      const [big, small] = await Promise.all([shrink(file, 1024, 0.82), shrink(file, 480, 0.65)]);
      d.photo = small;
      render();
      const ai = await analyze(big);
      if (!SP[ai.species]) ai.species = 'abalone';
      if (!A.GRADES[ai.grade]) ai.grade = '상';
      if (!['최상', '좋음', '보통'].includes(ai.freshness)) ai.freshness = '좋음';
      if (ai.isSeafood === false) ai.notes = '해산물이 잘 안 보여요. 다시 찍거나 아래에서 직접 골라 주세요. ' + (ai.notes || '');
      Object.assign(d, {
        status: 'ready', ai, species: ai.species, variety: (typeof ai.variety === 'string' && ai.variety.trim() && !/모름|없음|unknown/i.test(ai.variety)) ? ai.variety.trim().slice(0, 20) : null, grade: ai.grade, freshness: ai.freshness,
        weightKg: Math.max(0.5, Math.round((ai.estWeightKg || 1) * 2) / 2)
      });
      d.askPerKg = A.refPrice(d) || null;
      d.promo = ai.promo || A.promo(Object.assign({ author: ui.me }, d));
    } catch (e) { d.status = 'error'; d.error = e.message; }
    render();
  }
  // AI에게 홍보 글을 새로 쓰게 함 (Gemini가 없으면 다른 틀로)
  async function rewrite() {
    const d = ui.draft;
    const ta = $('#promo'); if (ta) d.promo = ta.value;
    if (!CONFIG.gemini) { d.variant++; d.promo = A.promo(Object.assign({ author: ui.me }, d), d.variant); render(); return; }
    d.rewriting = true; render();
    const prompt = `제주 해녀가 직접 잡은 해산물을 손님에게 알리는 짧은 홍보 글을 써라. 해녀 어르신의 따뜻한 말투, 2~3문장, 이모지와 해시태그 없이.
품목: ${A.label(d.species, d.variety)}, 등급: ${d.grade}, 신선도: ${d.freshness}, 양: ${d.weightKg}kg, 해녀: ${ui.me.name.replace('(예시)', '')}, 동네: ${ui.me.village}.
가격과 전화번호는 넣지 마라. 이전 글과 다르게 써라: "${d.promo}"
글만 답하라.`;
    const body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.9 } });
    try {
      let r = await fetch('/api/gemini?model=gemini-flash-lite-latest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (r.status === 404 || r.status === 400) r = await fetch('/api/gemini?model=gemini-flash-latest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const j = await r.json();
      const t = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
      if (!r.ok || !t) throw new Error(j.error?.message || '답이 비었어요');
      d.promo = t.replace(/^["“]|["”]$/g, '');
    } catch (e) {
      d.variant++; d.promo = A.promo(Object.assign({ author: ui.me }, d), d.variant);
      toast('AI가 쓰지 못해서 기본 글로 바꿨어요.');
    }
    d.rewriting = false; render();
  }

  function keepRv() {
    if ($('#rv-name')) { ui.rv.name = $('#rv-name').value.trim(); ui.rv.phone = $('#rv-phone').value.trim(); ui.rv.text = $('#rv-text').value; }
  }
  function detectLine(text) {
    if (!String(text || '').trim()) return '적으면 어떤 해산물인지 알아봐서 올라올 때 연결해 드려요.';
    const hit = A.detect(text);
    return hit.length ? '알아본 해산물: <b>' + hit.map((k) => esc(SP[k].ko)).join(', ') + '</b> · 올라오면 먼저 보여 드려요.'
      : '아직 어떤 해산물인지 못 알아봤어요. 해산물 이름을 넣어 주세요. 그래도 해녀에게 요청으로 전해져요.';
  }
  // 먼저 보기 남은 시간이 흐르도록 30초마다 다시 그림 (입력 중이면 건너뜀)
  setInterval(() => {
    const busy = document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (S && !busy && ui.draft.status === 'idle' && S.posts.some((p) => p.earlyUntil)) render();
  }, 30000);

  /* ---------- 동작 ---------- */
  document.addEventListener('change', (e) => {
    if (e.target.id === 'cam' && e.target.files[0]) onPhoto(e.target.files[0]);
    if (e.target.id === 'other-name') { const d = ui.draft; d.variety = e.target.value.trim() || null; if (d.askPerKg != null) d.askPerKg = A.refPrice(d) || d.askPerKg; d.promo = A.promo(Object.assign({ author: ui.me }, d), d.variant); render(); }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'promo') ui.draft.promo = e.target.value;
    if (e.target.id === 'other-name') ui.draft.variety = e.target.value.trim() || null;
    if (e.target.id === 'rv-text') { ui.rv.text = e.target.value; $('#rv-detect').innerHTML = detectLine(e.target.value); }
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, v = b.dataset.v, d = ui.draft;
    switch (act) {
      case 'role': break;
      case 'tab': ui.tab[ui.role] = v; ui.delArm = null; render(); window.scrollTo(0, 0); break;
      case 'filter': ui.filter = v; render(); break;
      case 'copy': copy(v, '전화번호를 복사했어요.'); break;
      case 'dismiss-post': ui.lastPost = null; render(); break;
      case 'retake': ui.draft = { status: 'idle' }; render(); break;
      case 'd-variety': d.variety = v || null; d.promo = A.promo(Object.assign({ author: ui.me }, d), d.variant); render(); break;
      case 'd-species': d.variety = null; d.species = v; if (d.askPerKg != null) d.askPerKg = A.refPrice(d); d.promo = A.promo(Object.assign({ author: ui.me }, d), d.variant); render(); break;
      case 'd-grade': d.grade = v; if (d.askPerKg != null) d.askPerKg = A.refPrice(d); render(); break;
      case 'd-fresh': d.freshness = v; if (d.askPerKg != null) d.askPerKg = A.refPrice(d); render(); break;
      case 'd-w': d.weightKg = Math.max(0.5, Math.round((d.weightKg + +v) * 10) / 10); render(); break;
      case 'd-ask': d.askPerKg = v === 'on' ? (A.refPrice(d) || 10000) : null; render(); break;
      case 'd-adj': d.askPerKg = Math.max(1000, d.askPerKg + +v); render(); break;
      case 'rewrite': run(rewrite); break;
      case 'publish': {
        const ta = $('#promo'); if (ta) d.promo = ta.value.trim();
        if (d.species === 'other' && !d.variety) { toast('해산물 이름을 적어 주세요.'); break; }
        if (!ui.me.name || !ui.me.phone) { toast('손님이 연락할 이름과 전화번호를 먼저 적어 주세요.'); ui.tab.h = 'me'; render(); break; }
        b.disabled = true;
        run(async () => {
          const p = await mutate((s) => {
            const post = {
              id: A.uid('p'), ownerId: DEV, author: Object.assign({}, ui.me),
              species: d.species, variety: d.variety || null, grade: d.grade, freshness: d.freshness, weightKg: d.weightKg,
              refPerKg: A.refPrice(d), refLive: A.basePerKg(d.species, d.variety).live, askPerKg: d.askPerKg, photo: d.photo || null,
              promo: d.promo, createdAt: new Date().toISOString(), status: 'open'
            };
            const ws = s.wants.filter((w) => !w.matchedPostId && ((w.species || []).includes(post.species) || (post.species === 'other' && post.variety && String(w.text || '').includes(post.variety))));
            if (ws.length) { post.earlyUntil = new Date(Date.now() + A.EARLY_MIN * 60000).toISOString(); ws.forEach((w) => { w.matchedPostId = post.id; }); }
            s.posts.unshift(post); return post;
          });
          ui.lastPost = p.id; ui.draft = { status: 'idle' }; render(); window.scrollTo(0, 0);
        }).finally(() => { b.disabled = false; });
        break;
      }
      case 'share': { const p = S.posts.find((x) => x.id === b.dataset.id); if (p) copy(shareText(p), '홍보 글을 복사했어요. 카카오톡이나 밴드에 붙여 넣으세요.'); break; }
      case 'toggle': run(() => mutate((s) => { const p = s.posts.find((x) => x.id === b.dataset.id); if (p) p.status = p.status === 'sold' ? 'open' : 'sold'; })); break;
      case 'del-arm': ui.delArm = b.dataset.id; render(); break;
      case 'del-cancel': ui.delArm = null; render(); break;
      case 'del': ui.delArm = null; run(() => mutate((s) => { s.posts = s.posts.filter((x) => x.id !== b.dataset.id); })).then(() => toast('글을 내렸어요.')); break;
      case 'reset': run(async () => { S = A.seed(); store.set('hb2-state', S); if (CONFIG.shared) await pushShared(); ui.lastPost = null; render(); toast('예시 글로 되돌렸어요.'); }); break;
      case 'me-save': {
        const m = { name: $('#me-name').value.trim(), village: $('#me-village').value.trim(), phone: $('#me-phone').value.trim(), place: $('#me-place').value.trim(), hours: $('#me-hours').value.trim() };
        if (!m.name || !digits(m.phone)) { toast('이름과 전화번호는 꼭 적어 주세요.'); break; }
        ui.me = m; store.set('hb2-me', m); toast('저장했어요. 다음에 올리는 글부터 이 정보가 보여요.');
        ui.tab.h = ui.draft.status === 'ready' ? 'upload' : 'me'; render();
        break;
      }
      case 'open-resv': ui.tab.c = 'reserve'; render(); window.scrollTo(0, 0); break;
      case 'close-resv': ui.tab.c = 'market'; render(); window.scrollTo(0, 0); break;
      case 'rv-chip': {
        const ta = $('#rv-text'); if (!ta) break;
        const t = ta.value.trim();
        ta.value = t.includes(v) ? t : (t ? t.replace(/[,\s]+$/, '') + ', ' : '') + v + ' ';
        ui.rv.text = ta.value; $('#rv-detect').innerHTML = detectLine(ta.value);
        ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
        break;
      }
      case 'rv-save': {
        keepRv();
        const r = ui.rv;
        const text = String(r.text || '').trim();
        if (!text) { toast('기다리는 해산물을 적어 주세요.'); break; }
        if (!r.name) { toast('이름을 적어 주세요.'); break; }
        store.set('hb2-guest', r);
        run(async () => {
          await mutate((s) => {
            s.wants.unshift({ id: A.uid('w'), ownerId: DEV, name: r.name, phone: r.phone, text, species: A.detect(text), createdAt: new Date().toISOString(), matchedPostId: null });
          });
          const hit = A.detect(text);
          ui.rv.text = ''; store.set('hb2-guest', ui.rv); render();
          toast(hit.length ? '예약했어요. 올라오면 먼저 보여 드릴게요.' : '예약했어요. 해산물을 못 알아봐서 해녀에게 요청으로 전할게요.');
        });
        break;
      }
      case 'rv-cancel': run(() => mutate((s) => { s.wants = s.wants.filter((w) => w.id !== b.dataset.id); })); break;
      case 'rv-see': ui.tab.c = 'market'; ui.filter = v; render(); window.scrollTo(0, 0); break;
      case 'pg-new': ui.newProg = true; render(); break;
      case 'pg-cancel': ui.newProg = false; render(); break;
      case 'pg-save': {
        const t = $('#pg-title').value.trim();
        if (!t) { toast('체험 이름을 적어 주세요.'); break; }
        const pg = { id: A.uid('pg'), ownerId: DEV, author: Object.assign({}, ui.me), title: t, desc: $('#pg-desc').value.trim(), price: +$('#pg-price').value || null, times: $('#pg-times').value.trim(), season: $('#pg-season').value.trim() };
        run(async () => { await mutate((s) => { s.programs.unshift(pg); }); ui.newProg = false; render(); toast('체험을 알렸어요.'); });
        break;
      }
      case 'pg-del': run(() => mutate((s) => { s.programs = s.programs.filter((x) => x.id !== b.dataset.id); })); break;
    }
  });
  document.querySelectorAll('.roles button').forEach((btn) => btn.addEventListener('click', () => {
    ui.role = btn.dataset.role; store.set('hb2-role', ui.role); ui.delArm = null; render(); window.scrollTo(0, 0);
  }));

  // 공유 게시판이면 다른 해녀가 올린 글을 30초마다 받아옴 (입력 중이면 건너뜀)
  setInterval(() => {
    if (!CONFIG.shared) return;
    const busy = document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (busy || ui.draft.status !== 'idle') return;
    fetchShared().then((d) => { if (d && d.v === 2) { S = norm(d); render(); } }).catch(() => {});
  }, 30000);

  /* ---------- 시작 ---------- */
  (async () => {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (res.ok && (res.headers.get('content-type') || '').includes('json')) CONFIG = Object.assign(CONFIG, await res.json());
    } catch { /* 서버가 없으면 미리보기 */ }
    await load();
    norm(S);
    render();
    // 오늘 수산물 시세(aT)를 받아서 추천 가격에 씀
    if (CONFIG.price) {
      try {
        const r = await fetch('/api/price', { cache: 'no-store' });
        const j = await r.json();
        if (r.ok && j.rows) { CONFIG.priceN = A.setMarket(j.rows); CONFIG.priceDate = j.date; render(); }
      } catch { /* 시세를 못 받으면 기본 참고가 */ }
    }
  })();
})();
