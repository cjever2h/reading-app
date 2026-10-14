// 서재: 상태별 표지 그리드, 장르·태그 분류, 알라딘 검색으로 책 추가
import { S } from './db.js';
import { esc, coverImg, STATUS, GENRES, stars } from './ui.js';
import { searchModal } from './forms.js';
import { go } from './app.js';
import { progress } from './calc.js';

const view = { status: 'reading', genre: '', tag: '', q: '', sort: 'recent' };

export function renderLibrary(el) {
  const allTags = [...new Set(S.books.flatMap(b => b.tags || []))].sort();
  const count = st => S.books.filter(b => st === 'all' || b.status === st).length;
  let list = S.books.filter(b => (view.status === 'all' || b.status === view.status)
    && (!view.genre || b.genre === view.genre) && (!view.tag || (b.tags || []).includes(view.tag))
    && (!view.q || `${b.title} ${b.author}`.toLowerCase().includes(view.q.toLowerCase())));
  const sorters = {
    recent: (a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''),
    title: (a, b) => a.title.localeCompare(b.title, 'ko'),
    finish: (a, b) => (b.finish_date || '').localeCompare(a.finish_date || ''),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
  };
  list.sort(sorters[view.sort]);

  el.innerHTML = `
  <div class="sec-head"><h1>서재</h1><button class="btn primary" data-add>+ 알라딘에서 책 추가</button></div>
  <div class="tabs">${[['reading', '읽는 중'], ['want', '읽고 싶은 책'], ['done', '완독'], ['all', '전체']].map(([k, v]) => `<button class="${view.status === k ? 'on' : ''}" data-st="${k}">${v} <span class="muted">${count(k)}</span></button>`).join('')}</div>
  <div class="filters row gap wrap">
    <input class="grow" placeholder="서재에서 찾기" value="${esc(view.q)}" data-q>
    <select data-genre><option value="">전체 장르</option>${GENRES.map(g => `<option ${g === view.genre ? 'selected' : ''}>${g}</option>`).join('')}</select>
    <select data-tag><option value="">전체 태그</option>${allTags.map(t => `<option ${t === view.tag ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
    <select data-sort>${[['recent', '최근 수정순'], ['title', '제목순'], ['finish', '완독일순'], ['rating', '별점순']].map(([k, v]) => `<option value="${k}" ${k === view.sort ? 'selected' : ''}>${v}</option>`).join('')}</select>
  </div>
  ${list.length ? `<div class="grid">${list.map(b => {
    const p = progress(b);
    return `<a class="book-tile" href="#/book/${b.id}">
      ${coverImg(b, 'cover')}
      ${b.status === 'reading' && p != null ? `<div class="bar thin"><i style="width:${p}%"></i></div>` : ''}
      <b class="t">${esc(b.title)}</b>
      <span class="muted small">${esc(b.author || '')}</span>
      ${b.status === 'done' && b.rating ? `<span class="stars small">${stars(b.rating)}</span>` : ''}
      ${b.genre ? `<span class="chip small">${esc(b.genre)}</span>` : ''}
    </a>`;
  }).join('')}</div>` : `<div class="card empty"><p>${S.books.length ? '조건에 맞는 책이 없어요.' : '서재가 비어 있어요. 첫 책을 추가해 보세요.'}</p><button class="btn primary" data-add>책 추가</button></div>`}
  `;
  el.querySelectorAll('[data-add]').forEach(b => b.onclick = () => searchModal({ onAdded: bk => go('#/book/' + bk.id) }));
  el.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { view.status = b.dataset.st; renderLibrary(el); });
  const q = el.querySelector('[data-q]');
  q.oninput = () => { view.q = q.value; const pos = q.selectionStart; renderLibrary(el); const nq = el.querySelector('[data-q]'); nq.focus(); nq.setSelectionRange(pos, pos); };
  el.querySelector('[data-genre]').onchange = e => { view.genre = e.target.value; renderLibrary(el); };
  el.querySelector('[data-tag]').onchange = e => { view.tag = e.target.value; renderLibrary(el); };
  el.querySelector('[data-sort]').onchange = e => { view.sort = e.target.value; renderLibrary(el); };
}
