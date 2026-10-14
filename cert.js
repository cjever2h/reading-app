// 오늘의 독서 인증 이미지: 정사각형(피드)·세로형(스토리), 페이지 사진 자르기·가리기 편집, 저장·공유
import * as db from './db.js';
import { S } from './db.js';
import { esc, openModal, toast, fmtDur, pad, ymd } from './ui.js';
import { streak, pagesOf } from './calc.js';

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
    for (const ch of para) {
      const t = line + ch;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = ch.trimStart(); } else line = t;
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

/** 인증 이미지 그리기 */
export async function drawCert(canvas, d) {
  const story = d.template === 'story';
  const W = 1080, H = story ? 1920 : 1080;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  try { await Promise.all([document.fonts.load(F(800, 40)), document.fonts.load(F(600, 30)), document.fonts.load(F(500, 30))]); } catch { /* 기본 글꼴 */ }
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#22382f'); g.addColorStop(1, '#0f1714');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const P = 64, CW = W - P * 2;
  const [mainTitle, ...subParts] = String(d.title).split(/\s*:\s+/);
  const subTitle = subParts.join(': ');
  const stats = [['읽은 쪽', d.pagesText], ['독서 시간', d.timeText], ['연속 독서', `${d.streak}일`]];

  // 상단 라벨
  ctx.fillStyle = '#e9c46a'; ctx.font = F(700, 30); ctx.fillText('오늘의 독서', P, P + 30);
  ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = F(500, 30); ctx.textAlign = 'right'; ctx.fillText(d.dateText, W - P, P + 30); ctx.textAlign = 'left';
  // 하단
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = F(500, 26);
  if (d.nickname) ctx.fillText(`@${d.nickname}`, P, H - P + 6);
  ctx.textAlign = 'right'; ctx.fillText('독서기록 · AI각인 독서', W - P, H - P + 6); ctx.textAlign = 'left';

  const coverBox = (x, y, w) => {
    const h = Math.round(w * 1.45);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 36; ctx.shadowOffsetY = 14;
    roundRect(ctx, x, y, w, h, 10); ctx.fillStyle = '#2f4a3e'; ctx.fill(); ctx.restore();
    if (d.cover) { ctx.save(); roundRect(ctx, x, y, w, h, 10); ctx.clip(); drawCover(ctx, d.cover, x, y, w, h); ctx.restore(); }
    else { ctx.fillStyle = '#fff'; ctx.font = F(700, Math.round(w / 9)); wrapLines(ctx, mainTitle, w - 30, 6).forEach((l, i) => ctx.fillText(l, x + 16, y + w / 6 + i * (w / 7))); }
    return h;
  };
  // 제목 블록: 반환 높이
  const titleBlock = (x, y, w, size, align = 'left', measureOnly = false) => {
    ctx.textAlign = align;
    const ax = align === 'center' ? x + w / 2 : x;
    let yy = y;
    ctx.font = F(800, size);
    const tl = wrapLines(ctx, mainTitle, w, 2);
    tl.forEach(l => { yy += size * 1.22; if (!measureOnly) { ctx.fillStyle = '#fff'; ctx.fillText(l, ax, yy); } });
    if (subTitle) {
      ctx.font = F(500, Math.round(size * 0.52));
      const sl = wrapLines(ctx, subTitle, w, 2);
      yy += 10;
      sl.forEach(l => { yy += size * 0.52 * 1.4; if (!measureOnly) { ctx.fillStyle = 'rgba(255,255,255,.72)'; ctx.fillText(l, ax, yy); } });
    }
    ctx.font = F(500, Math.round(size * 0.56));
    yy += size * 0.56 * 1.9;
    if (!measureOnly) { ctx.fillStyle = 'rgba(255,255,255,.62)'; ctx.fillText(wrapLines(ctx, d.author, w, 1)[0] || '', ax, yy); }
    ctx.textAlign = 'left';
    return yy - y;
  };
  const statBoxes = (y, h = 170) => {
    const gap = 20, bw = (CW - gap * 2) / 3;
    stats.forEach(([k, v], i) => {
      const x = P + i * (bw + gap);
      roundRect(ctx, x, y, bw, h, 24); ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = F(500, 28); ctx.fillText(k, x + 30, y + h * 0.36);
      ctx.fillStyle = '#e9c46a'; ctx.font = F(800, v.length > 9 ? 40 : 50);
      ctx.fillText(v, x + 30, y + h * 0.78);
    });
    return h;
  };
  const quoteBox = (y, size, maxLines, measureOnly = false) => {
    if (!d.quote) return 0;
    ctx.font = F(600, size);
    const ls = wrapLines(ctx, `“${d.quote}”`, CW - 90, maxLines);
    const lh = size * 1.5, qh = ls.length * lh + 70 + (d.quotePage ? 30 : 0);
    if (measureOnly) return qh;
    roundRect(ctx, P, y, CW, qh, 26); ctx.fillStyle = 'rgba(233,196,106,.13)'; ctx.fill();
    ctx.fillStyle = '#e9c46a'; ctx.fillRect(P, y + 26, 6, qh - 52);
    ctx.fillStyle = '#fff'; ctx.font = F(600, size);
    ls.forEach((l, i) => ctx.fillText(l, P + 44, y + 40 + size + i * lh));
    if (d.quotePage) { ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = F(500, 26); ctx.textAlign = 'right'; ctx.fillText(`p.${d.quotePage}`, W - P - 36, y + qh - 28); ctx.textAlign = 'left'; }
    return qh;
  };
  const photoBox = (y, h, overlayQuote) => {
    ctx.save(); roundRect(ctx, P, y, CW, h, 28); ctx.clip();
    drawCover(ctx, d.photo, P, y, CW, h);
    if (overlayQuote && d.quote) {
      const gg = ctx.createLinearGradient(0, y + h * 0.4, 0, y + h);
      gg.addColorStop(0, 'rgba(0,0,0,0)'); gg.addColorStop(1, 'rgba(0,0,0,.8)');
      ctx.fillStyle = gg; ctx.fillRect(P, y, CW, h);
      ctx.fillStyle = '#fff'; ctx.font = F(600, 34);
      const ls = wrapLines(ctx, `“${d.quote}”`, CW - 80, 3);
      ls.forEach((l, i) => ctx.fillText(l, P + 40, y + h - 40 - (ls.length - 1 - i) * 48));
    }
    ctx.restore();
  };

  const top = P + 80, bottom = H - P - 50;
  if (!story && d.photo) {
    photoBox(top, 480, true);
    let y = top + 480 + 36;
    const cw = 150; coverBox(P, y, cw);
    const tx = P + cw + 36, tw = W - tx - P;
    titleBlock(tx, y - 10, tw, 40);
    const sy = y + Math.round(cw * 1.45) - 64;
    const colW = tw / 3;
    stats.forEach(([k, v], i) => {
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = F(500, 24); ctx.fillText(k, tx + i * colW, sy);
      ctx.fillStyle = '#e9c46a'; ctx.font = F(800, v.length > 9 ? 32 : 40); ctx.fillText(v, tx + i * colW, sy + 48);
    });
  } else if (!story) {
    const cw = 260, ch = Math.round(cw * 1.45);
    const tx = P + cw + 44, tw = W - tx - P;
    const qh = quoteBox(0, 34, 3, true);
    const blockH = ch + 40 + 160 + (qh ? qh + 30 : 0);
    let y = top + Math.max(0, (bottom - top - blockH) / 2);
    coverBox(P, y, cw);
    const th = titleBlock(tx, 0, tw, 52, 'left', true);
    titleBlock(tx, y + Math.max(0, (ch - th) / 2) - 16, tw, 52);
    y += ch + 40;
    statBoxes(y, 160); y += 160 + 30;
    quoteBox(y, 34, 3);
  } else if (d.photo) {
    photoBox(top, 760, false);
    let y = top + 760 + 50;
    const cw = 210; coverBox(P, y, cw);
    const tx = P + cw + 40, tw = W - tx - P;
    const th = titleBlock(tx, 0, tw, 50, 'left', true);
    titleBlock(tx, y + Math.max(0, (cw * 1.45 - th) / 2) - 14, tw, 50);
    y += Math.round(cw * 1.45) + 50;
    statBoxes(y); y += 170 + 36;
    quoteBox(y, 38, Math.max(2, Math.floor((bottom - y - 110) / 57)));
  } else {
    const cw = 440, ch = Math.round(cw * 1.45);
    const th = titleBlock(P, 0, CW, 60, 'center', true);
    const qh = quoteBox(0, 40, 5, true);
    const blockH = ch + 50 + th + 60 + 170 + (qh ? qh + 40 : 0);
    let y = top + Math.max(0, (bottom - top - blockH) / 2);
    coverBox((W - cw) / 2, y, cw);
    y += ch + 50;
    titleBlock(P, y - 20, CW, 60, 'center');
    y += th + 60;
    statBoxes(y); y += 170 + 40;
    quoteBox(y, 40, 5);
  }
}

