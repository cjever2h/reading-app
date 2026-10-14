// AI각인 독서가이드: 읽기 전 · 읽는 중 · 날마다 · 읽은 후 · 활용 + 빠른 참조 카드 12종
import * as db from './db.js';
import { S } from './db.js';
import { esc, nl2br, toast, ymd, coverImg, fmtDate, fmtDur, copyText } from './ui.js';
import { MODES, STEPS, DURING_ACTIONS, quickCards, genreGuide, placeholders } from './guide-data.js';
import { systemPrompt, aiOn, lastPage, sessionDate, ensureReviews } from './calc.js';
import { go, query } from './app.js';
import { notebookMarkdown } from './export.js';

/** 카드 해석: c1~c12 = 부록 D, g0~ = 부록 A(책 장르) */
function resolveCard(id, bookId) {
  const custom = S.settings.custom_prompts || {};
  if (id && /^g\d+$/.test(id)) {
    const b = db.book(bookId);
    const gg = b?.genre ? genreGuide(b.genre, custom) : null;
    const p = gg?.prompts[Number(id.slice(1))];
    if (p) return { id, title: `${b.genre} · ${p.label}`, prompt: p.text, from: gg.from, ai: `원고 ${gg.from}의 '${p.label}' 프롬프트다. 사용자의 요청에 답하되, 사용자가 자기 생각을 더해 이어갈 수 있도록 마지막에 질문 하나를 한다.` };
  }
  const cards = quickCards(custom);
  const c = cards.find(x => x.id === id) || cards[0];
  return { ...c, from: '부록 D · 상황별 빠른 참조 카드' };
}

/** [메모] [노트] [목록]을 내 기록으로 채우기 */
function fillText(ph, bookId) {
  if (ph === '[노트]') return bookId ? '\n' + notebookMarkdown(bookId) + '\n' : '';
  if (ph === '[메모]') {
    const qs = db.byBook('quotes', bookId).filter(q => q.memo).map(q => `- (p.${q.page ?? '?'}) ${q.memo_type ? `[${q.memo_type}] ` : ''}${q.memo}`);
    const ns = db.byBook('notes', bookId).filter(n => n.kind === 'chapter' || n.kind === 'daily').map(n => `- ${n.title || n.note_date}: ${String(n.body).replace(/\s+/g, ' ').slice(0, 300)}`);
    return '\n' + [...qs, ...ns].join('\n') + '\n';
  }
  if (ph === '[목록]') {
    return '\n' + S.books.filter(x => db.summaryOf(x.id)?.one_line).map(x => `- 『${x.title.split(/\s*:\s+/)[0]}』: ${db.summaryOf(x.id).one_line}`).join('\n') + '\n';
  }
  return null;
}

export function renderGuide(el, a, b) {
  if (a === 'new') return startNew(el, b);
  if (a) { const g = S.guides.find(x => x.id === a) || (S._draftGuide?.id === a ? S._draftGuide : null); if (g) return chat(el, g); }
  return guideHome(el);
}

