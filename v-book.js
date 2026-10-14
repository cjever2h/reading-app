// 책 상세: 정보 · 세션 · 문장 · 노트 · 정리 · 가이드 · 실험 · 내보내기
import * as db from './db.js';
import { S } from './db.js';
import { esc, nl2br, coverImg, STATUS, fmtDate, fmtTime, fmtDur, stars, tagChips, toast, ymd, openModal, NOTE_KINDS, copyText, download, parseTags, addDays, confirmBox } from './ui.js';
import { quoteModal, noteModal, bookEditModal, sessionModal } from './forms.js';
import { bookSeconds, lastPage, progress, pagesOf, ensureReviews, aiOn } from './calc.js';
import { go, refresh } from './app.js';
import { MODES } from './guide-data.js';
import { notebookMarkdown, reviewDraft, cardNewsCopy, threadsDraft, discussionMarkdown, aiPolish, sendToNotion } from './export.js';
import { renderDBPanel } from './v-db.js';
import { certModal } from './cert.js';

const TABS = [['info', '개요'], ['sessions', '세션'], ['quotes', '문장'], ['notes', '노트'], ['summary', '완독 정리'], ['guide', '가이드'], ['exp', '30일 실험'], ['export', '내보내기']];

export function renderBook(el, id, tab = 'info') {
  const b = db.book(id);
  if (!b) { el.innerHTML = '<div class="card">책을 찾을 수 없어요. <a href="#/library">서재로</a></div>'; return; }
  const p = progress(b);
  const secs = bookSeconds(id);
  el.innerHTML = `
  <div class="split">
    <div class="split-main">
      <div class="book-head card">
        ${coverImg(b, 'cover lg')}
        <div class="grow">
          <div class="row gap wrap"><span class="badge st-${b.status}">${STATUS[b.status]}</span>${b.genre ? `<span class="chip">${esc(b.genre)}</span>` : ''}${tagChips(b.tags)}</div>
          <h1 class="book-title">${esc(b.title)}</h1>
          <div class="muted">${esc(b.author || '')} · ${esc(b.publisher || '')} ${b.pub_date ? '· ' + esc(b.pub_date.slice(0, 10)) : ''}</div>
          <div class="kv mt">
            <span>쪽수 <b>${b.pages || '-'}</b></span><span>현재 <b>${lastPage(id) || 0}쪽</b>${p != null ? ` (${p}%)` : ''}</span>
            <span>독서 시간 <b>${fmtDur(secs)}</b></span><span>별점 <b class="stars">${b.rating ? stars(b.rating) + ` ${b.rating}` : '미입력'}</b></span>
          </div>
          ${p != null ? `<div class="bar"><i style="width:${p}%"></i></div>` : ''}
          <div class="row gap wrap mt">
            ${b.status !== 'done' ? `<button class="btn primary" data-act="timer">타이머 시작</button>` : ''}
            <button class="btn" data-act="quote">+ 문장</button>
            <button class="btn" data-act="note">+ 노트</button>
            ${b.status === 'want' ? `<button class="btn" data-act="startread">읽기 시작</button>` : ''}
            ${b.status === 'reading' ? `<button class="btn" data-act="finish">완독 처리</button>` : ''}
            <button class="btn ghost" data-act="edit">정보 수정</button>
          </div>
        </div>
      </div>
      <div class="tabs scroll">${TABS.map(([k, v]) => `<a class="${tab === k ? 'on' : ''}" href="#/book/${id}/${k}">${v}${countBadge(id, k)}</a>`).join('')}</div>
      <div data-tab></div>
    </div>
    <aside class="split-side" data-side></aside>
  </div>`;

  el.querySelector('[data-act=edit]').onclick = () => bookEditModal({ book: b, onSaved: refresh });
  el.querySelector('[data-act=quote]').onclick = () => quoteModal({ bookId: id, page: lastPage(id) || null, onSaved: refresh });
  el.querySelector('[data-act=note]').onclick = () => noteModal({ bookId: id, kind: 'chapter', onSaved: refresh });
  el.querySelector('[data-act=timer]')?.addEventListener('click', () => go('#/timer/' + id));
  el.querySelector('[data-act=startread]')?.addEventListener('click', async () => { await db.save('books', { ...b, status: 'reading', start_date: b.start_date || ymd() }); refresh(); });
  el.querySelector('[data-act=finish]')?.addEventListener('click', () => finishBook(b));

  const T = el.querySelector('[data-tab]');
  ({ info: tabInfo, sessions: tabSessions, quotes: tabQuotes, notes: tabNotes, summary: tabSummary, guide: tabGuide, exp: tabExp, export: tabExport }[tab] || tabInfo)(T, b);

  if (window.matchMedia('(min-width: 1100px)').matches) renderDBPanel(el.querySelector('[data-side]'), { bookId: id });
}

