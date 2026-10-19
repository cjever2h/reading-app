// 오늘의 독서 인증 이미지: 정사각형 템플릿 5종(썸네일에서 선택), 오늘의 한 줄, 책 진행률, 페이지 사진 자르기·가리기, 저장·공유
import * as db from './db.js';
import { S } from './db.js';
import { esc, openModal, toast, fmtDur, pad, ymd, addDays } from './ui.js';
import { streak, pagesOf, sessionDate, bookSeconds } from './calc.js';

const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; });

async function fileToCanvas(file, max = 2000) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImg(url);
    const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * r); c.height = Math.round(img.naturalHeight * r);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally { URL.revokeObjectURL(url); }
}
const cloneCanvas = c => { const n = document.createElement('canvas'); n.width = c.width; n.height = c.height; n.getContext('2d').drawImage(c, 0, 0); return n; };

/* ---------- 텍스트 줄바꿈 ---------- */
function wrapLines(ctx, text, maxW, maxLines = 99) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const tok of para.split(/(\s+)/)) {
      const t = line + tok;
      if (ctx.measureText(t).width <= maxW) { line = t; continue; }
      if (line.trim() && ctx.measureText(tok.trim()).width <= maxW) { lines.push(line.trimEnd()); line = tok.trimStart(); continue; }
      for (const ch of tok) { // 너무 긴 단어는 글자 단위로
        const t2 = line + ch;
        if (ctx.measureText(t2).width > maxW && line) { lines.push(line.trimEnd()); line = ch.trimStart(); } else line = t2;
      }
    }
    lines.push(line);
  }
  if (lines.length > maxLines) { const cut = lines.slice(0, maxLines); cut[maxLines - 1] = cut[maxLines - 1].replace(/.{0,2}$/, '…'); return cut; }
  return lines;
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function drawCover(ctx, img, x, y, w, h) {
  // object-fit: cover
  const r = Math.max(w / img.width, h / img.height);
  const sw = w / r, sh = h / r;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

const F = (w, s) => `${w} ${s}px Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;

/* ---------- 템플릿 5종 (정사각형 1080) ---------- */
export const CERT_TEMPLATES = [
  { id: 'classic', name: '다크 그린 클래식' },
  { id: 'quote', name: '문장 카드' },
  { id: 'color', name: '책 색 맞춤' },
  { id: 'stats', name: '기록·통계형' },
  { id: 'photo', name: '사진 풀화면' },
];
const W = 1080, H = 1080, P = 64;
const GOLD = '#e9c46a';

/** 표지에서 대표 색 추출 (채도 높은 색 우선) */
export function coverColor(img) {
  if (!img) return null;
  try {
    const c = document.createElement('canvas'); c.width = c.height = 40;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0, 40, 40);
    const d = x.getImageData(0, 0, 40, 40).data;
    const buckets = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), lum = (mx + mn) / 2, sat = mx ? (mx - mn) / mx : 0;
      if (lum > 235 || lum < 18) continue; // 흰 배경·검은 글자 제외
      const k = (r >> 5) + ',' + (g >> 5) + ',' + (b >> 5);
      const o = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0, sat: 0 };
      o.n++; o.r += r; o.g += g; o.b += b; o.sat += sat; buckets.set(k, o);
    }
    let best = null, score = -1;
    for (const o of buckets.values()) { const s = o.n * (0.35 + o.sat / o.n); if (s > score) { score = s; best = o; } }
    return best ? [best.r / best.n, best.g / best.n, best.b / best.n].map(Math.round) : null;
  } catch { return null; }
}
const shade = ([r, g, b], f) => `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;

function setup(canvas) {
  canvas.width = W; canvas.height = H;
  return canvas.getContext('2d');
}
function footer(ctx, d, color = 'rgba(255,255,255,.55)') {
  ctx.fillStyle = color; ctx.font = F(500, 26); ctx.textAlign = 'left';
  if (d.nickname) ctx.fillText(`@${d.nickname}`, P, H - P + 6);
  ctx.textAlign = 'right'; ctx.fillText('독서기록 · AI각인 독서', W - P, H - P + 6); ctx.textAlign = 'left';
}
function header(ctx, d, label = '오늘의 독서', c1 = GOLD, c2 = 'rgba(255,255,255,.75)') {
  ctx.fillStyle = c1; ctx.font = F(700, 30); ctx.textAlign = 'left'; ctx.fillText(label, P, P + 30);
  ctx.fillStyle = c2; ctx.font = F(500, 30); ctx.textAlign = 'right'; ctx.fillText(d.dateText, W - P, P + 30); ctx.textAlign = 'left';
}
function coverBox(ctx, d, x, y, w) {
  const h = Math.round(w * 1.45);
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 34; ctx.shadowOffsetY = 14;
  roundRect(ctx, x, y, w, h, 10); ctx.fillStyle = '#2f4a3e'; ctx.fill(); ctx.restore();
  if (d.cover) { ctx.save(); roundRect(ctx, x, y, w, h, 10); ctx.clip(); drawCover(ctx, d.cover, x, y, w, h); ctx.restore(); }
  else { ctx.fillStyle = '#fff'; ctx.font = F(700, Math.round(w / 9)); wrapLines(ctx, d.mainTitle, w - 30, 6).forEach((l, i) => ctx.fillText(l, x + 16, y + w / 6 + i * (w / 7))); }
  return h;
}
/** 제목·부제·저자. 높이 반환 */
function titleBlock(ctx, d, x, y, w, size, { align = 'left', color = '#fff', sub = 'rgba(255,255,255,.72)', au = 'rgba(255,255,255,.62)', measure = false, maxLines = 2 } = {}) {
  ctx.textAlign = align; const ax = align === 'center' ? x + w / 2 : x; let yy = y;
  ctx.font = F(800, size);
  wrapLines(ctx, d.mainTitle, w, maxLines).forEach(l => { yy += size * 1.22; if (!measure) { ctx.fillStyle = color; ctx.fillText(l, ax, yy); } });
  if (d.subTitle) { ctx.font = F(500, Math.round(size * 0.5)); yy += 8; wrapLines(ctx, d.subTitle, w, 1).forEach(l => { yy += size * 0.5 * 1.4; if (!measure) { ctx.fillStyle = sub; ctx.fillText(l, ax, yy); } }); }
  ctx.font = F(500, Math.round(size * 0.54)); yy += size * 0.54 * 1.8;
  if (!measure) { ctx.fillStyle = au; ctx.fillText(wrapLines(ctx, d.author, w, 1)[0] || '', ax, yy); }
  ctx.textAlign = 'left';
  return yy - y;
}
function statBoxes(ctx, d, y, h = 150, { bg = 'rgba(255,255,255,.07)', label = 'rgba(255,255,255,.6)', value = GOLD } = {}) {
  const gap = 20, CW = W - P * 2, bw = (CW - gap * 2) / 3;
  d.stats.forEach(([k, v], i) => {
    const x = P + i * (bw + gap);
    roundRect(ctx, x, y, bw, h, 22); ctx.fillStyle = bg; ctx.fill();
    ctx.fillStyle = label; ctx.font = F(500, 26); ctx.fillText(k, x + 28, y + h * 0.37);
    ctx.fillStyle = value; ctx.font = F(800, v.length > 9 ? 38 : 46); ctx.fillText(v, x + 28, y + h * 0.78);
  });
  return h;
}
/** 진행률 막대. 높이 반환 */
function progressBar(ctx, d, x, y, w, { track = 'rgba(255,255,255,.15)', fill = GOLD, text = 'rgba(255,255,255,.75)', size = 24 } = {}) {
  if (!d.showProgress || d.progress == null) return 0;
  ctx.fillStyle = text; ctx.font = F(600, size); ctx.textAlign = 'left';
  ctx.fillText(`책 진행률 ${d.progress}%`, x, y + size);
  ctx.textAlign = 'right'; ctx.font = F(500, size); ctx.fillText(d.progressText, x + w, y + size); ctx.textAlign = 'left';
  const by = y + size + 14;
  roundRect(ctx, x, by, w, 14, 7); ctx.fillStyle = track; ctx.fill();
  if (d.progress > 0) { roundRect(ctx, x, by, Math.max(14, w * d.progress / 100), 14, 7); ctx.fillStyle = fill; ctx.fill(); }
  return size + 14 + 14;
}
/** 문장(따옴표)과 나의 한 줄. 높이 반환 */
function wordsBlock(ctx, d, x, y, w, { size = 34, color = '#fff', mine = 'rgba(255,255,255,.8)', mark = GOLD, maxLines = 3, measure = false } = {}) {
  let yy = y;
  if (d.quote) {
    ctx.font = F(600, size);
    const ls = wrapLines(ctx, `“${d.quote}”`, w, maxLines);
    ls.forEach(l => { yy += size * 1.45; if (!measure) { ctx.fillStyle = color; ctx.fillText(l, x, yy); } });
    if (d.quotePage) { yy += 34; if (!measure) { ctx.fillStyle = 'rgba(255,255,255,.55)'; if (color !== '#fff') ctx.fillStyle = mine; ctx.font = F(500, 24); ctx.fillText(`p.${d.quotePage}`, x, yy); } }
  }
  if (d.oneLine) {
    yy += d.quote ? 22 : 0;
    ctx.font = F(600, Math.round(size * 0.78));
    const ls = wrapLines(ctx, d.oneLine, w - 150, 2);
    ls.forEach((l, i) => {
      yy += size * 0.78 * 1.5;
      if (!measure) {
        if (i === 0) { ctx.fillStyle = mark; ctx.font = F(700, Math.round(size * 0.62)); ctx.fillText('나의 한 줄', x, yy); ctx.font = F(600, Math.round(size * 0.78)); }
        ctx.fillStyle = mine; ctx.fillText(l, x + 150, yy);
      }
    });
  }
  return yy - y;
}

const DRAW = {
  /* 1. 다크 그린 클래식 */
  classic(ctx, d) {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#22382f'); g.addColorStop(1, '#0f1714');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    header(ctx, d); footer(ctx, d);
    const top = P + 80;
    if (d.photo) {
      const ph = 400;
      ctx.save(); roundRect(ctx, P, top, W - P * 2, ph, 26); ctx.clip(); drawCover(ctx, d.photo, P, top, W - P * 2, ph); ctx.restore();
      let y = top + ph + 34;
      const cw = 140; coverBox(ctx, d, P, y, cw);
      const tx = P + cw + 34, tw = W - tx - P;
      const th = titleBlock(ctx, d, tx, y - 12, tw, 38, { maxLines: 1 });
      let sy = y - 12 + th + 30;
      const colW = tw / 3;
      d.stats.forEach(([k, v], i) => {
        ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = F(500, 22); ctx.fillText(k, tx + i * colW, sy);
        ctx.fillStyle = GOLD; ctx.font = F(800, v.length > 9 ? 30 : 36); ctx.fillText(v, tx + i * colW, sy + 42);
      });
      y = Math.max(y + Math.round(cw * 1.45), sy + 60) + 26;
      y += progressBar(ctx, d, P, y, W - P * 2, { size: 22 }) + 20;
      wordsBlock(ctx, d, P, y - 10, W - P * 2, { size: 28, maxLines: 1 });
    } else {
      const cw = 250, ch = Math.round(cw * 1.45);
      const tx = P + cw + 44, tw = W - tx - P;
      let y = top + 10;
      coverBox(ctx, d, P, y, cw);
      const th = titleBlock(ctx, d, tx, 0, tw, 50, { measure: true });
      titleBlock(ctx, d, tx, y + Math.max(0, (ch - th) / 2) - 40, tw, 50);
      if (d.showProgress && d.progress != null) progressBar(ctx, d, tx, y + ch - 52, tw, { size: 22 });
      y += ch + 36;
      statBoxes(ctx, d, y, 140); y += 140 + 26;
      wordsBlock(ctx, d, P, y - 10, W - P * 2, { size: 30, maxLines: 2 });
    }
  },

  /* 2. 문장 카드: 문장을 크게 */
  quote(ctx, d) {
    ctx.fillStyle = '#f5efe3'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(120,90,40,.06)'; for (let i = 0; i < 40; i++) ctx.fillRect(0, 150 + i * 46, W, 1);
    header(ctx, d, '오늘의 문장', '#9a6b1f', 'rgba(40,40,40,.6)'); footer(ctx, d, 'rgba(40,40,40,.5)');
    const main = d.quote || d.oneLine || d.mainTitle;
    const isQuote = !!d.quote;
    let size = 54; ctx.font = F(700, size);
    let ls = wrapLines(ctx, main, W - P * 2 - 20, 6);
    if (ls.length > 4) { size = 44; ctx.font = F(700, size); ls = wrapLines(ctx, main, W - P * 2 - 20, 7); }
    const blockH = ls.length * size * 1.5;
    let y = Math.max(280, 260 + (440 - blockH) / 2);
    ctx.fillStyle = '#c9962e'; ctx.font = F(800, 130); ctx.fillText('“', P - 4, y - size * 0.35);
    ctx.font = F(700, size); ctx.fillStyle = '#1f2a24';
    ls.forEach((l, i) => ctx.fillText(l, P + 10, y + i * size * 1.5));
    y += blockH;
    if (isQuote && d.quotePage) { ctx.fillStyle = 'rgba(40,40,40,.55)'; ctx.font = F(500, 26); ctx.fillText(`p.${d.quotePage}`, P + 10, y + 6); y += 40; }
    if (isQuote && d.oneLine) {
      ctx.font = F(600, 28); const ol = wrapLines(ctx, d.oneLine, W - P * 2 - 170, 2);
      ctx.fillStyle = '#9a6b1f'; ctx.font = F(700, 24); ctx.fillText('나의 한 줄', P + 10, y + 34);
      ctx.fillStyle = '#3b4440'; ctx.font = F(600, 28); ol.forEach((l, i) => ctx.fillText(l, P + 170, y + 34 + i * 40));
    }
    // 하단 책 정보
    const by = H - P - 210;
    ctx.fillStyle = 'rgba(40,40,40,.15)'; ctx.fillRect(P, by - 24, W - P * 2, 2);
    const cw = 110; coverBox(ctx, d, P, by, cw);
    const tx = P + cw + 30;
    ctx.fillStyle = '#1f2a24'; ctx.font = F(800, 36); ctx.fillText(wrapLines(ctx, d.mainTitle, W - tx - P, 1)[0], tx, by + 42);
    ctx.fillStyle = 'rgba(40,40,40,.6)'; ctx.font = F(500, 26); ctx.fillText(wrapLines(ctx, d.author, W - tx - P, 1)[0] || '', tx, by + 82);
    ctx.fillStyle = '#9a6b1f'; ctx.font = F(700, 28); ctx.fillText(d.stats.map(s => s[1]).join('  ·  '), tx, by + 118);
    if (d.showProgress && d.progress != null) progressBar(ctx, d, tx, by + 132, W - tx - P, { track: 'rgba(40,40,40,.12)', fill: '#c9962e', text: 'rgba(40,40,40,.65)', size: 18 });
  },

  /* 3. 책 색 맞춤 */
  color(ctx, d) {
    const base = d.color || [36, 69, 58];
    const lum = (0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2]);
    const dark = lum > 150 ? 0.42 : lum > 90 ? 0.62 : 0.85;
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, shade(base, dark * 1.15)); g.addColorStop(1, shade(base, dark * 0.55));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.beginPath(); ctx.arc(W - 120, 220, 330, 0, Math.PI * 2); ctx.fill();
    header(ctx, d, '오늘의 독서', '#fff', 'rgba(255,255,255,.8)'); footer(ctx, d, 'rgba(255,255,255,.7)');
    const cw = 330, ch = Math.round(cw * 1.45);
    const cx = P, cy = P + 96;
    coverBox(ctx, d, cx, cy, cw);
    const tx = cx + cw + 46, tw = W - tx - P;
    let y = cy + 6;
    y += titleBlock(ctx, d, tx, y, tw, 48, { maxLines: 3, sub: 'rgba(255,255,255,.82)', au: 'rgba(255,255,255,.75)' }) + 78;
    d.stats.forEach(([k, v]) => {
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = F(500, 24); ctx.fillText(k, tx, y);
      ctx.fillStyle = '#fff'; ctx.font = F(800, 40); ctx.fillText(v, tx + 150, y + 4);
      y += 58;
    });
    let y2 = cy + ch + 40;
    y2 += progressBar(ctx, d, P, y2, W - P * 2, { track: 'rgba(255,255,255,.22)', fill: '#fff', text: 'rgba(255,255,255,.85)', size: 22 });
    wordsBlock(ctx, d, P, y2 + (d.showProgress && d.progress != null ? 6 : -20), W - P * 2, { size: 30, maxLines: 2, mark: '#fff', mine: 'rgba(255,255,255,.88)' });
  },

  /* 4. 기록·통계형 */
  stats(ctx, d) {
    ctx.fillStyle = '#111418'; ctx.fillRect(0, 0, W, H);
    header(ctx, d, 'READING LOG', '#5ee08b', 'rgba(255,255,255,.7)'); footer(ctx, d, 'rgba(255,255,255,.45)');
    // 책 한 줄
    const cw = 90; coverBox(ctx, d, P, P + 84, cw);
    ctx.fillStyle = '#fff'; ctx.font = F(800, 34); ctx.fillText(wrapLines(ctx, d.mainTitle, W - P * 2 - cw - 30, 1)[0], P + cw + 28, P + 84 + 46);
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = F(500, 24); ctx.fillText(wrapLines(ctx, d.author, W - P * 2 - cw - 30, 1)[0] || '', P + cw + 28, P + 84 + 86);
    // 큰 숫자: 독서 시간
    let y = P + 84 + 130 + 70;
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = F(600, 26); ctx.fillText('오늘 독서 시간', P, y);
    ctx.fillStyle = '#fff'; ctx.font = F(900, 150); ctx.fillText(d.timeBig, P - 6, y + 150);
    // 보조 숫자
    const sx = 620;
    [['읽은 쪽', d.pagesText], ['연속 독서', `${d.streak}일`], ['이 책 누적', d.bookTotalText]].forEach(([k, v], i) => {
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = F(600, 24); ctx.fillText(k, sx, y + i * 62);
      ctx.fillStyle = '#5ee08b'; ctx.font = F(800, 34); ctx.textAlign = 'right'; ctx.fillText(v, W - P, y + i * 62); ctx.textAlign = 'left';
    });
    y += 210;
    // 최근 7일 막대
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = F(600, 24); ctx.fillText('최근 7일', P, y);
    const maxS = Math.max(1, ...d.week.map(x => x.sec));
    const bw = (W - P * 2 - 6 * 18) / 7, bh = 120, by = y + 24;
    d.week.forEach((x, i) => {
      const bx = P + i * (bw + 18);
      roundRect(ctx, bx, by, bw, bh, 10); ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fill();
      const hh = x.sec ? Math.max(10, bh * x.sec / maxS) : 0;
      if (hh) { roundRect(ctx, bx, by + bh - hh, bw, hh, 10); ctx.fillStyle = x.today ? '#5ee08b' : 'rgba(94,224,139,.45)'; ctx.fill(); }
      ctx.fillStyle = x.today ? '#fff' : 'rgba(255,255,255,.5)'; ctx.font = F(600, 22); ctx.textAlign = 'center'; ctx.fillText(x.label, bx + bw / 2, by + bh + 32); ctx.textAlign = 'left';
    });
    y = by + bh + 60;
    y += progressBar(ctx, d, P, y, W - P * 2, { track: 'rgba(255,255,255,.1)', fill: '#5ee08b', size: 22 }) + 18;
    wordsBlock(ctx, d, P, y - 18, W - P * 2, { size: 26, maxLines: 1, mark: '#5ee08b' });
  },

  /* 5. 사진 풀화면 */
  photo(ctx, d) {
    if (d.photo) drawCover(ctx, d.photo, 0, 0, W, H);
    else if (d.cover) { ctx.filter = 'blur(28px) brightness(.8)'; drawCover(ctx, d.cover, -60, -60, W + 120, H + 120); ctx.filter = 'none'; }
    else { ctx.fillStyle = '#22382f'; ctx.fillRect(0, 0, W, H); }
    const gt = ctx.createLinearGradient(0, 0, 0, 260); gt.addColorStop(0, 'rgba(0,0,0,.6)'); gt.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gt; ctx.fillRect(0, 0, W, 260);
    const gb = ctx.createLinearGradient(0, H * 0.35, 0, H); gb.addColorStop(0, 'rgba(0,0,0,0)'); gb.addColorStop(1, 'rgba(0,0,0,.88)'); ctx.fillStyle = gb; ctx.fillRect(0, H * 0.35, W, H * 0.65);
    header(ctx, d, '오늘의 독서', GOLD, 'rgba(255,255,255,.9)'); footer(ctx, d, 'rgba(255,255,255,.7)');
    const hasProg = d.showProgress && d.progress != null;
    const wh = wordsBlock(ctx, d, P, 0, W - P * 2, { size: 32, maxLines: 2, measure: true });
    let bottom = H - P - 46;
    const progY = hasProg ? bottom - 52 : bottom;
    const wordsTop = progY - (wh ? wh + 24 : 0);
    const statTop = wordsTop - 100;
    const th = titleBlock(ctx, d, P, 0, W - P * 2, 50, { measure: true, maxLines: 1 });
    const titleTop = statTop - th - 26;
    if (!d.photo && d.cover) {
      const ch = Math.min(400, titleTop - 40 - 140), cw = Math.round(ch / 1.45);
      if (ch > 120) coverBox(ctx, d, (W - cw) / 2, 140, cw);
    }
    titleBlock(ctx, d, P, titleTop, W - P * 2, 50, { maxLines: 1 });
    let sx = P;
    d.stats.forEach(([k, v]) => {
      ctx.fillStyle = 'rgba(255,255,255,.65)'; ctx.font = F(500, 24); ctx.fillText(k, sx, statTop + 26);
      ctx.fillStyle = GOLD; ctx.font = F(800, 42); ctx.fillText(v, sx, statTop + 80);
      sx += Math.max(230, ctx.measureText(v).width + 70);
    });
    if (wh) wordsBlock(ctx, d, P, wordsTop - 12, W - P * 2, { size: 32, maxLines: 2 });
    if (hasProg) progressBar(ctx, d, P, progY, W - P * 2, { size: 22, track: 'rgba(255,255,255,.25)' });
  },
};

