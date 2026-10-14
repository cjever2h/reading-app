// Supabase Edge Function: api
// 알라딘 OpenAPI 프록시(키 노출·CORS 방지), AI 가이드 대화, 표지 이미지 프록시, 노션 전송, OCR
// Secrets: ALADIN_TTB_KEY, GEMINI_API_KEY | OPENAI_API_KEY | ANTHROPIC_API_KEY, (선택) NOTION_TOKEN
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const ALADIN = Deno.env.get('ALADIN_TTB_KEY') || '';
const GEMINI = Deno.env.get('GEMINI_API_KEY') || '';
const OPENAI = Deno.env.get('OPENAI_API_KEY') || '';
const ANTHROPIC = Deno.env.get('ANTHROPIC_API_KEY') || '';
const NOTION = Deno.env.get('NOTION_TOKEN') || '';
const aiProvider = GEMINI ? 'gemini' : OPENAI ? 'openai' : ANTHROPIC ? 'anthropic' : null;

async function authUser(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data } = await sb.auth.getUser(token);
  return data.user ?? null;
}

/* ---------- 도서 검색 ---------- */
type BookOut = { isbn13: string; title: string; author: string; publisher: string; pub_date: string; cover_url: string; pages: number | null; aladin_category: string; aladin_link: string; description: string; toc?: string; source: string };

function fromAladin(it: any): BookOut {
  return {
    isbn13: it.isbn13 || it.isbn || '',
    title: it.title || '',
    author: it.author || '',
    publisher: it.publisher || '',
    pub_date: it.pubDate || '',
    cover_url: (it.cover || '').replace(/^http:/, 'https:'),
    pages: it.subInfo?.itemPage ?? null,
    aladin_category: it.categoryName || '',
    aladin_link: (it.link || '').replace(/&amp;/g, '&'),
    description: it.description || '',
    toc: it.subInfo?.toc || '',
    source: 'aladin',
  };
}
function fromGoogle(v: any): BookOut {
  const i = v.volumeInfo || {};
  const ids = i.industryIdentifiers || [];
  const isbn = (ids.find((x: any) => x.type === 'ISBN_13') || ids.find((x: any) => x.type === 'ISBN_10') || {}).identifier || '';
  const img = i.imageLinks?.thumbnail || i.imageLinks?.smallThumbnail || '';
  return {
    isbn13: isbn, title: [i.title, i.subtitle].filter(Boolean).join(': '), author: (i.authors || []).join(', '), publisher: i.publisher || '',
    pub_date: i.publishedDate || '', cover_url: img.replace(/^http:/, 'https:').replace('&edge=curl', ''), pages: i.pageCount ?? null,
    aladin_category: (i.categories || []).join(' > '), aladin_link: i.infoLink || '', description: i.description || '', source: 'google',
  };
}

async function aladinSearch(q: string, type: string) {
  if (ALADIN) {
    if (type === 'ISBN') return [await aladinLookup(q.replace(/[^0-9Xx]/g, ''))].filter(Boolean);
    const qt = type === 'Title' ? 'Title' : type === 'Author' ? 'Author' : 'Keyword';
    const u = `https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?ttbkey=${ALADIN}&Query=${encodeURIComponent(q)}&QueryType=${qt}&MaxResults=20&start=1&SearchTarget=Book&output=js&Version=20131101&Cover=Big`;
    const r = await fetch(u);
    const t = await r.text();
    const d = JSON.parse(t.replace(/;\s*$/, ''));
    if (d.errorCode) throw new Error(`알라딘 오류: ${d.errorMessage}`);
    return (d.item || []).map(fromAladin);
  }
  const prefix = type === 'Title' ? 'intitle:' : type === 'Author' ? 'inauthor:' : type === 'ISBN' ? 'isbn:' : '';
  const qq = type === 'ISBN' ? q.replace(/[^0-9Xx]/g, '') : q;
  const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(prefix + qq)}&maxResults=20&printType=books`);
  const d = await r.json();
  return (d.items || []).map(fromGoogle);
}
async function aladinLookup(isbn: string): Promise<BookOut | null> {
  if (!isbn) return null;
  if (ALADIN) {
    const idType = isbn.length === 13 ? 'ISBN13' : 'ISBN';
    const u = `https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx?ttbkey=${ALADIN}&itemIdType=${idType}&ItemId=${isbn}&output=js&Version=20131101&Cover=Big&OptResult=Toc,fulldescription`;
    const r = await fetch(u);
    const t = await r.text();
    const d = JSON.parse(t.replace(/;\s*$/, ''));
    if (d.errorCode) throw new Error(`알라딘 오류: ${d.errorMessage}`);
    const it = (d.item || [])[0];
    if (!it) return null;
    const out = fromAladin(it);
    if (it.fulldescription) out.description = String(it.fulldescription).replace(/<[^>]+>/g, '').slice(0, 3000);
    if (out.toc) out.toc = String(out.toc).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
    return out;
  }
  const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
  const d = await r.json();
  return d.items?.[0] ? fromGoogle(d.items[0]) : null;
}

/* ---------- AI ---------- */
type Msg = { role: 'user' | 'assistant'; content: string };
async function ai(system: string, messages: Msg[], maxTokens = 700, image?: { mime: string; data: string }) {
  if (!aiProvider) throw new Error('AI 키가 설정되지 않았어요');
  if (aiProvider === 'gemini') {
    const contents = messages.map((m, i) => {
      const parts: any[] = [{ text: m.content }];
      if (image && i === messages.length - 1) parts.push({ inline_data: { mime_type: image.mime, data: image.data } });
      return { role: m.role === 'assistant' ? 'model' : 'user', parts };
    });
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: maxTokens * 3, temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } } }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    return (d.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim();
  }
  if (aiProvider === 'openai') {
    const msgs: any[] = [{ role: 'system', content: system }, ...messages.map((m, i) => {
      if (image && i === messages.length - 1) return { role: m.role, content: [{ type: 'text', text: m.content }, { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data}` } }] };
      return m;
    })];
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: msgs, max_tokens: maxTokens, temperature: 0.7 }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    return d.choices?.[0]?.message?.content?.trim() || '';
  }
  const msgs = messages.map((m, i) => {
    if (image && i === messages.length - 1) return { role: m.role, content: [{ type: 'image', source: { type: 'base64', media_type: image.mime, data: image.data } }, { type: 'text', text: m.content }] };
    return m;
  });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5', system, messages: msgs, max_tokens: maxTokens }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return (d.content || []).map((c: any) => c.text || '').join('').trim();
}

