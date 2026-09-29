// スタバ日記 — メインアプリ
const state = {
  stores: [],
  visits: [],
  storeSort: 'recent',
  storePref: '',
  storeQuery: '',
};

const photoUrlCache = new Map();
const collator = new Intl.Collator('ja');
const $view = document.getElementById('view');
const $title = document.getElementById('pageTitle');
const $back = document.getElementById('backBtn');

// ---------- ユーティリティ ----------
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
function fmtDate(s, withYear = true) {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  const w = WEEK[new Date(y, m - 1, d).getDay()];
  return `${withYear ? y + '年' : ''}${m}月${d}日(${w})`;
}

function daysAgo(s) {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t - new Date(y, m - 1, d)) / 86400000);
  if (diff === 0) return '今日';
  if (diff === 1) return '昨日';
  if (diff > 1 && diff < 31) return `${diff}日前`;
  return '';
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 2200);
}

function storeById(id) {
  return state.stores.find((s) => s.id === id);
}

function visitCompare(a, b) {
  // 日付の新しい順、同日なら登録の新しい順
  return b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0);
}

function visitsOf(storeId) {
  return state.visits.filter((v) => v.storeId === storeId).sort(visitCompare);
}

// 店舗ごとの集計（訪問回数・初回・最終）
function storeStats() {
  const map = new Map();
  for (const s of state.stores) map.set(s.id, { count: 0, first: null, last: null });
  for (const v of state.visits) {
    const st = map.get(v.storeId);
    if (!st) continue;
    st.count++;
    if (!st.first || v.date < st.first) st.first = v.date;
    if (!st.last || v.date > st.last) st.last = v.date;
  }
  return map;
}

// 各訪問が「その店舗で何回目か」
function visitNumbers() {
  const nums = new Map();
  const byStore = new Map();
  [...state.visits].sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0))
    .forEach((v) => {
      const n = (byStore.get(v.storeId) || 0) + 1;
      byStore.set(v.storeId, n);
      nums.set(v.id, n);
    });
  return nums;
}

async function photoUrl(id) {
  if (photoUrlCache.has(id)) return photoUrlCache.get(id);
  const rec = await DB.get('photos', id);
  if (!rec) return '';
  const url = URL.createObjectURL(photoBlob(rec));
  photoUrlCache.set(id, url);
  return url;
}

// data-photo 属性の付いた img に写真を読み込む
function hydratePhotos(root = $view) {
  root.querySelectorAll('img[data-photo]').forEach(async (img) => {
    img.src = await photoUrl(img.dataset.photo);
  });
}

// 画像を縮小して JPEG Blob にする（容量節約）
function compressImage(file, maxSize = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(1, maxSize / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像の変換に失敗しました'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
    img.src = url;
  });
}

// iPhone の Safari は IndexedDB に Blob を保存すると失敗することがあるため、
// 写真は ArrayBuffer として保存する（古い形式の blob も読めるようにしておく）
function photoBlob(rec) {
  return rec.blob || new Blob([rec.data], { type: rec.type || 'image/jpeg' });
}

async function photoRecord(id, blob) {
  const data = blob.arrayBuffer ? await blob.arrayBuffer() : await new Response(blob).arrayBuffer();
  return { id, data, type: blob.type || 'image/jpeg' };
}

function blobToDataURL(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}

async function dataURLToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}

async function loadAll() {
  [state.stores, state.visits] = await Promise.all([DB.getAll('stores'), DB.getAll('visits')]);
}

// ---------- 共通パーツ ----------
function statsHtml() {
  const stats = storeStats();
  const visited = state.stores.filter((s) => stats.get(s.id).count > 0);
  const prefs = new Set(visited.map((s) => s.prefecture).filter(Boolean));
  const year = String(new Date().getFullYear());
  const thisYear = state.visits.filter((v) => v.date.startsWith(year)).length;
  return `
    <section class="stats">
      <div class="stat"><b>${visited.length}</b><span>店舗</span></div>
      <div class="stat"><b>${state.visits.length}</b><span>回 訪問</span></div>
      <div class="stat"><b>${prefs.size}<small>/47</small></b><span>都道府県</span></div>
      <div class="stat"><b>${thisYear}</b><span>回 (${year}年)</span></div>
    </section>`;
}