function countBadge(id, k) {
  const n = { sessions: db.byBook('sessions', id).filter(s => s.ended_at).length, quotes: db.byBook('quotes', id).length, notes: db.byBook('notes', id).length, guide: db.byBook('guides', id).length, exp: db.byBook('experiments', id).length }[k];
  return n ? ` <span class="muted">${n}</span>` : '';
}

async function finishBook(b) {
  const m = openModal(`<h3>완독을 축하해요</h3>
    <p>『${esc(b.title)}』 완독 처리를 할게요. 별점은 직접 입력해 주세요.</p>
    <form class="form" id="ff">
      <div class="row gap"><label class="grow">완독일<input type="date" name="finish_date" value="${ymd()}"></label>
      <label class="grow">별점 (0~5, 0.5 단위)<input type="number" name="rating" min="0" max="5" step="0.5" value="${esc(b.rating ?? '')}"></label></div>
      <p class="muted small">완독 후 72시간 루틴: 오늘(D+0) 한 줄 요약·핵심 문장 3개·액션 아이템 1개를 직접 쓰고(약 35분), D+1·D+3·D+7에 '오늘의 복습'이 올라와요.</p>
      <div class="row end gap"><button class="btn primary">완독 처리하고 정리 시작</button></div>
    </form>`);
  m.el.querySelector('#ff').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await db.save('books', { ...b, status: 'done', finish_date: fd.get('finish_date'), rating: fd.get('rating'), current_page: b.pages || lastPage(b.id) });
    await ensureReviews(b.id, fd.get('finish_date'));
    m.close();
    toast('완독! 72시간 루틴을 시작해요');
    go(`#/guide/new/after?book=${b.id}`);
  };
}

/* ---------- 개요 ---------- */
function tabInfo(T, b) {
  const pre = b.pre_questions || {}, goal = b.goal || {};
  const hasPre = pre.expect || pre.doubt || pre.connect;
  T.innerHTML = `
    <div class="card">
      <div class="sec-head"><h3>읽기 전 질문과 독서 목표</h3><button class="btn small" data-go="#/guide/new/pre?book=${b.id}">${hasPre ? '가이드로 다시 하기' : '읽기 전 가이드 시작'}</button></div>
      <form class="form" id="pref">
        <label>기대: 이 책에서 얻고 싶은 것<textarea name="expect" rows="2">${esc(pre.expect || '')}</textarea></label>
        <label>의심: 확인하고 싶은 주장<textarea name="doubt" rows="2">${esc(pre.doubt || '')}</textarea></label>
        <label>연결: 내 삶·이전 책과의 연결<textarea name="connect" rows="2">${esc(pre.connect || '')}</textarea></label>
        <div class="row gap wrap">
          <label class="grow">읽는 기간<input name="period" value="${esc(goal.period || '')}"></label>
          <label class="grow">읽는 이유<input name="reason" value="${esc(goal.reason || b.reason || '')}"></label>
        </div>
        <div class="row gap wrap">
          <label class="grow">읽고 난 후 달라질 점<input name="change" value="${esc(goal.change || '')}"></label>
          <label class="grow">활용 계획<input name="plan" value="${esc(goal.plan || '')}"></label>
        </div>
        <div class="row end"><button class="btn primary small">저장</button></div>
      </form>
    </div>
    ${b.toc ? `<details class="card"><summary><b>목차</b></summary><div class="pre-wrap small">${esc(b.toc)}</div></details>` : ''}
    ${b.description ? `<details class="card" ${hasPre ? '' : 'open'}><summary><b>책 소개</b></summary><p class="small">${nl2br(b.description)}</p></details>` : ''}
    ${b.source === 'aladin' ? `<p class="muted small">도서 정보 출처: <a href="${esc(b.aladin_link || 'https://www.aladin.co.kr')}" target="_blank" rel="noopener">알라딘</a></p>` : b.source === 'google' ? '<p class="muted small">도서 정보 출처: Google Books</p>' : ''}
  `;
  T.querySelector('[data-go]').onclick = e => go(e.target.dataset.go);
  T.querySelector('#pref').onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(e.target);
    await db.save('books', { ...b, pre_questions: { expect: fd.get('expect'), doubt: fd.get('doubt'), connect: fd.get('connect') }, goal: { period: fd.get('period'), reason: fd.get('reason'), change: fd.get('change'), plan: fd.get('plan') }, reason: b.reason || fd.get('reason') });
    toast('저장했어요');
  };
}

