// 통계: 일·주·월 독서 시간, 읽은 쪽수, 연속 독서일, 완독 달력(표지), 월별 완독 책장
import { S } from './db.js';
import * as db from './db.js';
import { esc, ymd, addDays, fmtDur, coverImg, GENRES } from './ui.js';
import { sessionDate, pagesOf, streak, longestStreak } from './calc.js';

const view = { range: 'day', calYm: null, year: null };

// 장르별 책등 색
const GENRE_COLOR = { '경제·투자': [201, 150, 46], '인문·철학': [36, 69, 58], '역사·역사소설': [138, 75, 58], '자기계발·심리': [63, 122, 99], '소설·스릴러': [64, 98, 168] };
const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const shortT = t => String(t || '').replace(/\s*\([^)]*\)/g, '').split(/\s*:\s+/)[0];
const finishedBooks = () => S.books.filter(b => b.status === 'done' && b.finish_date);

/** 완독 달력: 그날 완독한 책 표지 표시, 책을 읽은 날은 점 */
function coverCalendar(byDay, today) {
  const ym = view.calYm || today.slice(0, 7);
  const [Y, M] = ym.split('-').map(Number);
  const first = new Date(Y, M - 1, 1);
  const lastD = new Date(Y, M, 0).getDate();
  const offset = first.getDay();
  const done = finishedBooks().filter(b => b.finish_date.startsWith(ym));
  const readDays = Object.keys(byDay).filter(d => d.startsWith(ym)).length;
  const cells = Array.from({ length: lastD }, (_, i) => {
    const d = `${ym}-${String(i + 1).padStart(2, '0')}`;
    const bs = done.filter(b => b.finish_date === d);
    const read = byDay[d];
    const cls = ['d', bs.length ? 'has' : '', read ? 'read' : '', d === today ? 'today' : ''].join(' ');
    const tip = [d, read ? `독서 ${fmtDur(read.sec)}` : '', ...bs.map(b => `완독: ${shortT(b.title)}`)].filter(Boolean).join(' · ');
    return `<div class="${cls}" title="${esc(tip)}">${bs.length ? `<a href="#/book/${bs[0].id}" class="cc">${coverImg(bs[0], 'cal-cover')}</a>${bs.length > 1 ? `<span class="more">+${bs.length - 1}</span>` : ''}` : ''}<span class="n">${i + 1}</span>${read && !bs.length ? '<i class="rd"></i>' : ''}</div>`;
  }).join('');
  return `<div class="card">
    <div class="sec-head"><h3>${Y}년 ${M}월 완독 달력</h3>
      <div class="row gap"><button class="btn small ghost" data-cal="-1" aria-label="이전 달">‹</button><button class="btn small ghost" data-cal="0">이번 달</button><button class="btn small ghost" data-cal="1" aria-label="다음 달">›</button></div></div>
    <p class="muted small">이번 달 완독 <b>${done.length}권</b> · 책 읽은 날 ${readDays}일 <span class="cal-legend"><i class="rd"></i> 읽은 날 · 표지 = 그날 완독한 책</span></p>
    <div class="cal cover-cal">${'일월화수목금토'.split('').map(w => `<span class="w">${w}</span>`).join('')}${'<span></span>'.repeat(offset)}${cells}</div>
  </div>`;
}

