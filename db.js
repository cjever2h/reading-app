// 데이터 계층: Supabase (로그인 사용자별 RLS) + 메모리 캐시
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export let sb = null;
export const S = {
  user: null,
  books: [], sessions: [], quotes: [], notes: [], summaries: [], experiments: [], reviews: [], guides: [],
  settings: {},
  apiStatus: null,
};

const TABLES = {
  books: 'books', sessions: 'reading_sessions', quotes: 'quotes', notes: 'notes', summaries: 'summaries',
  experiments: 'action_experiments', reviews: 'review_tasks', guides: 'guide_sessions',
};

const FIELDS = {
  books: ['id', 'isbn13', 'title', 'author', 'publisher', 'pub_date', 'cover_url', 'pages', 'aladin_category', 'aladin_link', 'description',
    'source', 'genre', 'status', 'start_date', 'finish_date', 'rating', 'reason', 'tags', 'goal', 'pre_questions', 'current_page', 'toc'],
  sessions: ['id', 'book_id', 'started_at', 'ended_at', 'seconds', 'start_page', 'end_page', 'photo_path', 'memo'],
  quotes: ['id', 'book_id', 'session_id', 'body', 'page', 'memo', 'memo_type', 'tags'],
  notes: ['id', 'book_id', 'kind', 'title', 'body', 'note_date', 'tags'],
  summaries: ['id', 'book_id', 'one_line', 'key_quotes', 'concepts', 'action_item', 'feynman', 'thesis', 'content_used', 'written_at'],
  experiments: ['id', 'book_id', 'action', 'start_date', 'checks', 'result_memo', 'plan'],
  reviews: ['id', 'book_id', 'stage', 'due_date', 'done', 'response', 'done_at'],
  guides: ['id', 'book_id', 'mode', 'messages', 'step', 'summary', 'status'],
};
const NUMERIC = new Set(['pages', 'rating', 'current_page', 'seconds', 'start_page', 'end_page', 'page', 'step']);

function clean(kind, obj) {
  const out = {};
  for (const f of FIELDS[kind]) {
    if (!(f in obj)) continue;
    let v = obj[f];
    if (v === '' || v === undefined) v = null;
    if (v !== null && NUMERIC.has(f)) { v = Number(v); if (Number.isNaN(v)) v = null; }
    out[f] = v;
  }
  if (!out.id) out.id = crypto.randomUUID();
  return out;
}

function chk({ data, error }) { if (error) throw error; return data; }

export async function init() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
}
export async function getUser() { const { data } = await sb.auth.getSession(); return data.session?.user ?? null; }
export async function signIn(email, password) { const { data, error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; return data.user; }
export async function signUp(email, password) { const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } }); if (error) throw error; return data; }
export async function signOut() { await sb.auth.signOut(); }
export async function resetPassword(email) { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin }); if (error) throw error; }
export async function updatePassword(pw) { const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw error; }
export function onAuth(cb) { sb.auth.onAuthStateChange((e, s) => cb(e, s?.user ?? null)); }

/** 로그인 직후 전체 데이터 로드 */
export async function loadAll() {
  const keys = Object.keys(TABLES);
  const res = await Promise.all(keys.map(k => sb.from(TABLES[k]).select('*').order('created_at', { ascending: true })));
  keys.forEach((k, i) => { S[k] = chk(res[i]) || []; });
  const st = chk(await sb.from('settings').select('*').maybeSingle());
  S.settings = st || {};
}

export async function save(kind, obj) {
  const row = clean(kind, obj);
  if (kind !== 'sessions') row.updated_at = new Date().toISOString();
  const data = chk(await sb.from(TABLES[kind]).upsert(row).select().single());
  const list = S[kind]; const i = list.findIndex(x => x.id === data.id);
  if (i >= 0) list[i] = data; else list.push(data);
  return data;
}
export async function insertMany(kind, arr) {
  if (!arr.length) return [];
  const rows = arr.map(o => clean(kind, o));
  const data = chk(await sb.from(TABLES[kind]).upsert(rows).select());
  for (const d of data) { const i = S[kind].findIndex(x => x.id === d.id); if (i >= 0) S[kind][i] = d; else S[kind].push(d); }
  return data;
}
export async function remove(kind, id) {
  chk(await sb.from(TABLES[kind]).delete().eq('id', id));
  S[kind] = S[kind].filter(x => x.id !== id);
  if (kind === 'books') { for (const k of ['sessions', 'quotes', 'notes', 'summaries', 'experiments', 'reviews', 'guides']) S[k] = S[k].filter(x => x.book_id !== id); }
  if (kind === 'sessions') S.quotes.forEach(q => { if (q.session_id === id) q.session_id = null; });
}

export async function saveSettings(patch) {
  const row = { ...S.settings, ...patch, user_id: S.user.id, updated_at: new Date().toISOString() };
  delete row.created_at;
  const data = chk(await sb.from('settings').upsert(row).select().single());
  S.settings = data;
  return data;
}

/* ---------- 조회 헬퍼 ---------- */
export const book = id => S.books.find(b => b.id === id);
export const byBook = (kind, id) => S[kind].filter(x => x.book_id === id);
export const summaryOf = id => S.summaries.find(s => s.book_id === id);

/* ---------- 스토리지 (페이지 사진) ---------- */
export async function uploadPhoto(blob, name = 'page.jpg') {
  const path = `${S.user.id}/${Date.now()}-${name}`;
  chk(await sb.storage.from('photos').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false }));
  return path;
}
export async function photoUrl(path) {
  if (!path) return null;
  const { data, error } = await sb.storage.from('photos').createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}
export async function removePhoto(path) { if (path) await sb.storage.from('photos').remove([path]); }

/* ---------- 서버 함수 (알라딘 프록시 / AI / 이미지 / 노션) ---------- */
export async function api(action, payload = {}) {
  const { data, error } = await sb.functions.invoke('api', { body: { action, ...payload } });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}
/** 외부 이미지(표지)를 CORS 문제 없이 캔버스용 objectURL로 */
const imgCache = new Map();
export async function proxiedImage(url) {
  if (!url) return null;
  if (imgCache.has(url)) return imgCache.get(url);
  try {
    const { data, error } = await sb.functions.invoke('api', { body: { action: 'img', url } });
    if (error) throw error;
    const blob = data instanceof Blob ? data : null;
    if (!blob) throw new Error('no blob');
    const u = URL.createObjectURL(blob);
    imgCache.set(url, u);
    return u;
  } catch { return null; }
}
export async function loadApiStatus() {
  try { S.apiStatus = await api('status'); } catch { S.apiStatus = { aladin: false, ai: null, notion: false, offline: true }; }
  return S.apiStatus;
}
