// 오늘의 복습: D+1 스스로 답하기, D+3 5문항 테스트, D+7 콘텐츠 초안
import * as db from './db.js';
import { S } from './db.js';
import { esc, nl2br, toast, fmtDate, coverImg, ymd, copyText } from './ui.js';
import { systemPrompt, aiOn } from './calc.js';
import { go, refresh } from './app.js';
import { reviewDraft, cardNewsCopy, threadsDraft } from './export.js';

export function renderReview(el, id) {
  const r = S.reviews.find(x => x.id === id);
  if (!r) { el.innerHTML = '<p class="card">복습 항목을 찾을 수 없어요. <a href="#/home">홈</a></p>'; return; }
  const b = db.book(r.book_id);
  const head = `<div class="card row gap">${coverImg(b, 'cover xs')}<div class="grow"><span class="badge">${r.stage}</span> <b>${esc(b.title)}</b><div class="muted small">${fmtDate(r.due_date)} 예정 ${r.done ? '· 완료' : ''}</div></div><a class="btn small ghost" href="#/home">홈</a></div>`;
  if (r.stage === 'D+1') return d1(el, r, b, head);
  if (r.stage === 'D+3') return d3(el, r, b, head);
  return d7(el, r, b, head);
}

async function complete(r, response) {
  await db.save('reviews', { ...r, done: true, done_at: new Date().toISOString(), response });
  toast(`${r.stage} 복습 완료`);
}

/* D+1: 어제 읽은 책의 핵심이 뭐였지? → 스스로 답한 뒤 막히면 노트 확인 */
function d1(el, r, b, head) {
  const sm = db.summaryOf(b.id) || {};
  const resp = r.response || {};
  el.innerHTML = `${head}
  <div class="card">
    <h2>어제 읽은 책의 핵심이 뭐였지?</h2>
    <p class="muted small">노트를 보지 말고 먼저 기억나는 대로 적어보세요. 막히면 그때 노트를 열어요.</p>
    <textarea class="w100" rows="5" data-ans placeholder="한 줄 요약, 핵심 문장, 액션 아이템 중 기억나는 것">${esc(resp.answer || '')}</textarea>
    <div class="row gap wrap mt"><button class="btn" data-peek>막혔어요, 노트 확인</button><span class="grow"></span><button class="btn primary" data-done>${r.done ? '다시 저장' : '복습 완료'}</button></div>
    <div data-note class="hidden mt"></div>
  </div>`;
  const noteBox = el.querySelector('[data-note]');
  el.querySelector('[data-peek]').onclick = () => {
    noteBox.classList.remove('hidden');
    noteBox.innerHTML = `<div class="card accent">
      <b>내 정리본</b>
      <p>한 줄 요약: ${esc(sm.one_line || '-')}</p>
      ${(sm.key_quotes || []).filter(k => k.text).map((k, i) => `<blockquote>${i + 1}. ${esc(k.text)}${k.page ? ` (p.${k.page})` : ''}</blockquote>`).join('')}
      <p>액션 아이템: ${esc(sm.action_item || '-')}</p>
      <p class="muted small">비교해 보고, 놓친 부분을 위 답에 보태 적어보세요.</p></div>`;
  };
  el.querySelector('[data-done]').onclick = async () => {
    const answer = el.querySelector('[data-ans]').value.trim();
    if (!answer) { toast('먼저 기억나는 것을 적어요'); return; }
    await complete(r, { answer, peeked: !noteBox.classList.contains('hidden') });
    go('#/home');
  };
}

