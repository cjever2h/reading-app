// 월간 리포트: 월 독서 시간, 읽은 책, 기억에 남은 한 줄, 공유용 이미지
import * as db from './db.js';
import { S } from './db.js';
import { esc, nl2br, ymd, fmtDur, coverImg, openModal, toast, stars, GENRES } from './ui.js';
import { sessionDate, pagesOf } from './calc.js';
import { go } from './app.js';
import { loadImg, wrapLines, roundRect, drawCover, F } from './cert.js';

const pad = n => String(n).padStart(2, '0');
const shortT = t => String(t || '').replace(/\s*\([^)]*\)/g, '').split(/\s*:\s+/)[0].trim();
const ymOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const shiftYm = (ym, n) => { const [y, m] = ym.split('-').map(Number); return ymOf(new Date(y, m - 1 + n, 1)); };
const ymLabel = ym => `${+ym.slice(0, 4)}년 ${+ym.slice(5)}월`;

/** 한 달 데이터 모으기 */
export function monthData(ym) {
  const [Y, M] = ym.split('-').map(Number);
  const days = new Date(Y, M, 0).getDate();
  const sess = S.sessions.filter(s => s.ended_at && sessionDate(s).startsWith(ym));
  const byDay = Array.from({ length: days }, () => 0);
  for (const s of sess) byDay[+sessionDate(s).slice(8) - 1] += s.seconds || 0;
  const seconds = sess.reduce((a, s) => a + (s.seconds || 0), 0);
  const pages = sess.reduce((a, s) => a + pagesOf(s), 0);
  const readDays = byDay.filter(v => v > 0).length;
  let best = 0, cur = 0; for (const v of byDay) { cur = v > 0 ? cur + 1 : 0; best = Math.max(best, cur); }
  const finished = S.books.filter(b => b.status === 'done' && (b.finish_date || '').startsWith(ym)).sort((a, b) => a.finish_date.localeCompare(b.finish_date));
  // 이달 세션이 있는 책 (책별 시간·쪽)
  const perBook = {};
  for (const s of sess) { const p = perBook[s.book_id] ||= { sec: 0, pages: 0, n: 0 }; p.sec += s.seconds || 0; p.pages += pagesOf(s); p.n++; }
  const readBooks = Object.entries(perBook).map(([id, v]) => ({ book: db.book(id), ...v })).filter(x => x.book).sort((a, b) => b.sec - a.sec);
  const inMonth = x => (x.created_at || '').slice(0, 7) === ym || (x.note_date || '').startsWith(ym);
  const quotes = S.quotes.filter(q => (q.created_at || '').slice(0, 7) === ym);
  const notes = S.notes.filter(inMonth);
  const genres = {}; for (const b of finished) if (b.genre) genres[b.genre] = (genres[b.genre] || 0) + 1;
  const rated = finished.filter(b => b.rating);
  const avgRating = rated.length ? rated.reduce((a, b) => a + Number(b.rating), 0) / rated.length : null;
  return { ym, days, sess, byDay, seconds, pages, readDays, bestStreak: best, finished, readBooks, quotes, notes, genres, avgRating };
}

/** 기억에 남은 한 줄 후보: 이달 저장한 문장, 이달 완독 책의 한 줄 요약, 이달 '오늘의 한 줄' */
function lineCandidates(d) {
  const out = [];
  for (const q of d.quotes) { const b = db.book(q.book_id); out.push({ key: 'q:' + q.id, kind: 'quote', text: q.body, book: b ? shortT(b.title) : '', page: q.page, label: '저장한 문장' }); }
  for (const b of d.finished) { const sm = db.summaryOf(b.id); if (sm?.one_line) out.push({ key: 's:' + b.id, kind: 'mine', text: sm.one_line, book: shortT(b.title), label: '완독 한 줄 요약' }); }
  for (const s of d.sess) if (s.memo && s.memo.trim()) { const b = db.book(s.book_id); out.push({ key: 'm:' + s.id, kind: 'mine', text: s.memo.trim(), book: b ? shortT(b.title) : '', label: `오늘의 한 줄 · ${+sessionDate(s).slice(5, 7)}/${+sessionDate(s).slice(8)}` }); }
  return out;
}
const savedLine = ym => ((S.settings.data || {}).report_lines || {})[ym] || null;
async function saveLine(ym, line) {
  const data = { ...(S.settings.data || {}) };
  data.report_lines = { ...(data.report_lines || {}), [ym]: line };
  if (!line) delete data.report_lines[ym];
  await db.saveSettings({ data });
}

