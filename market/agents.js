/*
 * 해녀바당 홍보 게시판 에이전트 로직
 * - 품목 판별은 서버(Gemini)가, 참고 시세와 홍보 글 기본 틀은 여기서 만든다
 * - 거래(주문·결제·배송)는 하지 않는다. 손님이 해녀에게 직접 연락한다
 */
(function (root) {
  'use strict';

  // 참고 시세(원/kg). 실제 시세 API가 없을 때 쓰는 예시 값
  const SPECIES = {
    abalone:     { ko: '전복',       refPerKg: 38000 },
    obunjagi:    { ko: '오분자기',   refPerKg: 60000 },
    turban:      { ko: '소라',       refPerKg: 12000 },
    octopus:     { ko: '문어',       refPerKg: 22000 },
    seacucumber: { ko: '해삼',       refPerKg: 26000 },
    urchinroe:   { ko: '성게알',     refPerKg: 150000 },
    urchin:      { ko: '성게(통)',   refPerKg: 20000 },
    seaweed:     { ko: '미역',       refPerKg: 6000 },
    hijiki:      { ko: '톳',         refPerKg: 5000 },
    agar:        { ko: '우뭇가사리', refPerKg: 9000 },
    bomal:       { ko: '보말',       refPerKg: 15000 },
    mussel:      { ko: '홍합(섭)',   refPerKg: 8000 },
    oyster:      { ko: '굴',         refPerKg: 15000 },
    seasquirt:   { ko: '멍게',       refPerKg: 9000 },
    sealhare:    { ko: '군소',       refPerKg: 10000 },
    barnacle:    { ko: '거북손',     refPerKg: 20000 },
    gulfweed:    { ko: '모자반',     refPerKg: 4000 },
    ecklonia:    { ko: '감태',       refPerKg: 5000 }
  };
  // 세부 품종: AI가 사진에서 이 중 하나로 구분 (목록에 없으면 보이는 대로 한국어 이름)
  const VARIETIES = {
    abalone: ['참전복', '까막전복', '말전복', '시볼트전복'],
    turban: ['뿔소라', '민소라'],
    octopus: ['돌문어(참문어)', '대문어(피문어)', '왜문어'],
    seacucumber: ['홍해삼', '청해삼', '흑해삼'],
    urchinroe: ['보라성게알', '말똥성게알'],
    urchin: ['보라성게', '말똥성게', '둥근성게'],
    seaweed: ['돌미역(자연산)', '양식 미역'],
    bomal: ['밤고둥', '팽이고둥', '눈알고둥', '울타리고둥'],
    mussel: ['참홍합(섭)', '진주담치'],
    oyster: ['참굴', '바위굴'],
    seasquirt: ['붉은멍게', '돌멍게'],
    sealhare: ['군소', '검은군소'],
    gulfweed: ['참모자반(몸)', '괭생이모자반']
  };
  // 화면에 보일 이름: 세부 품종이 품목 이름을 품으면 그대로(홍해삼), 아니면 함께(보말 · 밤고둥)
  function label(species, variety) {
    const ko = (SPECIES[species] || {}).ko || '해산물';
    if (!variety) return ko;
    const base = ko.replace(/\(.*\)/, '');
    return variety.includes(base) ? variety : ko + ' · ' + variety;
  }
  const GRADES = { '특': 1.2, '상': 1.0, '중': 0.85 };
  const FRESH = { '최상': 1.05, '좋음': 1, '보통': 0.95 };
  const MAX_POSTS = 20;
  const EARLY_MIN = 30;        // 예약 손님이 먼저 보는 시간(분)
  const WANT_DAYS = 14;        // 예약은 14일 지나면 자동으로 지움

  const uid = (p) => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const round100 = (n) => Math.round(n / 100) * 100;
  const iso = (d) => new Date(d).toISOString();
  const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1); return (c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28) ? a : b; };

  // aT 「최근일자 도·소매가격」에서 받은 실제 시세 (품목별 도매·소매 kg당 가격)
  const MARKET = {};
  const PRICE_NAMES = {
    abalone: ['전복'], obunjagi: ['오분자기'], turban: ['소라'], octopus: ['문어'], seacucumber: ['해삼'],
    urchinroe: ['성게'], urchin: ['성게'], seaweed: ['미역'], hijiki: ['톳'], agar: ['우뭇가사리', '우무'],
    oyster: ['굴'], mussel: ['홍합'], seasquirt: ['멍게']
  };
  const SKIP = /(건|마른|젓|액젓|냉동|수입|염장|조미|가공)/;   // 말린 것·가공품은 생물 가격과 달라서 뺌
  const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  function setMarket(rows) {
    Object.keys(MARKET).forEach((k) => delete MARKET[k]);
    for (const [k, names] of Object.entries(PRICE_NAMES)) {
      const cand = (rows || []).filter((r) => {
        const t = (r.item || '') + ' ' + (r.kind || '');
        return r.perKg && names.some((n) => t.includes(n)) && !SKIP.test(t);
      });
      if (!cand.length) continue;
      const ws = cand.filter((r) => /도매/.test(r.se || '') || String(r.seCd) === '02');
      const rt = cand.filter((r) => /소매/.test(r.se || '') || String(r.seCd) === '01');
      MARKET[k] = { wholesale: median(ws.map((r) => r.perKg)), retail: median(rt.map((r) => r.perKg)), any: median(cand.map((r) => r.perKg)), date: cand[0].date || null };
    }
    return Object.keys(MARKET).length;
  }
  // 직거래 기준가: 도매가 있으면 도매 × 1.15(해녀 몫), 소매만 있으면 소매 × 0.9(손님도 이득), 없으면 예시 참고가
  function basePerKg(species) {
    const m = MARKET[species], sp = SPECIES[species];
    if (m && m.wholesale) return { v: m.wholesale * 1.15, live: true };
    if (m && m.retail) return { v: m.retail * 0.9, live: true };
    if (m && m.any) return { v: m.any, live: true };
    return { v: sp ? sp.refPerKg : 0, live: false };
  }
  function marketNote(species) {
    const m = MARKET[species];
    const won = (n) => Math.round(n / 100) * 100;
    if (!m) return '기본 참고가(예시 값)예요. 오늘 aT 시세에 이 품목이 없어요.';
    const d = m.date ? String(m.date).replace(/^(\d{4})-?(\d\d)-?(\d\d).*/, '$2/$3') + ' ' : '';
    const parts = [];
    if (m.wholesale) parts.push('도매 kg당 ' + won(m.wholesale).toLocaleString('ko-KR') + '원');
    if (m.retail) parts.push('소매 kg당 ' + won(m.retail).toLocaleString('ko-KR') + '원');
    if (!parts.length) parts.push('kg당 ' + won(m.any).toLocaleString('ko-KR') + '원');
    return 'aT ' + d + '시세: ' + parts.join(', ') + (m.wholesale ? '. 도매가보다 15% 높게 잡아 해녀님 몫을 늘렸어요.' : '.');
  }
  function refPrice({ species, grade, freshness }) {
    if (!SPECIES[species]) return 0;
    return round100(basePerKg(species).v * (GRADES[grade] || 1) * (FRESH[freshness] || 1));
  }

  // AI가 없을 때 쓰는 홍보 글 틀
  function promo({ species, variety, grade, freshness, weightKg, author }, variant) {
    const ko = label(species, variety);
    const who = author && author.name ? author.name.replace(/\(예시\)/, '') + ' 해녀' : '해녀';
    const where = author && author.village ? author.village.replace(/ 어촌계$/, '') + ' 바다' : '제주 바다';
    const fresh = freshness === '최상' ? '방금 건져 올려 펄떡펄떡 살아 있어요' : freshness === '보통' ? '오늘 안에 드시면 좋아요' : '오늘 물질해서 아주 싱싱해요';
    const v = [
      `오늘 ${where}에서 ${who}가 직접 물질해 온 ${ko}${josa(ko, '이에요', '예요')}. ${fresh}. ${grade}등급으로 ${weightKg}kg 있어요. 필요하신 분은 편하게 연락 주세요.`,
      `${ko} 들어왔어요! ${who}가 숨 참고 한 개 한 개 따온 ${grade}등급 ${ko}${josa(ko, '이에요', '예요')}. ${fresh}. 양이 많지 않으니 먼저 연락 주시는 분께 드릴게요.`,
      `${where} 맑은 물에서 자란 ${ko}${josa(ko, '을', '를')} ${who}가 오늘 잡았어요. 중간 상인 없이 해녀에게 바로 사시는 거라 더 싱싱하고 정직해요. ${weightKg}kg, 전화나 문자 주세요.`
    ];
    return v[(variant || 0) % v.length];
  }

  // 손님이 직접 적은 글에서 해산물을 알아봄 (예: "뿔소라 2kg" → 소라)
  const ALIASES = {
    abalone: ['전복'], obunjagi: ['오분자기', '떡조개'], turban: ['소라', '뿔소라'],
    octopus: ['문어', '돌문어', '참문어', '피문어'], seacucumber: ['해삼'],
    urchinroe: ['성게알', '성게 알', '우니', '성게'], urchin: ['통성게', '성게(통)', '성게 통'],
    seaweed: ['미역'], hijiki: ['톳'], agar: ['우뭇가사리', '우무', '천초'],
    bomal: ['보말', '고둥', '고매기'], mussel: ['홍합', '섭', '담치'], oyster: ['굴'], seasquirt: ['멍게', '우렁쉥이'],
    sealhare: ['군소'], barnacle: ['거북손'], gulfweed: ['모자반', '몸국'], ecklonia: ['감태']
  };
  function detect(text) {
    const t = String(text || '');
    const hit = Object.keys(ALIASES).filter((k) => ALIASES[k].some((a) => t.includes(a)));
    // "통성게"를 적었으면 성게알로 따로 잡지 않음
    if (hit.includes('urchin') && hit.includes('urchinroe') && !/성게\s?알|우니/.test(t)) return hit.filter((k) => k !== 'urchinroe');
    return hit;
  }

  const EXAMPLE_ME = { name: '김순덕(예시)', village: '하도 어촌계', phone: '010-0000-0000', place: '하도 어촌계 해녀 판매장', hours: '물질 끝나고 오후 3~5시' };

  function seed() {
    const now = Date.now();
    const h = (n) => iso(now - n * 3600 * 1000);
    const a1 = Object.assign({}, EXAMPLE_ME);
    const a2 = { name: '고옥자(예시)', village: '종달 어촌계', phone: '010-0000-0001', place: '종달리 포구 앞', hours: '오전 11시~오후 2시' };
    const mk = (author, species, grade, freshness, weightKg, ask, hrs, status) => ({
      id: uid('p'), ownerId: 'seed', example: true, author, species, grade, freshness, weightKg,
      refPerKg: refPrice({ species, grade, freshness }), askPerKg: ask, photo: null,
      promo: promo({ species, grade, freshness, weightKg, author }, hrs), createdAt: h(hrs), status: status || 'open'
    });
    return {
      v: 2,
      posts: [
        mk(a1, 'abalone', '특', '최상', 3, 45000, 1),
        mk(a2, 'turban', '상', '좋음', 5, 13000, 2),
        mk(a1, 'seaweed', '상', '좋음', 4, null, 5),
        mk(a2, 'octopus', '상', '좋음', 1.5, 25000, 26, 'sold')
      ],
      wants: [
        { id: 'w-seed1', ownerId: 'seed', example: true, name: '박지은(예시)', phone: '010-0000-0002', text: '성게알 0.5kg 정도, 주말에 받고 싶어요', species: ['urchinroe'], createdAt: h(20), matchedPostId: null },
        { id: 'w-seed2', ownerId: 'seed', example: true, name: '이도윤(예시)', phone: '', text: '돌문어 큰 걸로 한 마리', species: ['octopus'], createdAt: h(9), matchedPostId: null }
      ],
      programs: [
        { id: 'pg1', ownerId: 'seed', example: true, author: a1, title: '해녀와 함께하는 물질 체험', desc: '해녀 삼촌에게 테왁 잡는 법과 숨 고르는 법을 배우고 얕은 바다에서 소라를 직접 찾아봐요.', price: 70000, times: '오전 10시, 오후 2시 (2시간)', season: '5~10월, 물때와 날씨에 따라 쉬어요' },
        { id: 'pg2', ownerId: 'seed', example: true, author: a2, title: '불턱 이야기와 해녀 밥상', desc: '물질 뒤 몸을 녹이던 불턱에 둘러앉아 해녀 이야기를 듣고, 그날 잡은 해산물로 차린 밥상을 함께 먹어요.', price: 45000, times: '낮 12시, 저녁 5시 30분 (1시간 30분)', season: '사계절' }
      ]
    };
  }

  const api = { label, VARIETIES, detect, ALIASES, SPECIES, GRADES, FRESH, MAX_POSTS, EARLY_MIN, WANT_DAYS, EXAMPLE_ME, uid, refPrice, promo, seed, setMarket, marketNote, basePerKg, MARKET };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Agents = api;
})(typeof window !== 'undefined' ? window : globalThis);
