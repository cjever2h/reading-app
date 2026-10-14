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
  try { await Promise.all([document.fonts.load(F(800, 40)), document.fonts.load(F(500, 30))]); } catch { /* 기본 글꼴 */ }
  // 배경
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1d2b24'); g.addColorStop(1, '#0f1714');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const P = 64;
  let y = P;

  // 상단 라벨
  ctx.fillStyle = '#e9c46a'; ctx.font = F(700, 30);
  ctx.fillText('오늘의 독서', P, y + 30);
  ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = F(500, 30); ctx.textAlign = 'right';
  ctx.fillText(d.dateText, W - P, y + 30); ctx.textAlign = 'left';
  y += 60;

  // 페이지 사진
  const photoH = d.photo ? (story ? 820 : 470) : 0;
  if (d.photo) {
    ctx.save(); roundRect(ctx, P, y, W - P * 2, photoH, 28); ctx.clip();
    drawCover(ctx, d.photo, P, y, W - P * 2, photoH);
    if (d.quote && !story) {
      const gg = ctx.createLinearGradient(0, y + photoH * 0.45, 0, y + photoH);
      gg.addColorStop(0, 'rgba(0,0,0,0)'); gg.addColorStop(1, 'rgba(0,0,0,.78)');
      ctx.fillStyle = gg; ctx.fillRect(P, y, W - P * 2, photoH);
      ctx.fillStyle = '#fff'; ctx.font = F(600, 34);
      const ls = wrapLines(ctx, `“${d.quote}”`, W - P * 2 - 80, 3);
      ls.forEach((l, i) => ctx.fillText(l, P + 40, y + photoH - 40 - (ls.length - 1 - i) * 48));
    }
    ctx.restore();
    y += photoH + 40;
  }

  // 책 정보
  const coverW = d.photo ? (story ? 220 : 170) : (story ? 360 : 300);
  const coverH = Math.round(coverW * 1.45);
  if (d.cover) {
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
    roundRect(ctx, P, y, coverW, coverH, 10); ctx.fillStyle = '#333'; ctx.fill(); ctx.restore();
    ctx.save(); roundRect(ctx, P, y, coverW, coverH, 10); ctx.clip(); drawCover(ctx, d.cover, P, y, coverW, coverH); ctx.restore();
  } else {
    roundRect(ctx, P, y, coverW, coverH, 10); ctx.fillStyle = '#2f4a3e'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = F(700, 28);
    wrapLines(ctx, d.title, coverW - 30, 5).forEach((l, i) => ctx.fillText(l, P + 15, y + 50 + i * 38));
  }
  const tx = P + coverW + 44, tw = W - tx - P;
  let ty = y + 8;
  ctx.fillStyle = '#fff'; ctx.font = F(800, d.photo ? 46 : 54);
  const tl = wrapLines(ctx, d.title, tw, 3);
  tl.forEach((l, i) => ctx.fillText(l, tx, ty + 46 + i * (d.photo ? 58 : 66)));
  ty += 46 + (tl.length - 1) * (d.photo ? 58 : 66) + 44;
  ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = F(500, 30);
  wrapLines(ctx, d.author, tw, 1).forEach(l => ctx.fillText(l, tx, ty));
  ty += 40;

  // 수치
  const stats = [['읽은 쪽', d.pagesText], ['독서 시간', d.timeText], ['연속 독서', `${d.streak}일`]];
  if (!story) {
    const sy = Math.max(ty + 30, y + coverH - 120);
    const colW = tw / 3;
    stats.forEach(([k, v], i) => {
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = F(500, 26); ctx.fillText(k, tx + i * colW, sy);
      ctx.fillStyle = '#e9c46a'; ctx.font = F(800, v.length > 8 ? 34 : 42); ctx.fillText(v, tx + i * colW, sy + 52);
    });
    y = Math.max(y + coverH, sy + 70) + 40;
  } else {
    y += coverH + 60;
    const colW = (W - P * 2) / 3;
    stats.forEach(([k, v], i) => {
      roundRect(ctx, P + i * colW + (i ? 10 : 0), y, colW - 20, 170, 24); ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = F(500, 28); ctx.fillText(k, P + i * colW + 34, y + 58);
      ctx.fillStyle = '#e9c46a'; ctx.font = F(800, v.length > 8 ? 38 : 50); ctx.fillText(v, P + i * colW + 34, y + 130);
    });
    y += 220;
    if (d.quote) {
      ctx.font = F(600, 40);
      const ls = wrapLines(ctx, `“${d.quote}”`, W - P * 2 - 80, 6);
      const qh = ls.length * 58 + 80;
      roundRect(ctx, P, y, W - P * 2, qh, 28); ctx.fillStyle = 'rgba(233,196,106,.12)'; ctx.fill();
      ctx.fillStyle = '#fff';
      ls.forEach((l, i) => ctx.fillText(l, P + 40, y + 70 + i * 58));
      if (d.quotePage) { ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = F(500, 26); ctx.textAlign = 'right'; ctx.fillText(`p.${d.quotePage}`, W - P - 40, y + qh - 24); ctx.textAlign = 'left'; }
      y += qh + 30;
    }
  }
  // 사진 없는 정사각형에 문장
  if (!story && !d.photo && d.quote) {
    ctx.fillStyle = '#fff'; ctx.font = F(600, 36);
    const ls = wrapLines(ctx, `“${d.quote}”`, W - P * 2, 4);
    ls.forEach((l, i) => ctx.fillText(l, P, y + 30 + i * 52));
  }
  // 하단
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = F(500, 26);
  ctx.fillText(d.nickname ? `@${d.nickname}` : '', P, H - P + 6);
  ctx.textAlign = 'right'; ctx.fillText('독서기록 · AI각인 독서', W - P, H - P + 6); ctx.textAlign = 'left';
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