/* ---------- 노션 ---------- */
function mdToBlocks(md: string) {
  const blocks: any[] = [];
  const rt = (t: string) => {
    const out: any[] = [];
    for (let i = 0; i < t.length; i += 1900) out.push({ type: 'text', text: { content: t.slice(i, i + 1900) } });
    return out;
  };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    let m;
    if ((m = line.match(/^###\s+(.*)/))) blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: rt(m[1]) } });
    else if ((m = line.match(/^##\s+(.*)/))) blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: rt(m[1]) } });
    else if ((m = line.match(/^#\s+(.*)/))) blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: rt(m[1]) } });
    else if ((m = line.match(/^>\s?(.*)/))) blocks.push({ object: 'block', type: 'quote', quote: { rich_text: rt(m[1]) } });
    else if ((m = line.match(/^\s*[-*]\s+\[( |x)\]\s+(.*)/))) blocks.push({ object: 'block', type: 'to_do', to_do: { rich_text: rt(m[2]), checked: m[1] === 'x' } });
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(m[1]) } });
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) blocks.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: rt(m[1]) } });
    else if (/^---+$/.test(line)) blocks.push({ object: 'block', type: 'divider', divider: {} });
    else blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt(line) } });
  }
  return blocks;
}
async function notionExport(token: string, parent: string, title: string, markdown: string) {
  const tk = token || NOTION;
  if (!tk) throw new Error('노션 통합 토큰이 없어요 (설정에서 입력)');
  const pid = (parent.match(/[0-9a-f]{32}/i) || parent.replace(/-/g, '').match(/[0-9a-f]{32}/i) || [''])[0];
  if (!pid) throw new Error('노션 상위 페이지 ID(또는 URL)가 올바르지 않아요');
  const blocks = mdToBlocks(markdown);
  const headers = { Authorization: `Bearer ${tk}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };
  const r = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST', headers,
    body: JSON.stringify({ parent: { page_id: pid }, properties: { title: { title: [{ text: { content: title.slice(0, 200) } }] } }, children: blocks.slice(0, 100) }),
  });
  const d = await r.json();
  if (d.object === 'error') throw new Error(`노션 오류: ${d.message}`);
  for (let i = 100; i < blocks.length; i += 100) {
    await fetch(`https://api.notion.com/v1/blocks/${d.id}/children`, { method: 'PATCH', headers, body: JSON.stringify({ children: blocks.slice(i, i + 100) }) });
  }
  return { url: d.url, id: d.id };
}

const IMG_HOSTS = /(^|\.)(aladin\.co\.kr|googleusercontent\.com|books\.google\.com|google\.com|gstatic\.com|kakaocdn\.net|daumcdn\.net|yes24\.com|kyobobook\.co\.kr)$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const user = await authUser(req);
    if (!user) return json({ error: '로그인이 필요해요' }, 401);
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === 'status') return json({ aladin: !!ALADIN, search: ALADIN ? 'aladin' : 'google', ai: aiProvider, notion: !!NOTION });

    if (action === 'search') return json({ items: await aladinSearch(String(body.q || ''), String(body.type || 'Keyword')), source: ALADIN ? 'aladin' : 'google' });
    if (action === 'lookup') return json({ item: await aladinLookup(String(body.isbn || '')) });

    if (action === 'img') {
      const u = new URL(String(body.url || ''));
      if (!IMG_HOSTS.test(u.hostname)) return json({ error: 'host not allowed' }, 400);
      const r = await fetch(u.toString());
      if (!r.ok) return json({ error: 'fetch failed' }, 502);
      return new Response(await r.arrayBuffer(), { headers: { ...CORS, 'Content-Type': r.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=86400' } });
    }

    if (action === 'ai') {
      const text = await ai(String(body.system || ''), (body.messages || []).slice(-30), Math.min(Number(body.max_tokens) || 700, 2000));
      return json({ text, provider: aiProvider });
    }

    if (action === 'ocr') {
      const text = await ai('너는 OCR 엔진이다. 사진 속 책 본문 텍스트를 그대로 옮겨 적는다. 설명, 요약, 수정 없이 보이는 문장만 출력한다. 줄바꿈은 문단 기준으로 정리한다.',
        [{ role: 'user', content: '이 책 페이지 사진의 본문 텍스트를 그대로 적어줘.' }], 1500, { mime: String(body.mime || 'image/jpeg'), data: String(body.data || '') });
      return json({ text });
    }

    if (action === 'notion') return json(await notionExport(String(body.token || ''), String(body.parent || ''), String(body.title || '독서노트'), String(body.markdown || '')));

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