/** 인증 이미지 그리기 */
export async function drawCert(canvas, d) {
  const ctx = setup(canvas);
  try { await Promise.all([document.fonts.load(F(800, 40)), document.fonts.load(F(600, 30)), document.fonts.load(F(500, 30)), document.fonts.load(F(900, 60))]); } catch { /* 기본 글꼴 */ }
  const cleanTitle = String(d.title).replace(/\s*\((?=[^)]*(에디션|기념|개정|특별|양장|리커버|한정|합본|eBook|큰글자|전면))[^)]*\)/gi, '').trim();
  const [mainTitle, ...subParts] = cleanTitle.split(/\s*:\s+/);
  const dd = { ...d, mainTitle, subTitle: subParts.join(': '), stats: [['읽은 쪽', d.pagesText], ['독서 시간', d.timeText], ['연속 독서', `${d.streak}일`]] };
  (DRAW[d.template] || DRAW.classic)(ctx, dd);
}

/* ---------- 인증 이미지 모달 ---------- */
export async function certModal(session, { afterClose, justFinished = false } = {}) {
  const b = db.book(session.book_id);
  const st = S.settings;
  const quotes = [...S.quotes.filter(q => q.session_id === session.id), ...S.quotes.filter(q => q.book_id === b.id && q.session_id !== session.id).reverse()];
  const savedTpl = (st.data || {}).cert_template || localStorage.getItem('ra-cert-tpl') || 'classic';
  const state = { template: CERT_TEMPLATES.some(t => t.id === savedTpl) ? savedTpl : 'classic', photoCanvas: null, photoDirty: false, quoteId: '', showNick: st.show_nickname !== false, showProgress: true, oneLine: session.memo || '' };

  const m = openModal(`
    <h3>${justFinished ? '완독 기록' : '오늘의 독서 인증'}</h3>
    <div class="tpl-strip" data-tpls>${CERT_TEMPLATES.map(t => `<button class="tpl ${t.id === state.template ? 'on' : ''}" data-tpl="${t.id}"><canvas width="216" height="216"></canvas><span>${t.name}</span></button>`).join('')}</div>
    <div class="cert-wrap">
      <div class="cert-preview"><canvas data-cv></canvas></div>
      <div class="cert-ctrl form">
        <label>오늘의 한 줄 <span class="muted small">(이미지에 '나의 한 줄'로 표시)</span><input data-one maxlength="60" placeholder="예: 편리함이 구속이 될 수 있다는 걸 알았다" value="${esc(state.oneLine)}"></label>
        <label>문장 1개 (선택)<select data-quote><option value="">선택 안 함</option>${quotes.map(q => `<option value="${q.id}">${esc(q.body.slice(0, 40))}${q.body.length > 40 ? '…' : ''}</option>`).join('')}</select></label>
        <div class="field-label">책 페이지 사진</div>
        <div class="row gap wrap">
          <label class="btn small file-btn">촬영<input type="file" accept="image/*" capture="environment" hidden data-photo></label>
          <label class="btn small file-btn">갤러리<input type="file" accept="image/*" hidden data-photo></label>
          <button class="btn small" data-edit disabled>자르기·가리기</button>
          <button class="btn small ghost" data-nophoto disabled>사진 빼기</button>
        </div>
        <label class="check"><input type="checkbox" data-prog checked> 책 진행률 표시</label>
        <label class="check"><input type="checkbox" data-nick ${state.showNick ? 'checked' : ''}> 닉네임 표기 (@${esc(st.nickname || '')})</label>
        <div class="row gap wrap mt">
          <button class="btn primary" data-share>공유</button>
          <button class="btn" data-save>이미지 저장</button>
        </div>
        <p class="muted small" data-msg>템플릿은 위에서 골라요. 고른 템플릿은 다음에도 기본으로 열려요.</p>
      </div>
    </div>`, { wide: true, onClose: () => { finish(); afterClose && afterClose(); } });

  const cv = m.el.querySelector('[data-cv]');
  const msg = m.el.querySelector('[data-msg]');
  const coverUrl = b.cover_url ? await db.proxiedImage(b.cover_url) : null;
  const cover = coverUrl ? await loadImg(coverUrl).catch(() => null) : null;
  if (session.photo_path) {
    const u = await db.photoUrl(session.photo_path);
    if (u) { try { state.photoCanvas = await fileToCanvas(await (await fetch(u)).blob()); } catch { /* ignore */ } }
  }

  const d0 = new Date(session.started_at);
  const day0 = ymd(d0);
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(day0, i - 6);
    const sec = S.sessions.filter(s => s.ended_at && sessionDate(s) === day).reduce((a, s) => a + (s.seconds || 0), 0);
    return { label: '일월화수목금토'[new Date(day + 'T00:00:00').getDay()], sec, today: i === 6 };
  });
  const endPage = Math.max(session.end_page || 0, b.current_page || 0);
  const prog = b.pages ? Math.min(100, Math.round(endPage / b.pages * 100)) : null;
  const tsec = session.seconds || 0;
  const base = {
    title: b.title, author: b.author || '',
    dateText: `${d0.getFullYear()}.${pad(d0.getMonth() + 1)}.${pad(d0.getDate())} ${'일월화수목금토'[d0.getDay()]}요일`,
    pagesText: session.start_page != null && session.end_page ? `p.${session.start_page}–${session.end_page}` : `${pagesOf(session)}쪽`,
    timeText: fmtDur(tsec), timeBig: tsec >= 3600 ? `${Math.floor(tsec / 3600)}h ${Math.floor(tsec / 60) % 60}m` : `${Math.max(1, Math.round(tsec / 60))}분`,
    streak: streak(day0) || 1, cover, color: coverColor(cover), week,
    progress: prog, progressText: b.pages ? `${endPage} / ${b.pages}쪽` : '',
    bookTotalText: fmtDur(bookSeconds(b.id)),
  };
  const data = () => {
    const q = quotes.find(x => x.id === state.quoteId);
    return { ...base, photo: state.photoCanvas, quote: q?.body?.slice(0, 160), quotePage: q?.page, nickname: state.showNick ? (st.nickname || '') : '', oneLine: state.oneLine.trim(), showProgress: state.showProgress };
  };
  const big = document.createElement('canvas');
  const drawThumbs = async () => {
    const dd = data();
    for (const btn of m.el.querySelectorAll('[data-tpl]')) {
      await drawCert(big, { ...dd, template: btn.dataset.tpl });
      const tc = btn.querySelector('canvas'); tc.getContext('2d').drawImage(big, 0, 0, tc.width, tc.height);
    }
  };
  let thumbTimer = null;
  const redraw = async (thumbs = true) => {
    await drawCert(cv, { ...data(), template: state.template });
    m.el.querySelector('[data-edit]').disabled = !state.photoCanvas;
    m.el.querySelector('[data-nophoto]').disabled = !state.photoCanvas;
    if (thumbs) { clearTimeout(thumbTimer); thumbTimer = setTimeout(drawThumbs, 250); }
  };
  await redraw();

  m.el.querySelectorAll('[data-tpl]').forEach(btn => btn.onclick = () => {
    state.template = btn.dataset.tpl;
    m.el.querySelectorAll('[data-tpl]').forEach(x => x.classList.toggle('on', x === btn));
    localStorage.setItem('ra-cert-tpl', state.template);
    redraw(false);
  });
  m.el.querySelector('[data-one]').oninput = e => { state.oneLine = e.target.value; redraw(); };
  m.el.querySelector('[data-quote]').onchange = e => { state.quoteId = e.target.value; redraw(); };
  m.el.querySelector('[data-nick]').onchange = e => { state.showNick = e.target.checked; redraw(); };
  m.el.querySelector('[data-prog]').onchange = e => { state.showProgress = e.target.checked; redraw(); };
  m.el.querySelectorAll('[data-photo]').forEach(inp => inp.onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    state.photoCanvas = await fileToCanvas(f); state.photoDirty = true;
    await redraw();
    photoEditor(state.photoCanvas, c => { state.photoCanvas = c; state.photoDirty = true; redraw(); });
  });
  m.el.querySelector('[data-edit]').onclick = () => photoEditor(state.photoCanvas, c => { state.photoCanvas = c; state.photoDirty = true; redraw(); });
  m.el.querySelector('[data-nophoto]').onclick = () => { state.photoCanvas = null; state.photoDirty = false; redraw(); };

  const toBlob = () => new Promise(res => cv.toBlob(res, 'image/jpeg', 0.92));
  const fname = () => `독서인증_${base.dateText.slice(0, 10).replace(/\./g, '')}_${b.title.slice(0, 20)}.jpg`.replace(/[\\/:*?"<>|\s]/g, '_');
  m.el.querySelector('[data-save]').onclick = async () => {
    const blob = await toBlob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname(); document.body.appendChild(a); a.click(); a.remove();
    msg.textContent = '이미지를 저장했어요.';
  };
  m.el.querySelector('[data-share]').onclick = async () => {
    const blob = await toBlob();
    const file = new File([blob], fname(), { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: '오늘의 독서', text: `『${b.title}』 ${base.pagesText} · ${base.timeText}` }); } catch { /* 취소 */ }
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname(); document.body.appendChild(a); a.click(); a.remove();
      msg.textContent = '이 브라우저는 바로 공유를 지원하지 않아 이미지로 저장했어요.';
    }
  };

  async function finish() {
    // 고른 템플릿을 계정에 기억, 오늘의 한 줄은 세션 메모로 저장, 새 사진은 업로드
    try { if ((S.settings.data || {}).cert_template !== state.template) await db.saveSettings({ data: { ...(S.settings.data || {}), cert_template: state.template } }); } catch { /* ignore */ }
    const patch = {};
    if (state.oneLine.trim() !== (session.memo || '')) patch.memo = state.oneLine.trim();
    try {
      if (state.photoDirty && state.photoCanvas) {
        const blob = await new Promise(res => state.photoCanvas.toBlob(res, 'image/jpeg', 0.85));
        patch.photo_path = await db.uploadPhoto(blob, 'page.jpg');
        if (session.photo_path) db.removePhoto(session.photo_path);
      }
      if (Object.keys(patch).length) { const cur = S.sessions.find(s => s.id === session.id) || session; await db.save('sessions', { ...cur, ...patch }); }
    } catch (e) { console.warn('인증 정보 저장 실패', e); }
  }
}