function guideHome(el) {
  const books = S.books.filter(x => x.status !== 'want');
  const sel = query().get('book') || books.find(x => x.status === 'reading')?.id || books[0]?.id || '';
  const cards = quickCards(S.settings.custom_prompts || {});
  const genreHtml = bookId => {
    const b = db.book(bookId);
    const gg = b?.genre ? genreGuide(b.genre, S.settings.custom_prompts || {}) : null;
    if (!gg) return '<p class="muted small">책을 고르면 장르에 맞는 프롬프트가 나와요.</p>';
    return `<p class="muted small">${esc(b.genre)} · 출처: ${esc(gg.from)}</p><div class="card-grid">${gg.prompts.map((p, i) => {
      const locked = p.afterOnly && b.status !== 'done';
      return `<button class="qcard" data-gp="${i}" ${locked ? 'disabled title="완독 후에 열려요 (결말 스포일러 방지)"' : ''}><b>${esc(p.label)}${locked ? ' · 완독 후' : ''}</b><span class="muted small">"${esc(p.text)}"</span></button>`;
    }).join('')}</div>`;
  };
  const recent = [...S.guides].sort((x, y) => (y.updated_at || '').localeCompare(x.updated_at || '')).slice(0, 12);
  el.innerHTML = `<h1>AI각인 독서가이드</h1>
    <p class="muted small">원칙: 내가 먼저 생각하고 쓴다. AI는 검증·질문·가공만 맡는다. 질문은 한 번에 하나씩. ${aiOn() ? `AI 연결됨 (${esc(S.apiStatus.ai)})` : 'AI 키 연결 전: 질문·힌트 중심의 가이드로 진행돼요.'}</p>
    <label class="mb">책 선택<select data-book>${books.map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}<option value="" ${!sel ? 'selected' : ''}>(책 없이)</option></select></label>
    <div class="mode-grid">${Object.entries(MODES).map(([k, m]) => `<button class="card mode-card" data-mode="${k}"><b>${m.name}</b><span class="muted small">${m.when}</span><span class="small">${m.desc}</span><span class="muted small">저장: ${m.saves}</span></button>`).join('')}</div>
    <h2 class="mt">장르별 AI 독서 프롬프트 <span class="muted small">부록 A</span></h2>
    <div data-genre>${genreHtml(sel)}</div>
    <h2 class="mt">상황별 빠른 참조 카드 <span class="muted small">부록 D</span></h2>
    <p class="muted small">[ ]로 표시된 부분에 내 상황을 넣으면 바로 사용할 수 있어요.</p>
    <div class="card-grid">${cards.map(c => `<button class="qcard" data-card="${c.id}"><b>${esc(c.title)}</b><span class="muted small">"${esc(c.prompt)}"</span></button>`).join('')}</div>
    <h2 class="mt">최근 대화</h2>
    ${recent.length ? `<div class="list">${recent.map(g => `<a class="card row gap" href="#/guide/${g.id}"><span class="badge">${MODES[g.mode]?.name || '빠른 카드'}</span><span class="grow small">${esc(db.book(g.book_id)?.title || '')} ${esc(g.summary || '')}</span><span class="muted small">${fmtDate(g.updated_at || g.created_at, false)}</span></a>`).join('')}</div>` : '<p class="muted small">아직 대화가 없어요.</p>'}`;
  const bookSel = el.querySelector('[data-book]');
  const bindGenre = () => el.querySelectorAll('[data-gp]').forEach(x => x.onclick = () => go(`#/guide/new/card?card=g${x.dataset.gp}&book=${bookSel.value}`));
  bindGenre();
  bookSel.onchange = () => { el.querySelector('[data-genre]').innerHTML = genreHtml(bookSel.value); bindGenre(); };
  el.querySelectorAll('[data-mode]').forEach(x => x.onclick = () => go(`#/guide/new/${x.dataset.mode}${bookSel.value ? '?book=' + bookSel.value : ''}`));
  el.querySelectorAll('[data-card]').forEach(x => x.onclick = () => go(`#/guide/new/card?card=${x.dataset.card}${bookSel.value ? '&book=' + bookSel.value : ''}`));
}

function startNew(el, mode) {
  const bookId = query().get('book') || null;
  const cardId = query().get('card');
  const needBook = mode === 'card' ? !resolveCard(cardId, bookId).noBook : mode !== 'daily';
  if (needBook && !bookId) { toast('책을 먼저 고르세요'); return guideHome(el); }
  const g = { id: crypto.randomUUID(), book_id: bookId, mode, messages: [], step: 0, status: 'open', _new: true };
  if (mode === 'card') g.card = query().get('card');
  // 첫 질문
  if (STEPS[mode]) g.messages.push({ role: 'guide', text: STEPS[mode][0].q, step: 0, prefill: prefillFor(mode, 0, bookId) });
  else if (mode === 'during') g.messages.push({ role: 'guide', text: `동반 독서 파트너예요. ① 질문하면 친절하게 답하기 ② 내 이해가 맞는지 확인해주기 ③ 더 깊이 생각할 질문 던지기. 단, 아직 읽지 않은 부분은 먼저 말하지 않아요.\n위에 지금 읽은 쪽을 적고, 아래 '모르면 즉시 묻기' 버튼을 누르거나 궁금한 것을 적어보세요.`, step: 0 });
  else if (mode === 'card') {
    const c = resolveCard(cardId, bookId);
    g.card = c.id;
    const phs = placeholders(c.prompt);
    g.messages.push({ role: 'guide', text: `[${c.from} · ${c.title}]\n"${c.prompt}"${phs.length ? `\n${phs.join(', ')} 부분을 내 내용으로 채워 보내세요.` : ''}`, step: 0, card: c.id, prefill: c.prompt });
  }
  history.replaceState(null, '', `#/guide/${g.id}`);
  S._draftGuide = g;
  return chat(el, g);
}

