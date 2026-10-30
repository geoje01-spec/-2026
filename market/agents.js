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
    agar:        { ko: '우뭇가사리', refPerKg: 9000 }
  };
  const GRADES = { '특': 1.2, '상': 1.0, '중': 0.85 };
  const FRESH = { '최상': 1.05, '좋음': 1, '보통': 0.95 };
  const MAX_POSTS = 20;

  const uid = (p) => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const round100 = (n) => Math.round(n / 100) * 100;
  const iso = (d) => new Date(d).toISOString();
  const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1); return (c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28) ? a : b; };

  function refPrice({ species, grade, freshness }) {
    const sp = SPECIES[species];
    if (!sp) return 0;
    return round100(sp.refPerKg * (GRADES[grade] || 1) * (FRESH[freshness] || 1));
  }

  // AI가 없을 때 쓰는 홍보 글 틀
  function promo({ species, grade, freshness, weightKg, author }, variant) {
    const ko = (SPECIES[species] || {}).ko || '해산물';
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
      programs: [
        { id: 'pg1', ownerId: 'seed', example: true, author: a1, title: '해녀와 함께하는 물질 체험', desc: '해녀 삼촌에게 테왁 잡는 법과 숨 고르는 법을 배우고 얕은 바다에서 소라를 직접 찾아봐요.', price: 70000, times: '오전 10시, 오후 2시 (2시간)', season: '5~10월, 물때와 날씨에 따라 쉬어요' },
        { id: 'pg2', ownerId: 'seed', example: true, author: a2, title: '불턱 이야기와 해녀 밥상', desc: '물질 뒤 몸을 녹이던 불턱에 둘러앉아 해녀 이야기를 듣고, 그날 잡은 해산물로 차린 밥상을 함께 먹어요.', price: 45000, times: '낮 12시, 저녁 5시 30분 (1시간 30분)', season: '사계절' }
      ]
    };
  }

  const api = { SPECIES, GRADES, FRESH, MAX_POSTS, EXAMPLE_ME, uid, refPrice, promo, seed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Agents = api;
})(typeof window !== 'undefined' ? window : globalThis);