function dayBars(d) {
  const max = Math.max(1, ...d.byDay);
  const w = 100 / d.days;
  return `<div class="chart" style="height:150px"><svg viewBox="0 0 100 110" preserveAspectRatio="none" class="bars">${d.byDay.map((v, i) => {
    const h = (v / max) * 100;
    return `<rect x="${i * w + w * 0.15}" y="${110 - h}" width="${w * 0.7}" height="${h}" rx="0.6"><title>${i + 1}일 ${fmtDur(v)}</title></rect>`;
  }).join('')}</svg><div class="x-labels">${d.byDay.map((_, i) => `<span style="width:${w}%">${(i + 1) % 5 === 0 || i === 0 ? i + 1 : ''}</span>`).join('')}</div></div>`;
}

const view = { ym: null };

export function renderReport(el, ymArg) {
  const today = ymd();
  const ym = ymArg || view.ym || today.slice(0, 7);
  view.ym = ym;
  const d = monthData(ym);
  const prev = monthData(shiftYm(ym, -1));
  const diff = d.seconds - prev.seconds;
  const cands = lineCandidates(d);
  const sel = savedLine(ym);
  const hasTime = d.seconds > 0;
  const isFuture = ym > today.slice(0, 7);

  el.innerHTML = `
  <div class="sec-head"><h1>월간 리포트</h1><a class="btn small ghost" href="#/stats">통계로</a></div>
  <div class="card month-nav">
    <button class="btn small ghost" data-m="-1" aria-label="이전 달">‹</button>
    <b>${ymLabel(ym)}</b>
    <button class="btn small ghost" data-m="1" aria-label="다음 달" ${isFuture ? 'disabled' : ''}>›</button>
    <span class="grow"></span>
    <button class="btn primary small" data-share>공유 이미지 만들기</button>
  </div>
  <div class="stat-cards">
    <div class="card"><span class="label">독서 시간</span><b class="big">${hasTime ? fmtDur(d.seconds) : '–'}</b><span class="muted small">${hasTime || prev.seconds ? (diff >= 0 ? `지난달보다 ${fmtDur(diff)} 더` : `지난달보다 ${fmtDur(-diff)} 덜`) : '타이머 기록 없음'}</span></div>
    <div class="card"><span class="label">독서한 날</span><b class="big">${d.readDays}<small>/${d.days}일</small></b><span class="muted small">${d.bestStreak ? `최장 연속 ${d.bestStreak}일` : '–'}</span></div>
    <div class="card"><span class="label">읽은 쪽</span><b class="big">${d.pages.toLocaleString()}<small>쪽</small></b><span class="muted small">${d.readDays ? `하루 평균 ${fmtDur(d.seconds / d.readDays)}` : '–'}</span></div>
    <div class="card"><span class="label">완독</span><b class="big">${d.finished.length}<small>권</small></b><span class="muted small">${d.avgRating ? `평균 별점 ${d.avgRating.toFixed(1)}` : `지난달 ${prev.finished.length}권`}</span></div>
  </div>
  ${hasTime ? `<div class="card"><h3>날짜별 독서 시간</h3>${dayBars(d)}</div>` : ''}

  <div class="card">
    <div class="sec-head"><h3>기억에 남은 한 줄</h3>${sel ? '<button class="btn small ghost" data-clear>선택 해제</button>' : ''}</div>
    ${sel ? `<div class="report-line ${sel.kind}"><div>${sel.kind === 'quote' ? '“' + nl2br(sel.text) + '”' : nl2br(sel.text)}</div><span class="muted small">${sel.kind === 'quote' ? '책 속 문장' : '나의 한 줄'}${sel.book ? ` · 『${esc(sel.book)}』` : ''}${sel.page ? ` p.${sel.page}` : ''}</span></div>` : '<p class="muted small">이달의 한 줄을 골라주세요. 공유 이미지에 들어가요.</p>'}
    ${cands.length ? `<details ${sel ? '' : 'open'}><summary class="muted small">이달 기록에서 고르기 (${cands.length})</summary><div class="list mt">${cands.map(c => `<button class="card cand ${sel && sel.key === c.key ? 'on' : ''}" data-cand="${c.key}"><span class="muted small">${esc(c.label)}${c.book ? ` · 『${esc(c.book)}』` : ''}${c.page ? ` p.${c.page}` : ''}</span><span>${esc(c.text.slice(0, 140))}${c.text.length > 140 ? '…' : ''}</span></button>`).join('')}</div></details>` : '<p class="muted small">이달 저장한 문장·한 줄 요약·오늘의 한 줄이 없어요. 아래에 직접 써도 돼요.</p>'}
    <form class="row gap mt" data-own><input name="t" maxlength="80" placeholder="직접 쓰기: 이달 나에게 남은 한 줄" value="${sel && sel.key === 'own' ? esc(sel.text) : ''}"><button class="btn small">저장</button></form>
  </div>

  <div class="card">
    <h3>이달 완독한 책 <span class="muted small">${d.finished.length}권</span></h3>
    ${d.finished.length ? `<div class="report-books">${d.finished.map(b => { const sm = db.summaryOf(b.id); return `<a class="report-book" href="#/book/${b.id}">${coverImg(b, 'cover')}<b>${esc(shortT(b.title))}</b><span class="muted small">${+b.finish_date.slice(5, 7)}/${+b.finish_date.slice(8)} 완독${b.rating ? ` · <span class="stars">${stars(b.rating)}</span>` : ''}</span>${sm?.one_line ? `<span class="small one">${esc(sm.one_line)}</span>` : ''}</a>`; }).join('')}</div>` : '<p class="muted small">이달 완독한 책이 없어요.</p>'}
  </div>

  ${d.readBooks.length ? `<div class="card"><h3>이달 읽은 책 <span class="muted small">타이머 기록 기준</span></h3>
    ${d.readBooks.map(x => `<a class="row gap mini-row" href="#/book/${x.book.id}">${coverImg(x.book, 'cover xs')}<span class="grow">${esc(shortT(x.book.title))}<span class="muted small block">${x.n}회 · ${x.pages}쪽${x.book.status === 'done' && (x.book.finish_date || '').startsWith(ym) ? ' · 완독' : ''}</span></span><b class="small">${fmtDur(x.sec)}</b></a>`).join('')}
  </div>` : ''}

  <div class="card"><h3>이달의 기록</h3>
    <div class="kv"><span>저장한 문장 <b>${d.quotes.length}</b></span><span>노트 <b>${d.notes.length}</b></span><span>독서 세션 <b>${d.sess.length}</b></span></div>
    ${Object.keys(d.genres).length ? `<div class="row gap wrap mt">${GENRES.filter(g => d.genres[g]).map(g => `<span class="chip">${esc(g)} ${d.genres[g]}</span>`).join('')}</div>` : ''}
  </div>`;

  el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => go(`#/report/${shiftYm(ym, +b.dataset.m)}`));
  el.querySelectorAll('[data-cand]').forEach(b => b.onclick = async () => { const c = cands.find(x => x.key === b.dataset.cand); await saveLine(ym, c); renderReport(el, ym); });
  el.querySelector('[data-clear]')?.addEventListener('click', async () => { await saveLine(ym, null); renderReport(el, ym); });
  el.querySelector('[data-own]').onsubmit = async e => { e.preventDefault(); const t = e.target.t.value.trim(); if (!t) return; await saveLine(ym, { key: 'own', kind: 'mine', text: t }); toast('저장했어요'); renderReport(el, ym); };
  el.querySelector('[data-share]').onclick = () => reportShareModal(ym);
}