function prefillFor(mode, i, bookId) {
  if (mode === 'daily' && STEPS.daily[i].key === 'range') {
    const today = ymd();
    const ss = S.sessions.filter(s => s.ended_at && sessionDate(s) === today && (!bookId || s.book_id === bookId));
    if (ss.length) return ss.map(s => `『${db.book(s.book_id)?.title}』 ${s.start_page ?? '?'}~${s.end_page ?? '?'}쪽, ${fmtDur(s.seconds)}`).join('\n');
  }
  if (mode === 'daily' && STEPS.daily[i].key === 'quote') {
    const today = ymd();
    const q = S.quotes.filter(x => ymd(new Date(x.created_at)) === today && (!bookId || x.book_id === bookId)).slice(-1)[0];
    if (q) return q.body;
  }
  if (mode === 'after' && STEPS.after[i].key === 'action_item') return db.summaryOf(bookId)?.action_item || '';
  if (mode === 'apply' && STEPS.apply[i].key === 'extract') return db.summaryOf(bookId)?.action_item || '';
  return '';
}

/* ---------- 대화 화면 ---------- */
function chat(el, g) {
  if (g.mode === 'card' && !g.card) g.card = g.messages[0]?.card;
  const b = db.book(g.book_id);
  const steps = STEPS[g.mode];
  const done = g.status === 'done';
  const card = g.mode === 'card' ? resolveCard(g.card, g.book_id) : null;
  const firstUserDone = g.messages.some(m => m.role === 'user');
  const prefillCard = card && !firstUserDone;
  const title = card ? card.title : MODES[g.mode]?.name;
  const cur = steps ? steps[g.step] : null;
  const lastMsg = g.messages[g.messages.length - 1];
  const answeredThisStep = steps && g.messages.some(m => m.role === 'user' && m.step === g.step);

  el.innerHTML = `<div class="guide">
    <div class="guide-head card">
      ${b ? coverImg(b, 'cover xs') : ''}
      <div class="grow"><b>${esc(title)}</b>${b ? `<div class="muted small">『${esc(b.title)}』${b.genre ? ' · ' + esc(b.genre) : ''}</div>` : ''}</div>
      ${steps ? `<span class="muted small">${Math.min(g.step + 1, steps.length)}/${steps.length}단계</span>` : ''}
      <a class="btn small ghost" href="#/guide">목록</a>
    </div>
    ${steps ? `<div class="steps">${steps.map((s, i) => `<i class="${i < g.step || done ? 'ok' : i === g.step ? 'cur' : ''}"></i>`).join('')}</div>` : ''}
    ${g.mode === 'during' || g.mode === 'card' ? `<div class="row gap wrap mb"><label class="row gap small">현재 읽은 쪽<input type="number" data-page value="${esc(g.page ?? (b ? lastPage(b.id) || '' : ''))}" style="width:6rem"></label><span class="muted small">이 쪽 이후 내용은 AI가 말하지 않아요</span></div>` : ''}
    <div class="msgs" data-msgs>${g.messages.map(msgHtml).join('')}</div>
    ${done ? doneBox(g) : `
    ${g.mode === 'during' ? `<div class="row gap wrap mb">${DURING_ACTIONS.map(a => `<button class="btn small" data-da="${a.key}">${esc(a.label)}</button>`).join('')}</div>` : ''}
    <form class="composer" data-form>
      <textarea rows="${prefillCard ? 5 : 3}" data-input placeholder="${cur ? '먼저 내 생각을 적어요' : '내 생각이나 질문을 먼저 적어요'}">${esc(prefillCard ? card.prompt : (!answeredThisStep && lastMsg?.role === 'guide' ? (lastMsg.prefill || '') : ''))}</textarea>
      ${cur?.limit ? `<div class="muted small right" data-count></div>` : ''}
      <div class="row gap wrap">
        <button type="button" class="btn small ghost" data-hint>막혔어요 (힌트)</button>
        ${prefillCard && (card.fill || []).length && (g.book_id || card.fill.includes('[목록]')) ? `<button type="button" class="btn small" data-fill>${card.fill.join('·')}을 내 기록으로 채우기</button>` : ''}
        ${card || g.mode === 'during' ? `<button type="button" class="btn small ghost" data-copy>프롬프트 복사</button>` : ''}
        <span class="grow"></span>
        ${steps && answeredThisStep ? `<button type="button" class="btn" data-next>${g.step + 1 >= steps.length ? '마치고 저장' : '다음 단계'}</button>` : ''}
        ${!steps ? `<button type="button" class="btn small" data-save-note>대화를 노트로 저장</button>` : ''}
        <button class="btn primary" data-send>${steps && answeredThisStep ? (aiOn() ? 'AI에게 이어 말하기' : '덧붙이기') : '보내기'}</button>
      </div>
    </form>`}
  </div>`;

  const msgs = el.querySelector('[data-msgs]');
  msgs.scrollTop = msgs.scrollHeight;
  requestAnimationFrame(() => el.querySelector('[data-form]')?.scrollIntoView({ block: 'end', behavior: 'smooth' }));
  if (done) { bindDone(el, g); return; }

  const input = el.querySelector('[data-input]');
  const pageInp = el.querySelector('[data-page]');
  if (pageInp) pageInp.onchange = () => { g.page = Number(pageInp.value) || null; persist(g); };
  const counter = el.querySelector('[data-count]');
  if (counter) { const upd = () => { counter.textContent = `${input.value.length}/${cur.limit}자`; counter.classList.toggle('error', input.value.length > cur.limit); }; input.oninput = upd; upd(); }

  el.querySelectorAll('[data-da]').forEach(x => x.onclick = () => { const a = DURING_ACTIONS.find(d => d.key === x.dataset.da); g._action = a.key; g._tpl = a.prompt; input.value = a.prompt; input.focus(); const m = a.prompt.indexOf('['); if (m >= 0) input.setSelectionRange(m, a.prompt.indexOf(']', m) + 1); });
  el.querySelector('[data-fill]')?.addEventListener('click', () => {
    let t = input.value;
    for (const ph of card.fill) { const v = fillText(ph, g.book_id); if (v != null) t = t.split(ph).join(v.trim() ? v : ph); }
    input.value = t; input.focus();
  });
  el.querySelector('[data-copy]')?.addEventListener('click', () => copyText(input.value || card?.prompt || ''));

  el.querySelector('[data-hint]').onclick = async () => {
    if (aiOn() && (cur || card || g.mode === 'during')) {
      const btn = el.querySelector('[data-hint]'); btn.disabled = true; btn.textContent = '힌트 생각 중…';
      try {
        const instr = `사용자가 이 질문에서 막혔다. 답을 대신 써주지 말고, 생각을 시작할 수 있는 힌트나 짧은 예시 하나만 준다. 질문: ${cur ? cur.q : (card ? `${card.prompt}의 ${placeholders(card.prompt).join(', ')} 부분을 무엇으로 채울지` : '읽는 중 질문')}`;
        const text = await callAi(g, instr, true);
        g.messages.push({ role: 'ai', text, step: g.step, hint: true });
      } catch (e) { g.messages.push({ role: 'guide', text: `힌트: ${hintText(cur, card)}`, step: g.step }); }
    } else {
      g.messages.push({ role: 'guide', text: `힌트: ${hintText(cur, card)}`, step: g.step });
    }
    persist(g); chat(el, g);
  };

  el.querySelector('[data-next]')?.addEventListener('click', () => nextStep(el, g));
  el.querySelector('[data-save-note]')?.addEventListener('click', () => saveChatAsNote(g));

  el.querySelector('[data-form]').onsubmit = async e => {
    e.preventDefault();
    const text = input.value.trim();
    if (text.length < 2) { toast('먼저 내 생각을 한 줄이라도 적어요'); return; }
    if (cur?.limit && text.length > cur.limit) { toast(`${cur.limit}자 이내로 줄여주세요`); return; }
    const tpl = prefillCard ? card.prompt : (g.mode === 'during' && g._tpl ? g._tpl : '');
    const left = placeholders(tpl).filter(ph => text.includes(ph));
    if (left.length) { toast(`${left.join(', ')} 부분을 내 내용으로 채워주세요`); return; }
    g._tpl = null;
    const primary = steps ? !g.messages.some(m => m.role === 'user' && m.step === g.step) : false;
    g.messages.push({ role: 'user', text, step: g.step, primary });
    persist(g);
    const sendBtn = el.querySelector('[data-send]');
    if (aiOn()) {
      chat(el, g);
      const typing = document.createElement('div'); typing.className = 'msg ai typing'; typing.textContent = '생각 중…';
      el.querySelector('[data-msgs]').appendChild(typing);
      el.querySelectorAll('button').forEach(x => x.disabled = true);
      try {
        let instr = cur ? cur.ai : card ? card.ai : '';
        if (g.mode === 'during') { const a = DURING_ACTIONS.find(d => d.key === g._action); instr = (a ? a.ai : '사용자의 질문에 동반 독서 파트너로 답한다. 이해·연결·적용 중 맞는 단계로 돕는다.'); g._action = null; }
        const reply = await callAi(g, instr);
        g.messages.push({ role: 'ai', text: reply, step: g.step });
      } catch (err) { g.messages.push({ role: 'guide', text: `AI 응답 실패: ${err.message}\n(질문 흐름은 계속 진행할 수 있어요)`, step: g.step }); }
      persist(g);
      chat(el, g);
    } else {
      sendBtn.disabled = true;
      if (steps && primary) return nextStep(el, g);
      if (!steps) {
        const a = g.mode === 'during' ? DURING_ACTIONS.find(d => d.key === g._action) : null;
        const tip = a ? a.ai.replace(/^\[.*?\]\s*/, '') : '좋아요. 이 생각을 문장 메모나 노트로 남겨두면 완독 후 정리에 바로 쓸 수 있어요.';
        g.messages.push({ role: 'guide', text: `${card ? '앱의 AI 키가 아직 연결되지 않았어요. 원고 방식대로 위 문장을 프롬프트 복사로 Claude나 ChatGPT에 붙여넣어 쓸 수 있어요.' : `가이드: ${tip}`}\n(AI 키를 연결하면 이 자리에서 AI가 바로 답해요)`, step: g.step });
        g._action = null;
      }
      persist(g); chat(el, g);
    }
  };
}

