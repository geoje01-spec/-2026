const $ = (sel) => document.querySelector(sel);
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ymd = (s) => (s ? `${Number(s.slice(4, 6))}/${Number(s.slice(6, 8))}` : '');

const STATUS = {
  available: '판매 중',
  reserved: '예약 손님 연결됨',
  sold: '판매 완료',
  pending: '대기 중',
  matched: '상품 연결됨',
  completed: '거래 완료',
  cancelled: '취소',
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `오류가 났어요 (${res.status})`);
  return data;
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

// 해녀 이름은 기기에 기억해 두고 다음에 자동으로 채운다.
const NAME_KEY = 'haenyeoName';
const savedName = () => {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
};
const rememberName = (name) => {
  try { localStorage.setItem(NAME_KEY, name); } catch {}
};

// ---------- 탭 ----------

const loaders = { products: loadProducts, experience: loadExperiences, reservations: loadReservations };

document.querySelectorAll('.tabbar button').forEach((btn) => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

function showTab(name) {
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  window.scrollTo(0, 0);
  loaders[name]?.();
}

// ---------- 사진 → AI 판별 ----------

const sellForm = $('#sell-form');
let imageDataUrl = null;
let detected = [];
let priceInfo = null;
let priceTouched = false;

// 큰 사진은 업로드 전에 줄여서 데이터와 시간을 아낀다.
function resizeImage(file, maxSide = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('사진을 열 수 없어요.'));
    img.src = URL.createObjectURL(file);
  });
}

function setAiStatus(message, isError = false) {
  const el = $('#ai-status');
  el.hidden = !message;
  el.textContent = message || '';
  el.classList.toggle('error', isError);
}

$('#photo-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    imageDataUrl = await resizeImage(file);
  } catch (err) {
    setAiStatus(err.message, true);
    return;
  }
  $('#photo-preview').src = imageDataUrl;
  $('#photo-preview').hidden = false;
  $('#photo-placeholder').hidden = true;
  sellForm.hidden = true;
  setAiStatus('🤖 AI가 어떤 해산물인지 보고 있어요…');

  let result;
  try {
    result = await api('/api/identify', { method: 'POST', body: { image: imageDataUrl } });
  } catch (err) {
    setAiStatus(`AI 판별에 실패했어요. 품목을 직접 골라 주세요. (${err.message})`, true);
    result = { is_seafood: true, items: [], note: '' };
  }
  detected = result.items || [];
  if (!result.is_seafood) {
    setAiStatus('사진에서 해산물을 찾지 못했어요. 다시 찍거나 품목을 직접 골라 주세요.', true);
  } else if (detected.length) {
    setAiStatus('');
  }
  showSellForm(result.note);
});