/* ---------- 공유 이미지 (1080 정사각형) ---------- */
const W = 1080, H = 1080, P = 64, GOLD = '#e9c46a';
export async function drawReport(canvas, d, opt) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  try { await Promise.all([document.fonts.load(F(800, 40)), document.fonts.load(F(600, 30)), document.fonts.load(F(900, 60))]); } catch { /* 기본 글꼴 */ }
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#24453a'); g.addColorStop(1, '#0f1714');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(233,196,106,.07)'; ctx.beginPath(); ctx.arc(W - 90, 120, 260, 0, Math.PI * 2); ctx.fill();
  // 머리
  ctx.fillStyle = GOLD; ctx.font = F(700, 28); ctx.fillText('MONTHLY READING REPORT', P, P + 26);
  ctx.fillStyle = '#fff'; ctx.font = F(900, 76); ctx.fillText(ymLabel(d.ym), P, P + 118);
  // 수치 4칸
  const hasTime = d.seconds > 0;
  const stats = hasTime
    ? [['독서 시간', fmtDur(d.seconds)], ['독서한 날', `${d.readDays}일`], ['읽은 쪽', `${d.pages.toLocaleString()}쪽`], ['완독', `${d.finished.length}권`]]
    : [['완독', `${d.finished.length}권`], ['평균 별점', d.avgRating ? d.avgRating.toFixed(1) : '–'], ['저장한 문장', `${d.quotes.length}개`], ['많이 읽은 장르', (Object.entries(d.genres).sort((a, b) => b[1] - a[1])[0] || ['–'])[0].split('·')[0]]];
  const sy = P + 160, gap = 16, bw = (W - P * 2 - gap * 3) / 4, bh = 136;
  stats.forEach(([k, v], i) => {
    const x = P + i * (bw + gap);
    roundRect(ctx, x, sy, bw, bh, 20); ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.62)'; ctx.font = F(500, 24); ctx.fillText(k, x + 24, sy + 46);
    ctx.fillStyle = GOLD; let fs = 44; ctx.font = F(800, fs); while (ctx.measureText(v).width > bw - 40 && fs > 26) { fs -= 2; ctx.font = F(800, fs); } ctx.fillText(v, x + 24, sy + 104);
  });
  // 책 표지 줄
  const books = d.finished.length ? d.finished : d.readBooks.map(x => x.book);
  const label = d.finished.length ? `이달 완독한 책 ${d.finished.length}권` : (books.length ? `이달 읽은 책 ${books.length}권` : '');
  let y = sy + bh + 56;
  if (books.length) {
    ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = F(600, 26); ctx.fillText(label, P, y); y += 22;
    const maxN = 7, show = books.slice(0, books.length > maxN ? maxN - 1 : maxN);
    const slots = Math.min(maxN, books.length);
    const roomH = opt.line ? 300 : 430; // 한 줄 상자 자리를 남기고 표지를 최대한 크게
    const cw = Math.min(roomH / 1.45, (W - P * 2 - (slots - 1) * 16) / slots, 230), ch = Math.round(cw * 1.45);
    for (let i = 0; i < show.length; i++) {
      const x = P + i * (cw + 16);
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 10; roundRect(ctx, x, y, cw, ch, 8); ctx.fillStyle = '#2f4a3e'; ctx.fill(); ctx.restore();
      const img = opt.covers[show[i].id];
      if (img) { ctx.save(); roundRect(ctx, x, y, cw, ch, 8); ctx.clip(); drawCover(ctx, img, x, y, cw, ch); ctx.restore(); }
      else { ctx.fillStyle = '#fff'; ctx.font = F(700, 18); wrapLines(ctx, shortT(show[i].title), cw - 20, 5).forEach((l, j) => ctx.fillText(l, x + 10, y + 34 + j * 24)); }
    }
    if (books.length > show.length) {
      const x = P + show.length * (cw + 16);
      roundRect(ctx, x, y, cw, ch, 8); ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = F(800, 40); ctx.textAlign = 'center'; ctx.fillText(`+${books.length - show.length}`, x + cw / 2, y + ch / 2 + 14); ctx.textAlign = 'left';
    }
    y += ch + 52;
  }
  // 기억에 남은 한 줄: 내용 높이에 맞춘 상자를 남은 공간 가운데에
  const line = opt.line;
  const bottom = H - P - 50;
  if (line && bottom - y > 140) {
    const text = line.kind === 'quote' ? `“${line.text}”` : line.text;
    const avail = bottom - y;
    let fs = 40, ls;
    for (; fs >= 28; fs -= 2) { ctx.font = F(600, fs); ls = wrapLines(ctx, text, W - P * 2 - 80, 99); if (ls.length * fs * 1.45 + 130 <= avail) break; }
    ctx.font = F(600, fs); ls = wrapLines(ctx, text, W - P * 2 - 80, Math.max(1, Math.floor((avail - 130) / (fs * 1.45))));
    const boxH = 84 + ls.length * fs * 1.45 + (line.book ? 46 : 18);
    const by = y + Math.max(0, (avail - boxH) / 2);
    roundRect(ctx, P, by, W - P * 2, boxH, 24); ctx.fillStyle = 'rgba(233,196,106,.12)'; ctx.fill();
    ctx.fillStyle = GOLD; ctx.fillRect(P, by + 22, 6, boxH - 44);
    ctx.font = F(700, 24); ctx.fillText(line.kind === 'quote' ? '이달 기억에 남은 문장' : '이달 나의 한 줄', P + 40, by + 50);
    ctx.fillStyle = '#fff'; ctx.font = F(600, fs); ls.forEach((l, i) => ctx.fillText(l, P + 40, by + 84 + fs + i * fs * 1.45 - fs * 0.2));
    if (line.book) { ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = F(500, 24); ctx.textAlign = 'right'; ctx.fillText(`『${line.book}』${line.page ? ` p.${line.page}` : ''}`, W - P - 32, by + boxH - 24); ctx.textAlign = 'left'; }
  } else if (!books.length && !line) {
    ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = F(600, 34); ctx.textAlign = 'center';
    ctx.fillText('이달의 독서 기록이 아직 없어요', W / 2, (y + bottom) / 2); ctx.textAlign = 'left';
  }
  // 바닥
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = F(500, 26);
  if (opt.nickname) ctx.fillText(`@${opt.nickname}`, P, H - P + 6);
  ctx.textAlign = 'right'; ctx.fillText('독서기록 · AI각인 독서', W - P, H - P + 6); ctx.textAlign = 'left';
}