function hintText(cur, card) {
  if (cur?.hint) return cur.hint;
  if (card) { const phs = placeholders(card.prompt); return phs.length ? `${phs.join(', ')} 자리에 지금 내 상황을 구체적으로 적어보세요. 예: [개념] → "스몰 윈", [상황] → "40대 직장인, 출퇴근 1시간"` : '그대로 보내면 돼요.'; }
  return '지금 읽은 부분에서 가장 마음에 걸리는 문장 하나를 그대로 옮겨 적어보세요.';
}

function msgHtml(m) {
  const cls = m.role === 'user' ? 'user' : m.role === 'ai' ? 'ai' : 'guide';
  const who = m.role === 'user' ? '나' : m.role === 'ai' ? 'AI' : '가이드';
  return `<div class="msg ${cls}"><span class="who">${who}</span>${nl2br(m.text)}</div>`;
}

async function callAi(g, instr, isHint = false) {
  const page = g.page ?? (g.book_id ? lastPage(g.book_id) : null);
  const card = g.mode === 'card' ? resolveCard(g.card, g.book_id) : null;
  const system = systemPrompt(g.book_id, instr, { uptoPage: page || null, toc: !!card?.toc });
  const steps = STEPS[g.mode];
  const msgs = [];
  for (const m of g.messages) {
    const role = m.role === 'user' ? 'user' : 'assistant';
    const text = m.role === 'guide' ? `(가이드 질문) ${m.text}` : m.text;
    if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += '\n' + text; else msgs.push({ role, content: text });
  }
  if (isHint) msgs.push({ role: 'user', content: '막혔어요. 힌트를 주세요.' });
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length) msgs.push({ role: 'user', content: '시작할게요.' });
  if (steps) msgs[msgs.length - 1].content += `\n\n[지금은 ${g.step + 1}/${steps.length}단계: ${steps[g.step].q}]`;
  const d = await db.api('ai', { system, messages: msgs, max_tokens: 600 });
  return d.text || '(응답 없음)';
}

