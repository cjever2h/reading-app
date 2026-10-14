// Supabase Edge Function: api
// 도서 검색 프록시(카카오 책 검색 + 알라딘 공개 페이지 보충, 키 노출·CORS 방지), AI 가이드 대화, 표지 이미지 프록시, 노션 전송, OCR
// Secrets: KAKAO_REST_KEY (카카오 책 검색), GEMINI_API_KEY | OPENAI_API_KEY | ANTHROPIC_API_KEY, (선택) NOTION_TOKEN
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const KAKAO = Deno.env.get('KAKAO_REST_KEY') || '';
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
// 1순위: 카카오 책 검색 API (공식, KAKAO_REST_KEY)
// 보충: 카카오에는 쪽수·분류가 없어서 알라딘 공개 상품 페이지에서 쪽수·분류·큰 표지만 읽어 채운다 (실패하면 직접 입력)
// 키가 없을 때: 알라딘 공개 검색 페이지 (알라딘 OpenAPI는 2026-10-30 종료)
type BookOut = { isbn13: string; title: string; author: string; publisher: string; pub_date: string; cover_url: string; pages: number | null; aladin_category: string; aladin_link: string; description: string; toc?: string; source: string; item_id?: string; isbn10?: string; info_link?: string };

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', 'Accept-Language': 'ko-KR,ko;q=0.9' };
const decode = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const strip = (s: string) => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/* 카카오 */
function kakaoCover(thumb: string) {
  // search1.kakaocdn.net/thumb/R120x174.q85/?fname=<원본> → 원본 이미지 주소가 더 크다
  try { const f = new URL(thumb).searchParams.get('fname'); if (f) return decodeURIComponent(f).replace(/^http:/, 'https:'); } catch { /* ignore */ }
  return (thumb || '').replace(/^http:/, 'https:');
}
function fromKakao(d: any): BookOut {
  const isbns = String(d.isbn || '').split(/\s+/).filter(Boolean);
  const authors = (d.authors || []).join(', ');
  const tr = (d.translators || []).length ? ` (옮긴이: ${(d.translators || []).join(', ')})` : '';
  return {
    isbn13: isbns.find(x => x.length === 13) || '', isbn10: isbns.find(x => x.length === 10) || '',
    title: d.title || '', author: authors + tr, publisher: d.publisher || '', pub_date: String(d.datetime || '').slice(0, 10),
    cover_url: kakaoCover(d.thumbnail || ''), pages: null, aladin_category: '', aladin_link: '', info_link: d.url || '',
    description: String(d.contents || '').trim(), source: 'kakao',
  };
}
async function kakaoSearch(q: string, type: string): Promise<BookOut[]> {
  const target = type === 'Title' ? 'title' : type === 'Author' ? 'person' : type === 'ISBN' ? 'isbn' : '';
  const qq = type === 'ISBN' ? q.replace(/[^0-9Xx]/g, '') : q;
  const r = await fetch(`https://dapi.kakao.com/v3/search/book?query=${encodeURIComponent(qq)}&size=20${target ? `&target=${target}` : ''}`, { headers: { Authorization: `KakaoAK ${KAKAO}` } });
  const d = await r.json();
  if (!r.ok) throw new Error(`카카오 검색 오류: ${d.message || d.msg || r.status}`);
  return (d.documents || []).map(fromKakao);
}

