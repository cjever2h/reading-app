// 집계·공통 로직
import * as db from './db.js';
import { S } from './db.js';
import { ymd, addDays } from './ui.js';
import { PRINCIPLES, genreGuide } from './guide-data.js';

export const sessionDate = s => ymd(new Date(s.started_at));
export const pagesOf = s => (s.end_page && s.start_page != null) ? Math.max(0, s.end_page - s.start_page + 1) : 0;

export function secondsOn(date) {
  return S.sessions.filter(s => s.ended_at && sessionDate(s) === date).reduce((a, s) => a + (s.seconds || 0), 0);
}
export function pagesOn(date) {
  return S.sessions.filter(s => s.ended_at && sessionDate(s) === date).reduce((a, s) => a + pagesOf(s), 0);
}
/** 연속 독서일: 오늘 읽었으면 오늘부터, 아니면 어제부터 거꾸로 */
export function streak(today = ymd()) {
  const days = new Set(S.sessions.filter(s => s.ended_at && (s.seconds || 0) > 0).map(sessionDate));
  let d = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
export function longestStreak() {
  const days = [...new Set(S.sessions.filter(s => s.ended_at && (s.seconds || 0) > 0).map(sessionDate))].sort();
  let best = 0, cur = 0, prev = null;
  for (const d of days) { cur = prev && addDays(prev, 1) === d ? cur + 1 : 1; best = Math.max(best, cur); prev = d; }
  return best;
}
export function bookSeconds(bookId) { return S.sessions.filter(s => s.book_id === bookId && s.ended_at).reduce((a, s) => a + (s.seconds || 0), 0); }
export function lastPage(bookId) {
  const b = db.book(bookId);
  const ends = S.sessions.filter(s => s.book_id === bookId && s.end_page).map(s => s.end_page);
  return Math.max(b?.current_page || 0, ...ends, 0);
}
export function progress(b) {
  const p = lastPage(b.id);
  if (!b.pages) return null;
  return Math.min(100, Math.round((p / b.pages) * 100));
}

/* ---------- 복습 일정 ---------- */
export async function ensureReviews(bookId, baseDate) {
  const base = baseDate || db.book(bookId)?.finish_date || ymd();
  const want = [['D+1', 1], ['D+3', 3], ['D+7', 7]];
  const exist = db.byBook('reviews', bookId);
  const rows = want.filter(([st]) => !exist.some(r => r.stage === st)).map(([stage, n]) => ({ book_id: bookId, stage, due_date: addDays(base, n), done: false }));
  if (rows.length) await db.insertMany('reviews', rows);
}
export function dueReviews(today = ymd()) {
  return S.reviews.filter(r => !r.done && r.due_date <= today).sort((a, b) => a.due_date.localeCompare(b.due_date));
}

/* ---------- AI 맥락 ---------- */
export function bookContext(bookId, { uptoPage = null, includeNotes = true, toc = false } = {}) {
  const b = db.book(bookId);
  if (!b) return '';
  const lines = [`[책] ${b.title} / ${b.author || ''} / ${b.publisher || ''} / 장르: ${b.genre || '미정'} / 총 ${b.pages || '?'}쪽`];
  if (b.description) lines.push(`[알라딘 소개] ${b.description.slice(0, 800)}`);
  if (toc && b.toc) lines.push(`[목차]\n${b.toc.slice(0, 2500)}`);
  if (b.reason) lines.push(`[읽는 이유] ${b.reason}`);
  if (b.pre_questions) { const q = b.pre_questions; lines.push(`[읽기 전 질문] 기대: ${q.expect || '-'} / 의심: ${q.doubt || '-'} / 연결: ${q.connect || '-'}`); }
  const page = uptoPage ?? lastPage(bookId);
  if (page) lines.push(`[현재 읽은 쪽] ${page}쪽까지 읽음. ${page}쪽 이후 내용은 절대 언급하지 말 것.`);
  const qs = db.byBook('quotes', bookId).slice(-25);
  if (qs.length) lines.push('[저장한 문장]\n' + qs.map(q => `- (p.${q.page ?? '?'}) ${q.body}${q.memo ? ` / ${q.memo_type || '메모'}: ${q.memo}` : ''}`).join('\n'));
  if (includeNotes) {
    const ns = db.byBook('notes', bookId).slice(-8);
    if (ns.length) lines.push('[이전 노트]\n' + ns.map(n => `- ${n.note_date} ${n.title || ''}: ${String(n.body).slice(0, 300)}`).join('\n'));
    const sm = db.summaryOf(bookId);
    if (sm?.one_line) lines.push(`[완독 정리] 한 줄 요약: ${sm.one_line} / 액션: ${sm.action_item || '-'} / 개념: ${(sm.concepts || []).join(', ')}`);
  }
  if (S.settings.cross_book) {
    const others = S.books.filter(x => x.id !== bookId && x.status === 'done').slice(-5);
    if (others.length) lines.push('[교차 분석용: 다른 완독 책]\n' + others.map(o => `- ${o.title}: ${db.summaryOf(o.id)?.one_line || ''}`).join('\n'));
  }
  return lines.join('\n');
}
export function systemPrompt(bookId, extra = '', opts = {}) {
  const b = db.book(bookId);
  const custom = S.settings.custom_prompts || {};
  const parts = [PRINCIPLES];
  const gg = b?.genre ? genreGuide(b.genre, custom) : null;
  if (gg) parts.push(`[장르 지침 · ${gg.from}] ${gg.lens}\n원고 부록 A의 이 장르 프롬프트: ${gg.prompts.map(p => `${p.label} "${p.text}"`).join(' / ')}`);
  if (!S.settings.cross_book) parts.push('다른 책과의 교차 분석은 하지 않는다.');
  if (bookId) parts.push(bookContext(bookId, opts));
  if (extra) parts.push('[이번 단계에서 할 일] ' + extra);
  return parts.join('\n\n');
}
export const aiOn = () => Boolean(S.apiStatus?.ai);
