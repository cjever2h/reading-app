// 홈: 오늘 독서 시간, 읽는 중인 책, 연속 독서일, 오늘의 복습
import * as db from './db.js';
import { S } from './db.js';
import { esc, ymd, fmtDur, coverImg, fmtDate } from './ui.js';
import { secondsOn, pagesOn, streak, dueReviews, progress } from './calc.js';
import { go } from './app.js';
import { searchModal } from './forms.js';
import { timerState } from './v-timer.js';

const STAGE_TEXT = {
  'D+1': '어제 읽은 책의 핵심이 뭐였지? 스스로 답해보기',
  'D+3': '5문항 기억 테스트',
  'D+7': '독서 후기·카드뉴스·스레드 중 하나 초안 쓰기',
};

export function renderHome(el) {
  const today = ymd();
  const sec = secondsOn(today), pages = pagesOn(today), st = streak();
  const reading = S.books.filter(b => b.status === 'reading');
  const reviews = dueReviews(today);
  const year = new Date().getFullYear();
  const doneYear = S.books.filter(b => b.status === 'done' && (b.finish_date || '').startsWith(String(year))).length;
  const goal = S.settings.yearly_goal || 0;
  const dailyDone = S.notes.some(n => n.kind === 'daily' && n.note_date === today);
  const tmr = timerState();
  const hour = new Date().getHours();

  el.innerHTML = `
  <section class="hero card">
    <div class="hero-stats">
      <div><span class="label">오늘 독서</span><b class="big">${fmtDur(sec)}</b><span class="muted small">${pages ? pages + '쪽' : '아직 기록 없음'}</span></div>
      <div><span class="label">연속 독서일</span><b class="big">${st}<small>일</small></b><span class="muted small">${st ? '이어가는 중' : '오늘 첫 기록을 남겨요'}</span></div>
      <div><span class="label">${year} 완독</span><b class="big">${doneYear}${goal ? `<small>/${goal}권</small>` : '<small>권</small>'}</b>${goal ? `<div class="bar"><i style="width:${Math.min(100, doneYear / goal * 100)}%"></i></div>` : ''}</div>
    </div>
    ${tmr ? `<button class="btn primary block" data-go="#/timer">진행 중인 타이머로 돌아가기</button>` : ''}
  </section>

  <section>
    <div class="sec-head"><h2>오늘의 복습</h2><span class="muted small">D+1 · D+3 · D+7</span></div>
    ${reviews.length ? `<div class="list">${reviews.map(r => {
      const b = db.book(r.book_id);
      const late = r.due_date < today;
      return `<a class="review-item card" href="#/review/${r.id}">
        ${coverImg(b, 'cover xs')}
        <div class="grow"><div><span class="badge">${r.stage}</span> <b>${esc(b?.title || '')}</b></div><div class="muted small">${STAGE_TEXT[r.stage]}${late ? ` · ${fmtDate(r.due_date, false)} 예정분` : ''}</div></div>
        <span class="chev">›</span></a>`;
    }).join('')}</div>` : `<p class="muted card">오늘 할 복습이 없어요. 책을 완독하고 정리를 쓰면 D+1·D+3·D+7 복습이 자동으로 올라와요.</p>`}
  </section>

  <section>
    <div class="sec-head"><h2>읽는 중인 책</h2><button class="btn small" data-add>+ 책 추가</button></div>
    ${reading.length ? `<div class="reading-list">${reading.map(b => {
      const p = progress(b);
      return `<div class="reading-card card">
        <a href="#/book/${b.id}">${coverImg(b, 'cover md')}</a>
        <div class="grow">
          <a href="#/book/${b.id}"><b>${esc(b.title)}</b></a>
          <div class="muted small">${esc(b.author || '')}</div>
          ${p != null ? `<div class="bar"><i style="width:${p}%"></i></div><div class="muted small">${p}% · ${b.current_page || 0}/${b.pages}쪽</div>` : ''}
          <div class="row gap wrap mt">
            <button class="btn primary small" data-timer="${b.id}">타이머 시작</button>
            <button class="btn small" data-go="#/guide/new/during?book=${b.id}">읽는 중 가이드</button>
          </div>
        </div></div>`;
    }).join('')}</div>` : `<div class="card empty"><p>읽는 중인 책이 없어요.</p><button class="btn primary" data-add>책 찾기</button></div>`}
  </section>

  <section class="card daily-cta ${dailyDone ? 'done' : ''}">
    <div class="grow"><b>하루 마무리: 날마다 읽기 대화</b><div class="muted small">${dailyDone ? '오늘의 일일 노트를 저장했어요.' : '5단계 대화로 오늘 독서를 정리하고 100자 요약을 일일 노트로 남겨요.' + (hour >= 20 ? ' 지금 하기 좋은 시간이에요.' : '')}</div></div>
    <button class="btn ${dailyDone ? '' : 'primary'}" data-daily>${dailyDone ? '다시 하기' : '시작'}</button>
  </section>
  `;

  el.querySelectorAll('[data-add]').forEach(b => b.onclick = () => searchModal({ onAdded: bk => go('#/book/' + bk.id) }));
  el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  el.querySelectorAll('[data-timer]').forEach(b => b.onclick = () => go('#/timer/' + b.dataset.timer));
  el.querySelector('[data-daily]').onclick = () => {
    const bid = reading[0]?.id || '';
    go(`#/guide/new/daily${bid ? '?book=' + bid : ''}`);
  };
}
