// 설정: 닉네임·인증 이미지, 가이드 옵션(교차 분석, 프롬프트 편집), 연결 상태, 노션, 내보내기, 계정
import * as db from './db.js';
import { S } from './db.js';
import { esc, toast, download, GENRES, openModal, ymd } from './ui.js';
import { GENRE_PROMPTS, QUICK_CARDS } from './guide-data.js';
import { allMarkdown, backupJson } from './export.js';
import { refresh } from './app.js';

export async function renderSettings(el) {
  const st = S.settings;
  const api = S.apiStatus || await db.loadApiStatus();
  el.innerHTML = `<div class="sec-head"><h1>설정</h1><a class="btn small" href="#/stats">통계</a></div>
  <form class="card form" id="f1">
    <h3>프로필 · 인증 이미지</h3>
    <label>닉네임<input name="nickname" value="${esc(st.nickname || '')}"></label>
    <label class="check"><input type="checkbox" name="show_nickname" ${st.show_nickname !== false ? 'checked' : ''}> 독서 인증 이미지에 닉네임 표기</label>
    <label>연간 완독 목표(권)<input type="number" name="yearly_goal" min="0" value="${esc(st.yearly_goal ?? 24)}"></label>
    <h3 class="mt">가이드 옵션</h3>
    <label class="check"><input type="checkbox" name="cross_book" ${st.cross_book ? 'checked' : ''}> 타 책과의 교차 분석 허용 (기본 꺼짐)</label>
    <div class="row end"><button class="btn primary small">저장</button></div>
  </form>

  <div class="card">
    <h3>연결 상태</h3>
    <ul class="status-list">
      <li><b>도서 검색</b> ${api.search === 'aladin' ? '<span class="ok">알라딘 OpenAPI 연결됨</span>' : '<span class="warn-t">알라딘 TTB 키 등록 전 · 알라딘 공개 검색 페이지로 임시 검색 중 (키를 넣으면 공식 API로 자동 전환)</span>'}</li>
      <li><b>AI 가이드</b> ${api.ai ? `<span class="ok">${esc(api.ai)} 연결됨</span>` : '<span class="warn-t">AI 키 등록 전 · 질문·힌트 중심 가이드로 동작</span>'}</li>
      <li><b>사진 문장 인식</b> ${api.ai ? '<span class="ok">AI 인식</span>' : '<span class="muted">브라우저 인식(Tesseract)</span>'}</li>
    </ul>
    <p class="muted small">키는 Supabase Edge Function 비밀값(ALADIN_TTB_KEY, GEMINI_API_KEY 등)으로만 보관돼요. 브라우저에는 노출되지 않아요.</p>
  </div>

  <form class="card form" id="f2">
    <h3>노션 전송</h3>
    <p class="muted small">노션에서 통합(Integration)을 만들고, 독서노트를 담을 페이지에서 '연결 추가'로 그 통합을 연결한 뒤 아래에 입력하세요. 연결 없이도 '복사' 후 노션에 붙여넣으면 서식이 유지돼요.</p>
    <label>통합 토큰 (secret_… 또는 ntn_…)<input name="notion_token" type="password" autocomplete="off" value="${esc(st.notion_token || '')}"></label>
    <label>상위 페이지 URL 또는 ID<input name="notion_parent" value="${esc(st.notion_parent || '')}"></label>
    <div class="row end"><button class="btn small primary">저장</button></div>
  </form>

  <div class="card">
    <h3>가이드 프롬프트 편집</h3>
    <p class="muted small">원고 부록 A(장르별 프롬프트)와 부록 D(빠른 참조 카드) 문구로 바꿔 쓸 수 있어요. 비워두면 기본값을 써요.</p>
    <div class="row gap wrap"><button class="btn small" data-edit-genres>장르별 프롬프트 (5종)</button><button class="btn small" data-edit-cards>빠른 참조 카드 (12종)</button></div>
  </div>

  <div class="card">
    <h3>내보내기 · 백업</h3>
    <div class="row gap wrap"><button class="btn small" data-md>전체 독서노트 마크다운</button><button class="btn small" data-json>전체 데이터 JSON 백업</button></div>
  </div>

  <form class="card form" id="f3">
    <h3>계정</h3>
    <p class="small">${esc(S.user.email)}</p>
    <label>새 비밀번호<input type="password" name="pw" minlength="6" autocomplete="new-password"></label>
    <div class="row gap end"><button class="btn small">비밀번호 변경</button><button type="button" class="btn small danger" data-logout>로그아웃</button></div>
  </form>
  <p class="muted small center">독서앱 · 도서 정보 제공: 알라딘 (키 등록 시)</p>`;

  el.querySelector('#f1').onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(e.target);
    await db.saveSettings({ nickname: fd.get('nickname'), show_nickname: fd.get('show_nickname') === 'on', cross_book: fd.get('cross_book') === 'on', yearly_goal: Number(fd.get('yearly_goal')) || null });
    toast('저장했어요');
  };
  el.querySelector('#f2').onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(e.target);
    await db.saveSettings({ notion_token: fd.get('notion_token').trim() || null, notion_parent: fd.get('notion_parent').trim() || null });
    toast('노션 연결 정보를 저장했어요');
  };
  el.querySelector('#f3').onsubmit = async e => {
    e.preventDefault(); const pw = new FormData(e.target).get('pw');
    if (!pw || pw.length < 6) { toast('6자 이상 입력하세요'); return; }
    try { await db.updatePassword(pw); toast('비밀번호를 바꿨어요'); e.target.reset(); } catch (err) { toast(err.message); }
  };
  el.querySelector('[data-logout]').onclick = () => db.signOut();
  el.querySelector('[data-md]').onclick = () => download(`독서노트_전체_${ymd()}.md`, allMarkdown(), 'text/markdown;charset=utf-8');
  el.querySelector('[data-json]').onclick = () => download(`독서앱_백업_${ymd()}.json`, backupJson(), 'application/json');
  el.querySelector('[data-edit-genres]').onclick = () => editGenres();
  el.querySelector('[data-edit-cards]').onclick = () => editCards();
}

