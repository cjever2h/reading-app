// 사진 문장 인식(OCR): AI 키가 있으면 서버 AI, 없으면 브라우저 Tesseract.js(조명 보정 전처리 후)
import * as db from './db.js';
import { S } from './db.js';

/** 파일 → 캔버스 (긴 변 max px) */
export async function fileToCanvas(file, max = 2200) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('사진을 열 수 없어요')); i.src = url; });
    const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * r); c.height = Math.round(img.naturalHeight * r);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally { URL.revokeObjectURL(url); }
}
const toBlob = (c, q = 0.88) => new Promise(res => c.toBlob(res, 'image/jpeg', q));
const toB64 = blob => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });

/** 그림자·누런 종이 보정: 배경 밝기로 나눠 흑백 대비를 키움 */
export function preprocess(src) {
  const W = src.width, H = src.height;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const ox = out.getContext('2d'); ox.drawImage(src, 0, 0);
  const img = ox.getImageData(0, 0, W, H), a = img.data;
  const sw = Math.max(8, Math.round(W / 25)), sh = Math.max(8, Math.round(H / 25));
  const sm = document.createElement('canvas'); sm.width = sw; sm.height = sh;
  const sx = sm.getContext('2d'); sx.filter = 'blur(2px)'; sx.drawImage(src, 0, 0, sw, sh);
  const bg = document.createElement('canvas'); bg.width = W; bg.height = H;
  const bx = bg.getContext('2d'); bx.imageSmoothingQuality = 'high'; bx.drawImage(sm, 0, 0, W, H);
  const b = bx.getImageData(0, 0, W, H).data;
  for (let i = 0; i < a.length; i += 4) {
    const g = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    const bv = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
    let v = Math.min(255, g / Math.max(30, bv) * 235);
    v = v < 140 ? v * 0.6 : Math.min(255, v * 1.08);
    a[i] = a[i + 1] = a[i + 2] = v;
  }
  ox.putImageData(img, 0, 0);
  return out;
}

let tesseractLoading = null, workerP = null, progressCb = () => {};
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!tesseractLoading) tesseractLoading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = () => res(window.Tesseract); s.onerror = () => { tesseractLoading = null; rej(new Error('글자 인식 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요')); };
    document.head.appendChild(s);
  });
  return tesseractLoading;
}
async function getWorker() {
  if (!workerP) workerP = (async () => {
    const T = await loadTesseract();
    return T.createWorker('kor+eng', 1, { logger: m => progressCb(m) });
  })().catch(e => { workerP = null; throw e; });
  return workerP;
}

/** 캔버스 글자 인식 → { text, source } */
export async function recognize(canvas, onProgress = () => {}) {
  if (S.apiStatus?.ai) {
    try {
      onProgress('AI로 글자 인식 중…');
      const d = await db.api('ocr', { mime: 'image/jpeg', data: await toB64(await toBlob(canvas)) });
      if (d.text && d.text.trim()) return { text: d.text.trim(), source: 'ai' };
    } catch { onProgress('AI 인식 실패, 휴대폰에서 인식으로 바꿔요…'); }
  }
  progressCb = m => {
    if (m.status === 'recognizing text') onProgress(`글자 인식 중 ${Math.round(m.progress * 100)}%`);
    else if (/load|initializ/i.test(m.status || '')) onProgress('한국어 인식 준비 중… (처음 한 번은 데이터를 받느라 조금 걸려요)');
  };
  onProgress('한국어 인식 준비 중…');
  const w = await getWorker();
  const r = await w.recognize(await toBlob(preprocess(canvas), 0.92));
  return { text: (r.data.text || '').replace(/\n{3,}/g, '\n\n').trim(), source: 'browser', confidence: r.data.confidence };
}

/** 예전 호출 방식 호환 */
export async function runOcr(file, onProgress = () => {}) {
  return (await recognize(await fileToCanvas(file), onProgress)).text;
}

const isPageLine = l => /^[-–—·\s]*\d{1,4}[-–—·\s]*$/.test(l);
const CLOSERS = '”"’\'」』)]》〉';
/**
 * 인식한 텍스트 → 문장 목록. 책 줄바꿈은 이어 붙이고, 빈 줄은 문단 구분.
 * 숫자만 있는 줄은 쪽수로 보고 page로 돌려줌.
 */
export function splitSentences(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.replace(/\s+/g, ' ').trim());
  let page = null; const paras = []; let cur = [];
  const flush = () => { if (cur.length) { paras.push(cur.join(' ')); cur = []; } };
  for (const l of lines) {
    if (!l) { flush(); continue; }
    if (isPageLine(l)) { page = Number(l.replace(/\D/g, '')); flush(); continue; }
    if (l.replace(/[^가-힣a-zA-Z0-9]/g, '').length < 2) continue; // 얼룩·기호만 있는 줄
    cur.push(l);
  }
  flush();
  const out = [];
  paras.forEach((p0, pi) => {
    // 닫는 따옴표가 ':' ';'로 잘못 읽힌 경우 (…다: → …다.)
    const p = p0.replace(/([다요죠])[:;](?= |$)/g, '$1.');
    let start = 0;
    for (let i = 0; i < p.length; i++) {
      if (!'.!?。…'.includes(p[i])) continue;
      let j = i + 1;
      while (j < p.length && ('.!?。…'.includes(p[j]) || CLOSERS.includes(p[j]))) j++;
      if (j >= p.length || p[j] === ' ') {
        const s = p.slice(start, j).trim();
        if (s) out.push({ text: s, para: pi });
        start = j + 1; i = j;
      }
    }
    const rest = p.slice(start).trim();
    if (rest) out.push({ text: rest, para: pi });
  });
  return { sentences: out, page };
}