function orderListHtml(items) {
  if (!items || !items.length) return '';
  return `<ul class="orders">${items.map((it) => `
    <li><span class="drink">${esc(it.name)}</span>${it.size ? `<span class="size">${esc(it.size)}</span>` : ''}
    ${it.custom ? `<div class="custom">${esc(it.custom)}</div>` : ''}</li>`).join('')}</ul>`;
}

function photosHtml(ids, cls = 'photos') {
  if (!ids || !ids.length) return '';
  return `<div class="${cls}">${ids.map((id) => `<img data-photo="${esc(id)}" alt="写真" loading="lazy">`).join('')}</div>`;
}

function visitCardHtml(v, { showStore = true, num } = {}) {
  const s = storeById(v.storeId);
  const ago = daysAgo(v.date);
  return `
    <article class="card visit">
      <div class="visit-head">
        <div>
          <div class="date">${fmtDate(v.date)}${ago ? `<span class="ago">${ago}</span>` : ''}</div>
          ${showStore && s ? `<a class="store-link" href="#/store/${s.id}">${esc(s.name)}</a>
            <span class="pref-tag">${esc(s.prefecture || '')}</span>` : ''}
        </div>
        <div class="visit-actions">
          ${num ? `<span class="nth">${num}回目</span>` : ''}
          <a class="icon-btn" href="#/edit/${v.id}" aria-label="編集">✎</a>
        </div>
      </div>
      ${orderListHtml(v.items)}
      ${photosHtml(v.photoIds)}
      ${v.memo ? `<p class="memo">${esc(v.memo).replace(/\n/g, '<br>')}</p>` : ''}
    </article>`;
}

function emptyHtml(msg) {
  return `<div class="empty"><div class="big">☕</div><p>${msg}</p><a class="btn primary" href="#/new">最初の記録をつける</a></div>`;
}

// ---------- 画面: ホーム（記録一覧） ----------
function renderHome() {
  setHeader('スタバ日記');
  if (!state.visits.length) {
    $view.innerHTML = statsHtml() + emptyHtml('まだ記録がありません。<br>行ったスタバを記録してみましょう！');
    return;
  }
  const nums = visitNumbers();
  const sorted = [...state.visits].sort(visitCompare);
  let html = statsHtml();
  let curMonth = '';
  for (const v of sorted) {
    const [y, m] = v.date.split('-');
    const key = `${y}年${Number(m)}月`;
    if (key !== curMonth) {
      curMonth = key;
      const count = sorted.filter((x) => x.date.startsWith(`${y}-${m}`)).length;
      html += `<h2 class="section">${key}<small>${count}回</small></h2>`;
    }
    html += visitCardHtml(v, { num: nums.get(v.id) });
  }
  $view.innerHTML = html;
  hydratePhotos();
}

// ---------- 画面: 店舗一覧 ----------
const SORTS = [
  ['recent', '新着順'],
  ['kana', '五十音順'],
  ['pref', '都道府県別'],
  ['count', '訪問回数順'],
  ['first', '初訪問が古い順'],
];

