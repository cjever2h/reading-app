// 내보내기: 독서노트(노션 구조), 서평 초안, 카드뉴스 카피, 스레드, 발제 질문, 마크다운, 노션 전송
import * as db from './db.js';
import { S } from './db.js';
import { fmtDur, NOTE_KINDS, stars } from './ui.js';
import { bookSeconds, systemPrompt } from './calc.js';

const T = b => String(b.title || '').split(/\s*:\s+/)[0];
const quoteLine = q => `> ${q.body}${q.page ? ` (p.${q.page})` : ''}`;

export function notebookMarkdown(bookId) {
  const b = db.book(bookId); if (!b) return '';
  const sm = db.summaryOf(bookId) || {};
  const pre = b.pre_questions || {}, goal = b.goal || {};
  const notes = db.byBook('notes', bookId);
  const quotes = db.byBook('quotes', bookId).sort((a, c) => (a.page || 0) - (c.page || 0));
  const L = [];
  L.push(`# ${b.title}`);
  L.push('## 기본 정보');
  L.push(`- 저자: ${b.author || ''}`, `- 출판사: ${b.publisher || ''} (${b.pub_date || ''})`, `- 쪽수: ${b.pages || ''}`, `- 장르: ${b.genre || ''}`,
    `- 읽은 기간: ${b.start_date || '?'} ~ ${b.finish_date || '읽는 중'}`, `- 총 독서 시간: ${fmtDur(bookSeconds(bookId))}`,
    `- 별점: ${b.rating ? `${stars(b.rating)} (${b.rating})` : '-'}`, `- 읽는 이유: ${b.reason || goal.reason || ''}`);
  if (b.isbn13) L.push(`- ISBN: ${b.isbn13}`);
  L.push('## 읽기 전 질문');
  L.push(`- 기대: ${pre.expect || ''}`, `- 의심: ${pre.doubt || ''}`, `- 연결: ${pre.connect || ''}`);
  if (goal.period || goal.change || goal.plan) L.push(`- 독서 목표: ${goal.period || ''} / 달라질 점: ${goal.change || ''} / 활용 계획: ${goal.plan || ''}`);
  L.push('## 챕터별 메모');
  const ch = notes.filter(n => n.kind === 'chapter');
  if (ch.length) ch.forEach(n => { L.push(`### ${n.title || n.note_date}`); L.push(n.body.replace(/^##\s*챕터:.*$/m, '').trim()); });
  else L.push('- (챕터별 메모 없음)');
  L.push('### 저장한 문장');
  quotes.forEach(q => { L.push(quoteLine(q)); if (q.memo) L.push(`- ${q.memo_type ? `[${q.memo_type}] ` : ''}${q.memo}`); });
  const daily = notes.filter(n => n.kind === 'daily');
  if (daily.length) { L.push('### 일일 노트'); daily.forEach(n => L.push(`- ${n.note_date}: ${n.body.replace(/\n+/g, ' ')}`)); }
  L.push('## 완독 후 정리');
  L.push(`- 한 줄 요약: ${sm.one_line || ''}`);
  (sm.key_quotes || []).forEach((k, i) => { if (k.text) { L.push(`- 핵심 문장 ${i + 1}: "${k.text}"${k.page ? ` (p.${k.page})` : ''}`); if (k.reason) L.push(`  - 이유: ${k.reason}`); } });
  L.push(`- 액션 아이템: ${sm.action_item || ''}`);
  if (sm.thesis) L.push(`- 논지 압축: ${sm.thesis.replace(/\n+/g, ' ')}`);
  if (sm.feynman) L.push(`- 파인만 설명: ${sm.feynman.replace(/\n+/g, ' ')}`);
  L.push('## 핵심 개념 태그');
  L.push((sm.concepts || []).map(c => `#${c}`).join(' ') || '-');
  L.push('## 연결된 책');
  const linked = sm.linked_books || [];
  const sameTag = S.books.filter(x => x.id !== bookId && (db.summaryOf(x.id)?.concepts || []).some(c => (sm.concepts || []).includes(c)));
  if (linked.length) linked.forEach(t => L.push(`- ${t}`));
  if (sameTag.length) L.push(`- (같은 핵심 개념 태그) ${sameTag.map(x => `『${T(x)}』`).join(', ')}`);
  if (!linked.length && !sameTag.length) L.push('-');
  L.push('## 콘텐츠 활용');
  const cu = sm.content_used || {};
  [['blog', '블로그 서평'], ['card', '카드뉴스'], ['threads', '스레드'], ['club', '독서모임 발제']].forEach(([k, v]) => L.push(`- [${cu[k] ? 'x' : ' '}] ${v}`));
  const free = notes.filter(n => n.kind === 'free' || n.kind === 'pre');
  if (free.length) { L.push('## 기타 노트'); free.forEach(n => { L.push(`### ${n.title || NOTE_KINDS[n.kind]} (${n.note_date})`); L.push(n.body); }); }
  if (b.source === 'aladin') L.push('---', `도서 정보 출처: 알라딘 ${b.aladin_link || ''}`);
  return L.join('\n');
}

// 4-5 독서 후기 빠르게 쓰는 법: 노트(한 줄 요약·핵심 문장 3개·이유·액션)로 뼈대를 만들고 '내 이야기'를 직접 더한다
export function reviewDraft(bookId) {
  const b = db.book(bookId); const sm = db.summaryOf(bookId) || {}; const pre = b.pre_questions || {};
  const qs = db.byBook('quotes', bookId);
  const kq = (sm.key_quotes || []).filter(k => k.text);
  const picked = kq.length ? kq : qs.slice(0, 3).map(q => ({ text: q.body, page: q.page, reason: q.memo }));
  const thoughts = qs.filter(q => q.memo).slice(0, 4);
  const L = [];
  L.push('제목 후보 (직접 고르기)', `1. ${T(b)}${sm.one_line ? ` | ${sm.one_line}` : ' | (한 줄 요약)'}`, '2. (직접 작성)', '3. (직접 작성)', '');
  L.push(`# [서평] ${T(b)}`);
  L.push(`**책 정보** ${b.title} / ${b.author || ''} / ${b.publisher || ''}${b.pub_date ? ` (${b.pub_date.slice(0, 4)})` : ''}${b.pages ? ` / ${b.pages}쪽` : ''}`);
  L.push(`**읽은 기간** ${b.start_date || ''} ~ ${b.finish_date || ''} · 총 독서 시간 ${fmtDur(bookSeconds(bookId))}${b.rating ? ` · 나의 별점 ${b.rating}/5` : ''}`);
  L.push('', '## 이 책을 읽게 된 계기 (내 이야기)', b.reason || pre.expect || '(직접 작성)');
  L.push('', '## 한 줄 요약', sm.one_line || '(직접 작성)');
  L.push('', '## 기억할 문장');
  picked.forEach(k => { L.push(`> ${k.text}${k.page ? ` (p.${k.page})` : ''}`); if (k.reason) L.push(`인상 깊은 이유: ${k.reason}`); L.push(''); });
  L.push('## 읽으면서 떠오른 내 경험 (내 이야기)');
  thoughts.forEach(q => L.push(`- ${q.memo_type ? `[${q.memo_type}] ` : ''}${q.memo}`));
  L.push('(직접 작성)');
  if (sm.thesis) L.push('', '## 이 책의 핵심', sm.thesis);
  L.push('', '## 이 책 이후 실제로 바뀐 것 (내 이야기)', sm.action_item ? `액션 아이템: ${sm.action_item}` : '', '(실제로 해본 결과를 직접 작성)');
  L.push('', `나의 한 줄 평: ${sm.one_line || '(직접 작성)'}`);
  if ((sm.concepts || []).length) L.push('', (sm.concepts || []).map(c => '#' + c.replace(/\s+/g, '')).join(' '));
  if (b.source === 'aladin') L.push('', '도서 정보: 알라딘');
  L.push('', '※ AI 초안은 뼈대일 뿐이에요. 계기·내 경험·바뀐 것을 넣어야 후기가 살아나요. (원고 4-5)');
  return L.join('\n').replace(/\n{3,}/g, '\n\n');
}

// 5-2: 카드뉴스는 핵심 인사이트 5개 → 7장
export function cardNewsCopy(bookId) {
  const b = db.book(bookId); const sm = db.summaryOf(bookId) || {};
  const qs = db.byBook('quotes', bookId);
  const kq = (sm.key_quotes || []).filter(k => k.text);
  const ins = [...kq.map(k => ({ text: k.text, page: k.page, mine: k.reason })), ...qs.filter(q => !kq.some(k => k.text === q.body)).map(q => ({ text: q.body, page: q.page, mine: q.memo }))].slice(0, 5);
  while (ins.length < 5) ins.push({ text: '(인사이트 직접 작성)', page: null, mine: '' });
  const L = [];
  L.push('[카드 1 · 표지]', T(b), b.author || '', `훅 문구(직접 다듬기): ${sm.one_line || '이 책이 나에게 남긴 한 가지'}`, '');
  ins.forEach((k, i) => {
    L.push(`[카드 ${i + 2} · 인사이트 ${i + 1}]`, k.text.startsWith('(') ? k.text : `"${k.text}"${k.page ? ` (p.${k.page})` : ''}`);
    if (k.mine) L.push(`내 생각: ${k.mine}`);
    L.push('');
  });
  L.push('[카드 7 · 마무리]', `나의 한 줄 평: ${sm.one_line || '(직접 작성)'}`, sm.action_item ? `이 책으로 해볼 한 가지: ${sm.action_item}` : '', '여러분에게 가장 남은 문장은 무엇인가요?', '');
  L.push('---', '[캡션 초안]', `${T(b)} (${b.author || ''})`, sm.one_line ? `제 한 줄 평은 이렇습니다. "${sm.one_line}"` : '',
    ['독서', '책추천', '독서기록', ...(sm.concepts || [])].map(c => '#' + c.replace(/\s+/g, '')).join(' '));
  L.push('', '※ 따옴표 문장은 책의 실제 문장만 사용. 나의 해석은 "내 생각/나의 한 줄 평"으로 구분. (원고 5-2: 핵심 인사이트 5개 → 카드뉴스 7장)');
  return L.join('\n');
}

// 5-2: 스레드 5개 — "이 책 왜 읽어야 하는가" → 핵심 인사이트 3개 → 행동 촉구
export function threadsDraft(bookId) {
  const b = db.book(bookId); const sm = db.summaryOf(bookId) || {};
  const qs = db.byBook('quotes', bookId);
  const kq = (sm.key_quotes || []).filter(k => k.text);
  const ins = (kq.length ? kq : qs.map(q => ({ text: q.body, page: q.page, reason: q.memo }))).slice(0, 3);
  while (ins.length < 3) ins.push({ text: '', reason: '' });
  const L = [`[1/5] 이 책 왜 읽어야 하는가 (첫 문장 후킹, 직접 다듬기)`, `${T(b)}${b.author ? ` (${b.author.split(',')[0]})` : ''}. ${b.reason ? b.reason : '(내가 이 책을 읽은 이유)'}`, ''];
  ins.forEach((k, i) => {
    L.push(`[${i + 2}/5] 핵심 인사이트 ${i + 1}`, k.text ? `"${k.text}"` : '(인상 깊은 문장 직접 선택)');
    L.push(k.reason ? `내 생각: ${k.reason}` : '내 생각: (직접 작성)', '');
  });
  L.push('[5/5] 행동 촉구', sm.action_item ? `저는 이번 달 이렇게 해봅니다: ${sm.action_item}` : '(이 책을 읽고 해볼 한 가지)', '여러분은 최근 읽은 책에서 어떤 문장이 남았나요?');
  return L.join('\n');
}

// 5-5·부록 E: 토론 질문 3유형 × 2 (① 주장 동의/반대 ② 내 삶에 적용 ③ 저자에 대한 의문) + 20분 발표 구조
export function discussionQuestions(bookId) {
  const b = db.book(bookId); const sm = db.summaryOf(bookId) || {};
  const qs = db.byBook('quotes', bookId);
  const cite = q => `"${q.body}"${q.page ? ` (p.${q.page})` : ''}`;
  const kq = (sm.key_quotes || []).filter(k => k.text).map(k => ({ body: k.text, page: k.page, memo: k.reason }));
  const pool = [...kq, ...qs];
  const out = [];
  const agree = [...pool.filter(q => q.memo_type === '의문'), ...pool].slice(0, 2);
  agree.forEach(q => out.push({ type: '① 주장에 동의/반대', q: `${cite(q)} 저자의 이 주장에 동의하시나요, 반대하시나요? 그 이유는?`, note: q.memo }));
  if (agree.length < 2) out.push({ type: '① 주장에 동의/반대', q: sm.thesis ? `저자의 핵심 주장 중 동의하는 것과 동의하지 않는 것은 무엇인가요?` : '(저자의 핵심 주장 하나를 넣어 직접 작성)' });
  const apply = [...pool.filter(q => q.memo_type === '연결' || q.memo_type === '공감')].slice(0, 1);
  apply.forEach(q => out.push({ type: '② 내 삶에 적용', q: `${cite(q)} 이 문장을 내 일이나 생활에 적용한다면 무엇이 달라질까요?`, note: q.memo }));
  out.push({ type: '② 내 삶에 적용', q: '이 책에서 하나만 30일 동안 실험해 본다면 무엇을 해보고 싶나요?' + (sm.action_item ? ` (발제자의 액션: ${sm.action_item})` : '') });
  if (!apply.length) out.push({ type: '② 내 삶에 적용', q: (sm.concepts || [])[0] ? `'${sm.concepts[0]}'이(가) 내 삶에서 작동했던 순간이 있었나요?` : '(직접 작성)' });
  out.push({ type: '③ 저자에 대한 의문', q: `저자는 왜 이 책을 썼을까요? 저자가 놓치고 있거나 말하지 않은 것은 무엇일까요?` });
  out.push({ type: '③ 저자에 대한 의문', q: `이 책의 주장이 틀리다면 어떤 상황일까요?` });
  return out.slice(0, 6);
}
export const discussionMarkdown = (bookId) => {
  const b = db.book(bookId); const sm = db.summaryOf(bookId) || {};
  return [
    `# 『${T(b)}』 독서모임 발제`, '',
    '## 20분 발표 구조',
    `- 도입 (3분): 이 책을 고른 이유. ${b.reason || '(직접 작성)'}`,
    `- 독서 요약 (7분): ${sm.one_line || '(한 줄 요약)'}${sm.thesis ? ` / 핵심: ${sm.thesis.replace(/\n+/g, ' ')}` : ''}`,
    `- 핵심 인사이트 (7분): ${(sm.key_quotes || []).filter(k => k.text).map(k => `"${k.text}"`).join(' · ') || '(핵심 문장 3개)'}`,
    '- Q&A 유도 (3분): "저는 이 부분에서 동의하지 않는데, 여러분은 어떻게 생각하세요?"', '',
    '## 토론 질문',
    ...discussionQuestions(bookId).map((x, i) => `${i + 1}. [${x.type}] ${x.q}${x.note ? `\n   - 발제자 메모: ${x.note}` : ''}`), '',
    '## 진행 팁 (원고 부록 E)',
    '- 좋은 토론의 3조건: ① 답이 하나가 아닐 것 ② 참여자마다 다른 답을 가질 것 ③ 책을 읽지 않은 사람도 생각해볼 수 있을 것',
    '- 토론이 정체될 때: "이 주장이 틀리다면 어떤 상황일까요?"',
  ].join('\n');
};

export function allMarkdown() {
  return S.books.map(b => notebookMarkdown(b.id)).join('\n\n---\n\n');
}
export function backupJson() {
  const { user, apiStatus, ...rest } = S;
  return JSON.stringify({ exported_at: new Date().toISOString(), ...rest, settings: { ...S.settings, notion_token: undefined } }, null, 2);
}

/** AI로 다듬기: 사용자의 재료를 유지하며 문장만 다듬는다 */
export async function aiPolish(bookId, kind, draft) {
  const instr = {
    review: '아래 서평 초안을 블로그 서평으로 다듬어라. 사용자가 쓴 생각과 문장을 최대한 살리고, 인용 문장(> 로 시작)은 한 글자도 바꾸지 마라. 사용자가 쓰지 않은 사실이나 평가를 지어내지 말고, (직접 작성) 칸은 그대로 남겨라. 마크다운으로 출력.',
    card: '아래 카드뉴스 카피를 인스타그램 카드뉴스용으로 짧고 한눈에 보이게 다듬어라. 카드당 2~3줄. "기억할 한 문장"은 책의 실제 문장 그대로 두고, 해석은 "내 생각"/"나의 한 줄 평"으로 구분해라. 결말 스포일러 금지.',
    threads: '아래 스레드 초안을 짧고 명확하게 다듬어라. 첫 문장은 후킹, 3개 이하의 이어지는 글. 인용은 실제 문장 그대로.',
    discussion: '아래 독서모임 발제 질문을 열린 질문으로 다듬어라. 경험을 묻는 질문과 생각을 묻는 질문의 균형을 맞추고, 인용 문장은 그대로 둔다. 번호 목록 마크다운으로.',
  }[kind];
  const d = await db.api('ai', { system: systemPrompt(bookId, instr, { includeNotes: true }), messages: [{ role: 'user', content: draft }], max_tokens: 1500 });
  return d.text;
}

export async function sendToNotion(title, markdown) {
  const st = S.settings;
  return db.api('notion', { token: st.notion_token || '', parent: st.notion_parent || '', title, markdown });
}