/* ---------- 사진 편집기: 자르기 · 가리기(모자이크/검정) · 회전 ---------- */
export function photoEditor(srcCanvas, onDone) {
  let work = cloneCanvas(srcCanvas);
  const history = [];
  let mode = 'crop', sel = null, drag = null;
  const m = openModal(`<h3>사진 편집</h3>
    <div class="seg" data-mode>
      <label><input type="radio" name="em" value="crop" checked><span>자르기</span></label>
      <label><input type="radio" name="em" value="mosaic"><span>가리기 (모자이크)</span></label>
      <label><input type="radio" name="em" value="black"><span>가리기 (덮기)</span></label>
    </div>
    <p class="muted small" data-help>남길 영역을 드래그한 뒤 '자르기 적용'을 누르세요.</p>
    <div class="editor-stage"><canvas data-ec></canvas></div>
    <div class="row gap wrap mt">
      <button class="btn small" data-apply>자르기 적용</button>
      <button class="btn small" data-rotate>90° 회전</button>
      <button class="btn small" data-undo>되돌리기</button>
      <button class="btn small ghost" data-reset>원본으로</button>
      <span class="grow"></span>
      <button class="btn primary" data-done>완료</button>
    </div>`, { wide: true });
  const ec = m.el.querySelector('[data-ec]');
  const ctx = ec.getContext('2d');
  const help = { crop: "남길 영역을 드래그한 뒤 '자르기 적용'을 누르세요.", mosaic: '가릴 부분을 드래그하면 모자이크 처리돼요.', black: '가릴 부분을 드래그하면 덮어져요.' };

  function fit() {
    const maxW = Math.min(m.el.clientWidth || 800, 900), maxH = window.innerHeight * 0.6;
    const r = Math.min(maxW / work.width, maxH / work.height, 1);
    ec.width = Math.round(work.width * r); ec.height = Math.round(work.height * r);
    ec.dataset.scale = String(r);
    draw();
  }
  function draw() {
    ctx.drawImage(work, 0, 0, ec.width, ec.height);
    if (sel) {
      ctx.save();
      if (mode === 'crop') {
        ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, ec.width, ec.height);
        ctx.drawImage(work, sel.x / +ec.dataset.scale, sel.y / +ec.dataset.scale, sel.w / +ec.dataset.scale, sel.h / +ec.dataset.scale, sel.x, sel.y, sel.w, sel.h);
      }
      ctx.strokeStyle = '#e9c46a'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
      ctx.restore();
    }
  }
  const pos = e => { const r = ec.getBoundingClientRect(); return { x: Math.max(0, Math.min(ec.width, (e.clientX - r.left) * ec.width / r.width)), y: Math.max(0, Math.min(ec.height, (e.clientY - r.top) * ec.height / r.height)) }; };
  ec.style.touchAction = 'none';
  ec.onpointerdown = e => { ec.setPointerCapture(e.pointerId); drag = pos(e); sel = { x: drag.x, y: drag.y, w: 0, h: 0 }; };
  ec.onpointermove = e => { if (!drag) return; const p = pos(e); sel = { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) }; draw(); };
  ec.onpointerup = () => {
    drag = null;
    if (!sel || sel.w < 6 || sel.h < 6) { sel = null; draw(); return; }
    if (mode !== 'crop') { applyMask(); sel = null; draw(); }
  };
  const realRect = () => { const s = +ec.dataset.scale; return { x: Math.round(sel.x / s), y: Math.round(sel.y / s), w: Math.round(sel.w / s), h: Math.round(sel.h / s) }; };
  function push() { history.push(cloneCanvas(work)); if (history.length > 20) history.shift(); }
  function applyMask() {
    push();
    const r = realRect(); const wc = work.getContext('2d');
    if (mode === 'black') { wc.fillStyle = '#111'; wc.fillRect(r.x, r.y, r.w, r.h); return; }
    const block = Math.max(10, Math.round(Math.max(work.width, work.height) / 60));
    const tmp = document.createElement('canvas'); tmp.width = Math.max(1, Math.round(r.w / block)); tmp.height = Math.max(1, Math.round(r.h / block));
    tmp.getContext('2d').drawImage(work, r.x, r.y, r.w, r.h, 0, 0, tmp.width, tmp.height);
    wc.imageSmoothingEnabled = false; wc.drawImage(tmp, 0, 0, tmp.width, tmp.height, r.x, r.y, r.w, r.h); wc.imageSmoothingEnabled = true;
  }
  m.el.querySelectorAll('[name=em]').forEach(r => r.onchange = () => { mode = r.value; sel = null; m.el.querySelector('[data-help]').textContent = help[mode]; m.el.querySelector('[data-apply]').style.display = mode === 'crop' ? '' : 'none'; draw(); });
  m.el.querySelector('[data-apply]').onclick = () => {
    if (!sel) { toast('먼저 남길 영역을 드래그하세요'); return; }
    push(); const r = realRect();
    const n = document.createElement('canvas'); n.width = r.w; n.height = r.h; n.getContext('2d').drawImage(work, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    work = n; sel = null; fit();
  };
  m.el.querySelector('[data-rotate]').onclick = () => {
    push(); const n = document.createElement('canvas'); n.width = work.height; n.height = work.width;
    const c = n.getContext('2d'); c.translate(n.width, 0); c.rotate(Math.PI / 2); c.drawImage(work, 0, 0); work = n; sel = null; fit();
  };
  m.el.querySelector('[data-undo]').onclick = () => { if (history.length) { work = history.pop(); sel = null; fit(); } };
  m.el.querySelector('[data-reset]').onclick = () => { push(); work = cloneCanvas(srcCanvas); sel = null; fit(); };
  m.el.querySelector('[data-done]').onclick = () => { onDone(work); m.close(); };
  requestAnimationFrame(fit);
}