function renderStores() {
  setHeader('行った店舗');
  const stats = storeStats();
  const prefsUsed = PREFECTURES.filter((p) => state.stores.some((s) => s.prefecture === p));

  $view.innerHTML = statsHtml() + `
    <div class="filters">
      <input type="search" id="storeQuery" placeholder="店舗名・地名で検索" value="${esc(state.storeQuery)}">
      <select id="storePref">
        <option value="">すべての都道府県</option>
        ${prefsUsed.map((p) => `<option ${p === state.storePref ? 'selected' : ''}>${p}</option>`).join('')}
      </select>
      <div class="chips">
        ${SORTS.map(([k, label]) => `<button class="chip ${state.storeSort === k ? 'on' : ''}" data-sort="${k}">${label}</button>`).join('')}
      </div>
    </div>
    <div id="storeList"></div>`;

  const draw = () => drawStoreList(stats);
  const qEl = document.getElementById('storeQuery');
  // 日本語入力の変換中は再描画しない
  qEl.addEventListener('input', (e) => {
    if (e.isComposing) return;
    state.storeQuery = qEl.value;
    draw();
  });
  qEl.addEventListener('compositionend', () => { state.storeQuery = qEl.value; draw(); });
  document.getElementById('storePref').addEventListener('change', (e) => { state.storePref = e.target.value; draw(); });
  $view.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    state.storeSort = b.dataset.sort;
    $view.querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  }));
  draw();
}

function drawStoreList(stats) {
  let list = state.stores.filter((s) => stats.get(s.id).count > 0);
  if (state.storePref) list = list.filter((s) => s.prefecture === state.storePref);
  const q = toHiragana(state.storeQuery.trim().toLowerCase());
  if (q) {
    list = list.filter((s) => toHiragana(`${s.name} ${s.kana || ''} ${s.prefecture || ''} ${s.address || ''}`.toLowerCase()).includes(q));
  }

  const kanaKey = (s) => toHiragana(s.kana || s.name);
  const byKana = (a, b) => collator.compare(kanaKey(a), kanaKey(b));
  const prefIdx = (s) => { const i = PREFECTURES.indexOf(s.prefecture); return i < 0 ? 99 : i; };
  const st = (s) => stats.get(s.id);

  let groupOf = null;
  switch (state.storeSort) {
    case 'kana':
      list.sort(byKana);
      groupOf = (s) => kanaRow(s.kana || s.name);
      break;
    case 'pref':
      list.sort((a, b) => prefIdx(a) - prefIdx(b) || byKana(a, b));
      groupOf = (s) => s.prefecture || '未設定';
      break;
    case 'count':
      list.sort((a, b) => st(b).count - st(a).count || st(b).last.localeCompare(st(a).last));
      break;
    case 'first':
      list.sort((a, b) => st(a).first.localeCompare(st(b).first));
      break;
    default:
      list.sort((a, b) => st(b).last.localeCompare(st(a).last));
  }

  let html = `<p class="result-count">${list.length}店舗</p>`;
  if (!state.visits.length) {
    html += emptyHtml('まだ店舗がありません。');
  } else if (!list.length) {
    html += '<p class="empty-small">条件に合う店舗がありません。</p>';
  }

  let curGroup = null;
  for (const s of list) {
    if (groupOf) {
      const g = groupOf(s);
      if (g !== curGroup) {
        curGroup = g;
        const n = list.filter((x) => groupOf(x) === g).length;
        html += `<h2 class="section">${esc(g)}<small>${n}店舗</small></h2>`;
      }
    }
    const x = st(s);
    html += `
      <a class="card store-row" href="#/store/${s.id}">
        <div class="store-main">
          <div class="store-name">${esc(s.name)}</div>
          <div class="store-sub">${esc(s.prefecture || '')}${s.kana ? ` ・ ${esc(s.kana)}` : ''}</div>
          <div class="store-dates">最終 ${fmtDate(x.last)}${x.count > 1 ? ` ／ 初回 ${fmtDate(x.first)}` : ''}</div>
        </div>
        <div class="count-badge"><b>${x.count}</b><span>回</span></div>
      </a>`;
  }
  document.getElementById('storeList').innerHTML = html;
}

