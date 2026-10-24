// 공통 입력 폼: 문장, 노트, 책 검색·추가, 책 정보 수정
import * as db from './db.js';
import { S } from './db.js';
import { esc, openModal, toast, parseTags, GENRES, STATUS, MEMO_TYPES, NOTE_KINDS, ymd, coverImg, mapGenre, confirmBox } from './ui.js';
import { MEMO_HELP } from './guide-data.js';
import { runOcr } from './ocr.js';
import { lastPage } from './calc.js';

/* ---------- 문장 저장 ---------- */
export function quoteModal({ bookId, sessionId = null, page = null, quote = null, onSaved } = {}) {
  const q = quote || {};
  const bid = q.book_id || bookId;
  const books = S.books;
  const m = openModal(`
    <h3>${q.id ? '문장 수정' : '문장 저장'}</h3>
    <form class="form" id="qf">
      <label>책<select name="book_id" required>${books.map(b => `<option value="${b.id}" ${b.id === bid ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}</select></label>
      <label>문장
        <textarea name="body" rows="4" required placeholder="마음에 남는 문장을 그대로 옮겨 적어요">${esc(q.body || '')}</textarea>
      </label>
      <div class="row gap wrap">
        <label class="btn small file-btn">사진으로 문장 인식<input type="file" accept="image/*" capture="environment" hidden data-ocr></label>
        <span class="muted small" data-ocr-msg></span>
      </div>
      <div class="row gap">
        <label class="grow">쪽수<input name="page" type="number" inputmode="numeric" min="0" value="${esc(q.page ?? page ?? '')}"></label>
        <label class="grow">태그<input name="tags" placeholder="쉼표로 구분" value="${esc((q.tags || []).join(', '))}"></label>
      </div>
      <div class="field-label">메모 종류</div>
      <div class="seg" data-seg>
        ${MEMO_TYPES.map(t => `<label title="${esc(MEMO_HELP[t])}"><input type="radio" name="memo_type" value="${t}" ${q.memo_type === t ? 'checked' : ''}><span>${t}</span></label>`).join('')}
      </div>
      <p class="muted small" data-memo-help>${q.memo_type ? esc(MEMO_HELP[q.memo_type]) : '공감·의문·연결 중 하나를 골라 메모를 붙여요'}</p>
      <label>메모<textarea name="memo" rows="2" placeholder="왜 이 문장이 남았나요?">${esc(q.memo || '')}</textarea></label>
      <div class="row end gap">
        ${q.id ? '<button type="button" class="btn danger" data-del>삭제</button>' : ''}
        <button class="btn primary">저장</button>
      </div>
    </form>`);
  const f = m.el.querySelector('#qf');
  f.querySelectorAll('[name=memo_type]').forEach(r => r.onchange = () => { m.el.querySelector('[data-memo-help]').textContent = MEMO_HELP[r.value]; });
  f.querySelector('[data-ocr]').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    const msg = m.el.querySelector('[data-ocr-msg]');
    msg.textContent = '문장 인식 중…';
    try {
      const text = await runOcr(file, p => { msg.textContent = p; });
      const ta = f.querySelector('[name=body]');
      pickOcrText(text, picked => { ta.value = (ta.value ? ta.value + '\n' : '') + picked; msg.textContent = '인식한 문장을 넣었어요. 틀린 글자를 확인하세요.'; });
    } catch (err) { msg.textContent = '인식 실패: ' + err.message; }
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(f);
    try {
      const saved = await db.save('quotes', {
        ...q, book_id: fd.get('book_id'), session_id: q.session_id ?? sessionId, body: fd.get('body').trim(), page: fd.get('page'),
        memo: fd.get('memo').trim(), memo_type: fd.get('memo_type') || null, tags: parseTags(fd.get('tags')),
      });
      toast('문장을 저장했어요');
      m.close();
      onSaved && onSaved(saved);
    } catch (err) { toast('저장 실패: ' + err.message); }
  };
  const del = f.querySelector('[data-del]');
  if (del) del.onclick = async () => { if (await confirmBox('이 문장을 삭제할까요?', '삭제')) { await db.remove('quotes', q.id); m.close(); onSaved && onSaved(null); } };
  setTimeout(() => f.querySelector('[name=body]').focus(), 50);
  return m;
}

function pickOcrText(text, cb) {
  const m = openModal(`<h3>인식한 텍스트</h3><p class="muted small">저장할 부분만 남기고 지우거나 고친 뒤 넣기를 누르세요.</p>
    <textarea rows="10" class="w100" data-t>${esc(text)}</textarea><div class="row end gap"><button class="btn primary" data-ok>넣기</button></div>`);
  m.el.querySelector('[data-ok]').onclick = () => { cb(m.el.querySelector('[data-t]').value.trim()); m.close(); };
}

/* ---------- 노트 ---------- */
export const NOTE_TEMPLATES = {
  chapter: '## 챕터: \n\n### 핵심 내용 (내 말로)\n\n### 남는 문장\n\n### 공감 / 의문 / 연결\n\n',
  daily: '',
  pre: '### 읽기 전 질문\n- 기대: \n- 의심: \n- 연결: \n\n### 독서 목표\n- 읽는 기간: \n- 이유: \n- 읽고 난 후 달라질 점: \n- 활용 계획: \n',
  free: '',
};
export function noteModal({ bookId = null, kind = 'free', note = null, onSaved } = {}) {
  const n = note || { kind, book_id: bookId, note_date: ymd(), body: NOTE_TEMPLATES[kind] || '' };
  const m = openModal(`
    <h3>${n.id ? '노트 수정' : '노트 쓰기'}</h3>
    <form class="form" id="nf">
      <div class="row gap wrap">
        <label class="grow">책<select name="book_id"><option value="">(책 없음)</option>${S.books.map(b => `<option value="${b.id}" ${b.id === n.book_id ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}</select></label>
        <label>종류<select name="kind">${Object.entries(NOTE_KINDS).map(([k, v]) => `<option value="${k}" ${k === n.kind ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>날짜<input type="date" name="note_date" value="${esc(n.note_date || ymd())}"></label>
      </div>
      <label>제목<input name="title" value="${esc(n.title || '')}" placeholder="(선택)"></label>
      <label>본문<textarea name="body" rows="12">${esc(n.body || '')}</textarea></label>
      <label>태그<input name="tags" value="${esc((n.tags || []).join(', '))}" placeholder="쉼표로 구분"></label>
      <div class="row end gap">
        ${n.id ? '<button type="button" class="btn danger" data-del>삭제</button>' : ''}
        <button class="btn primary">저장</button>
      </div>
    </form>`, { wide: true });
  const f = m.el.querySelector('#nf');
  f.querySelector('[name=kind]').onchange = e => {
    const ta = f.querySelector('[name=body]');
    if (!ta.value.trim() || Object.values(NOTE_TEMPLATES).includes(ta.value)) ta.value = NOTE_TEMPLATES[e.target.value] || '';
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(f);
    try {
      const saved = await db.save('notes', { ...n, book_id: fd.get('book_id') || null, kind: fd.get('kind'), note_date: fd.get('note_date'), title: fd.get('title').trim(), body: fd.get('body'), tags: parseTags(fd.get('tags')) });
      toast('노트를 저장했어요'); m.close(); onSaved && onSaved(saved);
    } catch (err) { toast('저장 실패: ' + err.message); }
  };
  const del = f.querySelector('[data-del]');
  if (del) del.onclick = async () => { if (await confirmBox('이 노트를 삭제할까요?', '삭제')) { await db.remove('notes', n.id); m.close(); onSaved && onSaved(null); } };
  return m;
}

/* ---------- 알라딘 검색으로 책 추가 ---------- */
export function searchModal({ onAdded } = {}) {
  const src = S.apiStatus?.search === 'kakao' ? '카카오 책 검색 (쪽수·분류는 알라딘에서 보충)' : '알라딘 공개 검색 페이지 (카카오 키 연결 전 임시)';
  const m = openModal(`
    <h3>책 추가</h3>
    <form class="row gap wrap" id="sf">
      <select name="type"><option value="Keyword">키워드</option><option value="Title">제목</option><option value="Author">저자</option><option value="ISBN">ISBN</option></select>
      <input name="q" class="grow" placeholder="제목·저자·ISBN으로 검색" required autocomplete="off">
      <button class="btn primary">검색</button>
    </form>
    <p class="muted small">검색 출처: ${esc(src)} · <a href="#" data-manual>직접 입력</a></p>
    <div class="search-results" data-res></div>`, { wide: true });
  const res = m.el.querySelector('[data-res]');
  let items = [];
  m.el.querySelector('#sf').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    res.innerHTML = '<div class="loading">검색 중…</div>';
    try {
      const d = await db.api('search', { q: fd.get('q'), type: fd.get('type') });
      items = d.items || [];
      if (!items.length) { res.innerHTML = '<p class="muted">검색 결과가 없어요. 다른 검색어나 직접 입력을 써보세요.</p>'; return; }
      res.innerHTML = items.map((it, i) => {
        const owned = S.books.some(b => (b.isbn13 && b.isbn13 === it.isbn13) || (it.aladin_link && b.aladin_link === it.aladin_link));
        return `<div class="result" data-i="${i}">${coverImg(it, 'cover sm')}<div class="grow"><b>${esc(it.title)}</b><div class="muted small">${esc(it.author)} · ${esc(it.publisher)} · ${esc(it.pub_date)}</div><div class="muted small">${esc(it.aladin_category)}</div></div>${owned ? '<span class="chip">서재에 있음</span>' : '<button class="btn small" data-pick>선택</button>'}</div>`;
      }).join('');
    } catch (err) { res.innerHTML = `<p class="error">검색 실패: ${esc(err.message)}</p>`; }
  };
  res.onclick = async e => {
    const btn = e.target.closest('[data-pick]');
    if (!btn) return;
    const it = items[+btn.closest('.result').dataset.i];
    btn.disabled = true; btn.textContent = '불러오는 중…';
    let full = it;
    try { if (it.isbn13 || it.item_id) { const d = await db.api('lookup', { isbn: it.isbn13, item_id: it.item_id }); if (d.item) full = { ...it, ...Object.fromEntries(Object.entries(d.item).filter(([, v]) => v)) }; } } catch { /* 검색 결과만으로 진행 */ }
    m.close();
    bookEditModal({ book: { ...full, status: 'reading', genre: mapGenre(full.aladin_category), start_date: ymd() }, isNew: true, onSaved: onAdded });
  };
  m.el.querySelector('[data-manual]').onclick = e => { e.preventDefault(); m.close(); bookEditModal({ book: { status: 'reading', source: 'manual', start_date: ymd(), genre: '인문·철학' }, isNew: true, onSaved: onAdded }); };
  setTimeout(() => m.el.querySelector('[name=q]').focus(), 50);
}

export function bookEditModal({ book = {}, isNew = false, onSaved } = {}) {
  const b = book;
  const m = openModal(`
    <h3>${isNew ? '서재에 추가' : '책 정보 수정'}</h3>
    <form class="form" id="bf">
      <div class="book-form-head">
        ${coverImg(b, 'cover md')}
        <div class="grow">
          <label>제목<input name="title" required value="${esc(b.title || '')}"></label>
          <label>저자<input name="author" value="${esc(b.author || '')}"></label>
        </div>
      </div>
      <div class="fgrid">
        <label>출판사<input name="publisher" value="${esc(b.publisher || '')}"></label>
        <label>출간일<input name="pub_date" value="${esc(b.pub_date || '')}" placeholder="YYYY-MM-DD"></label>
        <label>ISBN13<input name="isbn13" inputmode="numeric" value="${esc(b.isbn13 || '')}"></label>
        <label>쪽수<input name="pages" type="number" inputmode="numeric" min="0" value="${esc(b.pages ?? '')}"></label>
        <label>상태<select name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === b.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>장르<select name="genre">${GENRES.map(g => `<option ${g === b.genre ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
        <label>시작일<input type="date" name="start_date" value="${esc(b.start_date || '')}"></label>
        <label>완독일<input type="date" name="finish_date" value="${esc(b.finish_date || '')}"></label>
        <label>별점 (직접 입력)<input type="number" inputmode="decimal" name="rating" min="0" max="5" step="0.5" placeholder="0~5" value="${esc(b.rating ?? '')}"></label>
        <label>현재 쪽<input type="number" inputmode="numeric" name="current_page" min="0" value="${esc(b.current_page ?? '')}"></label>
      </div>
      <label>읽는 이유<input name="reason" value="${esc(b.reason || '')}" placeholder="왜 이 책을 읽나요?"></label>
      <label>태그<input name="tags" value="${esc((b.tags || []).join(', '))}" placeholder="쉼표로 구분"></label>
      <details class="more-fields"><summary class="muted small">표지 이미지 주소 바꾸기</summary><label>표지 URL<input name="cover_url" value="${esc(b.cover_url || '')}"></label></details>
      ${b.aladin_category ? `<p class="muted small">알라딘 분류: ${esc(b.aladin_category)}</p>` : ''}
      ${!b.pages && !isNew ? '' : (!b.pages ? '<p class="muted small">쪽수 정보가 없어요. 직접 입력해 주세요.</p>' : '')}
      <div class="row end gap">
        ${!isNew ? '<button type="button" class="btn danger" data-del>책 삭제</button>' : ''}
        <button class="btn primary">${isNew ? '서재에 추가' : '저장'}</button>
      </div>
    </form>`, { wide: true });
  const f = m.el.querySelector('#bf');
  f.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(f);
    const row = { ...b };
    for (const k of ['title', 'author', 'publisher', 'pub_date', 'isbn13', 'pages', 'status', 'genre', 'cover_url', 'start_date', 'finish_date', 'rating', 'current_page', 'reason']) row[k] = fd.get(k);
    row.tags = parseTags(fd.get('tags'));
    if (row.status === 'done' && !row.finish_date) row.finish_date = ymd();
    if (row.status === 'reading' && !row.start_date) row.start_date = ymd();
    if (row.status === 'want') { /* 시작일은 그대로 두되 새로 추가 시 비움 */ if (isNew) row.start_date = null; }
    try {
      const saved = await db.save('books', row);
      toast(isNew ? '서재에 추가했어요' : '저장했어요');
      m.close(); onSaved && onSaved(saved);
    } catch (err) { toast('저장 실패: ' + err.message); }
  };
  const del = f.querySelector('[data-del]');
  if (del) del.onclick = async () => {
    if (await deleteBookFlow(b)) { m.close(); location.hash = '#/library'; }
  };
}

/** 책 삭제: 연결된 기록 수를 보여주고 확인, 페이지 사진도 정리. 삭제하면 true */
export async function deleteBookFlow(b) {
  const n = k => S[k].filter(x => x.book_id === b.id).length;
  const sessions = S.sessions.filter(x => x.book_id === b.id);
  const parts = [['독서 기록', sessions.length], ['문장', n('quotes')], ['노트', n('notes')], ['가이드 대화', n('guides')]].filter(([, c]) => c).map(([t, c]) => `${t} ${c}개`);
  const msg = `『${b.title}』을(를) 서재에서 삭제할까요?` + (parts.length ? `\n${parts.join(', ')}도 함께 지워져요.` : '') + '\n삭제하면 되돌릴 수 없어요.';
  if (!(await confirmBox(msg, '삭제'))) return false;
  try {
    const photos = sessions.map(s => s.photo_path).filter(Boolean);
    await db.remove('books', b.id);
    for (const p of photos) db.removePhoto(p).catch(() => {});
    toast('책을 삭제했어요');
    return true;
  } catch (e) { toast('삭제 실패: ' + e.message); return false; }
}

/** 세션 수정 */
export function sessionModal(s, onSaved) {
  const m = openModal(`<h3>독서 세션 수정</h3>
    <form class="form" id="ssf">
      <div class="row gap"><label class="grow">시작 쪽<input type="number" name="start_page" value="${esc(s.start_page ?? '')}"></label><label class="grow">종료 쪽<input type="number" name="end_page" value="${esc(s.end_page ?? '')}"></label></div>
      <label>순수 읽은 시간(분)<input type="number" name="minutes" min="0" value="${Math.round((s.seconds || 0) / 60)}"></label>
      <label>메모<textarea name="memo" rows="2">${esc(s.memo || '')}</textarea></label>
      <div class="row end gap"><button type="button" class="btn danger" data-del>삭제</button><button class="btn primary">저장</button></div>
    </form>`);
  const f = m.el.querySelector('#ssf');
  f.onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(f);
    await db.save('sessions', { ...s, start_page: fd.get('start_page'), end_page: fd.get('end_page'), seconds: Math.round(Number(fd.get('minutes')) * 60), memo: fd.get('memo') });
    toast('저장했어요'); m.close(); onSaved && onSaved();
  };
  f.querySelector('[data-del]').onclick = async () => { if (await confirmBox('이 세션을 삭제할까요?', '삭제')) { await db.remove('sessions', s.id); if (s.photo_path) db.removePhoto(s.photo_path); m.close(); onSaved && onSaved(); } };
}

export function suggestStartPage(bookId) { const p = lastPage(bookId); return p ? p + 1 : 1; }
