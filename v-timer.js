// 독서 타이머: 시작·일시정지·종료. 시각 기록 방식이라 화면이 꺼지거나 앱을 닫아도 시간이 유지된다.
import * as db from './db.js';
import { S } from './db.js';
import { esc, coverImg, openModal, toast, confirmBox, fmtDur, nl2br } from './ui.js';
import { quoteModal, suggestStartPage } from './forms.js';
import { go, updateTimerPill } from './app.js';
import { lastPage, ensureReviews } from './calc.js';
import { certModal } from './cert.js';
import { MEMO_HELP } from './guide-data.js';

const KEY = 'ra-timer-v1';
export function timerState() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function setState(s) { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); updateTimerPill(); }
const elapsedMs = st => st.accMs + (st.runningSince ? Date.now() - st.runningSince : 0);

let tick = null, wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); }
    else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* 지원 안 함 */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && wakeLock === null && localStorage.getItem('ra-wake') === '1' && timerState()?.runningSince) keepAwake(true); });

export function renderTimer(el, bookId) {
  clearInterval(tick);
  const st = timerState();
  if (st) return running(el, st);
  if (!bookId) return pickBook(el);
  return ready(el, bookId);
}

function pickBook(el) {
  const reading = S.books.filter(b => b.status === 'reading');
  const open = S.sessions.filter(s => !s.ended_at);
  el.innerHTML = `<h1>독서 타이머</h1>
    ${open.length ? `<div class="card warn"><b>끝나지 않은 세션이 있어요</b>${open.map(s => `<div class="row gap mt"><span class="grow small">『${esc(db.book(s.book_id)?.title || '')}』 ${new Date(s.started_at).toLocaleString('ko-KR')} 시작</span><button class="btn small" data-resume="${s.id}">이어서</button><button class="btn small danger ghost" data-drop="${s.id}">버리기</button></div>`).join('')}</div>` : ''}
    <p class="muted">어떤 책을 읽을까요?</p>
    ${reading.length ? `<div class="list">${reading.map(b => `<button class="card row gap pick-book" data-b="${b.id}">${coverImg(b, 'cover xs')}<span class="grow"><b>${esc(b.title)}</b><span class="muted small block">${lastPage(b.id) ? lastPage(b.id) + '쪽까지 읽음' : '처음부터'}</span></span><span class="chev">›</span></button>`).join('')}</div>` : '<p class="card muted">읽는 중인 책이 없어요. <a href="#/library">서재</a>에서 책을 추가하세요.</p>'}`;
  el.querySelectorAll('[data-b]').forEach(x => x.onclick = () => go('#/timer/' + x.dataset.b));
  el.querySelectorAll('[data-resume]').forEach(x => x.onclick = () => {
    const s = S.sessions.find(z => z.id === x.dataset.resume);
    setState({ sessionId: s.id, bookId: s.book_id, startedAt: new Date(s.started_at).getTime(), accMs: (s.seconds || 0) * 1000, runningSince: null, startPage: s.start_page });
    toast('일시정지 상태로 이어요. 실제 읽은 시간은 종료할 때 고칠 수 있어요');
    renderTimer(el);
  });
  el.querySelectorAll('[data-drop]').forEach(x => x.onclick = async () => { if (await confirmBox('이 세션을 버릴까요?', '버리기')) { await db.remove('sessions', x.dataset.drop); renderTimer(el); } });
}

function ready(el, bookId) {
  const b = db.book(bookId);
  if (!b) return pickBook(el);
  const sp = suggestStartPage(bookId);
  el.innerHTML = `<div class="timer-screen">
    ${coverImg(b, 'cover lg')}
    <h2>${esc(b.title)}</h2>
    <div class="muted">${esc(b.author || '')}</div>
    <label class="start-page">시작 쪽<input type="number" inputmode="numeric" value="${sp}" data-sp></label>
    <div class="big-time">00:00:00</div>
    <button class="btn primary xl" data-start>읽기 시작</button>
    <label class="check small"><input type="checkbox" data-wake ${localStorage.getItem('ra-wake') === '1' ? 'checked' : ''}> 읽는 동안 화면 켜두기</label>
  </div>`;
  el.querySelector('[data-wake]').onchange = e => localStorage.setItem('ra-wake', e.target.checked ? '1' : '0');
  el.querySelector('[data-start]').onclick = async () => {
    const startPage = Number(el.querySelector('[data-sp]').value) || null;
    const now = Date.now();
    try {
      const s = await db.save('sessions', { book_id: bookId, started_at: new Date(now).toISOString(), seconds: 0, start_page: startPage });
      if (b.status !== 'reading' || !b.start_date) await db.save('books', { ...b, status: 'reading', start_date: b.start_date || new Date().toISOString().slice(0, 10) });
      setState({ sessionId: s.id, bookId, startedAt: now, accMs: 0, runningSince: now, startPage });
      if (localStorage.getItem('ra-wake') === '1') keepAwake(true);
      renderTimer(el);
    } catch (e) { toast('시작 실패: ' + e.message); }
  };
}