// ---------- 画面: 店舗詳細 ----------
function renderStore(id) {
  const s = storeById(id);
  if (!s) { location.hash = '#/stores'; return; }
  setHeader(s.name, true);
  const vs = visitsOf(id);
  const nums = visitNumbers();
  const first = vs.length ? vs[vs.length - 1].date : null;
  const last = vs.length ? vs[0].date : null;

  // 年ごとの訪問日一覧
  const years = {};
  vs.forEach((v) => { (years[v.date.slice(0, 4)] ||= []).push(v); });

  $view.innerHTML = `
    <section class="card store-hero">
      <div class="store-name big">${esc(s.name)}</div>
      <div class="store-sub">${esc(s.prefecture || '都道府県 未設定')}${s.kana ? ` ・ ${esc(s.kana)}` : ''}</div>
      ${s.address ? `<div class="store-sub">📍 ${esc(s.address)}</div>` : ''}
      ${s.note ? `<p class="memo">${esc(s.note).replace(/\n/g, '<br>')}</p>` : ''}
      <div class="hero-stats">
        <div><b>${vs.length}</b><span>回 訪問</span></div>
        <div><b>${first ? fmtDate(first) : '-'}</b><span>はじめて</span></div>
        <div><b>${last ? fmtDate(last) : '-'}</b><span>最後に行った日</span></div>
      </div>
      <div class="row-btns">
        <a class="btn primary" href="#/new?store=${s.id}">＋ この店舗の記録を追加</a>
        <a class="btn" href="#/store-edit/${s.id}">店舗情報を編集</a>
        ${s.address || s.name ? `<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('スターバックス ' + s.name + ' ' + (s.address || s.prefecture || ''))}">地図</a>` : ''}
      </div>
    </section>

    ${vs.length ? `
    <h2 class="section">訪問した日<small>${vs.length}回</small></h2>
    <div class="card date-list">
      ${Object.keys(years).sort().reverse().map((y) => `
        <div class="year-row"><span class="year">${y}年</span>
          <span class="dates">${years[y].map((v) => `<a href="#v-${v.id}">${fmtDate(v.date, false)}</a>`).join('')}</span>
        </div>`).join('')}
    </div>
    <h2 class="section">記録</h2>
    ${vs.map((v) => `<div id="v-${v.id}">${visitCardHtml(v, { showStore: false, num: nums.get(v.id) })}</div>`).join('')}
    ` : '<p class="empty-small">この店舗の記録はまだありません。</p>'}
  `;
  $view.querySelectorAll('.date-list a').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById(a.getAttribute('href').slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  hydratePhotos();
}

// ---------- 画面: 都道府県 ----------
function renderPrefs() {
  setHeader('都道府県');
  const stats = storeStats();
  const perPref = new Map();
  for (const s of state.stores) {
    const x = stats.get(s.id);
    if (!x.count) continue;
    const p = perPref.get(s.prefecture) || { stores: 0, visits: 0 };
    p.stores++;
    p.visits += x.count;
    perPref.set(s.prefecture, p);
  }
  let html = statsHtml();
  for (const [name, from, to] of REGIONS) {
    html += `<h2 class="section">${name}</h2><div class="pref-grid">`;
    for (const p of PREFECTURES.slice(from, to)) {
      const d = perPref.get(p);
      html += d
        ? `<button class="pref on" data-pref="${p}"><span>${p.replace(/[都府県]$/, '')}</span><b>${d.stores}店</b><small>${d.visits}回</small></button>`
        : `<div class="pref"><span>${p.replace(/[都府県]$/, '')}</span></div>`;
    }
    html += '</div>';
  }
  $view.innerHTML = html;
  $view.querySelectorAll('[data-pref]').forEach((b) => b.addEventListener('click', () => {
    state.storePref = b.dataset.pref;
    state.storeQuery = '';
    location.hash = '#/stores';
  }));
}

// ---------- 画面: 記録の追加・編集 ----------
async function renderVisitForm(visitId, presetStoreId) {
  const editing = visitId ? state.visits.find((v) => v.id === visitId) : null;
  if (visitId && !editing) { location.hash = '#/'; return; }
  setHeader(editing ? '記録を編集' : '記録を追加', true);

  const stats = storeStats();
  const storeOpts = [...state.stores].sort((a, b) => (stats.get(b.id).last || '').localeCompare(stats.get(a.id).last || '') || byKanaStore(a, b));
  const selStore = editing ? editing.storeId : (presetStoreId || (storeOpts[0]?.id ?? ''));
  const items = editing?.items?.length ? editing.items : [{ name: '', size: '', custom: '' }];
  // photos: {id, blob?, isNew}
  const photos = (editing?.photoIds || []).map((id) => ({ id, isNew: false }));
  const pastItems = [...new Set(state.visits.flatMap((v) => (v.items || []).map((i) => i.name)).filter(Boolean))].sort(collator.compare);

  $view.innerHTML = `
    <form id="visitForm" class="form" autocomplete="off">
      <label class="field">
        <span>行った日</span>
        <input type="date" name="date" required value="${esc(editing?.date || todayStr())}">
      </label>

      <label class="field">
        <span>店舗</span>
        <select name="storeId" id="storeSelect">
          <option value="">＋ 新しい店舗を登録する</option>
          ${storeOpts.map((s) => `<option value="${s.id}" ${s.id === selStore ? 'selected' : ''}>${esc(s.name)}（${esc(s.prefecture || '-')}）</option>`).join('')}
        </select>
      </label>

      <fieldset id="newStore" class="subbox">
        <legend>新しい店舗</legend>
        ${storeFieldsHtml({})}
      </fieldset>

      <fieldset class="subbox">
        <legend>頼んだもの</legend>
        <div id="items"></div>
        <button type="button" class="btn small" id="addItem">＋ もう1品追加</button>
        <datalist id="pastItems">${pastItems.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      </fieldset>

      <fieldset class="subbox">
        <legend>写真</legend>
        <div id="photoPreview" class="photos edit"></div>
        <label class="btn small file-btn">📷 写真を選ぶ
          <input type="file" accept="image/*" multiple id="photoInput" hidden>
        </label>
      </fieldset>

      <label class="field">
        <span>メモ・感想</span>
        <textarea name="memo" rows="4" placeholder="窓際の席で読書。新作がおいしかった！">${esc(editing?.memo || '')}</textarea>
      </label>

      <div class="form-actions">
        <button type="submit" class="btn primary big">${editing ? '保存する' : '記録する'}</button>
        ${editing ? '<button type="button" class="btn danger" id="deleteVisit">この記録を削除</button>' : ''}
      </div>
    </form>`;

  const form = document.getElementById('visitForm');
  const $sel = document.getElementById('storeSelect');
  const $new = document.getElementById('newStore');
  const syncNew = () => {
    $new.hidden = !!$sel.value;
    $new.querySelector('[name=storeName]').required = !$sel.value;
  };
  $sel.addEventListener('change', syncNew);
  syncNew();

  // 商品行
  const $items = document.getElementById('items');
  const itemRow = (it) => {
    const div = document.createElement('div');
    div.className = 'item-row';
    div.innerHTML = `
      <div class="item-line">
        <input name="itemName" list="pastItems" placeholder="例：抹茶クリームフラペチーノ" value="${esc(it.name)}">
        <select name="itemSize">${SIZES.map((sz) => `<option value="${sz}" ${sz === it.size ? 'selected' : ''}>${sz || 'サイズ'}</option>`).join('')}</select>
        <button type="button" class="icon-btn remove" aria-label="削除">✕</button>
      </div>
      <input name="itemCustom" class="custom-input" placeholder="カスタマイズ（例：オールミルク・ソイ変更）" value="${esc(it.custom || '')}">`;
    div.querySelector('.remove').addEventListener('click', () => {
      if ($items.children.length > 1) div.remove();
      else div.querySelectorAll('input').forEach((i) => { i.value = ''; });
    });
    $items.appendChild(div);
  };
  items.forEach(itemRow);
  document.getElementById('addItem').addEventListener('click', () => {
    itemRow({ name: '', size: '', custom: '' });
    $items.lastElementChild.querySelector('input').focus();
  });

  // 写真
  const $preview = document.getElementById('photoPreview');
  const drawPhotos = async () => {
    $preview.innerHTML = '';
    for (const p of photos) {
      const wrap = document.createElement('div');
      wrap.className = 'thumb';
      const img = document.createElement('img');
      img.src = p.isNew ? p.url : await photoUrl(p.id);
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'thumb-rm';
      rm.textContent = '✕';
      rm.setAttribute('aria-label', '写真を外す');
      rm.addEventListener('click', () => { photos.splice(photos.indexOf(p), 1); drawPhotos(); });
      wrap.append(img, rm);
      $preview.appendChild(wrap);
    }
  };
  drawPhotos();
  document.getElementById('photoInput').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    for (const f of files) {
      try {
        const blob = await compressImage(f);
        photos.push({ id: uid(), blob, url: URL.createObjectURL(blob), isNew: true });
      } catch (err) {
        toast(err.message);
      }
    }
    drawPhotos();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    if (btn.disabled) return;
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '保存中…';
    try {
      await saveVisit();
    } catch (err) {
      console.error(err);
      alert(`保存できませんでした。\n（${err && (err.message || err.name) || err}）`);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  async function saveVisit() {
    const fd = new FormData(form);
    let storeId = fd.get('storeId');
    if (!storeId) {
      const name = normalizeStoreName(fd.get('storeName'));
      if (!name) { toast('店舗名を入力してください'); return; }
      const dup = state.stores.find((s) => s.name === name && s.prefecture === fd.get('prefecture'));
      if (dup) {
        storeId = dup.id;
      } else {
        const store = {
          id: uid(),
          name,
          kana: (fd.get('kana') || '').trim(),
          prefecture: fd.get('prefecture') || '',
          address: (fd.get('address') || '').trim(),
          note: '',
          createdAt: Date.now(),
        };
        await DB.put('stores', store);
        state.stores.push(store);
        storeId = store.id;
      }
    }

    const names = fd.getAll('itemName');
    const sizes = fd.getAll('itemSize');
    const customs = fd.getAll('itemCustom');
    const newItems = names.map((n, i) => ({ name: n.trim(), size: sizes[i], custom: customs[i].trim() }))
      .filter((i) => i.name || i.custom);

    const newPhotos = photos.filter((p) => p.isNew);
    if (newPhotos.length) await DB.putMany('photos', await Promise.all(newPhotos.map((p) => photoRecord(p.id, p.blob))));
    if (editing) {
      const removed = editing.photoIds.filter((id) => !photos.some((p) => p.id === id));
      if (removed.length) await DB.delMany('photos', removed);
    }
    newPhotos.forEach((p) => photoUrlCache.set(p.id, p.url));

    const visit = {
      id: editing?.id || uid(),
      storeId,
      date: fd.get('date'),
      items: newItems,
      photoIds: photos.map((p) => p.id),
      memo: (fd.get('memo') || '').trim(),
      createdAt: editing?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    await DB.put('visits', visit);
    if (editing) Object.assign(editing, visit);
    else state.visits.push(visit);

    toast(editing ? '保存しました' : '記録しました ☕');
    location.hash = `#/store/${storeId}`;
  }

  document.getElementById('deleteVisit')?.addEventListener('click', async () => {
    if (!confirm('この記録を削除しますか？（写真も削除されます）')) return;
    await DB.delMany('photos', editing.photoIds || []);
    await DB.del('visits', editing.id);
    state.visits = state.visits.filter((v) => v.id !== editing.id);
    toast('削除しました');
    history.back();
  });
}

