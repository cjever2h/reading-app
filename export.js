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
  L.push('## 콘텐츠 활용');
  const cu = sm.content_used || {};
  [['blog', '블로그 서평'], ['card', '카드뉴스'], ['threads', '스레드'], ['club', '독서모임 발제']].forEach(([k, v]) => L.push(`- [${cu[k] ? 'x' : ' '}] ${v}`));
  const free = notes.filter(n => n.kind === 'free' || n.kind === 'pre');
  if (free.length) { L.push('## 기타 노트'); free.forEach(n => { L.push(`### ${n.title || NOTE_KINDS[n.kind]} (${n.note_date})`); L.push(n.body); }); }
  if (b.source === 'aladin') L.push('---', `도서 정보 출처: 알라딘 ${b.aladin_link || ''}`);
  return L.join('\n');
}

export function reviewDraft(bookId) {
  const b = db.book(bookId); const sm = db.summaryOf(bookId) || {}; const pre = b.pre_questions || {};
  const qs = db.byBook('quotes', bookId);
  const kq = (sm.key_quotes || []).filter(k => k.text);
  const picked = kq.length ? kq : qs.slice(0, 3).map(q => ({ text: q.body, page: q.page, reason: q.memo }));
  const thoughts = qs.filter(q => q.memo).slice(0, 4);
  const L = [];
  L.push(`# [서평] ${T(b)}${sm.one_line ? ` | ${sm.one_line}` : ''}`);
  L.push(`**책 정보** ${b.title} / ${b.author || ''} / ${b.publisher || ''}${b.pub_date ? ` (${b.pub_date.slice(0, 4)})` : ''}${b.pages ? ` / ${b.pages}쪽` : ''}`);
  L.push(`**읽은 기간** ${b.start_date || ''} ~ ${b.finish_date || ''} · 총 독서 시간 ${fmtDur(bookSeconds(bookId))}${b.rating ? ` · 나의 별점 ${b.rating}/5` : ''}`);
  L.push('', '## 이 책을 읽게 된 이유', b.reason || pre.expect || '(직접 작성)');
  L.push('', '## 한 줄 요약', sm.one_line || '(직접 작성)');
  L.push('', '## 기억할 문장');
  picked.forEach(k => { L.push(`> ${k.text}${k.page ? ` (p.${k.page})` : ''}`); if (k.reason) L.push(`내 생각: ${k.reason}`); L.push(''); });
  L.push('## 나의 생각');
  if (sm.thesis) L.push(sm.thesis);
  thoughts.forEach(q => L.push(`- ${q.memo_type ? `[${q.memo_type}] ` : ''}${q.memo}`));
  if (!sm.thesis && !thoughts.length) L.push('(직접 작성)');
  L.push('', '## 내 삶에 적용할 한 가지', sm.action_item || '(직접 작성)');
  L.push('', '## 이런 분께 권해요', '- (직접 작성)');
  L.push('', `나의 한 줄 평: ${sm.one_line || '(직접 작성)'}`);
  if ((sm.concepts || []).length) L.push('', (sm.concepts || []).map(c => '#' + c.replace(/\s+/g, '')).join(' '));
  if (b.source === 'aladin') L.push('', '도서 정보: 알라딘');
  return L.join('\n');
}

export function cardNewsCopy(bookId) {
  const b = db.book(bookId); const sm = db.summaryOf(bookId) || {};
  const qs = db.byBook('quotes', bookId);
  const kq = (sm.key_quotes || []).filter(k => k.text);
  const picked = (kq.length ? kq : qs.slice(0, 3).map(q => ({ text: q.body, page: q.page, reason: q.memo }))).slice(0, 3);
  const L = [];
  L.push(`[카드 1 · 표지]`, `${T(b)}`, `${b.author || ''}`, `훅 문구(직접 다듬기): ${sm.one_line || '이 책이 나에게 남긴 한 가지'}`, '');
  picked.forEach((k, i) => {
    L.push(`[카드 ${i + 2} · 기억할 한 문장]`, `"${k.text}"`, k.page ? `- p.${k.page}` : '', k.reason ? `내 생각: ${k.reason}` : '', '');
  });
  const n = picked.length + 2;
  L.push(`[카드 ${n} · 나의 한 줄 평]`, sm.one_line || '(직접 작성)', '');
  L.push(`[카드 ${n + 1} · 오늘의 실천]`, sm.action_item || '(직접 작성)', '');
  L.push(`[카드 ${n + 2} · 마무리]`, '여러분에게 가장 남은 문장은 무엇인가요?', '댓글로 나눠주세요.', '');
  L.push('---', '[캡션 초안]', `${T(b)} (${b.author || ''})`, '', sm.one_line ? `제 한 줄 평은 이렇습니다. "${sm.one_line}"` : '', '', sm.action_item ? `이 책을 읽고 해볼 한 가지: ${sm.action_item}` : '', '',
    ['독서', '책추천', '독서기록', ...(sm.concepts || [])].map(c => '#' + c.replace(/\s+/g, '')).join(' '));
  L.push('', '※ "기억할 한 문장"은 책의 실제 문장만 사용. 나의 해석은 "내 생각/나의 한 줄 평"으로 구분.');
  return L.filter(x => x !== undefined).join('\n');
}

