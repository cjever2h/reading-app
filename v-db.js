// 문장·노트 통합 DB: 한 번에 검색, 책·태그·기간·종류 필터
import * as db from './db.js';
import { S } from './db.js';
import { esc, ymd, addDays, MEMO_TYPES, NOTE_KINDS, debounce } from './ui.js';
import { quoteModal, noteModal } from './forms.js';
import { quoteCard, noteCard } from './v-book.js';
import { refresh } from './app.js';

const F = { q: '', type: 'all', book: '', tag: '', period: 'all', from: '', to: '', memo: '' };

function filtered(f) {
  const q = f.q.trim().toLowerCase();
  const today = ymd();
  const from = f.period === '7' ? addDays(today, -6) : f.period === '30' ? addDays(today, -29) : f.period === 'year' ? `${today.slice(0, 4)}-01-01` : f.period === 'custom' ? f.from : '';
  const to = f.period === 'custom' ? f.to : '';
  const inRange = d => (!from || d >= from) && (!to || d <= to);
  const match = (...txt) => !q || txt.join(' ').toLowerCase().includes(q);
  const items = [];
  if (f.type !== 'notes') for (const x of S.quotes) {
    const d = ymd(new Date(x.created_at));
    if ((f.book && x.book_id !== f.book) || (f.tag && !(x.tags || []).includes(f.tag)) || !inRange(d) || (f.memo && x.memo_type !== f.memo)) continue;
    if (!match(x.body, x.memo, (x.tags || []).join(' '), db.book(x.book_id)?.title)) continue;
    items.push({ kind: 'quote', d, x });
  }
  if (f.type !== 'quotes' && !f.memo) for (const x of S.notes) {
    if ((f.book && x.book_id !== f.book) || (f.tag && !(x.tags || []).includes(f.tag)) || !inRange(x.note_date)) continue;
    if (!match(x.title, x.body, (x.tags || []).join(' '), db.book(x.book_id)?.title)) continue;
    items.push({ kind: 'note', d: x.note_date, x });
  }
  items.sort((a, b) => b.d.localeCompare(a.d) || (b.x.created_at || '').localeCompare(a.x.created_at || ''));
  return items;
}

function highlight(html, q) {
  if (!q.trim()) return html;
  const safe = esc(q.trim()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(new RegExp(`(>[^<]*?)(${safe})`, 'gi'), '$1<mark>$2</mark>');
}

function filterBar(f, compact) {
  const tags = [...new Set([...S.quotes, ...S.notes].flatMap(x => x.tags || []))].sort();
  return `<div class="filters ${compact ? 'compact' : ''}">
    <input class="w100" placeholder="문장·노트 통합 검색" value="${esc(f.q)}" data-f="q" type="search">
    <div class="row gap wrap mt">
      <select data-f="type"><option value="all">문장+노트</option><option value="quotes" ${f.type === 'quotes' ? 'selected' : ''}>문장만</option><option value="notes" ${f.type === 'notes' ? 'selected' : ''}>노트만</option></select>
      <select data-f="book"><option value="">모든 책</option>${S.books.map(b => `<option value="${b.id}" ${b.id === f.book ? 'selected' : ''}>${esc(b.title.slice(0, 24))}</option>`).join('')}</select>
      <select data-f="tag"><option value="">모든 태그</option>${tags.map(t => `<option ${t === f.tag ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
      <select data-f="memo"><option value="">메모 종류</option>${MEMO_TYPES.map(t => `<option ${t === f.memo ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select data-f="period">${[['all', '전체 기간'], ['7', '최근 7일'], ['30', '최근 30일'], ['year', '올해'], ['custom', '직접 지정']].map(([k, v]) => `<option value="${k}" ${k === f.period ? 'selected' : ''}>${v}</option>`).join('')}</select>
      ${f.period === 'custom' ? `<input type="date" data-f="from" value="${esc(f.from)}"><input type="date" data-f="to" value="${esc(f.to)}">` : ''}
    </div></div>`;
}

function renderInto(el, f, { compact = false, onChange } = {}) {
  const items = filtered(f);
  const qn = items.filter(i => i.kind === 'quote').length, nn = items.length - qn;
  el.innerHTML = `${filterBar(f, compact)}
    <div class="row gap mt mb"><span class="muted small grow">문장 ${qn} · 노트 ${nn}</span>
    <button class="btn small" data-newq>+ 문장</button><button class="btn small" data-newn>+ 노트</button></div>
    <div class="list" data-list>${items.slice(0, 300).map(i => highlight(i.kind === 'quote' ? quoteCard(i.x, !f.book) : noteCard(i.x, !f.book), f.q)).join('') || '<p class="muted card">결과가 없어요.</p>'}</div>`;
  const rerender = () => { renderInto(el, f, { compact, onChange }); };
  el.querySelectorAll('[data-f]').forEach(inp => {
    const k = inp.dataset.f;
    if (k === 'q') {
      inp.oninput = debounce(() => { f.q = inp.value; const pos = inp.selectionStart; rerender(); const n = el.querySelector('[data-f=q]'); n.focus(); n.setSelectionRange(pos, pos); }, 200);
    } else inp.onchange = () => { f[k] = inp.value; rerender(); };
  });
  el.querySelector('[data-newq]').onclick = () => quoteModal({ bookId: f.book || S.books[0]?.id, onSaved: () => (onChange || rerender)() });
  el.querySelector('[data-newn]').onclick = () => noteModal({ bookId: f.book || null, onSaved: () => (onChange || rerender)() });
  el.querySelectorAll('[data-q]').forEach(x => x.onclick = () => quoteModal({ quote: S.quotes.find(q => q.id === x.dataset.q), onSaved: () => (onChange || rerender)() }));
  el.querySelectorAll('[data-n]').forEach(x => x.onclick = () => noteModal({ note: S.notes.find(n => n.id === x.dataset.n), onSaved: () => (onChange || rerender)() }));
}

export function renderDB(el) {
  el.innerHTML = `<h1>문장·노트 DB</h1><div data-db></div>`;
  renderInto(el.querySelector('[data-db]'), F);
}

const panelF = {};
/** 데스크톱: 책 상세 옆에 나란히 띄우는 DB 패널 */
export function renderDBPanel(el, { bookId }) {
  if (!panelF[bookId]) panelF[bookId] = { ...F, q: '', book: bookId, tag: '', memo: '', period: 'all', type: 'all' };
  el.innerHTML = `<div class="side-head"><b>문장·노트 DB</b><span class="muted small">책 상세와 나란히 보기</span></div><div data-p></div>`;
  renderInto(el.querySelector('[data-p]'), panelF[bookId], { compact: true, onChange: refresh });
}