function byKanaStore(a, b) {
  return collator.compare(toHiragana(a.kana || a.name), toHiragana(b.kana || b.name));
}

function normalizeStoreName(name) {
  return (name || '').trim().replace(/\s+/g, ' ');
}

function storeFieldsHtml(s) {
  return `
    <label class="field"><span>店舗名</span>
      <input name="storeName" placeholder="例：京都二寧坂ヤサカ茶屋店" value="${esc(s.name || '')}"></label>
    <label class="field"><span>よみがな <small>（五十音順の並びに使います）</small></span>
      <input name="kana" placeholder="例：きょうとにねいざかやさかちゃやてん" value="${esc(s.kana || '')}"></label>
    <label class="field"><span>都道府県</span>
      <select name="prefecture">
        <option value="">選択してください</option>
        ${REGIONS.map(([r, f, t]) => `<optgroup label="${r}">${PREFECTURES.slice(f, t).map((p) => `<option ${p === s.prefecture ? 'selected' : ''}>${p}</option>`).join('')}</optgroup>`).join('')}
      </select></label>
    <label class="field"><span>住所・場所のメモ <small>（任意）</small></span>
      <input name="address" placeholder="例：京都市東山区 / 駅ナカ" value="${esc(s.address || '')}"></label>`;
}

// ---------- 画面: 店舗情報の編集 ----------
function renderStoreEdit(id) {
  const s = storeById(id);
  if (!s) { location.hash = '#/stores'; return; }
  setHeader('店舗情報を編集', true);
  const count = visitsOf(id).length;
  $view.innerHTML = `
    <form id="storeForm" class="form">
      ${storeFieldsHtml(s)}
      <label class="field"><span>お店のメモ <small>（任意）</small></span>
        <textarea name="note" rows="3" placeholder="例：テラス席あり、限定メニューあり">${esc(s.note || '')}</textarea></label>
      <div class="form-actions">
        <button class="btn primary big" type="submit">保存する</button>
        <button class="btn danger" type="button" id="deleteStore">この店舗を削除（記録${count}件も削除）</button>
      </div>
    </form>`;
  const form = document.getElementById('storeForm');
  form.querySelector('[name=storeName]').required = true;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    Object.assign(s, {
      name: normalizeStoreName(fd.get('storeName')),
      kana: fd.get('kana').trim(),
      prefecture: fd.get('prefecture'),
      address: fd.get('address').trim(),
      note: fd.get('note').trim(),
    });
    await DB.put('stores', s);
    toast('保存しました');
    location.hash = `#/store/${s.id}`;
  });
  document.getElementById('deleteStore').addEventListener('click', async () => {
    if (!confirm(`「${s.name}」と、その記録${count}件をすべて削除しますか？\nこの操作は元に戻せません。`)) return;
    const vs = visitsOf(id);
    await DB.delMany('photos', vs.flatMap((v) => v.photoIds || []));
    await DB.delMany('visits', vs.map((v) => v.id));
    await DB.del('stores', id);
    state.visits = state.visits.filter((v) => v.storeId !== id);
    state.stores = state.stores.filter((x) => x.id !== id);
    toast('削除しました');
    location.hash = '#/stores';
  });
}