/** 월별 완독: 읽은 책만큼 책등을 쌓는 책장 */
function bookStacks(today) {
  const year = view.year || +today.slice(0, 4);
  const books = finishedBooks().filter(b => b.finish_date.startsWith(String(year))).sort((a, b) => a.finish_date.localeCompare(b.finish_date));
  const thisMonth = +today.slice(5, 7), thisYear = +today.slice(0, 4);
  const cols = Array.from({ length: 12 }, (_, i) => {
    const mm = `${year}-${String(i + 1).padStart(2, '0')}`;
    const bs = books.filter(b => b.finish_date.startsWith(mm));
    const spines = bs.map(b => {
      const h = hash(b.id);
      const base = GENRE_COLOR[b.genre] || [120, 126, 122];
      const f = 0.82 + (h % 30) / 100;
      const col = `rgb(${base.map(v => Math.min(255, Math.round(v * f))).join(',')})`;
      const thick = Math.max(12, Math.min(28, Math.round((b.pages || 300) / 22)));
      const w = 80 + (h % 17);
      const off = (h >> 3) % (101 - w);
      return `<a class="spine" href="#/book/${b.id}" title="${esc(shortT(b.title))} · ${b.finish_date}${b.pages ? ` · ${b.pages}쪽` : ''}" style="background:${col};height:${thick}px;width:${w}%;margin-left:${off}%"><span>${esc(shortT(b.title))}</span></a>`;
    }).join('');
    return `<div class="shelf-col ${year === thisYear && i + 1 === thisMonth ? 'now' : ''}"><span class="cnt">${bs.length || ''}</span><div class="stack">${spines}</div><span class="ml">${i + 1}월</span></div>`;
  }).join('');
  const goal = S.settings.yearly_goal || 0;
  const used = [...new Set(books.map(b => b.genre).filter(Boolean))];
  return `<div class="card">
    <div class="sec-head"><h3>${year}년 월별 완독 <span class="muted small">${books.length}권${goal && year === thisYear ? ` / 목표 ${goal}권` : ''}</span></h3>
      <div class="row gap"><button class="btn small ghost" data-year="-1" aria-label="이전 해">‹</button><button class="btn small ghost" data-year="1" aria-label="다음 해">›</button></div></div>
    ${books.length ? '' : '<p class="muted small">이 해에 완독한 책이 없어요. 완독하면 그 달 칸에 책이 한 권씩 쌓여요.</p>'}
    <div class="shelf">${cols}</div>
    <p class="muted small shelf-legend">책 두께 = 쪽수 · 색 = 장르 ${used.map(g => `<span><i style="background:rgb(${(GENRE_COLOR[g] || [120, 126, 122]).join(',')})"></i>${esc(g)}</span>`).join('')}</p>
  </div>`;
}

function bars(data, { unit = 'min', h = 160 } = {}) {
  const max = Math.max(1, ...data.map(d => d.v));
  const w = 100 / data.length;
  return `<div class="chart" style="height:${h + 40}px">
    <svg viewBox="0 0 100 ${h}" preserveAspectRatio="none" class="bars">${data.map((d, i) => {
      const bh = (d.v / max) * (h - 14);
      return `<rect x="${i * w + w * 0.15}" y="${h - bh}" width="${w * 0.7}" height="${bh}" rx="0.8" class="${d.hl ? 'hl' : ''}"><title>${esc(d.label)}: ${unit === 'min' ? fmtDur(d.v * 60) : d.v + unit}</title></rect>`;
    }).join('')}</svg>
    <div class="x-labels">${data.map(d => `<span style="width:${w}%">${esc(d.short)}</span>`).join('')}</div>
  </div>`;
}