function showSellForm(note) {
  $('#ai-note').hidden = !note;
  $('#ai-note').textContent = note ? `🤖 ${note}` : '';

  const chips = $('#ai-choices');
  chips.innerHTML = '';
  if (detected.length > 1) {
    detected.forEach((item, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `chip${i === 0 ? ' active' : ''}`;
      b.textContent = `${item.name_detail || item.name} ${item.count ? `${item.count}개` : ''}`;
      b.addEventListener('click', () => {
        chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
        applyDetected(item);
      });
      chips.append(b);
    });
  }
  $('#haenyeo-name').value ||= savedName();
  sellForm.hidden = false;
  applyDetected(detected[0]);
  sellForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function applyDetected(item) {
  const f = sellForm.elements;
  f.itemName.value = item && item.name !== '기타' ? item.name : f.itemName.options[0].value;
  f.detail.value = item?.name_detail && item.name_detail !== item.name ? item.name_detail : '';
  f.count.value = item?.count || '';
  f.weightKg.value = item?.estimated_weight_kg ? Math.round(item.estimated_weight_kg * 10) / 10 : '';
  f.condition.value = item?.condition || '좋음';
  if (item && item.confidence < 0.6) {
    toast('AI가 확실하지 않대요. 품목을 꼭 확인해 주세요.');
  }
  priceTouched = false;
  loadPrice();
}

// ---------- 시세 → 추천 가격 ----------

async function loadPrice() {
  const item = sellForm.elements.itemName.value;
  const box = $('#price-box');
  box.innerHTML = '<span class="muted">시세를 불러오는 중…</span>';
  priceInfo = null;
  try {
    priceInfo = await api(`/api/price?item=${encodeURIComponent(item)}`);
  } catch (err) {
    box.innerHTML = `<span class="muted">시세를 불러오지 못했어요. 가격을 직접 입력해 주세요.<br>(${esc(err.message)})</span>`;
    return;
  }
  if (item !== sellForm.elements.itemName.value) return; // 그 사이 품목이 바뀜
  renderPrice();
}

function renderPrice() {
  const box = $('#price-box');
  if (!priceInfo.found) {
    box.innerHTML = `<span class="muted">${esc(priceInfo.reason)}</span>`;
    return;
  }
  const b = priceInfo.base;
  const total = suggestedTotal();
  const rows = priceInfo.references
    .map((r) => `<tr><td>${esc(r.variety)} · ${esc(r.grade)} · ${esc(r.market)} (${ymd(r.surveyDate)})</td><td>${won(r.price)}/${esc(r.unit)}</td></tr>`)
    .join('');
  const prev = [['어제', b.previous.day], ['1주 전', b.previous.week], ['1달 전', b.previous.month], ['1년 전', b.previous.year]]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k} ${won(v)}`)
    .join(' · ');
  box.innerHTML = `
    <div>추천 가격 <strong>${total ? won(total) : `${won(priceInfo.suggestedUnitPrice)}/${esc(b.unit)}`}</strong></div>
    ${total ? `<div class="muted">${won(priceInfo.suggestedUnitPrice)}/${esc(b.unit)} × ${esc(totalBasis())}</div>` : ''}
    <div class="muted">기준: ${esc(b.apiItem)} ${esc(b.variety)} · ${esc(b.grade)} · ${esc(b.market)} 시세 (${ymd(b.surveyDate)})</div>
    ${prev ? `<div class="muted">${prev}</div>` : ''}
    <details><summary>다른 시세 ${priceInfo.references.length}건 보기</summary><table>${rows}</table></details>`;
  if (!priceTouched && total) sellForm.elements.price.value = total;
  else if (!priceTouched) sellForm.elements.price.value = '';
}

function totalBasis() {
  const f = sellForm.elements;
  if (priceInfo.unit === 'kg') return `${f.weightKg.value}kg`;
  return `${f.count.value}${priceInfo.unit}`;
}

function suggestedTotal() {
  if (!priceInfo?.found) return null;
  const f = sellForm.elements;
  const qty = Number(priceInfo.unit === 'kg' ? f.weightKg.value : f.count.value);
  if (!qty) return null;
  return Math.round((priceInfo.suggestedUnitPrice * qty) / 100) * 100;
}

sellForm.elements.itemName.addEventListener('change', () => {
  priceTouched = false;
  loadPrice();
});
for (const name of ['weightKg', 'count']) {
  sellForm.elements[name].addEventListener('input', () => priceInfo?.found && renderPrice());
}
$('#price-input').addEventListener('input', () => (priceTouched = true));

$('#sell-reset').addEventListener('click', resetSell);

function resetSell() {
  sellForm.reset();
  sellForm.hidden = true;
  imageDataUrl = null;
  detected = [];
  priceInfo = null;
  $('#photo-input').value = '';
  $('#photo-preview').hidden = true;
  $('#photo-placeholder').hidden = false;
  $('#price-box').innerHTML = '';
  setAiStatus('');
  window.scrollTo(0, 0);
}

sellForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = sellForm.elements;
  const button = sellForm.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    const body = Object.fromEntries(new FormData(sellForm));
    body.image = imageDataUrl;
    if (priceInfo?.found) {
      body.priceBasis = {
        unitPrice: priceInfo.suggestedUnitPrice,
        unit: priceInfo.unit,
        source: `${priceInfo.base.apiItem} ${priceInfo.base.variety} ${priceInfo.base.market}`,
        surveyDate: priceInfo.base.surveyDate,
      };
    }
    rememberName(f.haenyeoName.value.trim());
    const { product, matchedReservation } = await api('/api/products', { method: 'POST', body });
    resetSell();
    if (matchedReservation) {
      toast(`🎉 예약 손님 ${matchedReservation.customerName}님에게 먼저 연결됐어요!`);
    } else {
      toast(`${product.itemName} 등록 완료!`);
    }
    showTab('products');
  } catch (err) {
    toast(err.message);
  } finally {
    button.disabled = false;
  }
});

// ---------- 내 상품 ----------

async function loadProducts() {
  const list = $('#product-list');
  let products;
  try {
    products = await api('/api/products');
  } catch (err) {
    list.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    return;
  }
  const reservations = products.some((p) => p.reservationId) ? await api('/api/reservations') : [];
  const byId = Object.fromEntries(reservations.map((r) => [r.id, r]));
  list.innerHTML = products.length ? '' : '<p class="empty">아직 등록한 상품이 없어요.</p>';
  for (const p of products) {
    const r = byId[p.reservationId];
    const el = document.createElement('div');
    el.className = `item${p.photo ? '' : ' no-photo'}`;
    el.innerHTML = `
      ${p.photo ? `<img src="${esc(p.photo)}" alt="">` : ''}
      <div>
        <h3>${esc(p.detail || p.itemName)} <span class="tag ${p.status}">${STATUS[p.status]}</span></h3>
        <p class="price">${won(p.price)}</p>
        <p>${[p.count ? `${p.count}개` : '', p.weightKg ? `${p.weightKg}kg` : '', p.condition ? `상태 ${p.condition}` : ''].filter(Boolean).join(' · ')}</p>
        ${r ? `<p>👤 예약 손님: ${esc(r.customerName)} ${esc(r.quantity)} ${r.contact ? `· ${esc(r.contact)}` : ''}</p>` : ''}
        <div class="actions">
          ${p.status !== 'sold' ? '<button class="small" data-act="sold">판매 완료</button>' : ''}
          <button class="small danger" data-act="delete">삭제</button>
        </div>
      </div>`;
    el.querySelector('[data-act=sold]')?.addEventListener('click', async () => {
      await api(`/api/products/${p.id}`, { method: 'PATCH', body: { status: 'sold' } }).catch((err) => toast(err.message));
      loadProducts();
    });
    el.querySelector('[data-act=delete]').addEventListener('click', async () => {
      if (!confirm('이 상품을 삭제할까요?')) return;
      await api(`/api/products/${p.id}`, { method: 'DELETE' }).catch((err) => toast(err.message));
      loadProducts();
    });
    list.append(el);
  }
}

// ---------- 체험 ----------

const expForm = $('#exp-form');

expForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(expForm));
  body.haenyeoName = savedName();
  try {
    await api('/api/experiences', { method: 'POST', body });
    expForm.reset();
    toast('체험이 올라갔어요!');
    loadExperiences();
  } catch (err) {
    toast(err.message);
  }
});

async function loadExperiences() {
  const list = $('#exp-list');
  let items;
  try {
    items = await api('/api/experiences');
  } catch (err) {
    list.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    return;
  }
  list.innerHTML = items.length ? '' : '<p class="empty">아직 등록한 체험이 없어요.</p>';
  for (const x of items) {
    const el = document.createElement('div');
    el.className = 'item no-photo';
    el.innerHTML = `
      <div>
        <h3>${esc(x.title)}</h3>
        <p>📅 ${esc(x.date)} ${esc(x.time)}${x.durationMin ? ` (${x.durationMin}분)` : ''}</p>
        <p>📍 ${esc(x.location)}</p>
        <p class="price">${won(x.pricePerPerson)} / 1인 · 예약 ${x.booked}/${x.capacity}명</p>
        ${x.preparation ? `<p>🎒 ${esc(x.preparation)}</p>` : ''}
        <ul class="bookings"></ul>
        <div class="actions"><button class="small danger" data-act="delete">삭제</button></div>
      </div>`;
    el.querySelector('[data-act=delete]').addEventListener('click', async () => {
      if (!confirm('이 체험과 예약을 모두 삭제할까요?')) return;
      await api(`/api/experiences/${x.id}`, { method: 'DELETE' }).catch((err) => toast(err.message));
      loadExperiences();
    });
    if (x.booked) {
      api(`/api/experiences/${x.id}/bookings`).then((bookings) => {
        el.querySelector('.bookings').innerHTML = bookings
          .filter((b) => b.status !== 'cancelled')
          .map((b) => `<li>👤 ${esc(b.customerName)} ${b.people}명${b.contact ? ` · ${esc(b.contact)}` : ''}</li>`)
          .join('');
      });
    }
    list.append(el);
  }
}

// ---------- 예약 ----------

async function loadReservations() {
  const list = $('#reservation-list');
  let items;
  try {
    items = await api('/api/reservations');
  } catch (err) {
    list.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    return;
  }
  list.innerHTML = items.length ? '' : '<p class="empty">아직 예약이 없어요.</p>';
  for (const r of items) {
    const el = document.createElement('div');
    el.className = 'item no-photo';
    el.innerHTML = `
      <div>
        <h3>${esc(r.customerName)} <span class="tag ${r.status}">${STATUS[r.status]}</span></h3>
        <p>${esc(r.itemName)} ${esc(r.quantity)}${r.contact ? ` · ${esc(r.contact)}` : ''}</p>
        <p class="muted">${new Date(r.createdAt).toLocaleString('ko-KR')}</p>
        ${['pending', 'matched'].includes(r.status) ? '<div class="actions"><button class="small danger">예약 취소</button></div>' : ''}
      </div>`;
    el.querySelector('button')?.addEventListener('click', async () => {
      if (!confirm('이 예약을 취소할까요?')) return;
      await api(`/api/reservations/${r.id}/cancel`, { method: 'POST' }).catch((err) => toast(err.message));
      loadReservations();
    });
    list.append(el);
  }
}

$('#reservation-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    const r = await api('/api/reservations', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
    form.reset();
    toast(r.status === 'matched' ? '판매 중인 상품과 바로 연결됐어요!' : '예약이 등록됐어요. 상품이 올라오면 먼저 연결돼요.');
    loadReservations();
  } catch (err) {
    toast(err.message);
  }
});

// ---------- 시작 ----------

(async function init() {
  const items = await api('/api/items').catch(() => ['전복']);
  const options = items.map((i) => `<option>${esc(i)}</option>`).join('');
  $('#item-select').innerHTML = options;
  $('#reservation-item').innerHTML = options;
  const health = await api('/api/health').catch(() => null);
  if (health && (!health.gemini || !health.priceApi)) {
    const badge = $('#status-badge');
    badge.hidden = false;
    badge.textContent = !health.gemini ? 'AI 키 없음' : '시세 키 없음';
  }
})();
