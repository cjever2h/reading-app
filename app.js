// 앱 진입점: 인증, 라우팅, 공통 네비게이션
import * as db from './db.js';
import { S } from './db.js';
import { $, esc, toast } from './ui.js';
import { renderHome } from './v-home.js';
import { renderLibrary } from './v-library.js';
import { renderBook } from './v-book.js';
import { renderTimer, timerState } from './v-timer.js';
import { renderDB } from './v-db.js';
import { renderGuide } from './v-guide.js';
import { renderStats } from './v-stats.js';
import { renderSettings } from './v-settings.js';
import { renderReview } from './v-review.js';

const ROUTES = [
  [/^#\/home$/, renderHome, 'home'],
  [/^#\/library$/, renderLibrary, 'library'],
  [/^#\/book\/([\w-]+)(?:\/(\w+))?$/, renderBook, 'library'],
  [/^#\/timer(?:\/([\w-]+))?$/, renderTimer, 'timer'],
  [/^#\/db$/, renderDB, 'db'],
  [/^#\/guide(?:\/([\w-]+))?(?:\/([\w-]+))?$/, renderGuide, 'guide'],
  [/^#\/stats$/, renderStats, 'stats'],
  [/^#\/settings$/, renderSettings, 'stats'],
  [/^#\/review\/([\w-]+)$/, renderReview, 'home'],
];

export function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
export function refresh() { route(true); }

let lastHash = '';
let currentQuery = new URLSearchParams();
export const query = () => currentQuery;
async function route(keepScroll = false) {
  const h = location.hash || '#/home';
  const [path, qs] = h.split('?');
  currentQuery = new URLSearchParams(qs || '');
  const view = $('#view');
  for (const [re, fn, tab] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
    const y = window.scrollY;
    try { await fn(view, ...m.slice(1)); } catch (e) { console.error(e); view.innerHTML = `<div class="card error">화면을 그리는 중 오류가 났어요: ${esc(e.message)}</div>`; }
    if (keepScroll && h === lastHash) window.scrollTo(0, y); else window.scrollTo(0, 0);
    lastHash = h;
    updateTimerPill();
    return;
  }
  location.hash = '#/home';
}

export function updateTimerPill() {
  const pill = $('#timer-pill');
  const st = timerState();
  if (!st || location.hash.startsWith('#/timer')) { pill.classList.add('hidden'); return; }
  const b = db.book(st.bookId);
  pill.classList.remove('hidden');
  pill.innerHTML = `<span class="dot ${st.runningSince ? 'live' : ''}"></span>${esc(b?.title || '독서 중')} · <b data-elapsed></b>`;
}
setInterval(() => {
  const st = timerState();
  const el = document.querySelector('#timer-pill [data-elapsed]');
  if (st && el) {
    const ms = st.accMs + (st.runningSince ? Date.now() - st.runningSince : 0);
    const s = Math.floor(ms / 1000);
    el.textContent = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
}, 1000);

/* ---------- 인증 ---------- */
function showAuth(show) {
  $('#auth-view').classList.toggle('hidden', !show);
  $('#app-view').classList.toggle('hidden', show);
}

function bindAuth() {
  const form = $('#auth-form');
  let mode = 'signin';
  form.addEventListener('click', e => { const b = e.target.closest('button[data-mode]'); if (b) mode = b.dataset.mode; });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#auth-email').value.trim(), pw = $('#auth-password').value;
    const msg = $('#auth-msg');
    msg.textContent = '';
    try {
      if (mode === 'signup') {
        const r = await db.signUp(email, pw);
        if (!r.session) { msg.textContent = '가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인하세요.'; return; }
      } else await db.signIn(email, pw);
      await start();
    } catch (err) { msg.textContent = err.message.includes('Invalid login') ? '이메일 또는 비밀번호가 맞지 않아요.' : err.message; }
  });
  $('#auth-reset').onclick = async () => {
    const email = $('#auth-email').value.trim();
    if (!email) { $('#auth-msg').textContent = '이메일을 먼저 입력하세요.'; return; }
    try { await db.resetPassword(email); $('#auth-msg').textContent = '비밀번호 재설정 메일을 보냈어요.'; } catch (err) { $('#auth-msg').textContent = err.message; }
  };
}

let started = false;
async function start() {
  S.user = await db.getUser();
  if (!S.user) { showAuth(true); return; }
  showAuth(false);
  $('#view').innerHTML = '<div class="loading">불러오는 중…</div>';
  await db.loadAll();
  if (!S.settings.user_id) await db.saveSettings({ nickname: S.user.email.split('@')[0] }).catch(() => {});
  db.loadApiStatus();
  $('#user-email').textContent = S.user.email;
  if (!started) { window.addEventListener('hashchange', () => route()); started = true; }
  route();
}

async function boot() {
  bindAuth();
  try { await db.init(); } catch (e) { document.body.innerHTML = `<p style="padding:2rem">초기화 실패: ${esc(e.message)}</p>`; return; }
  db.onAuth(async (ev, user) => {
    if (ev === 'PASSWORD_RECOVERY') {
      const pw = prompt('새 비밀번호를 입력하세요 (6자 이상)');
      if (pw) { try { await db.updatePassword(pw); toast('비밀번호를 바꿨어요'); } catch (e) { toast(e.message); } }
    }
    if (ev === 'SIGNED_OUT') { S.user = null; showAuth(true); }
  });
  await start();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

$('#timer-pill').onclick = () => go('#/timer');
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateTimerPill(); });
boot();