export function renderStats(el) {
  const ended = S.sessions.filter(s => s.ended_at);
  const today = ymd();
  const byDay = {};
  for (const s of ended) { const d = sessionDate(s); byDay[d] ||= { sec: 0, pages: 0 }; byDay[d].sec += s.seconds || 0; byDay[d].pages += pagesOf(s); }
  const sum = (from, to) => Object.entries(byDay).filter(([d]) => d >= from && d <= to).reduce((a, [, v]) => ({ sec: a.sec + v.sec, pages: a.pages + v.pages }), { sec: 0, pages: 0 });

  let series = [];
  if (view.range === 'day') {
    for (let i = 13; i >= 0; i--) { const d = addDays(today, -i); const v = byDay[d] || { sec: 0, pages: 0 }; series.push({ label: d, short: d.slice(8), v: Math.round(v.sec / 60), p: v.pages, hl: d === today }); }
  } else if (view.range === 'week') {
    const dow = (new Date().getDay() + 6) % 7; const monday = addDays(today, -dow);
    for (let i = 11; i >= 0; i--) { const from = addDays(monday, -7 * i), to = addDays(from, 6); const v = sum(from, to); series.push({ label: `${from}~${to}`, short: `${+from.slice(5, 7)}/${+from.slice(8)}`, v: Math.round(v.sec / 60), p: v.pages, hl: i === 0 }); }
  } else {
    const y = +today.slice(0, 4), m = +today.slice(5, 7);
    for (let i = 11; i >= 0; i--) { const dt = new Date(y, m - 1 - i, 1); const from = ymd(dt), to = ymd(new Date(dt.getFullYear(), dt.getMonth() + 1, 0)); const v = sum(from, to); series.push({ label: from.slice(0, 7), short: `${dt.getMonth() + 1}월`, v: Math.round(v.sec / 60), p: v.pages, hl: i === 0 }); }
  }
  const total = series.reduce((a, s) => ({ v: a.v + s.v, p: a.p + s.p }), { v: 0, p: 0 });

  // 월별 완독
  const year = today.slice(0, 4);
  const doneByMonth = Array.from({ length: 12 }, (_, i) => {
    const mm = `${year}-${String(i + 1).padStart(2, '0')}`;
    return { label: mm, short: `${i + 1}월`, v: S.books.filter(b => b.status === 'done' && (b.finish_date || '').startsWith(mm)).length, hl: i === new Date().getMonth() };
  });
  const doneYear = doneByMonth.reduce((a, x) => a + x.v, 0);
  const goal = S.settings.yearly_goal || 0;
  const allSec = ended.reduce((a, s) => a + (s.seconds || 0), 0);
  const allPages = ended.reduce((a, s) => a + pagesOf(s), 0);
  const genreCount = GENRES.map(g => ({ g, n: S.books.filter(b => b.status === 'done' && b.genre === g).length }));
  const readDays = Object.keys(byDay).length;


  el.innerHTML = `<div class="sec-head"><h1>통계</h1><a class="btn small" href="#/settings">설정</a></div>
  <div class="stat-cards">
    <div class="card"><span class="label">연속 독서일</span><b class="big">${streak()}일</b><span class="muted small">최장 ${longestStreak()}일</span></div>
    <div class="card"><span class="label">${year} 완독</span><b class="big">${doneYear}${goal ? `/${goal}` : ''}권</b>${goal ? `<div class="bar"><i style="width:${Math.min(100, doneYear / goal * 100)}%"></i></div>` : ''}</div>
    <div class="card"><span class="label">누적 독서 시간</span><b class="big">${fmtDur(allSec)}</b><span class="muted small">${readDays}일 기록</span></div>
    <div class="card"><span class="label">누적 읽은 쪽</span><b class="big">${allPages.toLocaleString()}쪽</b><span class="muted small">문장 ${S.quotes.length} · 노트 ${S.notes.length}</span></div>
  </div>
  <div class="card">
    <div class="sec-head"><h3>독서 시간</h3><div class="tabs small">${[['day', '일'], ['week', '주'], ['month', '월']].map(([k, v]) => `<button class="${view.range === k ? 'on' : ''}" data-r="${k}">${v}</button>`).join('')}</div></div>
    ${bars(series)}
    <p class="muted small">기간 합계 ${fmtDur(total.v * 60)} · ${total.p}쪽 · 평균 ${fmtDur((total.v * 60) / series.length)}/${view.range === 'day' ? '일' : view.range === 'week' ? '주' : '월'}</p>
  </div>
  <div class="card"><h3>읽은 쪽수</h3>${bars(series.map(s => ({ ...s, v: s.p })), { unit: '쪽', h: 120 })}</div>
  ${coverCalendar(byDay, today)}
  ${bookStacks(today)}
  <div class="card"><h3>장르별 완독</h3><div class="genre-bars">${genreCount.map(x => `<div class="row gap"><span class="g">${x.g}</span><div class="bar grow"><i style="width:${Math.max(...genreCount.map(z => z.n)) ? x.n / Math.max(...genreCount.map(z => z.n)) * 100 : 0}%"></i></div><b>${x.n}</b></div>`).join('')}</div></div>
  <div class="card"><h3>최근 완독</h3>${S.books.filter(b => b.status === 'done').sort((a, b) => (b.finish_date || '').localeCompare(a.finish_date || '')).slice(0, 8).map(b => `<a class="row gap mini-row" href="#/book/${b.id}">${coverImg(b, 'cover xs')}<span class="grow">${esc(b.title)}</span><span class="muted small">${b.finish_date || ''}</span></a>`).join('') || '<p class="muted small">아직 완독한 책이 없어요.</p>'}</div>`;
  el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { view.range = b.dataset.r; renderStats(el); });
  el.querySelectorAll('[data-cal]').forEach(b => b.onclick = () => {
    const step = +b.dataset.cal;
    if (!step) view.calYm = null;
    else { const [y, m] = (view.calYm || today.slice(0, 7)).split('-').map(Number); const d = new Date(y, m - 1 + step, 1); view.calYm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
    renderStats(el);
  });
  el.querySelectorAll('[data-year]').forEach(b => b.onclick = () => { view.year = (view.year || +today.slice(0, 4)) + +b.dataset.year; renderStats(el); });
}