/* ---------- 세션 ---------- */
function tabSessions(T, b) {
  const list = db.byBook('sessions', b.id).filter(s => s.ended_at).sort((a, c) => c.started_at.localeCompare(a.started_at));
  T.innerHTML = list.length ? `<div class="list">${list.map(s => `
    <div class="card row gap session-row">
      <div class="grow"><b>${fmtDate(s.started_at)}</b> <span class="muted small">${fmtTime(s.started_at)}~${fmtTime(s.ended_at)}</span>
      <div class="small">${fmtDur(s.seconds)} · ${s.start_page ?? '?'}~${s.end_page ?? '?'}쪽 (${pagesOf(s)}쪽)${s.photo_path ? ' · 사진' : ''}</div>
      ${s.memo ? `<div class="muted small">${esc(s.memo)}</div>` : ''}</div>
      <button class="btn small" data-cert="${s.id}">인증 이미지</button>
      <button class="btn small ghost" data-edit="${s.id}">수정</button>
    </div>`).join('')}</div>` : '<p class="card muted">아직 독서 세션이 없어요. 타이머로 읽기를 시작해 보세요.</p>';
  T.querySelectorAll('[data-edit]').forEach(x => x.onclick = () => sessionModal(S.sessions.find(s => s.id === x.dataset.edit), refresh));
  T.querySelectorAll('[data-cert]').forEach(x => x.onclick = () => certModal(S.sessions.find(s => s.id === x.dataset.cert)));
}

/* ---------- 문장 ---------- */
function tabQuotes(T, b) {
  const list = db.byBook('quotes', b.id).sort((a, c) => (a.page || 0) - (c.page || 0));
  T.innerHTML = `<div class="row end mb"><button class="btn small primary" data-new>+ 문장 저장</button></div>` + (list.length ? `<div class="list">${list.map(q => quoteCard(q)).join('')}</div>` : '<p class="card muted">저장한 문장이 없어요.</p>');
  T.querySelector('[data-new]').onclick = () => quoteModal({ bookId: b.id, page: lastPage(b.id) || null, onSaved: refresh });
  T.querySelectorAll('[data-q]').forEach(x => x.onclick = () => quoteModal({ quote: S.quotes.find(q => q.id === x.dataset.q), onSaved: refresh }));
}
export function quoteCard(q, showBook = false) {
  const bk = showBook ? db.book(q.book_id) : null;
  return `<div class="card quote" data-q="${q.id}">
    <blockquote>${nl2br(q.body)}</blockquote>
    <div class="row gap wrap small">${q.page ? `<span class="muted">p.${q.page}</span>` : ''}${bk ? `<span class="muted">『${esc(bk.title)}』</span>` : ''}${q.memo_type ? `<span class="badge mt-${q.memo_type}">${q.memo_type}</span>` : ''}${tagChips(q.tags)}</div>
    ${q.memo ? `<div class="memo">${nl2br(q.memo)}</div>` : ''}
  </div>`;
}