async function reportShareModal(ym) {
  const d = monthData(ym);
  const st = S.settings;
  const state = { nick: st.show_nickname !== false, line: savedLine(ym) };
  const m = openModal(`<h3>${ymLabel(ym)} 리포트 공유</h3>
    <div class="cert-wrap">
      <div class="cert-preview"><canvas data-cv></canvas></div>
      <div class="cert-ctrl form">
        <p class="small">${state.line ? '기억에 남은 한 줄이 들어가요.' : '기억에 남은 한 줄을 고르지 않았어요. 리포트 화면에서 고르면 이미지에 들어가요.'}</p>
        <label class="check"><input type="checkbox" data-nick ${state.nick ? 'checked' : ''}> 닉네임 표기 (@${esc(st.nickname || '')})</label>
        <div class="row gap wrap mt"><button class="btn primary" data-share>공유</button><button class="btn" data-save>이미지 저장</button></div>
        <p class="muted small" data-msg>표지는 이달 완독한 책이에요. 완독한 책이 없으면 이달 읽은 책으로 채워요.</p>
      </div>
    </div>`, { wide: true });
  const cv = m.el.querySelector('[data-cv]');
  const msg = m.el.querySelector('[data-msg]');
  const books = d.finished.length ? d.finished : d.readBooks.map(x => x.book);
  const covers = {};
  await Promise.all(books.slice(0, 7).map(async b => { if (!b.cover_url) return; const u = await db.proxiedImage(b.cover_url); if (u) covers[b.id] = await loadImg(u).catch(() => null); }));
  const draw = () => drawReport(cv, d, { covers, line: state.line, nickname: state.nick ? (st.nickname || '') : '' });
  await draw();
  m.el.querySelector('[data-nick]').onchange = e => { state.nick = e.target.checked; draw(); };
  const fname = `월간독서리포트_${ym.replace('-', '')}.jpg`;
  const toBlob = () => new Promise(res => cv.toBlob(res, 'image/jpeg', 0.92));
  const dl = blob => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; document.body.appendChild(a); a.click(); a.remove(); };
  m.el.querySelector('[data-save]').onclick = async () => { dl(await toBlob()); msg.textContent = '이미지를 저장했어요.'; };
  m.el.querySelector('[data-share]').onclick = async () => {
    const blob = await toBlob(); const file = new File([blob], fname, { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: `${ymLabel(ym)} 독서 리포트` }); } catch { /* 취소 */ } }
    else { dl(blob); msg.textContent = '이 브라우저는 바로 공유를 지원하지 않아 이미지로 저장했어요.'; }
  };
}