let persistTimer = null;
function persist(g) {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    try {
      const saved = await db.save('guides', g);
      Object.assign(g, { created_at: saved.created_at, updated_at: saved.updated_at, user_id: saved.user_id });
      const i = S.guides.findIndex(x => x.id === g.id); if (i >= 0) S.guides[i] = g;
    } catch (e) { console.warn('가이드 저장 실패', e); }
  }, 400);
}

function answers(g) {
  const out = {};
  const steps = STEPS[g.mode] || [];
  steps.forEach((s, i) => {
    const us = g.messages.filter(m => m.role === 'user' && m.step === i);
    const p = us.find(m => m.primary) || us[0];
    out[s.key] = p ? p.text : '';
  });
  return out;
}

async function nextStep(el, g) {
  const steps = STEPS[g.mode];
  if (g.step + 1 < steps.length) {
    g.step++;
    g.messages.push({ role: 'guide', text: steps[g.step].q, step: g.step, prefill: prefillFor(g.mode, g.step, g.book_id) });
    persist(g); chat(el, g); return;
  }
  // 완료: 결과 저장
  try { await finalize(g); } catch (e) { toast('저장 실패: ' + e.message); return; }
  g.status = 'done';
  persist(g);
  chat(el, g);
}

function parseKq(t) {
  if (!t) return { text: '', page: null, reason: '' };
  const parts = t.split(/\s*\/\s*|\n/).map(s => s.trim()).filter(Boolean);
  let page = null; let reason = '';
  const pi = parts.findIndex(p => /^(p\.?\s*)?\d{1,4}(쪽)?$/i.test(p));
  if (pi > 0) { page = Number(parts[pi].replace(/\D/g, '')); reason = parts.slice(pi + 1).join(' '); return { text: parts.slice(0, pi).join(' '), page, reason }; }
  if (parts.length >= 2) return { text: parts[0], page: null, reason: parts.slice(1).join(' ') };
  return { text: t, page: null, reason: '' };
}