/* D+3: 5문항 테스트를 하나씩 출제하고 답을 보완 */
function localQuestions(b) {
  const sm = db.summaryOf(b.id) || {};
  const qs = [];
  if (sm.one_line) qs.push({ q: '이 책을 한 줄로 요약하면?', ref: sm.one_line });
  (sm.key_quotes || []).filter(k => k.text).forEach((k, i) => {
    const words = k.text.split(/\s+/).filter(w => w.replace(/[^가-힣a-zA-Z]/g, '').length >= 2);
    const target = words.sort((a, c) => c.length - a.length)[0];
    if (target) qs.push({ q: `빈칸 채우기 (핵심 문장 ${i + 1}): "${k.text.replace(target, '____')}"`, ref: `${target}  ←  "${k.text}"${k.reason ? `\n고른 이유: ${k.reason}` : ''}` });
  });
  (sm.concepts || []).forEach(c => qs.push({ q: `핵심 개념 '${c}'을(를) 내 말로 설명해 보세요.`, ref: '내 노트·문장에서 이 개념이 나온 부분을 확인해 보세요.' }));
  if (sm.action_item) qs.push({ q: '이 책에서 가져온 액션 아이템은 무엇이었나요? 지금 실천하고 있나요?', ref: sm.action_item });
  db.byBook('quotes', b.id).slice(0, 5).forEach(q => qs.push({ q: `${q.page ? `p.${q.page}에서` : ''} 저장한 이 문장의 뒤에는 어떤 이야기가 이어졌나요? "${q.body.slice(0, 60)}${q.body.length > 60 ? '…' : ''}"`, ref: q.memo || '책을 펴서 확인해 보세요.' }));
  return qs.slice(0, 5);
}

function d3(el, r, b, head) {
  const st = r.response && r.response.items ? r.response : { items: [], idx: 0 };
  const draw = () => {
    const cur = st.items[st.idx];
    el.innerHTML = `${head}
    <div class="card">
      <h2>D+3 기억 테스트 (5문항)</h2>
      <p class="muted small">${aiOn() ? 'AI가 내 문장·노트·정리본을 근거로 한 문제씩 내요.' : '내 정리본과 저장한 문장으로 한 문제씩 나와요.'} 답한 뒤 보완해요.</p>
      ${!st.items.length ? `<button class="btn primary" data-start>테스트 시작</button>` : `
      <div class="steps">${st.items.map((_, i) => `<i class="${i < st.idx ? 'ok' : i === st.idx ? 'cur' : ''}"></i>`).join('')}</div>
      ${st.items.slice(0, st.idx).map((it, i) => `<details class="mini"><summary>${i + 1}. ${esc(it.q)}</summary><p class="small">내 답: ${nl2br(it.answer || '')}</p>${it.feedback ? `<p class="small muted">${nl2br(it.feedback)}</p>` : ''}</details>`).join('')}
      ${cur ? `<div class="msg guide"><span class="who">문제 ${st.idx + 1}</span>${nl2br(cur.q)}</div>
        ${cur.answer != null ? `<div class="msg user"><span class="who">나</span>${nl2br(cur.answer)}</div>${cur.feedback ? `<div class="msg ai"><span class="who">${aiOn() ? 'AI' : '확인'}</span>${nl2br(cur.feedback)}</div>` : ''}
          <div class="row end mt"><button class="btn primary" data-next>${st.idx + 1 >= st.items.length ? '테스트 마치기' : '다음 문제'}</button></div>`
        : `<textarea class="w100" rows="3" data-ans placeholder="기억나는 대로 답해요"></textarea><div class="row end mt"><button class="btn primary" data-answer>답하기</button></div>`}` : `<p><b>테스트 완료</b></p><div class="row gap"><a class="btn primary" href="#/home">홈으로</a></div>`}`}
    </div>`;
    el.querySelector('[data-start]')?.addEventListener('click', start);
    el.querySelector('[data-answer]')?.addEventListener('click', answer);
    el.querySelector('[data-next]')?.addEventListener('click', next);
  };
  async function start() {
    const btn = el.querySelector('[data-start]'); btn.disabled = true; btn.textContent = '문제 준비 중…';
    let items = [];
    if (aiOn()) {
      try {
        const d = await db.api('ai', {
          system: systemPrompt(b.id, '사용자가 저장한 문장, 노트, 완독 정리를 근거로 기억 확인 문제 5개를 만든다. 사용자 기록에 근거한 문제만 낸다. 출력은 JSON 배열만: [{"q":"문제","ref":"사용자 기록 속 근거"}]'),
          messages: [{ role: 'user', content: 'D+3 복습 테스트 문제 5개를 만들어 주세요. JSON 배열만 출력.' }], max_tokens: 900,
        });
        const m = d.text.match(/\[[\s\S]*\]/);
        items = JSON.parse(m ? m[0] : d.text).slice(0, 5).map(x => ({ q: String(x.q), ref: String(x.ref || '') }));
      } catch { items = []; }
    }
    if (!items.length) items = localQuestions(b);
    if (!items.length) { toast('문제를 만들 기록이 부족해요. 완독 정리를 먼저 써주세요'); draw(); return; }
    st.items = items; st.idx = 0;
    await db.save('reviews', { ...r, response: st }); draw();
  }
  async function answer() {
    const ans = el.querySelector('[data-ans]').value.trim();
    if (!ans) { toast('먼저 답을 적어요'); return; }
    const cur = st.items[st.idx];
    cur.answer = ans;
    if (aiOn()) {
      el.querySelector('[data-answer]').disabled = true;
      try {
        const d = await db.api('ai', {
          system: systemPrompt(b.id, '사용자의 답을 사용자 기록(근거)과 비교해 맞은 점을 먼저 인정하고, 빠진 부분을 짧게 보완한다. 3문장 이내. 새 질문은 하지 않는다.'),
          messages: [{ role: 'user', content: `문제: ${cur.q}\n근거(내 기록): ${cur.ref}\n내 답: ${ans}` }], max_tokens: 400,
        });
        cur.feedback = d.text;
      } catch (e) { cur.feedback = `내 기록: ${cur.ref}`; }
    } else cur.feedback = `내 기록과 비교해 보세요: ${cur.ref}`;
    await db.save('reviews', { ...r, response: st }); draw();
  }
  async function next() {
    st.idx++;
    if (st.idx >= st.items.length) { await complete(r, st); Object.assign(r, { done: true }); }
    else await db.save('reviews', { ...r, response: st });
    draw();
  }
  draw();
}