function running(el, st) {
  const b = db.book(st.bookId);
  if (!b) { setState(null); return pickBook(el); }
  const quotes = S.quotes.filter(q => q.session_id === st.sessionId);
  el.innerHTML = `<div class="timer-screen ${st.runningSince ? 'live' : 'paused'}">
    ${coverImg(b, 'cover lg')}
    <h2>${esc(b.title)}</h2>
    <div class="muted small">${st.startPage ? st.startPage + '쪽부터' : ''} · ${new Date(st.startedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 시작</div>
    <div class="big-time" data-t>00:00:00</div>
    <div class="muted small">${st.runningSince ? '읽는 중' : '일시정지'}</div>
    <div class="row gap center wrap">
      ${st.runningSince ? '<button class="btn xl" data-pause>일시정지</button>' : '<button class="btn primary xl" data-resume>계속 읽기</button>'}
      <button class="btn danger xl" data-end>종료</button>
    </div>
    <button class="btn accent xl block quick-quote" data-quote>문장 빠르게 저장</button>
    <div class="row gap center wrap">
      <button class="btn small" data-guide>읽는 중 가이드 (동반 독서 파트너)</button>
      <button class="btn small ghost" data-cancel>기록 취소</button>
    </div>
    <p class="muted small">메모 3종 · 공감: ${MEMO_HELP['공감']} / 의문: ${MEMO_HELP['의문']} / 연결: ${MEMO_HELP['연결']}</p>
    ${quotes.length ? `<div class="session-quotes"><b class="small">이번 세션에 저장한 문장 ${quotes.length}</b>${quotes.map(q => `<div class="mini-quote">${nl2br(q.body.slice(0, 120))} <span class="muted small">${q.page ? 'p.' + q.page : ''} ${q.memo_type || ''}</span></div>`).join('')}</div>` : ''}
  </div>`;
  const t = el.querySelector('[data-t]');
  const draw = () => { const s = Math.floor(elapsedMs(st) / 1000); t.textContent = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  draw(); tick = setInterval(() => { if (!document.body.contains(t)) return clearInterval(tick); draw(); }, 500);

  el.querySelector('[data-pause]')?.addEventListener('click', () => { st.accMs = elapsedMs(st); st.runningSince = null; setState(st); persist(st); keepAwake(false); renderTimer(el); });
  el.querySelector('[data-resume]')?.addEventListener('click', () => { st.runningSince = Date.now(); setState(st); if (localStorage.getItem('ra-wake') === '1') keepAwake(true); renderTimer(el); });
  el.querySelector('[data-quote]').onclick = () => quoteModal({ bookId: st.bookId, sessionId: st.sessionId, page: lastPage(st.bookId) || st.startPage, onSaved: () => renderTimer(el) });
  el.querySelector('[data-guide]').onclick = () => go(`#/guide/new/during?book=${st.bookId}`);
  el.querySelector('[data-cancel]').onclick = async () => {
    if (!(await confirmBox('이번 독서 기록을 취소할까요? (저장한 문장은 남아요)', '기록 취소'))) return;
    clearInterval(tick); await db.remove('sessions', st.sessionId).catch(() => {}); setState(null); keepAwake(false); renderTimer(el);
  };
  el.querySelector('[data-end]').onclick = () => endModal(el, st);
}

function persist(st) {
  const s = S.sessions.find(x => x.id === st.sessionId);
  if (s) db.save('sessions', { ...s, seconds: Math.round(elapsedMs(st) / 1000) }).catch(() => {});
}

function endModal(el, st) {
  const b = db.book(st.bookId);
  const secs = Math.round(elapsedMs(st) / 1000);
  // 종료 모달이 열린 동안 시간 멈춤
  if (st.runningSince) { st.accMs = elapsedMs(st); st.runningSince = null; setState(st); }
  const m = openModal(`<h3>독서 종료</h3>
    <p>『${esc(b.title)}』 <b>${fmtDur(secs)}</b> 읽었어요.</p>
    <form class="form" id="ef">
      <div class="row gap"><label class="grow">시작 쪽<input type="number" name="start_page" value="${esc(st.startPage ?? '')}"></label>
      <label class="grow">종료 쪽 (읽은 마지막 쪽)<input type="number" name="end_page" required inputmode="numeric" ${b.pages ? `max="${b.pages}"` : ''} autofocus></label></div>
      <label>순수 읽은 시간(분)<input type="number" name="minutes" min="0" value="${Math.max(1, Math.round(secs / 60))}"></label>
      <label>메모 (선택)<input name="memo" placeholder="오늘 독서 한 줄"></label>
      <label class="check"><input type="checkbox" name="done" ${b.pages ? '' : ''}> 이 책을 다 읽었어요 (완독)</label>
      <div class="row end gap"><button type="button" class="btn" data-back>계속 읽기</button><button class="btn primary">저장하고 인증 이미지 만들기</button></div>
    </form>`);
  const f = m.el.querySelector('#ef');
  f.end_page.oninput = () => { if (b.pages && Number(f.end_page.value) >= b.pages) f.done.checked = true; };
  m.el.querySelector('[data-back]').onclick = () => { st.runningSince = Date.now(); setState(st); m.close(); renderTimer(el); };
  f.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(f);
    const endPage = Number(fd.get('end_page'));
    const s0 = S.sessions.find(x => x.id === st.sessionId) || { id: st.sessionId, book_id: st.bookId, started_at: new Date(st.startedAt).toISOString() };
    try {
      const s = await db.save('sessions', { ...s0, ended_at: new Date().toISOString(), seconds: Math.round(Number(fd.get('minutes')) * 60), start_page: fd.get('start_page'), end_page: endPage, memo: fd.get('memo') });
      const patch = { ...b, current_page: Math.max(endPage, b.current_page || 0) };
      const finished = fd.get('done') === 'on';
      if (finished) { patch.status = 'done'; patch.finish_date = new Date().toISOString().slice(0, 10); }
      await db.save('books', patch);
      if (finished) await ensureReviews(b.id, patch.finish_date);
      setState(null); keepAwake(false); clearInterval(tick);
      m.close();
      toast('독서 기록을 저장했어요');
      certModal(s, { afterClose: () => { if (finished) go(`#/guide/new/after?book=${b.id}`); else go('#/home'); }, justFinished: finished });
    } catch (err) { toast('저장 실패: ' + err.message); }
  };
}
