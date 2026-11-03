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
    ecklonia:    { ko: '감태',       refPerKg: 5000 },
    other:       { ko: '기타',       refPerKg: 0 }        // 목록에 없는 해산물: 이름은 variety에
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
    if (species === 'other') return variety || '기타 해산물';
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
  let MARKET_ROWS = [];
  const PRICE_NAMES = {
    abalone: ['전복'], obunjagi: ['오분자기'], turban: ['소라'], octopus: ['문어'], seacucumber: ['해삼'],
    urchinroe: ['성게'], urchin: ['성게'], seaweed: ['미역'], hijiki: ['톳'], agar: ['우뭇가사리', '우무'],
    oyster: ['굴'], mussel: ['홍합'], seasquirt: ['멍게']
  };
  // 말린 것·가공품·깐 것(깐홍합)은 껍데기째 파는 생물 가격과 달라서 뺌 ("안깐홍합"은 남김)
  const SKIP = /(건|마른|젓|액젓|냉동|수입|염장|조미|가공|(^|\s)깐)/;
  const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  function summarize(names) {
    const cand = MARKET_ROWS.filter((r) => {
      const t = (r.item || '') + ' ' + (r.kind || '');
      return r.perKg && names.some((n) => n && t.includes(n)) && !SKIP.test(t);
    });
    if (!cand.length) return null;
    const ws = cand.filter((r) => /도매/.test(r.se || '') || String(r.seCd) === '02');
    const rt = cand.filter((r) => /소매/.test(r.se || '') || String(r.seCd) === '01');
    return { wholesale: median(ws.map((r) => r.perKg)), retail: median(rt.map((r) => r.perKg)), any: median(cand.map((r) => r.perKg)), date: cand[0].date || null };
  }
  function setMarket(rows) {
    Object.keys(MARKET).forEach((k) => delete MARKET[k]);
    MARKET_ROWS = rows || [];
    for (const [k, names] of Object.entries(PRICE_NAMES)) { const m = summarize(names); if (m) MARKET[k] = m; }
    return Object.keys(MARKET).length;
  }
  // 목록에 없는 해산물(기타)은 이름으로 시세를 찾음 (예: 갈치, 오징어)
  const marketFor = (species, variety) => species === 'other' ? (variety ? summarize([variety.replace(/\s+/g, '')]) : null) : MARKET[species];
  // 직거래 기준가: 도매가 있으면 도매 × 1.15(해녀 몫), 소매만 있으면 소매 × 0.9(손님도 이득), 없으면 예시 참고가
  function basePerKg(species, variety) {
    const m = marketFor(species, variety), sp = SPECIES[species];
    if (m && m.wholesale) return { v: m.wholesale * 1.15, live: true };
    if (m && m.retail) return { v: m.retail * 0.9, live: true };
    if (m && m.any) return { v: m.any, live: true };
    return { v: sp ? sp.refPerKg : 0, live: false };
  }
  function regionNote(region, species) {
    if (!region || !REGIONS[region]) return '';
    const own = itemFactor(region, species);
    const f = own || REGION_INDEX[region];
    if (!f) return ` ${REGIONS[region].name} 지역 물가 자료가 없어 전국 기준으로 잡았어요.`;
    const what = own ? REGIONS[region].name + ' ' + SPECIES[species].ko : REGIONS[region].name + ' 수산물';
    const pct = Math.round((f - 1) * 100);
    return ` ${what} 값이 최근 30일 전국 평균보다 ${pct === 0 ? '비슷해서 그대로' : Math.abs(pct) + '% ' + (pct > 0 ? '높아서 그만큼 올렸어요' : '낮아서 그만큼 내렸어요')}${pct === 0 ? ' 뒀어요' : ''}.`;
  }
  function marketNote(species, variety) {
    const m = marketFor(species, variety);
    const won = (n) => Math.round(n / 100) * 100;
    if (!m && species === 'other') return '이 해산물은 참고 시세가 없어요. 값은 손님과 직접 정해 주세요.';
    if (!m) return '기본 참고가(예시 값)예요. 오늘 aT 시세에 이 품목이 없어요.';
    const d = m.date ? String(m.date).replace(/^(\d{4})-?(\d\d)-?(\d\d).*/, '$2/$3') + ' ' : '';
    const parts = [];
    if (m.wholesale) parts.push('도매 kg당 ' + won(m.wholesale).toLocaleString('ko-KR') + '원');
    if (m.retail) parts.push('소매 kg당 ' + won(m.retail).toLocaleString('ko-KR') + '원');
    if (!parts.length) parts.push('kg당 ' + won(m.any).toLocaleString('ko-KR') + '원');
    return 'aT ' + d + '시세: ' + parts.join(', ') + (m.wholesale ? '. 도매가보다 15% 높게 잡아 해녀님 몫을 늘렸어요.' : '.');
  }
  function refPrice({ species, variety, grade, freshness, region }) {
    if (!SPECIES[species]) return 0;
    return round100(basePerKg(species, variety).v * (GRADES[grade] || 1) * (FRESH[freshness] || 1) * regionFactor(region, species));
  }

  // AI가 없을 때 쓰는 홍보 글 틀
  // 홍보 글: 눈길 끄는 첫 줄 → 맛·식감·누가 어디서 → 양 한정과 연락 유도
  const TASTE = {
    abalone: '쫄깃하게 씹히고 바다 향이 진해요. 회로도, 버터구이로도 좋아요',
    obunjagi: '전복보다 작아도 맛은 더 진하고 달아요',
    turban: '꼬들꼬들 씹히는 맛에 끝맛이 살짝 쌉싸름해요. 숙회로 드시면 딱이에요',
    octopus: '살짝 데치면 부드럽고 달큰해요',
    seacucumber: '오독오독 씹히는 소리부터 달라요',
    urchinroe: '입에 넣으면 녹으면서 단맛이 퍼져요',
    urchin: '갈라서 바로 떠 드시면 단맛이 진해요',
    seaweed: '미역국 끓이면 국물이 뽀얗게 우러나요',
    hijiki: '데쳐서 무치면 오독오독해요',
    agar: '삶아 굳히면 탱글한 우무가 돼요',
    bomal: '보말죽, 보말칼국수 끓이면 국물이 진하게 우러나요',
    mussel: '국물 내면 시원하고 살이 통통해요',
    oyster: '알이 굵고 비린내 없이 고소해요',
    seasquirt: '향이 진하고 끝맛이 달큰해요',
    sealhare: '데쳐서 썰면 쫀득해요',
    barnacle: '삶아서 까 먹으면 고소하고 짭조름해요',
    gulfweed: '몸국 끓이기 딱 좋아요',
    ecklonia: '쌉싸름한 향이 좋아 무침으로 그만이에요'
  };
  function promo({ species, variety, grade, freshness, weightKg, author }, variant) {
    const ko = label(species, variety);
    // 익명: 해녀 이름·마을·만나는 곳은 쓰지 않고 지역 바다만 씀
    const sea = ((author && REGIONS[author.region]) || REGIONS.jeju).name + ' 앞바다';
    const taste = TASTE[species] || '바다에서 바로 올라와 맛이 살아 있어요';
    const alive = freshness === '최상' ? '아직 살아서 꿈틀거려요' : freshness === '보통' ? '오늘 안에 드시는 걸 권해요' : '오늘 아침 물질한 거라 싱싱해요';
    const top = grade === '특' ? '큰 놈들로만 골랐어요' : grade === '상' ? '알 좋은 걸로 골랐어요' : '집에서 편하게 드시기 좋은 크기예요';
    const when = author && author.hours ? author.hours : '';
    const pickup = when ? `\n⏰ ${when}` : '';
    const v = [
      `【오늘 ${sea}에서 막 올라온 ${ko}】\n해녀 삼촌이 숨 참고 한 개 한 개 따 온 ${ko}${josa(ko, '이에요', '예요')}. ${alive}. ${taste}.\n오늘 들어온 건 ${weightKg}kg뿐이에요. 다 나가면 다음 물질 때까지 없어요.${pickup}`,
      `【양식 아니고, 해녀가 직접 땄어요】\n${sea} ${ko}, ${top}. ${taste}.\n중간 상인 없이 바다에서 바로 식탁으로 가요. 먼저 채팅 주시는 분께 드려요.${pickup}`,
      `${ko} 좋아하시는 분, 오늘이에요 🌊\n${sea} 물이 차고 맑아서 살이 꽉 찼어요. ${alive}. ${taste}.\n${weightKg}kg 한정이에요. 채팅 주시면 챙겨 둘게요.${pickup}`
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

  /* ---------- 지역: 특산품 추천과 지역 물가 ---------- */
  // 해녀가 물질하는 주요 지역과 널리 알려진 특산 해산물 (일반 정보)
  const REGIONS = {
    jeju:      { name: '제주', at: [33.38, 126.55], keys: ['제주', '서귀포'], specials: [['turban', '뿔소라'], ['obunjagi', null], ['urchinroe', '보라성게알'], ['hijiki', null], ['agar', null], ['gulfweed', '참모자반(몸)'], ['bomal', null]] },
    busan:     { name: '부산', at: [35.18, 129.08], keys: ['부산', '기장', '영도'], specials: [['seaweed', '돌미역(자연산)'], ['seasquirt', null], ['seacucumber', null], ['urchin', null]] },
    ulsan:     { name: '울산', at: [35.54, 129.31], keys: ['울산', '강동', '정자'], specials: [['seaweed', '돌미역(자연산)'], ['abalone', null], ['urchinroe', null]] },
    gyeongbuk: { name: '경북', at: [36.2, 129.37], keys: ['포항', '구룡포', '영덕', '울진', '경주', '경북', '안동'], specials: [['seaweed', '돌미역(자연산)'], ['octopus', '돌문어(참문어)'], ['urchinroe', null], ['seacucumber', null]] },
    gangwon:   { name: '강원', at: [37.75, 128.9], keys: ['강릉', '삼척', '고성', '양양', '속초', '동해', '강원', '춘천'], specials: [['mussel', '참홍합(섭)'], ['urchinroe', null], ['octopus', '대문어(피문어)'], ['abalone', null]] },
    gyeongnam: { name: '경남', at: [34.88, 128.62], keys: ['거제', '통영', '남해', '창원', '경남', '진주'], specials: [['seasquirt', null], ['oyster', null], ['seacucumber', null], ['mussel', null]] },
    jeonnam:   { name: '전남', at: [34.6, 126.9], keys: ['완도', '여수', '진도', '목포', '순천', '전남', '광주'], specials: [['abalone', null], ['hijiki', null], ['seaweed', null], ['oyster', null]] },
    chungnam:  { name: '충남', at: [36.6, 126.3], keys: ['태안', '보령', '서산', '천안', '충남', '대전'], specials: [['oyster', null], ['seacucumber', null]] }
  };
  function regionOf(text) {
    const t = String(text || '');
    if (REGIONS[t]) return t;
    return Object.keys(REGIONS).find((k) => REGIONS[k].keys.some((w) => t.includes(w)) || t.includes(REGIONS[k].name)) || null;
  }
  // 위도·경도에서 가장 가까운 지역
  function nearestRegion(lat, lon) {
    let best = null, bd = Infinity;
    for (const [k, r] of Object.entries(REGIONS)) { const d = (r.at[0] - lat) ** 2 + ((r.at[1] - lon) * Math.cos(lat * Math.PI / 180)) ** 2; if (d < bd) { bd = d; best = k; } }
    return best;
  }
  const isSpecial = (region, species) => !!(REGIONS[region] && REGIONS[region].specials.some(([k]) => k === species));
  // 지역 물가 계수: aT 지역별 수산물 소매가 ÷ 전국 평균 (서버 /api/region 이 계산). 자료가 없으면 1
  const REGION_INDEX = {};
  // 전복·굴·홍합은 aT 일별 시세로 그 품목만의 지역 계수를 씀 (aT 품목 코드)
  const ITEM_CODES = { abalone: '653', oyster: '644', mussel: '658' };
  const ITEM_INDEX = {};
  let REGION_META = null;
  const okFactor = (v) => v > 0.5 && v < 2;
  function setRegionIndex(data) {
    Object.keys(REGION_INDEX).forEach((k) => delete REGION_INDEX[k]);
    Object.keys(ITEM_INDEX).forEach((k) => delete ITEM_INDEX[k]);
    Object.entries((data && data.factors) || {}).forEach(([k, v]) => { if (REGIONS[k] && okFactor(v)) REGION_INDEX[k] = v; });
    for (const [sp, code] of Object.entries(ITEM_CODES)) {
      const it = data && data.byItem && data.byItem[code];
      if (!it) continue;
      ITEM_INDEX[sp] = {};
      Object.entries(it.factors || {}).forEach(([k, v]) => { if (REGIONS[k] && okFactor(v)) ITEM_INDEX[sp][k] = v; });
    }
    REGION_META = data || null;
    return Object.keys(REGION_INDEX).length;
  }
  const itemFactor = (region, species) => (ITEM_INDEX[species] || {})[region] || null;
  const regionFactor = (region, species) => itemFactor(region, species) || REGION_INDEX[region] || 1;

  /* ---------- 후기 검사: 욕설·일방적 비방 거르기 ---------- */
  // 1차는 여기 규칙(욕설·비하·근거 없는 범죄 단정), 2차는 서버 AI(/api/moderate)가 문맥을 봄.
  // 맛·양·신선도·응대에 대한 불만이나 낮은 별점 같은 정당한 비판은 막지 않는다.
  // 띄어쓰기·기호를 넣어 피해 가는 것(씨.발)까지 잡는 센 욕설은 기호를 뺀 글에서도 찾고,
  // 뜻이 여럿인 말은 원래 글에서만 찾음 ("불이 꺼져", "죽여주는 맛", "새우에 미역" 같은 오해 방지)
  const STRONG = [/씨발|시발|ㅅㅂ|ㅆㅂ|쉬발|씨빨|시빨/, /병신|ㅂㅅ|븅신|빙신/, /개새(끼|기|키)|개색(끼|기)|ㄱㅅㄲ/, /좆|존나|ㅈㄴ|ㅈ같/, /지랄|ㅈㄹ/];
  const BAD_WORDS = [/졸라/, /미친\s*(년|놈|것|새끼)|ㅁㅊ/, /닥쳐|엿\s*먹/, /니\s*애미|느금/, /틀딱|노인네|할망구|할매년/, /썅|쌍놈|쌍년|화냥/];
  const SLANDER = [/사기\s*(꾼|치|쳐|친|당했)/, /도둑\s*(년|놈|질|이네|같)/, /양아치/, /쓰레기\s*(같|년|놈)/, /망해라|망해\s*버려|문\s*닫아라/, /죽어라|뒤져라/, /(장사|팔지)\s*(하지\s*)?마라/];
  const flat = (t) => String(t || '').replace(/[\s.,·_\-~!?*^'"`]+/g, '');
  function checkReview(text) {
    const t = String(text || ''), f = flat(t);
    if (STRONG.some((re) => re.test(f)) || BAD_WORDS.some((re) => re.test(t))) return { ok: false, kind: '욕설', reason: '욕설이나 사람을 낮춰 부르는 말이 들어 있어요.' };
    if (SLANDER.some((re) => re.test(t))) return { ok: false, kind: '비방', reason: '근거 없이 사람을 범죄자로 몰거나 망하라고 하는 말이 들어 있어요.' };
    return { ok: true };
  }
  // 후기에 남긴 전화번호는 가림 (개인정보)
  const maskPhone = (t) => String(t || '').replace(/(01[016789])[-\s.]?\d{3,4}[-\s.]?(\d{4})/g, '$1-****-$2');

  /* ---------- 익명 별명 ---------- */
  // 이름·전화번호 대신 계정마다 늘 같은 별명 (해녀 "삼촌 바37", 손님 "손님 하12")
  const SYL = '가나다라마바사아자차카타파하';
  function aliasCode(key) {
    let h = 5381; for (const c of String(key || '')) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
    return SYL[h % SYL.length] + (10 + (Math.floor(h / SYL.length) % 90));
  }
  const alias = (kind, key) => (kind === 'haenyeo' ? '삼촌 ' : '손님 ') + aliasCode(key);

  // 해녀 내 정보: 손님에게 보이는 건 지역·판매 시간뿐 (이름·전화번호는 저장하지 않음)
  const EXAMPLE_ME = { region: 'jeju', hours: '물질 끝나고 오후 3~5시' };

  const digitsOf = (p) => String(p || '').replace(/[^\d]/g, '');
  function seed() {
    const now = Date.now();
    const h = (n) => iso(now - n * 3600 * 1000);
    // 예시 해녀 1은 "해녀로 둘러보기" 계정 것이라, 시연 때 손님 채팅을 해녀 화면에서 바로 받아 볼 수 있음
    const H1 = 'u:demo-haenyeo', H2 = 'seed-h2', G1 = 'u:demo-guest';
    const a1 = { alias: alias('haenyeo', H1), region: 'jeju', hours: EXAMPLE_ME.hours };
    const a2 = { alias: alias('haenyeo', H2), region: 'jeju', hours: '오전 11시~오후 2시' };
    const mk = (owner, author, species, grade, freshness, weightKg, ask, hrs, status) => ({
      id: uid('p'), ownerId: owner, example: true, author, species, grade, freshness, weightKg,
      refPerKg: refPrice({ species, grade, freshness }), askPerKg: ask, photo: null,
      promo: promo({ species, grade, freshness, weightKg, author }, hrs), createdAt: h(hrs), status: status || 'open'
    });
    const posts = [
      mk(H1, a1, 'abalone', '특', '최상', 3, 45000, 1),
      mk(H2, a2, 'turban', '상', '좋음', 5, 13000, 2),
      mk(H1, a1, 'seaweed', '상', '좋음', 4, null, 5),
      mk(H2, a2, 'octopus', '상', '좋음', 1.5, 25000, 26, 'sold')
    ];
    const rv = (post, stars, text, by, hrs) => ({ id: uid('r'), ownerId: by, example: true, postId: post.id, seller: post.ownerId, species: post.species, stars, text, alias: alias('general', by), createdAt: h(hrs), checked: 'rule' });
    const g = (k) => 'seed-g' + k;
    return {
      v: 2,
      posts,
      reviews: [
        rv(posts[0], 5, '전복이 정말 커요. 채팅으로 금방 답해 주셔서 좋았어요.', g(1), 0.5),
        rv(posts[0], 4, '맛은 좋았는데 생각보다 작은 게 두어 개 섞여 있었어요.', g(2), 0.8),
        rv(posts[3], 5, '살짝 데쳐 먹었는데 부드럽고 달아요.', g(3), 20)
      ],
      wants: [
        { id: 'w-seed1', ownerId: g(4), example: true, alias: alias('general', g(4)), text: '성게알 0.5kg 정도, 주말에 받고 싶어요', species: ['urchinroe'], createdAt: h(20), matchedPostId: null },
        { id: 'w-seed2', ownerId: g(5), example: true, alias: alias('general', g(5)), text: '돌문어 큰 걸로 한 마리', species: ['octopus'], createdAt: h(9), matchedPostId: null }
      ],
      // 예시 채팅: "손님으로 둘러보기" ↔ "해녀로 둘러보기"
      chats: [{
        id: 'c-seed1', example: true, ref: { type: 'post', id: posts[0].id }, title: label('abalone'),
        sellerId: H1, sellerAlias: a1.alias, buyerId: G1, buyerAlias: alias('general', G1), createdAt: h(0.6), updatedAt: h(0.4),
        msgs: [
          { id: 'm1', from: G1, text: '전복 1kg 주문하고 싶어요. 어떻게 받으면 될까요?', at: h(0.6) },
          { id: 'm2', from: H1, text: '네, 챙겨 둘게요. 받는 곳과 시간은 채팅으로 정해요.', at: h(0.4) }
        ]
      }],
      programs: [
        { id: 'pg1', ownerId: H1, example: true, author: a1, title: '해녀와 함께하는 물질 체험', desc: '해녀 삼촌에게 테왁 잡는 법과 숨 고르는 법을 배우고 얕은 바다에서 소라를 직접 찾아봐요.', price: 70000, times: '오전 10시, 오후 2시 (2시간)', season: '5~10월, 물때와 날씨에 따라 쉬어요' },
        { id: 'pg2', ownerId: H2, example: true, author: a2, title: '불턱 이야기와 해녀 밥상', desc: '물질 뒤 몸을 녹이던 불턱에 둘러앉아 해녀 이야기를 듣고, 그날 잡은 해산물로 차린 밥상을 함께 먹어요.', price: 45000, times: '낮 12시, 저녁 5시 30분 (1시간 30분)', season: '사계절' }
      ]
    };
  }

  const api = { REGIONS, regionOf, nearestRegion, isSpecial, setRegionIndex, regionFactor, regionNote, label, VARIETIES, detect, ALIASES, SPECIES, GRADES, FRESH, MAX_POSTS, EARLY_MIN, WANT_DAYS, EXAMPLE_ME, uid, refPrice, promo, seed, setMarket, marketNote, basePerKg, MARKET,
    checkReview, maskPhone, digitsOf, aliasCode, alias };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Agents = api;
})(typeof window !== 'undefined' ? window : globalThis);
