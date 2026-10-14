// 사진 문장 인식(OCR): AI 키가 있으면 서버 AI(한글 정확도 높음), 없으면 브라우저 Tesseract.js
import * as db from './db.js';
import { S } from './db.js';

export async function resizeImage(file, max = 1600, quality = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * r); c.height = Math.round(img.naturalHeight * r);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(res, 'image/jpeg', quality));
  } finally { URL.revokeObjectURL(url); }
}
const toB64 = blob => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });

let tesseractLoading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!tesseractLoading) tesseractLoading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = () => res(window.Tesseract); s.onerror = () => rej(new Error('OCR 라이브러리를 불러오지 못했어요'));
    document.head.appendChild(s);
  });
  return tesseractLoading;
}

export async function runOcr(file, onProgress = () => {}) {
  const blob = await resizeImage(file);
  if (S.apiStatus?.ai) {
    try {
      onProgress('AI로 문장 인식 중…');
      const d = await db.api('ocr', { mime: 'image/jpeg', data: await toB64(blob) });
      if (d.text) return d.text.trim();
    } catch (e) { onProgress('AI 인식 실패, 브라우저 인식으로 전환…'); }
  }
  const T = await loadTesseract();
  onProgress('브라우저에서 인식 중 (처음엔 언어 데이터 다운로드로 시간이 걸려요)…');
  const r = await T.recognize(blob, 'kor+eng', { logger: m => { if (m.status === 'recognizing text') onProgress(`인식 중 ${Math.round(m.progress * 100)}%`); } });
  return r.data.text.replace(/([가-힣])\s(?=[가-힣])/g, '$1 ').replace(/\n{3,}/g, '\n\n').trim();
}