/* ---------- 노트 ---------- */
function tabNotes(T, b) {
  const list = db.byBook('notes', b.id).sort((a, c) => c.note_date.localeCompare(a.note_date) || (c.created_at || '').localeCompare(a.created_at || ''));
  T.innerHTML = `<div class="row end gap mb wrap">
      <button class="btn small" data-new="chapter">+ 챕터별 메모</button><button class="btn small" data-new="daily">+ 일일 노트</button><button class="btn small" data-new="free">+ 자유 노트</button>
      <button class="btn small primary" data-nb>독서노트 전체 보기</button></div>` +
    (list.length ? `<div class="list">${list.map(n => noteCard(n)).join('')}</div>` : '<p class="card muted">노트가 없어요. 챕터별 메모 템플릿으로 시작해 보세요.</p>');
  T.querySelectorAll('[data-new]').forEach(x => x.onclick = () => noteModal({ bookId: b.id, kind: x.dataset.new, onSaved: refresh }));
  T.querySelectorAll('[data-n]').forEach(x => x.onclick = () => noteModal({ note: S.notes.find(n => n.id === x.dataset.n), onSaved: refresh }));
  T.querySelector('[data-nb]').onclick = () => showMarkdown('독서노트', notebookMarkdown(b.id), b);
}
export function noteCard(n, showBook = false) {
  const bk = showBook && n.book_id ? db.book(n.book_id) : null;
  return `<div class="card note" data-n="${n.id}">
    <div class="row gap wrap small"><span class="badge">${NOTE_KINDS[n.kind] || n.kind}</span><span class="muted">${fmtDate(n.note_date)}</span>${bk ? `<span class="muted">『${esc(bk.title)}』</span>` : ''}${tagChips(n.tags)}</div>
    ${n.title ? `<b>${esc(n.title)}</b>` : ''}
    <div class="note-body">${nl2br(String(n.body).slice(0, 400))}${String(n.body).length > 400 ? '…' : ''}</div>
  </div>`;
}