async function finalize(g) {
  const a = answers(g);
  const b = db.book(g.book_id);
  const today = ymd();
  const lastAi = step => [...g.messages].reverse().find(m => m.role === 'ai' && m.step === step)?.text;
  if (g.mode === 'pre' && b) {
    await db.save('books', { ...b, pre_questions: { expect: a.expect, doubt: a.doubt, connect: a.connect }, goal: { period: a.period, reason: a.reason, change: a.change, plan: a.plan }, reason: b.reason || a.reason });
    const body = `### 목차·서문 훑기\n${a.scan}\n\n### 읽기 전 질문\n- 기대: ${a.expect}\n- 의심: ${a.doubt}\n- 연결: ${a.connect}\n\n### 독서 목표\n- 읽는 기간: ${a.period}\n- 이유: ${a.reason}\n- 읽고 난 후 달라질 점: ${a.change}\n- 활용 계획: ${a.plan}`;
    await db.save('notes', { book_id: b.id, kind: 'pre', title: '읽기 전 준비', body, note_date: today, tags: [] });
    g.summary = `기대: ${a.expect}`.slice(0, 100);
  }
  if (g.mode === 'daily') {
    const s100 = a.summary100.slice(0, 100);
    const body = `${s100}\n\n---\n- 오늘 읽은 범위: ${a.range}\n- 남는 문장: ${a.quote}\n- 남은 이유: ${a.why}\n- 내일 해볼 행동: ${a.apply}`;
    await db.save('notes', { book_id: g.book_id, kind: 'daily', title: '날마다 읽기 대화', body, note_date: today, tags: [] });
    g.summary = s100;
  }
  if (g.mode === 'after' && b) {
    const prev = db.summaryOf(b.id) || {};
    await db.save('summaries', {
      ...prev, book_id: b.id, one_line: a.one_line_final || a.one_line, key_quotes: [parseKq(a.kq1), parseKq(a.kq2), parseKq(a.kq3)], action_item: a.action_item,
      thesis: a.thesis, feynman: a.feynman, concepts: a.concepts.split(/[,，#\n]+/).map(s => s.trim()).filter(Boolean).slice(0, 10),
      written_at: prev.written_at || new Date().toISOString(), content_used: prev.content_used || {},
    });
    await ensureReviews(b.id, b.finish_date || today);
    g.summary = (a.one_line_final || a.one_line).slice(0, 100);
  }
  if (g.mode === 'apply' && b) {
    await db.save('experiments', { book_id: b.id, action: a.translate || a.extract, start_date: today, checks: {}, plan: { principle: a.extract, criteria: a.experiment, content: a.content } });
    g.summary = `30일 실험: ${a.translate}`.slice(0, 100);
  }
  toast('가이드 결과를 저장했어요');
}

function doneBox(g) {
  const b = db.book(g.book_id);
  const links = {
    pre: b ? `<a class="btn" href="#/book/${b.id}/info">읽기 전 질문 보기</a><a class="btn primary" href="#/timer/${b.id}">타이머로 읽기 시작</a>` : '',
    daily: `<a class="btn" href="#/db">노트 DB 보기</a><a class="btn primary" href="#/home">홈으로</a>`,
    after: b ? `<a class="btn" href="#/book/${b.id}/summary">완독 정리본 보기</a><a class="btn primary" href="#/guide/new/apply?book=${b.id}">활용 단계로</a>` : '',
    apply: b ? `<a class="btn" href="#/book/${b.id}/exp">30일 실험 보기</a><a class="btn primary" href="#/book/${b.id}/export">콘텐츠 내보내기</a>` : '',
  }[g.mode] || '';
  return `<div class="card done-box"><b>완료했어요</b><p class="small">${esc(MODES[g.mode]?.saves || '')}에 저장됐어요.${g.summary ? `<br><span class="muted">${esc(g.summary)}</span>` : ''}</p><div class="row gap wrap">${links}<button class="btn ghost" data-reopen>대화 이어가기</button></div></div>`;
}
function bindDone(el, g) {
  el.querySelector('[data-reopen]')?.addEventListener('click', () => { g.status = 'open'; persist(g); chat(el, g); });
}

async function saveChatAsNote(g) {
  const body = g.messages.map(m => `**${m.role === 'user' ? '나' : m.role === 'ai' ? 'AI' : '가이드'}**: ${m.text}`).join('\n\n');
  const title = g.mode === 'during' ? '읽는 중 대화' : (g.mode === 'card' ? resolveCard(g.card, g.book_id).title : '가이드 대화');
  await db.save('notes', { book_id: g.book_id, kind: g.mode === 'during' ? 'daily' : 'free', title, body, note_date: ymd(), tags: [] });
  const mine = g.messages.filter(m => m.role === 'user').map(m => m.text).join(' ').slice(0, 100);
  g.summary = mine; persist(g);
  toast('노트로 저장했어요');
}