function editGenres() {
  const cp = S.settings.custom_prompts || {};
  const m = openModal(`<h3>장르별 프롬프트</h3><form class="form" id="gf">${GENRES.map(g => `<label>${g}<textarea name="${g}" rows="3" placeholder="${esc(GENRE_PROMPTS[g])}">${esc((cp.genres || {})[g] || '')}</textarea></label>`).join('')}<div class="row end"><button class="btn primary">저장</button></div></form>`, { wide: true });
  m.el.querySelector('#gf').onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(e.target);
    const genres = {}; GENRES.forEach(g => { const v = fd.get(g).trim(); if (v) genres[g] = v; });
    await db.saveSettings({ custom_prompts: { ...cp, genres } }); toast('저장했어요'); m.close();
  };
}
function editCards() {
  const cp = S.settings.custom_prompts || {};
  const cc = cp.cards || {};
  const m = openModal(`<h3>빠른 참조 카드 12종</h3><form class="form" id="cf">${QUICK_CARDS.map(c => `<fieldset><legend>${c.id.slice(1)}</legend>
    <label>제목<input name="${c.id}_title" value="${esc(cc[c.id]?.title || '')}" placeholder="${esc(c.title)}"></label>
    <label>사용자가 먼저 쓸 것<input name="${c.id}_need" value="${esc(cc[c.id]?.need || '')}" placeholder="${esc(c.need)}"></label>
    <label>AI 지침<textarea name="${c.id}_ai" rows="2" placeholder="${esc(c.ai)}">${esc(cc[c.id]?.ai || '')}</textarea></label></fieldset>`).join('')}
    <div class="row end"><button class="btn primary">저장</button></div></form>`, { wide: true });
  m.el.querySelector('#cf').onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(e.target);
    const cards = {};
    QUICK_CARDS.forEach(c => { const o = {}; ['title', 'need', 'ai'].forEach(k => { const v = fd.get(`${c.id}_${k}`).trim(); if (v) o[k] = v; }); if (Object.keys(o).length) cards[c.id] = o; });
    await db.saveSettings({ custom_prompts: { ...cp, cards } }); toast('저장했어요'); m.close();
  };
}