// ---------- 画面: 設定（バックアップ） ----------
function renderSettings() {
  setHeader('設定・バックアップ');
  $view.innerHTML = `
    ${statsHtml()}
    <section class="card">
      <h3>バックアップ</h3>
      <p class="hint">記録と写真は<b>この端末のブラウザの中</b>に保存されています。機種変更やブラウザのデータ削除に備えて、ときどきバックアップファイルを保存しておくと安心です。</p>
      <button class="btn primary" id="exportBtn">バックアップを保存する</button>
    </section>
    <section class="card">
      <h3>バックアップから復元</h3>
      <p class="hint">保存したバックアップファイル（.json）を読み込みます。今のデータに<b>追加</b>されます（同じ記録は上書き）。</p>
      <label class="btn file-btn">ファイルを選ぶ
        <input type="file" accept="application/json,.json" id="importInput" hidden>
      </label>
    </section>
    <section class="card">
      <h3>すべて削除</h3>
      <p class="hint">この端末に保存されたすべての記録と写真を削除します。</p>
      <button class="btn danger" id="clearBtn">すべてのデータを削除</button>
    </section>`;

  document.getElementById('exportBtn').addEventListener('click', exportBackup);
  document.getElementById('importInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) await importBackup(f);
  });
  document.getElementById('clearBtn').addEventListener('click', async () => {
    if (!confirm('本当にすべてのデータを削除しますか？')) return;
    if (!confirm('元に戻せません。よろしいですか？')) return;
    await DB.clearAll();
    photoUrlCache.clear();
    await loadAll();
    toast('削除しました');
    renderSettings();
  });
}

