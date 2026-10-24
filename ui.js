// 공통 UI 헬퍼
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const nl2br = s => esc(s).replace(/\n/g, '<br>');

export function toast(msg, ms = 2200) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

let modalStack = [];
/** 모달 열기. html 문자열 또는 element. 반환: {el, close} */
export function openModal(html, { wide = false, onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog"><button class="modal-x" aria-label="닫기">×</button><div class="modal-body"></div></div>`;
  const body = wrap.querySelector('.modal-body');
  if (typeof html === 'string') body.innerHTML = html; else body.appendChild(html);
  document.body.appendChild(wrap);
  document.body.classList.add('no-scroll');
  const close = () => {
    wrap.remove();
    modalStack = modalStack.filter(m => m !== api);
    if (!modalStack.length) document.body.classList.remove('no-scroll');
    onClose && onClose();
  };
  wrap.querySelector('.modal-x').onclick = close;
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  const api = { el: body, close };
  modalStack.push(api);
  return api;
}
export function closeAllModals() { [...modalStack].forEach(m => m.close()); }

export function confirmBox(msg, okText = '확인') {
  return new Promise(res => {
    const m = openModal(`<p class="confirm-msg">${nl2br(msg)}</p><div class="row end gap"><button class="btn" data-x>취소</button><button class="btn ${/삭제|버리기|취소/.test(okText) ? 'danger solid' : 'primary'}" data-ok>${esc(okText)}</button></div>`, { onClose: () => res(false) });
    m.el.querySelector('[data-x]').onclick = () => m.close();
    m.el.querySelector('[data-ok]').onclick = () => { res(true); m.close(); };
  });
}

/* ---------- 날짜/시간 ---------- */
export const pad = n => String(n).padStart(2, '0');
export function ymd(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return ymd(x);
}
export function fmtDate(s, withYear = true) {
  if (!s) return '';
  const x = new Date(s.length === 10 ? s + 'T00:00:00' : s);
  const w = '일월화수목금토'[x.getDay()];
  return withYear ? `${x.getFullYear()}.${pad(x.getMonth() + 1)}.${pad(x.getDate())} (${w})` : `${x.getMonth() + 1}/${x.getDate()} (${w})`;
}
export function fmtTime(s) { const x = new Date(s); return `${pad(x.getHours())}:${pad(x.getMinutes())}`; }
export function fmtDur(sec, long = false) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (long) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  if (h) return `${h}시간 ${m}분`;
  if (m) return `${m}분`;
  return `${s}초`;
}
export function daysBetween(a, b) {
  const A = new Date(a + 'T00:00:00'), B = new Date(b + 'T00:00:00');
  return Math.round((B - A) / 86400000);
}

export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

export function parseTags(s) {
  return [...new Set(String(s || '').split(/[,#\s]+/).map(x => x.trim()).filter(Boolean))];
}
export const tagChips = (tags = []) => (tags || []).map(t => `<span class="chip">#${esc(t)}</span>`).join('');

export const GENRES = ['경제·투자', '인문·철학', '역사·역사소설', '자기계발·심리', '소설·스릴러'];
export const STATUS = { want: '읽고 싶은 책', reading: '읽는 중', done: '완독' };
export const MEMO_TYPES = ['공감', '의문', '연결'];
export const NOTE_KINDS = { pre: '읽기 전', daily: '일일', chapter: '챕터별 메모', free: '자유' };

export function coverImg(book, cls = 'cover') {
  if (book?.cover_url) return `<img class="${cls}" src="${esc(book.cover_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  return `<div class="${cls} cover-ph"><span>${esc((book?.title || '?').slice(0, 12))}</span></div>`;
}

export function stars(n) {
  n = Number(n || 0);
  let s = '';
  for (let i = 1; i <= 5; i++) s += n >= i ? '★' : (n >= i - 0.5 ? '⯪' : '☆');
  return s;
}

export function copyText(text) {
  return navigator.clipboard.writeText(text).then(() => toast('복사했어요')).catch(() => {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove(); toast('복사했어요');
  });
}

export function download(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function mapGenre(category = '') {
  const c = category || '';
  if (/소설|시\/희곡|스릴러|추리|에세이>?소설/.test(c) && !/역사소설/.test(c)) return /역사/.test(c) ? '역사·역사소설' : '소설·스릴러';
  if (/역사/.test(c)) return '역사·역사소설';
  if (/경제|경영|투자|재테크|주식|부동산/.test(c)) return '경제·투자';
  if (/자기계발|심리|처세|성공|건강/.test(c)) return '자기계발·심리';
  if (/인문|철학|사회과학|과학|종교|예술/.test(c)) return '인문·철학';
  if (/Fiction|Novel/i.test(c)) return '소설·스릴러';
  if (/History/i.test(c)) return '역사·역사소설';
  if (/Business|Economics/i.test(c)) return '경제·투자';
  if (/Self-Help|Psychology/i.test(c)) return '자기계발·심리';
  return '인문·철학';
}