/* ---------- 인증 이미지 모달 ---------- */
export async function certModal(session, { afterClose, justFinished = false } = {}) {
  const b = db.book(session.book_id);
  const st = S.settings;
  const quotes = [...S.quotes.filter(q => q.session_id === session.id), ...S.quotes.filter(q => q.book_id === b.id && q.session_id !== session.id).reverse()];
  const state = { template: 'square', photo: null, photoCanvas: null, photoDirty: false, quoteId: '', showNick: st.show_nickname !== false };

  const m = openModal(`
    <h3>${justFinished ? '완독 기록' : '오늘의 독서 인증'}</h3>
    <div class="cert-wrap">
      <div class="cert-preview"><canvas data-cv></canvas></div>
      <div class="cert-ctrl form">
        <div class="seg" data-tpl><label><input type="radio" name="tpl" value="square" checked><span>정사각형 (피드)</span></label><label><input type="radio" name="tpl" value="story"><span>세로형 (스토리)</span></label></div>
        <div class="field-label">책 페이지 사진</div>
        <div class="row gap wrap">
          <label class="btn small file-btn">촬영<input type="file" accept="image/*" capture="environment" hidden data-photo></label>
          <label class="btn small file-btn">갤러리<input type="file" accept="image/*" hidden data-photo></label>
          <button class="btn small" data-edit disabled>자르기·가리기</button>
          <button class="btn small ghost" data-nophoto disabled>사진 빼기</button>
        </div>
        <label>문장 1개 (선택)<select data-quote><option value="">선택 안 함</option>${quotes.map(q => `<option value="${q.id}">${esc(q.body.slice(0, 40))}${q.body.length > 40 ? '…' : ''}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" data-nick ${state.showNick ? 'checked' : ''}> 닉네임 표기 (@${esc(st.nickname || '')})</label>
        <div class="row gap wrap mt">
          <button class="btn primary" data-share>공유</button>
          <button class="btn" data-save>이미지 저장</button>
        </div>
        <p class="muted small" data-msg>사진은 공유 전에 자르기·가리기로 보이고 싶은 부분만 남겨요.</p>
      </div>
    </div>`, { wide: true, onClose: () => { if (state.photoDirty && state.photoCanvas) savePhoto(); afterClose && afterClose(); } });

  const cv = m.el.querySelector('[data-cv]');
  const msg = m.el.querySelector('[data-msg]');
  const coverUrl = b.cover_url ? await db.proxiedImage(b.cover_url) : null;
  const cover = coverUrl ? await loadImg(coverUrl).catch(() => null) : null;

  if (session.photo_path) {
    const u = await db.photoUrl(session.photo_path);
    if (u) { try { const blob = await (await fetch(u)).blob(); const c = await fileToCanvas(blob); state.photoCanvas = c; } catch { /* ignore */ } }
  }

  const d0 = new Date(session.started_at);
  const base = {
    title: b.title, author: b.author || '',
    dateText: `${d0.getFullYear()}.${pad(d0.getMonth() + 1)}.${pad(d0.getDate())} ${'일월화수목금토'[d0.getDay()]}요일`,
    pagesText: session.start_page != null && session.end_page ? `p.${session.start_page}–${session.end_page}` : `${pagesOf(session)}쪽`,
    timeText: fmtDur(session.seconds),
    streak: streak(ymd(d0)) || 1,
    cover,
  };
  const redraw = async () => {
    const q = quotes.find(x => x.id === state.quoteId);
    await drawCert(cv, { ...base, template: state.template, photo: state.photoCanvas, quote: q?.body?.slice(0, 160), quotePage: q?.page, nickname: state.showNick ? (st.nickname || '') : '' });
    m.el.querySelector('[data-edit]').disabled = !state.photoCanvas;
    m.el.querySelector('[data-nophoto]').disabled = !state.photoCanvas;
  };
  await redraw();

  m.el.querySelectorAll('[name=tpl]').forEach(r => r.onchange = () => { state.template = r.value; redraw(); });
  m.el.querySelector('[data-quote]').onchange = e => { state.quoteId = e.target.value; redraw(); };
  m.el.querySelector('[data-nick]').onchange = e => { state.showNick = e.target.checked; redraw(); };
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

  async function savePhoto() {
    try {
      const blob = await new Promise(res => state.photoCanvas.toBlob(res, 'image/jpeg', 0.85));
      const path = await db.uploadPhoto(blob, 'page.jpg');
      const old = session.photo_path;
      await db.save('sessions', { ...session, photo_path: path });
      if (old) db.removePhoto(old);
    } catch (e) { console.warn('사진 업로드 실패', e); }
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
