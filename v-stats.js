// 통계: 일·주·월 독서 시간, 읽은 쪽수, 연속 독서일, 월별 완독 수
import { S } from './db.js';
import * as db from './db.js';
import { esc, ymd, addDays, fmtDur, coverImg, GENRES } from './ui.js';
import { sessionDate, pagesOf, streak, longestStreak } from './calc.js';

const view = { range: 'day' };

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

  // 이번 달 독서 달력
  const ym = today.slice(0, 7);
  const first = new Date(+ym.slice(0, 4), +ym.slice(5) - 1, 1);
  const lastD = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const offset = first.getDay();
  const maxSec = Math.max(1, ...Object.entries(byDay).filter(([d]) => d.startsWith(ym)).map(([, v]) => v.sec));

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
  <div class="card"><h3>${+ym.slice(5)}월 독서 달력</h3>
    <div class="cal">${'일월화수목금토'.split('').map(w => `<span class="w">${w}</span>`).join('')}${'<span></span>'.repeat(offset)}${Array.from({ length: lastD }, (_, i) => { const d = `${ym}-${String(i + 1).padStart(2, '0')}`; const v = byDay[d]; const lv = v ? Math.ceil((v.sec / maxSec) * 4) : 0; return `<span class="d l${lv} ${d === today ? 'today' : ''}" title="${d} ${v ? fmtDur(v.sec) : ''}">${i + 1}</span>`; }).join('')}</div>
  </div>
  <div class="card"><h3>${year} 월별 완독 수</h3>${bars(doneByMonth, { unit: '권', h: 100 })}</div>
  <div class="card"><h3>장르별 완독</h3><div class="genre-bars">${genreCount.map(x => `<div class="row gap"><span class="g">${x.g}</span><div class="bar grow"><i style="width:${Math.max(...genreCount.map(z => z.n)) ? x.n / Math.max(...genreCount.map(z => z.n)) * 100 : 0}%"></i></div><b>${x.n}</b></div>`).join('')}</div></div>
  <div class="card"><h3>최근 완독</h3>${S.books.filter(b => b.status === 'done').sort((a, b) => (b.finish_date || '').localeCompare(a.finish_date || '')).slice(0, 8).map(b => `<a class="row gap mini-row" href="#/book/${b.id}">${coverImg(b, 'cover xs')}<span class="grow">${esc(b.title)}</span><span class="muted small">${b.finish_date || ''}</span></a>`).join('') || '<p class="muted small">아직 완독한 책이 없어요.</p>'}</div>`;
  el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { view.range = b.dataset.r; renderStats(el); });
}