async function exportBackup() {
  toast('バックアップを作成中…');
  const photos = await DB.getAll('photos');
  const data = {
    app: 'starbucks-log',
    version: 1,
    exportedAt: new Date().toISOString(),
    stores: state.stores,
    visits: state.visits,
    photos: await Promise.all(photos.map(async (p) => ({ id: p.id, data: await blobToDataURL(photoBlob(p)) }))),
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const name = `スタバ日記バックアップ_${todayStr()}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  // スマホでは共有シート（「ファイルに保存」など）を優先
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'starbucks-log') throw new Error('スタバ日記のバックアップファイルではありません');
    const photos = await Promise.all((data.photos || []).map(async (p) => photoRecord(p.id, await dataURLToBlob(p.data))));
    await DB.putMany('photos', photos);
    await DB.putMany('stores', data.stores || []);
    await DB.putMany('visits', data.visits || []);
    await loadAll();
    toast(`復元しました（店舗${(data.stores || []).length}件・記録${(data.visits || []).length}件）`);
    location.hash = '#/';
  } catch (err) {
    alert('読み込めませんでした：' + err.message);
  }
}

// ---------- ルーター ----------
function setHeader(title, back = false) {
  $title.textContent = title;
  $back.hidden = !back;
  document.title = title === 'スタバ日記' ? title : `${title} | スタバ日記`;
}

$back.addEventListener('click', () => {
  if (history.length > 1) history.back();
  else location.hash = '#/';
});

function route() {
  const hash = location.hash.slice(1) || '/';
  const [path, query] = hash.split('?');
  const params = new URLSearchParams(query || '');
  const parts = path.split('/').filter(Boolean);
  let tab = 'home';

  switch (parts[0]) {
    case undefined: renderHome(); break;
    case 'stores': tab = 'stores'; renderStores(); break;
    case 'store': tab = 'stores'; renderStore(parts[1]); break;
    case 'store-edit': tab = 'stores'; renderStoreEdit(parts[1]); break;
    case 'prefs': tab = 'prefs'; renderPrefs(); break;
    case 'new': tab = 'new'; renderVisitForm(null, params.get('store')); break;
    case 'edit': tab = 'new'; renderVisitForm(parts[1]); break;
    case 'settings': tab = 'settings'; renderSettings(); break;
    default: renderHome();
  }
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  window.scrollTo(0, 0);
}

// 写真タップで拡大
const $lightbox = document.getElementById('lightbox');
document.addEventListener('click', (e) => {
  const img = e.target.closest('.photos:not(.edit) img');
  if (img) {
    $lightbox.querySelector('img').src = img.src;
    $lightbox.hidden = false;
  }
});
$lightbox.addEventListener('click', () => { $lightbox.hidden = true; });

window.addEventListener('hashchange', route);

// 想定外のエラーは画面に出す（何も起きないように見えるのを防ぐ）
window.addEventListener('error', (e) => toast(`エラー：${e.message}`));
window.addEventListener('unhandledrejection', (e) => toast(`エラー：${(e.reason && e.reason.message) || e.reason}`));

(async () => {
  try {
    await loadAll();
  } catch (err) {
    $view.innerHTML = `<p class="empty-small">データを読み込めませんでした（${esc(err.message)}）。<br>プライベートブラウズを解除して開き直してください。</p>`;
    return;
  }
  // 端末の空き容量が少ないときにデータが消されないよう依頼
  navigator.storage?.persist?.();
  route();
})();
