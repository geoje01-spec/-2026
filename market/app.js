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
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 안 되는 환경이면 메모리만 씀 */ } }
  };

  /* ---------- 로그인: 해녀 계정은 해녀 화면, 일반 계정은 손님 화면 ---------- */
  const SESSION = store.get('haenyeo_session', null);
  if (!SESSION || !SESSION.username) return;   // 로그인 화면(auth.js)이 대신 보임
  const IS_HAENYEO = SESSION.userType === 'haenyeo';

  /* ---------- 데이터: 공유 게시판(서버) 또는 이 기기 ---------- */
  let CONFIG = { gemini: false, shared: false };
  let S = null;
  const DEV = 'u:' + SESSION.username;   // 내 글·내 예약·내 후기를 가리는 주인 표시 (계정별)

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
    // 채팅이 생기기 전의 예시 글만 있으면 새 예시로 바꿈 (해녀가 올린 글이 있으면 그대로)
    if (!Array.isArray(S.chats) && S.posts.every((p) => p.example)) S = A.seed();
  }
  // 익명: 예전 글에 남은 이름·전화번호·마을·만나는 곳은 지우고 별명만 남김
  function anon(a, key) {
    a = a || {};
    if (!a.alias) a.alias = A.alias('haenyeo', key);
    if (!a.region) a.region = A.regionOf(a.village) || 'jeju';
    ['name', 'phone', 'village', 'place'].forEach((k) => delete a[k]);
    return a;
  }
  function norm(s) {
    s.reviews = Array.isArray(s.reviews) ? s.reviews : [];
    s.chats = Array.isArray(s.chats) ? s.chats : [];
    s.posts.forEach((p) => { p.author = anon(p.author, p.ownerId || p.id); });
    (s.programs || []).forEach((p) => { p.author = anon(p.author, p.ownerId || p.id); });
    s.reviews.forEach((r) => { if (!r.alias) r.alias = A.alias('general', r.ownerId || r.id); delete r.name; });
    s.wants =(s.wants || []).filter((w) => Date.now() - new Date(w.createdAt) < A.WANT_DAYS * 864e5);
    s.wants.forEach((w) => {   // 예전 형식(해산물 하나만 고르던 예약) 맞추기
      if (!w.alias) w.alias = A.alias('general', w.ownerId || w.id);
      delete w.name; delete w.phone;
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
  // 해녀 내 정보는 계정마다 따로 (지역·판매 시간만. 이름·전화번호는 받지 않음)
  const ME_KEY = 'hb2-me:' + SESSION.username;
  const firstMe = () => Object.assign({}, SESSION.demo ? A.EXAMPLE_ME : { region: 'jeju', hours: '' });
  // 손님과 해녀 모두 별명으로만 보임
  const ME_ALIAS = A.alias(IS_HAENYEO ? 'haenyeo' : 'general', DEV);
  const ui = {
    role: IS_HAENYEO ? 'h' : 'c',
    tab: { h: 'upload', c: 'market' },
    draft: { status: 'idle' },
    lastPost: null,
    filter: 'all',
    me: anonMe(store.get(ME_KEY, null) || firstMe()),
    delArm: null,
    newProg: false,
    rv: { text: '' },                                                           // 먼저 보기 예약 쓰는 중
    rev: { postId: null, stars: 5, text: '', busy: false, msg: null },         // 후기 쓰는 중
    chat: { id: null, pending: null, draft: '' }   // 채팅
  };
  function anonMe(m) { ['name', 'phone', 'village', 'place'].forEach((k) => delete m[k]); return m; }
  // 글·체험에 붙는 해녀 정보: 별명·지역·판매 시간만
  const myAuthor = () => ({ alias: ME_ALIAS, region: myRegion(), hours: ui.me.hours || '' });

  // 지역: 해녀는 내 정보의 지역, 손님은 고른 지역(또는 내 위치)
  const myRegion = () => ui.me.region || 'jeju';
  const rp = (d) => Object.assign({ region: myRegion() }, d);
  ui.region = IS_HAENYEO ? myRegion() : (store.get('hb2-region', null) || 'jeju');
  const regionName = (k) => (A.REGIONS[k] || {}).name || '';

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
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8M8 13h5"/></svg>'
  };
  // 선으로 그린 물결 두 줄 (잡지 삽화 느낌)
  const waves = '<svg class="waves" viewBox="0 0 400 36" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"><path vector-effect="non-scaling-stroke" d="M0 10 Q25 0 50 10 T100 10 T150 10 T200 10 T250 10 T300 10 T350 10 T400 10"/><path vector-effect="non-scaling-stroke" d="M0 28 Q25 18 50 28 T100 28 T150 28 T200 28 T250 28 T300 28 T350 28 T400 28"/></g></svg>';
  // 손님 표지 아래 삽화: 물결 위에 뜬 테왁
  const coverArt = '<svg class="art" viewBox="0 0 340 46" preserveAspectRatio="xMaxYMid meet" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M0 30q14-9 28 0t28 0 28 0 28 0 28 0 28 0 28 0 28 0 28 0 28 0 28 0 28 0"/><path d="M14 41q14-9 28 0t28 0 28 0 28 0 28 0 28 0 28 0 28 0 28 0 28 0 28 0" opacity=".45"/></g><circle cx="292" cy="17" r="11" style="fill:var(--tewak)"/><path d="M281.6 15.2c6.9 2.4 13.9 2.4 20.8 0" stroke="#fbf8f2" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>';

  /* ---------- 공용 조각 ---------- */
  // 손님이 해녀에게 연락하는 곳: 전화번호 대신 익명 채팅 (ref: 어떤 글·체험에 대한 채팅인지)
  function chatBox(ref, title, seller, a) {
    if (seller === DEV) return '';   // 내 글엔 채팅 버튼 없음
    const t = chatFind(ref, DEV);
    return `<div class="contact">
      <div class="row between"><div><b>${esc(a.alias)}</b> <span class="muted small">${esc(regionName(a.region))} 해녀</span></div><span class="pill info">익명</span></div>
      <button type="button" class="btn primary" data-act="chat-start" data-type="${ref.type}" data-id="${esc(ref.id)}">💬 ${t ? '채팅 이어 하기' : ref.type === 'post' ? '채팅으로 주문하기' : '채팅으로 물어보기'}</button>
      <p class="small" style="margin:0">🔒 이름과 전화번호는 서로 보이지 않아요. 받는 곳과 시간은 채팅으로 정해요.</p>
      <div class="kv">${a.hours ? `<span>판매 시간 <b>${esc(a.hours)}</b></span>` : ''}</div>
    </div>`;
  }
  function shareText(p) {
    return `[해녀바당] ${p.promo}\n\n${A.label(p.species, p.variety)} ${p.grade}등급 ${kg(p.weightKg)}${p.askPerKg ? ` · kg당 ${won(p.askPerKg)}` : ''}\n주문: 해녀바당에서 ${p.author.alias}에게 채팅 (이름·전화번호 없이)\n${location.origin}/market/`;
  }

  /* ---------- 익명 채팅 ---------- */
  // 채팅 하나 = 해녀(seller) 한 명 ↔ 손님(buyer) 한 명, 어떤 글·체험·예약에 대한 것인지(ref)
  // 공유 게시판(Upstash)이 연결돼야 다른 휴대폰끼리 주고받아짐. 지금은 이 기기 안에서만.
  const chatFind = (ref, buyerId) => S.chats.find((c) => c.ref.type === ref.type && c.ref.id === ref.id && c.buyerId === buyerId) || null;
  const myChats = () => S.chats.filter((c) => c.sellerId === DEV || c.buyerId === DEV).sort((x, y) => new Date(y.updatedAt) - new Date(x.updatedAt));
  const SEEN_KEY = 'hb2-seen:' + SESSION.username;   // 어디까지 읽었는지는 이 기기에만
  const unread = (c) => { const seen = store.get(SEEN_KEY, {})[c.id] || 0; return c.msgs.filter((m) => m.from !== DEV && new Date(m.at) > new Date(seen)).length; };
  const unreadAll = () => myChats().reduce((n, c) => n + unread(c), 0);
  function markSeen(c) { const all = store.get(SEEN_KEY, {}); all[c.id] = new Date().toISOString(); store.set(SEEN_KEY, all); }
  const otherAlias = (c) => (c.sellerId === DEV ? c.buyerAlias : c.sellerAlias);
  const refPost = (c) => (c.ref.type === 'post' ? S.posts.find((p) => p.id === c.ref.id) : null);
  function chatTitle(c) {
    const kind = c.ref.type === 'program' ? '체험' : c.ref.type === 'want' ? '예약' : '';
    return (kind ? kind + ' · ' : '') + c.title;
  }
  // 채팅 열기: 있으면 그 채팅, 없으면 첫 글을 보낼 때 만들 채팅(pending)
  function openChat(ref) {
    let c = null, pending = null;
    if (ref.type === 'want') {
      const w = S.wants.find((x) => x.id === ref.id); if (!w) return;
      c = chatFind(ref, w.ownerId);
      if (!c) pending = { ref, title: w.text.slice(0, 20), sellerId: DEV, sellerAlias: ME_ALIAS, buyerId: w.ownerId, buyerAlias: w.alias };
      ui.chat.draft = c ? '' : `${w.text.slice(0, 20)} 기다리셨죠? 오늘 물질해서 올렸어요.`;
    } else {
      const item = ref.type === 'post' ? S.posts.find((p) => p.id === ref.id) : S.programs.find((p) => p.id === ref.id);
      if (!item) return;
      c = chatFind(ref, DEV);
      const title = ref.type === 'post' ? A.label(item.species, item.variety) : item.title;
      if (!c) pending = { ref, title, sellerId: item.ownerId, sellerAlias: item.author.alias, buyerId: DEV, buyerAlias: ME_ALIAS };
      ui.chat.draft = c ? '' : ref.type === 'post' ? `${title} 주문하고 싶어요.` : `${title} 하고 싶어요. 언제 되나요?`;
    }
    Object.assign(ui.chat, { id: c ? c.id : null, pending });
    if (c) markSeen(c);
    ui.tab[ui.role] = 'chat'; render(); window.scrollTo(0, document.body.scrollHeight);
  }
  // 보낼 글 검사: 욕설·비방은 막고 전화번호는 가림 (익명 유지)
  function cleanMsg(text) {
    const t = String(text || '').trim();
    if (!t) return { ok: false, reason: '글을 적어 주세요.' };
    const chk = A.checkReview(t);
    if (!chk.ok) return { ok: false, reason: '🛡️ ' + chk.reason + ' 보내지 않았어요.' };
    return { ok: true, text: A.maskPhone(t) };
  }
  async function sendMsg(msg) {
    const pend = ui.chat.pending;
    await mutate((s) => {
      let c = ui.chat.id && s.chats.find((x) => x.id === ui.chat.id);
      if (!c && pend) {
        c = chatFind(pend.ref, pend.buyerId);   // 그사이 다른 기기에서 생겼을 수도
        if (!c) { c = Object.assign({ id: A.uid('c'), createdAt: new Date().toISOString(), msgs: [] }, pend); s.chats.unshift(c); }
      }
      if (!c) throw new Error('채팅을 찾지 못했어요.');
      c.msgs.push(Object.assign({ id: A.uid('m'), from: DEV, at: new Date().toISOString() }, msg));
      c.msgs = c.msgs.slice(-200);
      c.updatedAt = new Date().toISOString();
      ui.chat.id = c.id; ui.chat.pending = null;
      s.chats = s.chats.slice(0, 300);
    });
    const c = S.chats.find((x) => x.id === ui.chat.id); if (c) markSeen(c);
  }
  function chatList() {
    const cs = myChats();
    return `<div class="stack" style="gap:8px"><div class="eyebrow">💬 익명 채팅</div><h1>채팅</h1>
        <p class="muted" style="margin:0">${IS_HAENYEO ? '손님은 별명으로만 보여요. 삼촌 이름과 전화번호도 손님에게 보이지 않아요.' : '삼촌은 별명으로만 보여요. 내 이름과 전화번호도 삼촌에게 보이지 않아요.'} 나는 <b>${esc(ME_ALIAS)}</b>예요.</p></div>
      ${!CONFIG.shared ? '<div class="notice">지금은 이 기기 안에서만 주고받아져요. 공유 게시판을 연결하면 다른 휴대폰끼리 채팅돼요.</div>' : ''}
      ${cs.length ? `<ul class="chat-list">${cs.map((c) => {
        const last = c.msgs[c.msgs.length - 1], n = unread(c);
        return `<li><button type="button" data-act="chat-open" data-id="${esc(c.id)}">
          <span class="who"><b>${esc(otherAlias(c))}</b><time>${last ? esc(ago(last.at)) : ''}</time></span>
          <span class="what">${esc(chatTitle(c))}${c.example ? ' · 예시' : ''}</span>
          <span class="last">${last ? esc(last.text) : ''}</span>
          ${n ? `<span class="badge num">${n}</span>` : ''}</button></li>`;
      }).join('')}</ul>` : `<div class="empty">아직 채팅이 없어요. ${IS_HAENYEO ? '손님이 글을 보고 채팅을 보내면 여기에 와요.' : '해산물 글에서 "채팅으로 주문하기"를 눌러 보세요.'}</div>`}`;
  }
  function chatRoom() {
    const c = ui.chat.id && S.chats.find((x) => x.id === ui.chat.id), pend = !c && ui.chat.pending;
    const t = c || pend;
    if (!t) { ui.chat.id = null; return chatList(); }
    const iSell = t.sellerId === DEV;
    const msgs = (c ? c.msgs : []).map((m) => {
      const mine = m.from === DEV;
      return `<li class="msg ${mine ? 'me' : ''}"><p>${esc(m.text)}</p><time>${esc(ago(m.at))}</time></li>`;
    }).join('');
    const quick = iSell ? ['네, 있어요. 챙겨 둘게요.', '오늘은 다 팔렸어요. 죄송해요.'] : ['잘 받았어요. 고맙습니다!', '언제 받을 수 있을까요?'];
    return `<div class="chat-head">
        <button type="button" class="btn sm" data-act="chat-back">← 채팅 목록</button>
        <div class="grow"><b>${esc(iSell ? t.buyerAlias : t.sellerAlias)}</b><span class="muted small">${esc(chatTitle(t))}</span></div>
        <span class="pill info">익명</span>
      </div>
      <ul class="msgs" aria-live="polite">${msgs || '<li class="muted small" style="text-align:center;list-style:none">첫 글을 보내 보세요. 이름과 전화번호는 보이지 않아요.</li>'}</ul>
      <div class="quick-replies">${quick.map((q) => `<button type="button" class="chip" data-act="chat-quick" data-v="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <div class="chat-input">
        <textarea id="chat-text" rows="2" placeholder="채팅을 적어 주세요" aria-label="채팅 글">${esc(ui.chat.draft)}</textarea>
        <button type="button" class="btn primary" data-act="chat-send">보내기</button>
      </div>
      <p class="muted small" style="margin:0">🛡️ 욕설·비방은 보내지지 않고, 전화번호는 가려져요. 안전을 위해 채팅에서만 이야기해요.</p>`;
  }
  const chatView = () => (ui.chat.id || ui.chat.pending ? chatRoom() : chatList());
  /* ---------- 먼저 보기 예약 ---------- */
  const myWants = () => S.wants.filter((w) => w.ownerId === DEV);
  const isEarly = (p) => p.earlyUntil && new Date(p.earlyUntil) > Date.now();
  const canSeeEarly = (p) => p.ownerId === DEV || myWants().some((w) => w.matchedPostId === p.id);
  const minsLeft = (t) => Math.max(1, Math.ceil((new Date(t) - Date.now()) / 60000));
  function teaser(p) {
    const sp = SP[p.species];
    return `<article class="card teaser">
      <div class="row between"><h2>${esc(A.label(p.species, p.variety))} <span class="muted small">${esc(p.grade)}등급</span></h2><span class="pill warn">예약 손님 먼저 보는 중</span></div>
      <p style="margin:0">${esc(regionName(p.author.region))} 해녀 삼촌이 방금 ${esc(sp.ko)}${josa(sp.ko, '을', '를')} 올렸어요. 미리 예약한 손님이 먼저 보고 있어요.</p>
      <p class="muted small" style="margin:0"><b class="num">${minsLeft(p.earlyUntil)}분</b> 뒤에 모두에게 공개돼요. 다음부터 먼저 보고 싶으면 📅 버튼으로 예약하세요.</p>
    </article>`;
  }

  /* ---------- 후기 (해녀별 별점, 해녀는 계정으로 구분) ---------- */
  const sellerReviews = (p) => (S.reviews || []).filter((r) => r.seller === p.ownerId).sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt));
  // 게시판에 이미 있는 후기도 규칙에 걸리면 가리고 별점에서 뺌
  const shown = (r) => A.checkReview(r.text).ok;
  function rating(p) {
    const rs = sellerReviews(p).filter(shown);
    return rs.length ? { avg: rs.reduce((s, r) => s + r.stars, 0) / rs.length, n: rs.length } : null;
  }
  const starStr = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
  function reviewsBlock(p, owner) {
    const rs = sellerReviews(p), f = ui.rev;
    const list = rs.map((r) => shown(r)
      ? `<li class="review"><div class="row between"><span class="stars" aria-label="별 ${r.stars}개">${starStr(r.stars)}</span><time class="muted small">${esc(ago(r.createdAt))}</time></div>
          <p>${esc(A.maskPhone(r.text))}</p>
          <div class="kv"><span><b>${esc(r.alias)}</b></span><span>${esc(A.label(r.species, null))}</span>${r.checked === 'ai' ? '<span class="ai-ok">🛡️ AI 검사 통과</span>' : ''}${r.example ? '<span class="pill info">예시</span>' : ''}</div></li>`
      : '<li class="review hidden-rv">욕설이나 비방이 있어 가려진 후기예요.</li>').join('');
    const form = owner || p.ownerId === DEV ? '' : `<div class="rev-form">
        <h3>${esc(p.author.alias)}에게 후기 남기기 <span class="muted small" style="font-weight:400">${esc(ME_ALIAS)}(으)로 올라가요</span></h3>
        <div class="star-pick" role="group" aria-label="별점 고르기">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-act="rev-star" data-v="${n}" aria-label="${n}점" aria-pressed="${n <= f.stars}">★</button>`).join('')}<span class="num">${f.stars}점</span></div>
        <textarea id="rev-text" rows="3" placeholder="맛, 양, 신선도를 적어 주세요. 아쉬운 점도 괜찮아요.">${esc(f.text)}</textarea>
        ${f.msg ? `<div class="banner mod"><span aria-hidden="true">🛡️</span><div><b>${esc(f.msg.kind)} 때문에 올리지 않았어요.</b> ${esc(f.msg.reason)}${f.msg.suggestion ? `<div class="suggest">“${esc(f.msg.suggestion)}”</div><button type="button" class="btn sm" data-act="rev-use">이렇게 고쳐 쓰기</button>` : ' 불만이 있었다면 무엇이 아쉬웠는지 사실대로 적어 주세요.'}</div></div>` : ''}
        <button type="button" class="btn primary" data-act="rev-save" data-id="${esc(p.id)}" ${f.busy ? 'disabled' : ''}>${f.busy ? 'AI가 살펴보는 중…' : '후기 올리기'}</button>
        <p class="muted small" style="margin:0">🛡️ AI 도우미가 욕설과 일방적인 비방은 걸러 내요. 맛·양·신선도에 대한 솔직한 불만은 그대로 올라가요.</p>
      </div>`;
    return `<div class="reviews"><ul>${list || '<li class="muted small">아직 후기가 없어요.</li>'}</ul>${form}</div>`;
  }
  // 1차 이 기기 규칙 → 2차 서버 AI. 서버가 안 되면 규칙만으로 판단
  async function moderate(text, stars, item) {
    const local = A.checkReview(text);
    if (!local.ok) return Object.assign({ by: 'rule', suggestion: '' }, local);
    if (!CONFIG.gemini) return { ok: true, by: 'rule' };
    try {
      const r = await fetch('/api/moderate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, stars, item }) });
      const j = await r.json();
      if (r.ok && typeof j.ok === 'boolean') return j;
    } catch { /* 서버가 안 되면 규칙만 */ }
    return { ok: true, by: 'rule' };
  }

  function postCard(p, owner, i) {
    const sp = SP[p.species];
    const sold = p.status === 'sold';
    const rt = rating(p), nRev = sellerReviews(p).length, revOpen = ui.rev.postId === p.id;
    const nChat = S.chats.filter((c) => c.ref.type === 'post' && c.ref.id === p.id).length;
    const ownerBtns = `<div class="row">
        ${nChat ? `<button type="button" class="btn primary sm" data-act="tab" data-v="chat">💬 이 글 채팅 ${nChat}개</button>` : ''}
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
      <div class="post-h"><span class="no">No.${String((i || 0) + 1).padStart(2, '0')}</span><span class="by"><b>${esc(p.author.alias)}</b> · ${esc(regionName(p.author.region))}${rt ? `<span class="rate">★ ${rt.avg.toFixed(1)} <span class="muted">(${rt.n})</span></span>` : ''}</span></div>
      ${p.photo ? `<img class="photo" src="${esc(p.photo)}" alt="${esc(sp.ko)} 사진">` : ''}
      <div class="post-t"><h2>${esc(A.label(p.species, p.variety))} <span class="muted">${esc(p.grade)}등급 · 신선도 ${esc(p.freshness)}</span></h2>${sold ? '<span class="pill off">다 팔렸어요</span>' : '<span class="pill ok">있어요</span>'}</div>
      <div class="kv">${(p.author && (p.author.region || A.regionOf(p.author.village))) ? `<span>${esc(regionName(p.author.region || A.regionOf(p.author.village)))}${A.isSpecial(p.author.region || A.regionOf(p.author.village), p.species) ? ' 특산' : ''}</span>` : ''}<span>${esc(ago(p.createdAt))} 올림</span><span>양 <b>${kg(p.weightKg)}</b></span>${p.example ? '<span class="pill info">예시 글</span>' : ''}</div>
      ${p.promo ? `<p class="promo">${esc(p.promo)}</p>` : ''}
      <div class="row between" style="align-items:flex-end">
        ${p.askPerKg ? `<div class="price num" style="font-size:32px">${won(p.askPerKg).replace('원', '')}<small>원 / kg</small></div>` : '<strong>가격은 채팅으로 물어보세요</strong>'}
        ${p.refPerKg ? `<span class="muted small">참고 시세 kg당 ${won(p.refPerKg)}${p.refLive ? ' (aT)' : ''}</span>` : ''}
      </div>
      ${owner ? ownerBtns : (sold ? '<p class="muted small" style="margin:0">이번 것은 다 팔렸어요. 다음 물질 때 채팅으로 물어보세요.</p>' : '') + chatBox({ type: 'post', id: p.id }, A.label(p.species, p.variety), p.ownerId, p.author)}
      <button type="button" class="rev-toggle" data-act="rev-open" data-id="${esc(p.id)}" aria-expanded="${revOpen}">${rt ? `<span class="stars">★</span> ${rt.avg.toFixed(1)} · ` : ''}후기 ${nRev}개 ${revOpen ? '접기' : owner ? '보기' : '보기 · 쓰기'}</button>
      ${revOpen ? reviewsBlock(p, owner) : ''}
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
          <ul class="feed">${ws.map((w) => `<li><time>${esc(ago(w.createdAt))}</time><span><b>${esc(w.alias)}</b> “${esc(w.text)}”<br><button type="button" class="btn sm" data-act="chat-want" data-id="${esc(w.id)}">💬 먼저 채팅 보내기</button></span></li>`).join('')}</ul>` : ''; })()}
        <p class="muted" style="margin:0">카카오톡 단체방이나 밴드에도 붙여 넣으면 더 많은 손님이 봐요. 손님은 이름·전화번호 없이 채팅으로 주문해요.</p>
        <div class="row"><button type="button" class="btn primary" data-act="share" data-id="${esc(p.id)}">홍보 글 복사</button><button type="button" class="btn" data-act="dismiss-post">확인</button></div>
      </section>`;
    }
    if (d.status === 'idle') {
      html += `<div class="stack"><div class="eyebrow">${esc(regionName(myRegion()))} · ${esc(ME_ALIAS)}</div>
        <h1>오늘 잡은 해산물을<br>찍어서 알리세요</h1>
        <p class="muted" style="margin:0">사진 한 장이면 AI가 품목을 알아보고 홍보 글을 써 드려요. 손님은 삼촌 이름·전화번호 없이 채팅으로 주문해요. 수수료는 없어요.</p></div>
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
          <div class="want-list">${ws.map((w) => `<span><b>${esc(w.alias)}</b> “${esc(w.text)}” <button type="button" class="link" data-act="chat-want" data-id="${esc(w.id)}">💬 채팅</button></span>`).join('')}</div></div></div>`).join('') : '<div class="empty">지금 기다리는 손님이 없어요.</div>'}
      </section>`;
      return html;
    }
    html += d.photo ? `<img class="photo" src="${esc(d.photo)}" alt="방금 찍은 해산물 사진">` : '';
    if (d.status === 'analyzing') return html + `<div class="card"><div class="loading"><span class="spin" aria-hidden="true"></span>AI가 품목을 보고 홍보 글을 쓰고 있어요</div></div>`;
    if (d.status === 'error') return html + `<div class="card"><div class="banner">${esc(d.error)}</div><button type="button" class="btn big" data-act="retake">다시 찍기</button></div>`;
    const ref = A.refPrice(rp(d));
    html += `
      <section class="card">
        <div class="row between"><div class="eyebrow">AI가 본 결과</div>${d.ai.demo ? '<span class="pill info">데모</span>' : `<span class="pill ${d.ai.confidence >= .7 ? 'ok' : 'warn'}">확신 ${Math.round((d.ai.confidence || 0) * 100)}%</span>`}</div>
        ${d.ai.notes ? `<p style="margin:0">${esc(d.ai.notes)}</p>` : ''}
        ${d.ai.basis ? `<p class="muted small" style="margin:0">구분 근거: ${esc(d.ai.basis)}</p>` : ''}
        ${Array.isArray(d.ai.others) && d.ai.others.length ? `<p class="muted small" style="margin:0">함께 보여요: ${esc(d.ai.others.map((o) => (o.name || '') + (o.count ? ' ' + o.count + '개' : '')).join(', '))}. 따로 올리려면 다시 찍어 주세요.</p>` : ''}
        <h3>품목</h3>
        <div class="chips">${Object.entries(SP).sort(([a], [b]) => A.isSpecial(myRegion(), b) - A.isSpecial(myRegion(), a)).map(([k, v]) => `<button type="button" class="chip" data-act="d-species" data-v="${k}" aria-pressed="${k === d.species}">${k === 'other' ? '기타 (직접 입력)' : (A.isSpecial(myRegion(), k) ? '★ ' : '') + esc(v.ko)}</button>`).join('')}</div>
        <p class="muted small" style="margin:0">★ = ${esc(regionName(myRegion()))} 특산품. 손님 화면에서 추천으로 먼저 보여요.</p>
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
          <button type="button" class="chip" data-act="d-ask" data-v="off" aria-pressed="${d.askPerKg == null}">채팅으로 정하기</button>
        </div>
        ${d.askPerKg != null ? `
          <div class="price num">${won(d.askPerKg).replace('원', '')}<small>원 / kg</small></div>
          <div class="row"><button type="button" class="btn sm" data-act="d-adj" data-v="-1000">1,000원 내리기</button><button type="button" class="btn sm" data-act="d-adj" data-v="1000">1,000원 올리기</button></div>` : ''}
        <p class="muted small" style="margin:0">${ref ? `추천 값은 kg당 ${won(ref)}이에요. ${esc(A.marketNote(d.species, d.variety))}${esc(A.regionNote(myRegion(), d.species))} 값은 손님과 직접 정하셔도 돼요.` : esc(A.marketNote(d.species, d.variety))}</p>
      </section>
      <section class="card">
        <div class="row between"><div class="eyebrow">홍보 글</div><button type="button" class="btn sm" data-act="rewrite" ${d.rewriting ? 'disabled' : ''}>${d.rewriting ? '쓰는 중…' : 'AI가 다시 쓰기'}</button></div>
        <label class="field" for="promo">손님에게 보일 글 (고쳐도 돼요)<textarea id="promo" rows="6">${esc(d.promo)}</textarea></label>
      </section>
      <section class="card">
        <div class="eyebrow">손님에게 보이는 나</div>
        <div class="kv"><span><b>${esc(ME_ALIAS)}</b></span><span>${esc(regionName(myRegion()))} 해녀</span>${ui.me.hours ? `<span>판매 시간 <b>${esc(ui.me.hours)}</b></span>` : ''}</div>
        <p class="muted small" style="margin:0">🔒 이름과 전화번호는 손님에게 보이지 않아요. 손님은 채팅으로만 연락해요.</p>
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
      ${mine.length ? mine.map((p, i) => postCard(p, true, i)).join('') : '<div class="empty">아직 올린 글이 없어요. 올리기에서 사진을 찍어 보세요.</div>'}
      <button type="button" class="btn sm" data-act="reset">게시판을 예시 글로 되돌리기</button>`;
  }

  /* ---------- 해녀: 체험 ---------- */
  function hExp() {
    const mine = S.programs.filter((p) => p.ownerId === DEV);
    return `<h1>체험 알리기</h1>
      <p class="muted" style="margin:0">물질 체험, 해녀 밥상 같은 프로그램을 알리면 손님이 채팅으로 날짜를 물어봐요.</p>
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
      <section class="card">
        <div class="eyebrow">손님에게 보이는 이름</div>
        <div class="alias-big">${esc(ME_ALIAS)}</div>
        <p class="muted small" style="margin:0">🔒 삼촌 이름과 전화번호는 해녀바당에 저장하지 않고 손님에게도 보이지 않아요. 손님과는 채팅으로만 이야기해요.</p>
      </section>
      <section class="card">
        <label class="field">지역 <span class="muted small" style="font-weight:400">특산품 추천·지역 물가에 써요</span><select id="me-region">${Object.entries(A.REGIONS).map(([k, r]) => `<option value="${k}"${k === myRegion() ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
        <label class="field">판매 시간 <span class="muted small" style="font-weight:400">선택, 손님에게 보여요</span><input type="text" id="me-hours" value="${esc(m.hours || '')}" placeholder="물질 끝나고 오후 3~5시"></label>
        <button type="button" class="btn primary big" data-act="me-save">저장</button>
      </section>`;
  }

  /* ---------- 손님: 해산물 ---------- */
  function cMarket() {
    const kinds = [...new Set(S.posts.map((p) => p.species))];
    const R = ui.region, here = (p) => (p.author.region || A.regionOf(p.author.village)) === R;
    // 순서: 먼저 보기 → 우리 지역 특산품 → 우리 지역 → 다른 지역 → 다 팔린 것
    const rank = (p) => (isEarly(p) && canSeeEarly(p) ? 0 : p.status === 'sold' ? 9 : here(p) ? (A.isSpecial(R, p.species) ? 1 : 2) : 3);
    const list = S.posts.filter((p) => ui.filter === 'all' || p.species === ui.filter)
      .sort((a, b) => rank(a) - rank(b) || new Date(b.createdAt) - new Date(a.createdAt));
    const specials = (A.REGIONS[R] || { specials: [] }).specials.map(([k, v]) => {
      const n = S.posts.filter((p) => p.species === k && p.status !== 'sold' && here(p)).length;
      return n
        ? `<button type="button" class="sp-chip on" data-act="filter" data-v="${k}"><b>${esc(A.label(k, v))}</b><span>${n}건 있어요</span></button>`
        : `<button type="button" class="sp-chip" data-act="sp-resv" data-v="${esc(A.label(k, v))}"><b>${esc(A.label(k, v))}</b><span>📅 예약</span></button>`;
    }).join('');
    const arrived = myWants().filter((w) => w.matchedPostId).length;
    const today = new Date(), mmdd = String(today.getMonth() + 1).padStart(2, '0') + '.' + String(today.getDate()).padStart(2, '0');
    return `<section class="hero">
        <div class="row between" style="align-items:center;flex-wrap:nowrap">
          <div class="issue"><i>${mmdd}</i>${esc(regionName(R))} 해녀가 직접 알려요</div>
          <button type="button" class="cal-btn" data-act="open-resv" aria-label="먼저 보기 예약${myWants().length ? ', 예약 ' + myWants().length + '개' : ''}" title="먼저 보기 예약"><span aria-hidden="true">📅</span>${arrived ? `<span class="badge num">${arrived}</span>` : myWants().length ? '<i class="cal-dot"></i>' : ''}</button>
        </div>
        <h1>오늘,<br>바다에서<br><em>왔습니다.</em></h1>
        <p class="lede">해녀 삼촌이 숨 참고 따 온 해산물을 사진 그대로 알려 드려요. 이름·전화번호 없이 채팅으로 주문하세요.</p>
        <div class="trust"><span>수수료 <b>0원</b></span><span>익명 채팅</span><span>직접 거래</span></div>
        ${coverArt}
      </section>
      <div class="region-bar"><span class="muted small">지역</span>${Object.entries(A.REGIONS).map(([k, r]) => `<button type="button" class="chip" data-act="region" data-v="${k}" aria-pressed="${k === R}">${esc(r.name)}</button>`).join('')}<button type="button" class="chip" data-act="geo">📍 내 위치</button></div>
      <section class="card special"><div class="eyebrow">★ ${esc(regionName(R))} 특산품 추천</div><div class="sp-grid">${specials}</div><p class="muted small" style="margin:0">있는 건 눌러서 보고, 없는 건 예약해 두면 올라올 때 먼저 보여 드려요.</p></section>
      <div class="chips"><button type="button" class="chip" data-act="filter" data-v="all" aria-pressed="${ui.filter === 'all'}">전체</button>${kinds.map((k) => `<button type="button" class="chip" data-act="filter" data-v="${k}" aria-pressed="${ui.filter === k}">${esc(SP[k].ko)}</button>`).join('')}</div>
      ${list.length ? list.map((p, i) => (isEarly(p) && !canSeeEarly(p) ? teaser(p) : postCard(p, false, i))).join('') : '<div class="empty">아직 올라온 해산물이 없어요. 물질 끝나는 오후에 다시 봐 주세요.</div>'}`;
  }

  /* ---------- 손님: 먼저 보기 예약 ---------- */
  function cReserve() {
    const r = ui.rv, mine = myWants();
    return `<button type="button" class="btn sm" data-act="close-resv" style="align-self:flex-start">← 해산물로 돌아가기</button>
      <div class="stack"><div class="eyebrow">📅 먼저 보기 예약</div><h1>원하는 해산물을<br>미리 예약하세요</h1>
      <p class="muted" style="margin:0">예약한 해산물이 올라오면 다른 손님보다 ${A.EARLY_MIN}분 먼저 볼 수 있어요. 해녀에게는 <b>${esc(ME_ALIAS)}</b>(으)로만 보이고, 삼촌이 채팅으로 먼저 연락할 수 있어요. 돈은 내지 않아요.</p></div>
      <section class="card">
        <label class="field" for="rv-text">무엇을 기다리세요?<textarea id="rv-text" rows="3" placeholder="예: 큰 전복 1kg, 뿔소라 조금. 주말에 받고 싶어요">${esc(r.text)}</textarea></label>
        <p class="muted small" style="margin:0" id="rv-detect">${detectLine(r.text)}</p>
        <div class="stack" style="gap:6px"><span class="muted small">빠르게 넣기 (선택) · 누르면 위 글에 들어가요</span>
        <div class="chips small-chips">${Object.entries(SP).map(([k, v]) => `<button type="button" class="chip" data-act="rv-chip" data-v="${esc(v.ko)}">${esc(v.ko)}</button>`).join('')}</div></div>
        <button type="button" class="btn primary big" data-act="rv-save">예약하기</button>
        <p class="muted small" style="margin:0">예약은 ${A.WANT_DAYS}일 동안 유지돼요. 이름과 전화번호는 받지 않아요.</p>
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
      <p class="muted" style="margin:0">해녀 삼촌들이 직접 진행해요. 물때와 바다 날씨에 따라 날짜가 바뀌니 채팅으로 물어보세요.</p>
      ${S.programs.length ? S.programs.map((p) => `<div class="card">
        <div class="row between"><h2>${esc(p.title)}</h2>${p.example ? '<span class="pill info">예시</span>' : ''}</div>
        <p style="margin:0">${esc(p.desc)}</p>
        <div class="kv">${p.price ? `<span>1인 <b>${won(p.price)}</b></span>` : ''}${p.times ? `<span>${esc(p.times)}</span>` : ''}${p.season ? `<span>${esc(p.season)}</span>` : ''}</div>
        ${chatBox({ type: 'program', id: p.id }, p.title, p.ownerId, p.author, null)}
      </div>`).join('') : '<div class="empty">아직 알린 체험이 없어요.</div>'}`;
  }

  /* ---------- 탭 ---------- */
  const TABS = {
    h: [
      { id: 'upload', label: '올리기', icon: I.camera, view: hUpload },
      { id: 'mine', label: '내 글', icon: I.list, view: hMine, badge: () => S.posts.filter((p) => p.ownerId === DEV && p.status !== 'sold').length },
      { id: 'chat', label: '채팅', icon: I.chat, view: chatView, badge: unreadAll },
      { id: 'exp', label: '체험', icon: I.people, view: hExp },
      { id: 'me', label: '내 정보', icon: I.user, view: hMe }
    ],
    c: [
      { id: 'market', label: '해산물', icon: I.shop, view: cMarket, badge: () => S.posts.filter((p) => p.status !== 'sold').length },
      { id: 'chat', label: '채팅', icon: I.chat, view: chatView, badge: unreadAll },
      { id: 'exp', label: '체험', icon: I.people, view: cExp }
    ]
  };
  const HIDDEN = {
    c: [{ id: 'reserve', view: cReserve }]
  };

  function render() {
    if (!S) return;
    document.body.classList.toggle('haenyeo', ui.role === 'h');
    $('#account').innerHTML = `<span class="who"><b>${esc(ME_ALIAS)}</b><span>${IS_HAENYEO ? '해녀' : '손님'} · 익명</span></span><button type="button" class="btn" data-act="logout">로그아웃</button>`;
    $('#mode').innerHTML = `<span><i class="dot ${CONFIG.gemini ? 'on' : ''}"></i>사진 판별 ${CONFIG.gemini ? 'Gemini' : '데모'}</span><span><i class="dot ${CONFIG.priceN ? 'on' : ''}"></i>시세 ${CONFIG.priceN ? 'aT ' + CONFIG.priceN + '품목' : '기본 참고가'}</span>${CONFIG.regionN ? `<span><i class="dot on"></i>지역 물가 ${CONFIG.regionN}곳</span>` : ''}<span><i class="dot ${CONFIG.shared ? 'on' : ''}"></i>${CONFIG.shared ? '모든 손님에게 공유' : '이 기기에만 저장'}</span>`;
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
      const [big, small] = await Promise.all([shrink(file, 896, 0.8), shrink(file, 480, 0.65)]);   // 판별용은 조금 작게 해서 빠르게
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
      d.askPerKg = A.refPrice(rp(d)) || null;
      d.promo = ai.promo || A.promo(Object.assign({ author: myAuthor() }, d));
    } catch (e) { d.status = 'error'; d.error = e.message; }
    render();
  }
  // AI에게 홍보 글을 새로 쓰게 함 (Gemini가 없으면 다른 틀로)
  async function rewrite() {
    const d = ui.draft;
    const ta = $('#promo'); if (ta) d.promo = ta.value;
    if (!CONFIG.gemini) { d.variant++; d.promo = A.promo(Object.assign({ author: myAuthor() }, d), d.variant); render(); return; }
    d.rewriting = true; render();
    const prompt = `제주 해녀가 직접 잡은 해산물 홍보 글을 새로 써라.
품목: ${A.label(d.species, d.variety)}, 등급: ${d.grade}, 신선도: ${d.freshness}, 양: ${d.weightKg}kg, 지역: ${regionName(myRegion())} 앞바다, 받는 곳: 채팅으로 정함, 판매 시간: ${ui.me.hours || '없음'}.
익명 게시판이라 해녀 이름·마을 이름·전화번호는 절대 쓰지 말고 "해녀 삼촌"이라고만 쓴다. 연락은 "채팅"으로 하라고 쓴다.
홍보 글 규칙: 카카오톡 단체방·밴드에 올릴 진짜 홍보 글처럼 쓴다.
1줄: 【】 안에 눈길 끄는 한 줄 (15자 안팎, 예: 【오늘 아침 막 올라온 홍해삼】, 【양식 아니고, 해녀가 직접 땄어요】)
2~3줄: 누가 어디서 언제 잡았는지 + 맛·식감·향 같은 감각 표현 + 어떻게 먹으면 좋은지 한 가지. 해녀 어르신의 따뜻한 구어체("~요").
마지막 줄: 양 한정이나 오늘만이라는 이유로 지금 연락하게 만드는 한 줄.
이모지는 많아야 1개. "신선한 해산물을 만나보세요", "최고의 품질" 같은 뻔한 광고 문구와 "몸에 좋아요", "OO 예방" 같은 효능 주장은 쓰지 않는다. 가격과 전화번호는 넣지 않는다(앱이 따로 붙임).
이전 글과 첫 줄과 표현을 다르게 써라: "${d.promo}"
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
      d.variant++; d.promo = A.promo(Object.assign({ author: myAuthor() }, d), d.variant);
      toast('AI가 쓰지 못해서 기본 글로 바꿨어요.');
    }
    d.rewriting = false; render();
  }

  function keepRv() {
    if ($('#rv-text')) ui.rv.text = $('#rv-text').value;
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
    if (e.target.id === 'other-name') { const d = ui.draft; d.variety = e.target.value.trim() || null; if (d.askPerKg != null) d.askPerKg = A.refPrice(rp(d)) || d.askPerKg; d.promo = A.promo(Object.assign({ author: myAuthor() }, d), d.variant); render(); }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'promo') ui.draft.promo = e.target.value;
    if (e.target.id === 'other-name') ui.draft.variety = e.target.value.trim() || null;
    if (e.target.id === 'rv-text') { ui.rv.text = e.target.value; $('#rv-detect').innerHTML = detectLine(e.target.value); }
    if (e.target.id === 'rev-text') ui.rev.text = e.target.value;
    if (e.target.id === 'chat-text') ui.chat.draft = e.target.value;
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, v = b.dataset.v, d = ui.draft;
    switch (act) {
      case 'logout': try { localStorage.removeItem('haenyeo_session'); } catch { /* 저장 안 되는 환경 */ } location.reload(); break;
      case 'tab': ui.tab[ui.role] = v; ui.delArm = null; if (v === 'chat') Object.assign(ui.chat, { id: null, pending: null }); render(); window.scrollTo(0, 0); break;
      case 'filter': ui.filter = v; render(); break;
      case 'dismiss-post': ui.lastPost = null; render(); break;
      case 'retake': ui.draft = { status: 'idle' }; render(); break;
      case 'd-variety': d.variety = v || null; d.promo = A.promo(Object.assign({ author: myAuthor() }, d), d.variant); render(); break;
      case 'd-species': d.variety = null; d.species = v; if (d.askPerKg != null) d.askPerKg = A.refPrice(rp(d)); d.promo = A.promo(Object.assign({ author: myAuthor() }, d), d.variant); render(); break;
      case 'd-grade': d.grade = v; if (d.askPerKg != null) d.askPerKg = A.refPrice(rp(d)); render(); break;
      case 'd-fresh': d.freshness = v; if (d.askPerKg != null) d.askPerKg = A.refPrice(rp(d)); render(); break;
      case 'd-w': d.weightKg = Math.max(0.5, Math.round((d.weightKg + +v) * 10) / 10); render(); break;
      case 'd-ask': d.askPerKg = v === 'on' ? (A.refPrice(rp(d)) || 10000) : null; render(); break;
      case 'd-adj': d.askPerKg = Math.max(1000, d.askPerKg + +v); render(); break;
      case 'rewrite': run(rewrite); break;
      case 'publish': {
        const ta = $('#promo'); if (ta) d.promo = ta.value.trim();
        if (d.species === 'other' && !d.variety) { toast('해산물 이름을 적어 주세요.'); break; }
        b.disabled = true;
        run(async () => {
          const p = await mutate((s) => {
            const post = {
              id: A.uid('p'), ownerId: DEV, author: myAuthor(),
              species: d.species, variety: d.variety || null, grade: d.grade, freshness: d.freshness, weightKg: d.weightKg,
              refPerKg: A.refPrice(rp(d)), refLive: A.basePerKg(d.species, d.variety).live, askPerKg: d.askPerKg, photo: d.photo || null,
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
        const m = { region: $('#me-region').value, hours: $('#me-hours').value.trim() };
        ui.me = m; store.set(ME_KEY, m); toast('저장했어요. 다음에 올리는 글부터 이 정보가 보여요.');
        ui.tab.h = ui.draft.status === 'ready' ? 'upload' : 'me'; render();
        break;
      }
      case 'region': ui.region = v; ui.filter = 'all'; store.set('hb2-region', v); render(); break;
      case 'geo':
        if (!navigator.geolocation) { toast('이 기기는 위치를 알 수 없어요. 지역을 직접 골라 주세요.'); break; }
        toast('위치를 확인하고 있어요');
        navigator.geolocation.getCurrentPosition((pos) => { ui.region = A.nearestRegion(pos.coords.latitude, pos.coords.longitude); store.set('hb2-region', ui.region); ui.filter = 'all'; render(); toast(regionName(ui.region) + ' 특산품을 보여 드릴게요.'); },
          () => toast('위치를 못 가져왔어요. 지역을 직접 골라 주세요.'), { timeout: 8000 });
        break;
      case 'sp-resv': ui.rv.text = v + ' '; ui.tab.c = 'reserve'; render(); window.scrollTo(0, 0); break;
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
        const chk = cleanMsg(text); if (!chk.ok) { toast(chk.reason); break; }
        run(async () => {
          await mutate((s) => {
            s.wants.unshift({ id: A.uid('w'), ownerId: DEV, alias: ME_ALIAS, text: chk.text, species: A.detect(text), createdAt: new Date().toISOString(), matchedPostId: null });
          });
          const hit = A.detect(text);
          ui.rv.text = ''; render();
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
        const pg = { id: A.uid('pg'), ownerId: DEV, author: myAuthor(), title: t, desc: $('#pg-desc').value.trim(), price: +$('#pg-price').value || null, times: $('#pg-times').value.trim(), season: $('#pg-season').value.trim() };
        run(async () => { await mutate((s) => { s.programs.unshift(pg); }); ui.newProg = false; render(); toast('체험을 알렸어요.'); });
        break;
      }
      case 'pg-del': run(() => mutate((s) => { s.programs = s.programs.filter((x) => x.id !== b.dataset.id); })); break;
      /* 채팅 */
      case 'chat-start': openChat({ type: b.dataset.type, id: b.dataset.id }); break;
      case 'chat-want': openChat({ type: 'want', id: b.dataset.id }); break;
      case 'chat-open': {
        const c = S.chats.find((x) => x.id === b.dataset.id); if (!c) break;
        Object.assign(ui.chat, { id: c.id, pending: null, draft: '' });
        markSeen(c); render(); window.scrollTo(0, document.body.scrollHeight); break;
      }
      case 'chat-back': Object.assign(ui.chat, { id: null, pending: null, draft: '' }); render(); window.scrollTo(0, 0); break;
      case 'chat-quick': ui.chat.draft = v; render(); { const ta = $('#chat-text'); if (ta) ta.focus(); } break;
      case 'chat-send': {
        const ta = $('#chat-text'); if (ta) ui.chat.draft = ta.value;
        const chk = cleanMsg(ui.chat.draft); if (!chk.ok) { toast(chk.reason); break; }
        b.disabled = true;
        run(async () => { await sendMsg({ text: chk.text }); ui.chat.draft = ''; render(); window.scrollTo(0, document.body.scrollHeight); })
          .finally(() => { b.disabled = false; });
        break;
      }
      /* 후기 */
      case 'rev-open':
        if (ui.rev.postId === b.dataset.id) ui.rev.postId = null;
        else Object.assign(ui.rev, { postId: b.dataset.id, stars: 5, text: '', busy: false, msg: null });
        render(); break;
      case 'rev-star': ui.rev.stars = +v; render(); break;
      case 'rev-use': if (ui.rev.msg && ui.rev.msg.suggestion) { ui.rev.text = ui.rev.msg.suggestion; ui.rev.msg = null; render(); } break;
      case 'rev-save': {
        const p = S.posts.find((x) => x.id === b.dataset.id); if (!p) break;
        const f = ui.rev;
        f.text = String(f.text || '').trim();
        if (f.text.length < 5) { toast('후기를 조금 더 적어 주세요.'); break; }
        f.busy = true; f.msg = null; render();
        run(async () => {
          const res = await moderate(f.text, f.stars, A.label(p.species, p.variety));
          if (!res.ok) { f.msg = res; return; }
          await mutate((s) => {
            s.reviews.unshift({ id: A.uid('r'), ownerId: DEV, postId: p.id, seller: p.ownerId, species: p.species, stars: f.stars, text: A.maskPhone(f.text), alias: ME_ALIAS, createdAt: new Date().toISOString(), checked: res.by });
            s.reviews = s.reviews.slice(0, 200);
          });
          f.text = ''; f.stars = 5;
          toast('후기를 올렸어요. 고마워요!');
        }).finally(() => { f.busy = false; render(); });
        break;
      }
    }
  });

  // 채팅 화면을 보고 있으면 5초마다 새 글을 받아옴 (공유 게시판일 때, 입력 중이면 건너뜀)
  setInterval(() => {
    if (!CONFIG.shared || ui.tab[ui.role] !== 'chat') return;
    const busy = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (busy) return;
    fetchShared().then((d) => {
      if (!d || d.v !== 2) return;
      const before = JSON.stringify(S.chats); S = norm(d);
      if (JSON.stringify(S.chats) !== before) { const c = S.chats.find((x) => x.id === ui.chat.id); if (c) markSeen(c); render(); }
    }).catch(() => {});
  }, 5000);

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
    // 지역 물가 계수 (aT 지역별 가격)
    if (CONFIG.price) {
      fetch('/api/region', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((j) => { if (j) { CONFIG.regionN = A.setRegionIndex(j); render(); } }).catch(() => {});
    }
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