/* 알라딘 공개 페이지 (보충·대체) */
async function webSearch(q: string): Promise<BookOut[]> {
  const r = await fetch(`https://www.aladin.co.kr/search/wsearchresult.aspx?SearchTarget=Book&SearchWord=${encodeURIComponent(q)}`, { headers: UA });
  const html = await r.text();
  const chunks = html.split('class="ss_book_box"').slice(1, 21);
  const out: BookOut[] = [];
  for (const c of chunks) {
    const itemId = (c.match(/itemId="(\d+)"/) || [])[1];
    const title = (c.match(/class="bo3">([\s\S]*?)<\/a>/) || [])[1];
    if (!itemId || !title) continue;
    const sub = (c.match(/class="bo3">[\s\S]*?<\/a><span class="ss_f_g2">\s*-\s*([^<]+)</) || [])[1];
    const cover = (c.match(/src="(https:\/\/image\.aladin\.co\.kr\/product\/[^"]+?)" class="front_cover"/) || c.match(/src="(https:\/\/image\.aladin\.co\.kr\/product\/[^"]+?cover[^"]*?)"/) || [])[1] || '';
    const isbn = (c.match(/chkCart\.([0-9X]+)/i) || [])[1] || '';
    const infoLi = (c.match(/<li>(?:(?!<li>)[\s\S])*?AuthorSearch[\s\S]*?<\/li>/) || c.match(/<li>(?:(?!<li>)[\s\S])*?PublisherSearch[\s\S]*?<\/li>/) || [])[0] || '';
    const parts = strip(infoLi).split('|').map(s => s.trim());
    const cat = (c.match(/class="tit_category">\[([^\]]+)\]/) || [])[1] || '';
    out.push({
      isbn13: isbn.length === 13 ? isbn : '', title: strip(title) + (sub ? `: ${strip(sub)}` : ''), author: parts[0] || '', publisher: parts[1] || '', pub_date: parts[2] || '',
      cover_url: cover.replace('/cover200/', '/cover500/'), pages: null, aladin_category: cat, aladin_link: `https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=${itemId}`,
      description: '', source: 'aladin', item_id: itemId, isbn10: isbn.length === 10 ? isbn : '',
    });
  }
  return out;
}
async function webLookup(itemId: string): Promise<Partial<BookOut> | null> {
  const r = await fetch(`https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=${itemId}`, { headers: UA });
  const h = await r.text();
  const meta = (p: string) => decode((h.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)="${p}"[^>]+content="([^"]*)"`)) || [])[1] || '');
  const cats = (h.match(/<ul id="ulCategory">([\s\S]*?)<\/ul>/) || [])[1] || '';
  const firstCat = (cats.match(/<li[^>]*>([\s\S]*?)<\/li>/) || [])[1] || '';
  const pages = (h.match(/<li>(\d+)\s*쪽<\/li>/) || [])[1];
  return {
    isbn13: meta('og:barcode'), cover_url: meta('og:image'), author: meta('author'), pub_date: (h.match(/itemprop="datePublished" content="([^"]+)"/) || [])[1] || '',
    pages: pages ? Number(pages) : null, aladin_category: strip(firstCat.replace(/<a[^>]*foreignCategory[\s\S]*$/, '')), description: meta('og:description'),
    aladin_link: `https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=${itemId}`, source: 'aladin',
  };
}

async function bookSearch(q: string, type: string) {
  if (KAKAO) return kakaoSearch(q, type);
  return webSearch(type === 'ISBN' ? q.replace(/[^0-9Xx]/g, '') : q);
}
/** 상세: 카카오 결과에 쪽수·분류를 알라딘 공개 상품 페이지에서 보충 */
async function bookLookup(isbn: string, itemId = ''): Promise<any> {
  let id = itemId;
  try {
    if (!id && isbn) id = (await webSearch(isbn))[0]?.item_id || '';
    if (!id) return null;
    const w = await webLookup(id);
    if (!w) return null;
    if (KAKAO) return { pages: w.pages, aladin_category: w.aladin_category, aladin_link: w.aladin_link, cover_url: w.cover_url }; // 카카오 정보는 유지
    return w;
  } catch { return null; }
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

    if (action === 'status') return json({ kakao: !!KAKAO, search: KAKAO ? 'kakao' : 'aladin-web', ai: aiProvider, notion: !!NOTION });

    if (action === 'search') return json({ items: await bookSearch(String(body.q || ''), String(body.type || 'Keyword')), source: KAKAO ? 'kakao' : 'aladin-web' });
    if (action === 'lookup') return json({ item: await bookLookup(String(body.isbn || ''), String(body.item_id || '')) });

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
