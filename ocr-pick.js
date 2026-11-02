// 사진에서 문장 고르기: 사진 → 글자 인식 → 문장 목록에서 골라 저장 (같은 사진에서 여러 번 저장 가능)
import * as db from './db.js';
import { S } from './db.js';
import { esc, openModal, toast, parseTags, MEMO_TYPES } from './ui.js';
import { MEMO_HELP } from './guide-data.js';
import { fileToCanvas, recognize, splitSentences } from './ocr.js';
import { photoEditor } from './cert.js';

/**
 * @param bookId, sessionId, page: 저장 기본값
 * @param onSaved: 저장할 때마다 호출
 * @param onPick: 있으면 저장 대신 고른 글을 돌려줌 (문장 입력창에서 쓰는 경우)
 * @param autoPick: 열자마자 사진 고르기 창 띄우기 (클릭 처리 중에 호출해야 함)
 */
export function photoQuoteModal({ bookId, sessionId = null, page = null, onSaved, onPick, autoPick = true } = {}) {
  const st = { canvas: null, text: '', sentences: [], sel: new Set(), saved: new Set(), page: null, busy: false, separate: false };
  const books = S.books;
  const m = openModal(`
    <h3>사진에서 문장 고르기</h3>
    <div class="ocr-top">
      <div class="ocr-thumb" data-thumb><span class="muted small">사진 없음</span></div>
      <div class="grow">
        <div class="row gap wrap">
          <label class="btn primary small file-btn">사진 찍기·고르기<input type="file" accept="image/*" hidden data-file></label>
          <button class="btn small" data-crop disabled>자르기·회전</button>
        </div>
        <p class="muted small mt" data-msg>책 페이지를 정면에서 밝게 찍으면 잘 읽혀요. 두 쪽이 다 나오면 '자르기'로 한 쪽만 남겨요.</p>
      </div>
    </div>
    <div data-pick class="hidden">
      <div class="sec-head"><b class="small">저장할 문장을 눌러서 고르세요</b><span class="row gap"><button class="btn small ghost" data-all>전체 선택</button><button class="btn small ghost" data-none>선택 해제</button></span></div>
      <div class="sent-list" data-sents></div>
      <details class="mt"><summary class="muted small">인식한 전체 글 고치기</summary>
        <textarea class="w100 mt" rows="7" data-raw></textarea>
        <div class="row end mt"><button class="btn small" data-resplit>고친 글로 다시 나누기</button></div>
      </details>
      <form class="form mt" data-form>
        <label>저장할 문장 <span class="muted small" data-count></span><textarea name="body" rows="4" placeholder="위에서 문장을 고르면 여기에 채워져요. 틀린 글자는 바로 고쳐요."></textarea></label>
        <label class="check hidden" data-sepwrap><input type="checkbox" name="separate"> 고른 문장을 한 줄씩 각각 따로 저장</label>
        ${onPick ? '' : `
        <div class="fgrid">
          <label>책<select name="book_id">${books.map(b => `<option value="${b.id}" ${b.id === bookId ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}</select></label>
          <label>쪽수 <span class="muted small" data-pagehint></span><input name="page" type="number" inputmode="numeric" min="0" value="${esc(page ?? '')}"></label>
        </div>
        <div class="field-label">메모 종류</div>
        <div class="seg">${MEMO_TYPES.map(t => `<label title="${esc(MEMO_HELP[t])}"><input type="radio" name="memo_type" value="${t}"><span>${t}</span></label>`).join('')}</div>
        <label class="mt">메모<textarea name="memo" rows="2" placeholder="왜 이 문장이 남았나요? (선택)"></textarea></label>
        <label>태그<input name="tags" placeholder="쉼표로 구분 (선택)"></label>`}
        <div class="row end gap"><button type="button" class="btn" data-close>닫기</button><button class="btn primary" data-save disabled>${onPick ? '넣기' : '문장 저장'}</button></div>
      </form>
    </div>`, { wide: true });

  const $ = s => m.el.querySelector(s);
  const msg = $('[data-msg]'), form = $('[data-form]'), body = form.body;
  const fileInp = $('[data-file]');

  const renderList = () => {
    $('[data-sents]').innerHTML = st.sentences.length ? st.sentences.map((s, i) => `<button type="button" class="sent ${st.sel.has(i) ? 'on' : ''} ${st.saved.has(i) ? 'saved' : ''} ${i && s.para !== st.sentences[i - 1].para ? 'newpara' : ''}" data-i="${i}">${st.saved.has(i) ? '<span class="tick">저장됨</span>' : ''}${esc(s.text)}</button>`).join('')
      : '<p class="muted small">문장을 찾지 못했어요. 아래 \'인식한 전체 글 고치기\'에서 직접 고치거나 다시 찍어 보세요.</p>';
    m.el.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { const i = +b.dataset.i; st.sel.has(i) ? st.sel.delete(i) : st.sel.add(i); renderList(); fillBody(); });
  };
  const fillBody = () => {
    const idx = [...st.sel].sort((a, b) => a - b);
    $('[data-sepwrap]').classList.toggle('hidden', idx.length < 2 || !!onPick);
    st.separate = !onPick && form.separate.checked && idx.length > 1;
    if (st.separate) body.value = idx.map(i => st.sentences[i].text).join('\n');
    else body.value = idx.map((i, k) => (k && st.sentences[i].para !== st.sentences[idx[k - 1]].para ? '\n' : (k ? ' ' : '')) + st.sentences[i].text).join('');
    $('[data-count]').textContent = idx.length ? `${idx.length}문장 선택` : '';
    $('[data-save]').disabled = !body.value.trim();
  };
  body.oninput = () => { $('[data-save]').disabled = !body.value.trim(); };
  if (form.page) form.page.oninput = () => { form.page.dataset.user = '1'; };
  form.separate.onchange = fillBody;

  const setSplit = text => {
    st.text = text; $('[data-raw]').value = text;
    const r = splitSentences(text);
    st.sentences = r.sentences; st.sel = new Set(); st.saved = new Set();
    // 사진 속 쪽수가 타이머의 현재 쪽보다 정확 → 직접 고친 게 아니면 덮어씁움
    if (r.page && !onPick) { const pi = form.page; if (!pi.dataset.user) pi.value = r.page; $('[data-pagehint]').textContent = `(사진에서 찾음: ${r.page})`; }
    $('[data-pick]').classList.remove('hidden');
    renderList(); fillBody();
  };

  const runOcr = async () => {
    if (!st.canvas || st.busy) return;
    st.busy = true; $('[data-crop]').disabled = true;
    try {
      const r = await recognize(st.canvas, t => { msg.textContent = t; });
      setSplit(r.text);
      msg.textContent = r.text ? `${st.sentences.length}개 문장을 찾았어요${r.source === 'browser' && r.confidence < 70 ? ' · 흐리게 읽혔어요. 밝은 곳에서 다시 찍으면 더 정확해요' : ''}. 틀린 글자는 저장 전에 고쳐 주세요.` : '글자를 찾지 못했어요. 더 가까이, 밝게 찍어 보세요.';
    } catch (e) { msg.textContent = '인식 실패: ' + e.message; }
    st.busy = false; $('[data-crop]').disabled = !st.canvas;
  };
  const showThumb = () => {
    const t = $('[data-thumb]'); t.innerHTML = '';
    const c = document.createElement('canvas'); const r = Math.min(1, 220 / st.canvas.height, 160 / st.canvas.width);
    c.width = Math.round(st.canvas.width * r); c.height = Math.round(st.canvas.height * r);
    c.getContext('2d').drawImage(st.canvas, 0, 0, c.width, c.height); t.appendChild(c);
  };

  fileInp.onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { st.canvas = await fileToCanvas(f); } catch (err) { msg.textContent = err.message; return; }
    showThumb(); await runOcr();
  };
  $('[data-crop]').onclick = () => photoEditor(st.canvas, c => { st.canvas = c; showThumb(); runOcr(); });
  $('[data-all]').onclick = () => { st.sentences.forEach((_, i) => { if (!st.saved.has(i)) st.sel.add(i); }); renderList(); fillBody(); };
  $('[data-none]').onclick = () => { st.sel.clear(); renderList(); fillBody(); };
  $('[data-resplit]').onclick = () => { setSplit($('[data-raw]').value); msg.textContent = `${st.sentences.length}개 문장으로 다시 나눴어요.`; };
  $('[data-close]').onclick = () => m.close();

  form.onsubmit = async e => {
    e.preventDefault();
    const text = body.value.trim(); if (!text) return;
    if (onPick) { onPick(text); m.close(); return; }
    const fd = new FormData(form);
    const pieces = st.separate ? text.split('\n').map(s => s.trim()).filter(Boolean) : [text];
    const base = { book_id: fd.get('book_id'), session_id: sessionId, page: fd.get('page'), memo: (fd.get('memo') || '').trim(), memo_type: fd.get('memo_type') || null, tags: parseTags(fd.get('tags')) };
    if (!base.book_id) { toast('책을 먼저 고르세요'); return; }
    $('[data-save]').disabled = true;
    try {
      for (const p of pieces) await db.save('quotes', { ...base, body: p });
      st.sel.forEach(i => st.saved.add(i)); st.sel.clear();
      form.memo.value = ''; form.querySelectorAll('[name=memo_type]').forEach(r => { r.checked = false; });
      renderList(); fillBody();
      toast(`문장 ${pieces.length}개를 저장했어요`);
      msg.textContent = '저장했어요. 같은 사진에서 더 고르거나, 다른 사진을 찍을 수 있어요.';
      onSaved && onSaved();
    } catch (err) { toast('저장 실패: ' + err.message); $('[data-save]').disabled = false; }
  };

  if (autoPick) fileInp.click();
  return m;
}