/* ---------- 완독 정리 ---------- */
function tabSummary(T, b) {
  const sm = db.summaryOf(b.id) || { book_id: b.id, key_quotes: [{}, {}, {}], concepts: [], content_used: {} };
  const kq = [0, 1, 2].map(i => (sm.key_quotes || [])[i] || {});
  const cu = sm.content_used || {};
  const reviews = db.byBook('reviews', b.id).sort((a, c) => a.stage.localeCompare(c.stage));
  const quotes = db.byBook('quotes', b.id);
  const hours = b.finish_date ? Math.round((Date.now() - new Date(b.finish_date + 'T00:00:00')) / 3600000) : null;
  T.innerHTML = `
  ${b.status !== 'done' ? '<p class="card muted small">완독 처리 후 72시간 안에 정리하면 가장 오래 남아요. 지금 미리 써도 괜찮아요.</p>' : (hours != null && hours <= 72 ? `<p class="card accent small">완독 후 ${hours}시간째. 72시간 안에 정리를 마쳐요.</p>` : '')}
  <div class="card">
    <div class="sec-head"><h3>완독 후 정리</h3><button class="btn small" data-go="#/guide/new/after?book=${b.id}">읽은 후 가이드로 쓰기</button></div>
    <form class="form" id="smf">
      <label>한 줄 요약 (10분)<input name="one_line" value="${esc(sm.one_line || '')}" placeholder="이 책은 ___에게 ___라고 말한다"></label>
      <div class="field-label">핵심 문장 3개와 이유 (15분) ${quotes.length ? `<span class="muted small">· 저장한 문장에서 고르기 가능</span>` : ''}</div>
      ${kq.map((k, i) => `<div class="kq">
        <div class="row gap"><textarea class="grow" name="kq${i}_text" rows="2" placeholder="핵심 문장 ${i + 1}">${esc(k.text || '')}</textarea><input name="kq${i}_page" type="number" placeholder="쪽" value="${esc(k.page ?? '')}" style="width:5rem"></div>
        <div class="row gap"><input class="grow" name="kq${i}_reason" placeholder="고른 이유" value="${esc(k.reason || '')}">${quotes.length ? `<button type="button" class="btn small ghost" data-pick="${i}">문장 고르기</button>` : ''}</div>
      </div>`).join('')}
      <label>액션 아이템 1개 (10분)<input name="action_item" value="${esc(sm.action_item || '')}" placeholder="언제·어디서·얼마나"></label>
      <label>논지 압축: 핵심 3가지를 내 말로<textarea name="thesis" rows="3">${esc(sm.thesis || '')}</textarea></label>
      <label>파인만 설명: 중학생에게 설명하듯<textarea name="feynman" rows="3">${esc(sm.feynman || '')}</textarea></label>
      <label>핵심 개념 태그 (5개 내외, 쉼표 구분)<input name="concepts" value="${esc((sm.concepts || []).join(', '))}"></label>
      <label>연결된 책 (이 책과 이어지는 다른 책, 쉼표 구분)<input name="linked_books" value="${esc((sm.linked_books || []).join(', '))}" placeholder="예: 총, 균, 쇠, 팩트풀니스"></label>
      <div class="field-label">콘텐츠 활용</div>
      <div class="row gap wrap">${[['blog', '블로그 서평'], ['card', '카드뉴스'], ['threads', '스레드'], ['club', '독서모임 발제']].map(([k, v]) => `<label class="check"><input type="checkbox" name="cu_${k}" ${cu[k] ? 'checked' : ''}> ${v}</label>`).join('')}</div>
      <div class="row end gap"><button class="btn primary">정리 저장</button></div>
    </form>
  </div>
  <div class="card">
    <h3>복습 일정</h3>
    ${reviews.length ? `<div class="list">${reviews.map(r => `<a class="row gap review-row" href="#/review/${r.id}"><span class="badge">${r.stage}</span><span>${fmtDate(r.due_date)}</span><span class="grow muted small">${r.done ? '완료' : (r.due_date <= ymd() ? '오늘 할 차례' : '예정')}</span><span class="chev">›</span></a>`).join('')}</div>` : `<p class="muted small">정리를 저장하면 D+1·D+3·D+7 복습이 만들어져요.</p>`}
  </div>
  <div class="row end gap"><button class="btn" data-nb>독서노트(노션 구조) 보기</button>${sm.action_item ? `<button class="btn" data-exp>액션을 30일 실험으로</button>` : ''}</div>`;

  T.querySelector('[data-go]').onclick = e => go(e.target.dataset.go);
  T.querySelector('[data-nb]').onclick = () => showMarkdown('독서노트', notebookMarkdown(b.id), b);
  T.querySelector('[data-exp]')?.addEventListener('click', () => go(`#/book/${b.id}/exp`));
  T.querySelectorAll('[data-pick]').forEach(btn => btn.onclick = () => {
    const i = btn.dataset.pick;
    const m = openModal(`<h3>문장 고르기</h3><div class="list">${quotes.map(q => `<div class="card quote pickable" data-id="${q.id}"><blockquote>${nl2br(q.body)}</blockquote><span class="muted small">${q.page ? 'p.' + q.page : ''} ${q.memo ? '· ' + esc(q.memo) : ''}</span></div>`).join('')}</div>`, { wide: true });
    m.el.querySelectorAll('[data-id]').forEach(c => c.onclick = () => {
      const q = quotes.find(x => x.id === c.dataset.id);
      const f = T.querySelector('#smf');
      f[`kq${i}_text`].value = q.body; f[`kq${i}_page`].value = q.page ?? ''; if (!f[`kq${i}_reason`].value) f[`kq${i}_reason`].value = q.memo || '';
      m.close();
    });
  });
  T.querySelector('#smf').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, fd = new FormData(f);
    const row = {
      ...sm, book_id: b.id, one_line: fd.get('one_line'), action_item: fd.get('action_item'), thesis: fd.get('thesis'), feynman: fd.get('feynman'),
      concepts: parseTags(fd.get('concepts').replace(/,/g, ',')).slice(0, 10),
      key_quotes: [0, 1, 2].map(i => ({ text: fd.get(`kq${i}_text`).trim(), page: fd.get(`kq${i}_page`) ? Number(fd.get(`kq${i}_page`)) : null, reason: fd.get(`kq${i}_reason`).trim() })),
      content_used: Object.fromEntries(['blog', 'card', 'threads', 'club'].map(k => [k, fd.get('cu_' + k) === 'on'])),
      written_at: sm.written_at || new Date().toISOString(),
    };
    row.concepts = String(fd.get('concepts')).split(',').map(s => s.trim()).filter(Boolean).slice(0, 10);
    row.linked_books = String(fd.get('linked_books')).split(',').map(s => s.trim()).filter(Boolean);
    await db.save('summaries', row);
    await ensureReviews(b.id, b.finish_date || ymd());
    toast('정리를 저장했어요. 복습 일정이 잡혔어요');
    refresh();
  };
}