/* D+7: 독서 후기·카드뉴스·스레드 중 하나 초안 */
function d7(el, r, b, head) {
  const resp = r.response || {};
  const kinds = { review: ['독서 후기(서평)', reviewDraft], card: ['카드뉴스', cardNewsCopy], threads: ['스레드', threadsDraft] };
  let kind = resp.kind || 'review';
  const draw = () => {
    el.innerHTML = `${head}
    <div class="card">
      <h2>D+7 콘텐츠 초안</h2>
      <p class="muted small">하나만 골라 초안을 써요. 내 정리본으로 뼈대를 채워두었어요. 내 말로 고쳐 쓰세요.</p>
      <div class="seg">${Object.entries(kinds).map(([k, [label]]) => `<label><input type="radio" name="k" value="${k}" ${k === kind ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>
      <textarea class="w100 mono mt" rows="16" data-draft>${esc(resp.kind === kind && resp.draft ? resp.draft : kinds[kind][1](b.id))}</textarea>
      <div class="row gap wrap mt"><button class="btn" data-copy>복사</button><span class="grow"></span><button class="btn primary" data-done>초안 저장하고 완료</button></div>
    </div>`;
    el.querySelectorAll('[name=k]').forEach(x => x.onchange = () => { kind = x.value; draw(); });
    el.querySelector('[data-copy]').onclick = () => copyText(el.querySelector('[data-draft]').value);
    el.querySelector('[data-done]').onclick = async () => {
      const draft = el.querySelector('[data-draft]').value;
      await db.save('notes', { book_id: b.id, kind: 'free', title: `D+7 ${kinds[kind][0]} 초안`, body: draft, note_date: ymd(), tags: [] });
      const sm = db.summaryOf(b.id);
      if (sm) await db.save('summaries', { ...sm, content_used: { ...(sm.content_used || {}), [{ review: 'blog', card: 'card', threads: 'threads' }[kind]]: true } });
      await complete(r, { kind, draft });
      go('#/home');
    };
  };
  draw();
}