export function threadsDraft(bookId) {
  const b = db.book(bookId); const sm = db.summaryOf(bookId) || {};
  const q = (sm.key_quotes || []).find(k => k.text) || (db.byBook('quotes', bookId)[0] ? { text: db.byBook('quotes', bookId)[0].body } : null);
  return [
    `[1] (첫 문장 후킹, 직접 다듬기) ${sm.one_line || T(b) + '을 읽고 남은 한 가지'}`,
    '',
    `[2] ${T(b)} (${b.author || ''})에서 가장 남은 문장`,
    q ? `"${q.text}"` : '(문장 선택)',
    '',
    `[3] 제 한 줄 평은 이렇습니다. ${sm.one_line || '(직접 작성)'}`,
    sm.action_item ? `그래서 이번 달 해볼 것: ${sm.action_item}` : '',
    '',
    '여러분은 최근 읽은 책에서 어떤 문장이 남았나요?',
  ].join('\n');
}

export function discussionQuestions(bookId) {
  const b = db.book(bookId); const sm = db.summaryOf(bookId) || {};
  const qs = db.byBook('quotes', bookId);
  const out = [];
  out.push({ type: '여는 질문', q: `『${T(b)}』을 한 단어(또는 한 문장)로 표현한다면? 그 이유는?` });
  qs.filter(q => q.memo_type === '의문').slice(0, 3).forEach(q => out.push({ type: '생각을 묻는 질문', q: `"${q.body}"${q.page ? ` (p.${q.page})` : ''} 저자의 이 말에 동의하시나요? 동의하거나 망설여지는 이유는?`, note: q.memo }));
  qs.filter(q => q.memo_type === '연결').slice(0, 2).forEach(q => out.push({ type: '경험을 묻는 질문', q: `"${q.body}"${q.page ? ` (p.${q.page})` : ''} 이 문장을 읽고 떠오른 내 경험이나 다른 책이 있나요?`, note: q.memo }));
  qs.filter(q => q.memo_type === '공감').slice(0, 2).forEach(q => out.push({ type: '경험을 묻는 질문', q: `"${q.body}"${q.page ? ` (p.${q.page})` : ''} 이 문장에 공감했던 순간이 있다면 나눠주세요.`, note: q.memo }));
  (sm.concepts || []).slice(0, 2).forEach(c => out.push({ type: '개념 질문', q: `이 책의 핵심 개념 '${c}'을(를) 자기 말로 설명한다면? 일상에서 본 사례는?` }));
  out.push({ type: '적용 질문', q: '이 책을 읽고 앞으로 30일 동안 실천해 볼 한 가지는 무엇인가요?' + (sm.action_item ? ` (발제자의 액션: ${sm.action_item})` : '') });
  out.push({ type: '닫는 질문', q: '오늘 모임에서 나온 이야기 중 가장 남는 것 한 가지와, 이번 주 실천할 1가지는?' });
  return out;
}
export const discussionMarkdown = (bookId) => {
  const b = db.book(bookId);
  return [`# 『${T(b)}』 독서모임 발제`, '', ...discussionQuestions(bookId).map((x, i) => `${i + 1}. [${x.type}] ${x.q}${x.note ? `\n   - 발제자 메모: ${x.note}` : ''}`)].join('\n');
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