/* ---------- 가이드 ---------- */
function tabGuide(T, b) {
  const list = db.byBook('guides', b.id).sort((a, c) => (c.updated_at || '').localeCompare(a.updated_at || ''));
  T.innerHTML = `<div class="mode-grid">${Object.entries(MODES).map(([k, m]) => `<button class="card mode-card" data-mode="${k}"><b>${m.name}</b><span class="muted small">${m.when}</span><span class="small">${m.desc}</span></button>`).join('')}</div>
    <h3 class="mt">지난 대화</h3>
    ${list.length ? `<div class="list">${list.map(g => `<a class="card row gap" href="#/guide/${g.id}"><span class="badge">${MODES[g.mode]?.name || '빠른 카드'}</span><span class="grow small">${esc(g.summary || (g.messages || []).filter(m => m.role === 'user').slice(-1)[0]?.text?.slice(0, 60) || '')}</span><span class="muted small">${fmtDate(g.updated_at || g.created_at, false)}</span></a>`).join('')}</div>` : '<p class="muted small">아직 가이드 대화가 없어요.</p>'}`;
  T.querySelectorAll('[data-mode]').forEach(x => x.onclick = () => go(`#/guide/new/${x.dataset.mode}?book=${b.id}`));
}

/* ---------- 30일 실험 ---------- */
function tabExp(T, b) {
  const list = db.byBook('experiments', b.id);
  const sm = db.summaryOf(b.id);
  const today = ymd();
  T.innerHTML = `
  <div class="card">
    <h3>새 30일 실험</h3>
    <form class="form" id="exf">
      <label>액션 아이템<input name="action" required value="${esc(sm?.action_item || '')}" placeholder="예: 매일 아침 7시 가계부 5분 쓰기"></label>
      <div class="row gap wrap"><label class="grow">성공 기준<input name="criteria" placeholder="예: 30일 중 20일 이상"></label><label>시작일<input type="date" name="start_date" value="${today}"></label></div>
      <div class="row end"><button class="btn primary small">실험 시작</button></div>
    </form>
  </div>
  ${list.map(x => {
    const checks = x.checks || {};
    const days = Array.from({ length: 30 }, (_, i) => addDays(x.start_date, i));
    const done = days.filter(d => checks[d]).length;
    const dayNo = Math.min(30, Math.max(0, Math.floor((new Date(today) - new Date(x.start_date)) / 86400000) + 1));
    return `<div class="card exp" data-x="${x.id}">
      <div class="sec-head"><b>${esc(x.action)}</b><span class="muted small">${dayNo > 0 ? `Day ${dayNo}/30` : '시작 전'} · 실행 ${done}일</span></div>
      ${x.plan?.criteria ? `<div class="muted small">성공 기준: ${esc(x.plan.criteria)}</div>` : ''}
      <div class="exp-grid">${days.map((d, i) => `<button class="day ${checks[d] ? 'on' : ''} ${d === today ? 'today' : ''} ${d > today ? 'future' : ''}" data-d="${d}" ${d > today ? 'disabled' : ''} title="${d}">${i + 1}</button>`).join('')}</div>
      <label class="mt">결과 메모<textarea rows="2" data-memo>${esc(x.result_memo || '')}</textarea></label>
      <div class="row end gap"><button class="btn small danger ghost" data-del>삭제</button><button class="btn small" data-save>메모 저장</button></div>
    </div>`;
  }).join('')}`;
  T.querySelector('#exf').onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(e.target);
    await db.save('experiments', { book_id: b.id, action: fd.get('action'), start_date: fd.get('start_date'), checks: {}, plan: { criteria: fd.get('criteria') } });
    toast('30일 실험을 시작했어요'); refresh();
  };
  T.querySelectorAll('.exp').forEach(card => {
    const x = S.experiments.find(e => e.id === card.dataset.x);
    card.querySelectorAll('[data-d]').forEach(btn => btn.onclick = async () => {
      const checks = { ...(x.checks || {}) }; checks[btn.dataset.d] = !checks[btn.dataset.d]; if (!checks[btn.dataset.d]) delete checks[btn.dataset.d];
      await db.save('experiments', { ...x, checks }); refresh();
    });
    card.querySelector('[data-save]').onclick = async () => { await db.save('experiments', { ...x, result_memo: card.querySelector('[data-memo]').value }); toast('저장했어요'); };
    card.querySelector('[data-del]').onclick = async () => { if (await confirmBox('이 실험을 삭제할까요?', '삭제')) { await db.remove('experiments', x.id); refresh(); } };
  });
}

/* ---------- 내보내기 ---------- */
function tabExport(T, b) {
  const kinds = [
    ['notebook', '독서노트 (노션 구조)', () => notebookMarkdown(b.id)],
    ['review', '블로그 서평 초안', () => reviewDraft(b.id)],
    ['card', '카드뉴스 카피', () => cardNewsCopy(b.id)],
    ['threads', '스레드 초안', () => threadsDraft(b.id)],
    ['discussion', '독서모임 발제 질문', () => discussionMarkdown(b.id)],
  ];
  T.innerHTML = `<p class="muted small">저장한 문장·노트·완독 정리로 초안을 만들어요. '기억할 한 문장'은 실제 책 문장만, 내 해석은 '내 생각/나의 한 줄 평'으로 구분돼요.</p>
  <div class="mode-grid">${kinds.map(([k, label]) => `<button class="card mode-card" data-k="${k}"><b>${label}</b></button>`).join('')}</div>`;
  T.querySelectorAll('[data-k]').forEach(x => x.onclick = () => {
    const [k, label, fn] = kinds.find(z => z[0] === x.dataset.k);
    showMarkdown(label, fn(), b, k);
  });
}

export function showMarkdown(title, md, b, kind = 'notebook') {
  const m = openModal(`<h3>${esc(title)}</h3>
    <textarea class="w100 mono" rows="18" data-md>${esc(md)}</textarea>
    <div class="row gap wrap mt">
      <button class="btn" data-copy>복사</button>
      <button class="btn" data-dl>.md 저장</button>
      <button class="btn" data-notion>노션으로 보내기</button>
      ${kind !== 'notebook' && aiOn() ? '<button class="btn" data-ai>AI로 다듬기</button>' : ''}
      <button class="btn primary" data-save>노트로 저장</button>
    </div>
    <p class="muted small" data-msg></p>`, { wide: true });
  const ta = m.el.querySelector('[data-md]');
  const msg = m.el.querySelector('[data-msg]');
  m.el.querySelector('[data-copy]').onclick = () => copyText(ta.value);
  m.el.querySelector('[data-dl]').onclick = () => download(`${b.title}-${title}.md`.replace(/[\\/:*?"<>|]/g, '_'), ta.value, 'text/markdown;charset=utf-8');
  m.el.querySelector('[data-notion]').onclick = async () => {
    if (!S.settings.notion_parent) { msg.innerHTML = '설정에서 노션 통합 토큰과 상위 페이지를 먼저 연결하세요. (또는 복사 후 노션에 붙여넣기하면 서식이 그대로 들어가요)'; return; }
    msg.textContent = '노션으로 보내는 중…';
    try { const r = await sendToNotion(`${b.title} · ${title}`, ta.value); msg.innerHTML = `노션에 만들었어요: <a href="${esc(r.url)}" target="_blank" rel="noopener">열기</a>`; } catch (e) { msg.textContent = '실패: ' + e.message; }
  };
  m.el.querySelector('[data-ai]')?.addEventListener('click', async () => {
    msg.textContent = 'AI가 다듬는 중… (내 문장은 최대한 살려요)';
    try { const t = await aiPolish(b.id, kind, ta.value); ta.value = t; msg.textContent = 'AI가 다듬은 버전이에요. 인용 문장이 원문과 같은지 확인하세요.'; } catch (e) { msg.textContent = '실패: ' + e.message; }
  });
  m.el.querySelector('[data-save]').onclick = async () => {
    await db.save('notes', { book_id: b.id, kind: 'free', title, body: ta.value, note_date: ymd(), tags: [] });
    const sm = db.summaryOf(b.id);
    const cuKey = { review: 'blog', card: 'card', threads: 'threads', discussion: 'club' }[kind];
    if (sm && cuKey) await db.save('summaries', { ...sm, content_used: { ...(sm.content_used || {}), [cuKey]: true } });
    toast('노트로 저장했어요');
  };
}
