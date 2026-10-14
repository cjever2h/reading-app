-- 독서앱 스키마 (Supabase / Postgres)
-- 모든 테이블은 user_id 기준 RLS로 본인 데이터만 접근 가능

create extension if not exists pgcrypto;

-- 책
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  isbn13 text,
  title text not null,
  author text,
  publisher text,
  pub_date text,
  cover_url text,
  pages int,
  aladin_category text,
  aladin_link text,
  description text,
  toc text,
  source text,                       -- aladin | google | manual
  genre text check (genre in ('경제·투자','인문·철학','역사·역사소설','자기계발·심리','소설·스릴러')),
  status text not null default 'reading' check (status in ('want','reading','done')),
  start_date date,
  finish_date date,
  rating numeric(2,1) check (rating between 0 and 5),
  reason text,
  tags text[] not null default '{}',
  goal jsonb,                        -- 독서 목표: period, reason, change, plan
  pre_questions jsonb,               -- 읽기 전 질문: expect, doubt, connect
  current_page int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists books_user_idx on public.books(user_id);

-- 독서 세션 (타이머)
create table if not exists public.reading_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  seconds int not null default 0,     -- 일시정지를 뺀 순수 읽은 시간
  start_page int,
  end_page int,
  photo_path text,                    -- storage photos 버킷 경로 (선택)
  memo text,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on public.reading_sessions(user_id, started_at);

-- 문장
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  session_id uuid references public.reading_sessions(id) on delete set null,
  body text not null,
  page int,
  memo text,
  memo_type text check (memo_type in ('공감','의문','연결')),
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quotes_user_idx on public.quotes(user_id, book_id);

-- 노트 (읽기 전 / 일일 / 챕터별 / 자유)
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id uuid references public.books(id) on delete cascade,
  kind text not null default 'free' check (kind in ('pre','daily','chapter','free')),
  title text,
  body text not null default '',
  note_date date not null default current_date,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_user_idx on public.notes(user_id, book_id);

-- 완독 정리 (72시간 루틴)
create table if not exists public.summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id uuid not null unique references public.books(id) on delete cascade,
  one_line text,
  key_quotes jsonb not null default '[]',   -- [{text, page, reason}]
  concepts text[] not null default '{}',    -- 핵심 개념 태그 5개 내외
  action_item text,
  thesis text,                              -- 논지 압축 (내가 쓴 핵심 3가지)
  feynman text,                             -- 파인만 설명
  content_used jsonb not null default '{}', -- {blog, card, threads, club}
  written_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 액션 아이템 30일 실험
create table if not exists public.action_experiments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  action text not null,
  plan jsonb,                         -- {principle, translate, when, where, amount}
  start_date date not null default current_date,
  checks jsonb not null default '{}', -- {"2026-10-15": true}
  result_memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 복습 항목 (D+1 / D+3 / D+7)
create table if not exists public.review_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  stage text not null check (stage in ('D+1','D+3','D+7')),
  due_date date not null,
  done boolean not null default false,
  response jsonb,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, stage)
);

-- 가이드 대화
create table if not exists public.guide_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id uuid references public.books(id) on delete cascade,
  mode text not null check (mode in ('pre','during','daily','after','apply','card')),
  messages jsonb not null default '[]',   -- [{role:'guide'|'user'|'ai', text, step}]
  step int not null default 0,
  summary text,                           -- 100자 요약
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 사용자 설정
create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  nickname text,
  show_nickname boolean not null default true,
  cross_book boolean not null default false,  -- 타 책과의 교차 분석 (기본 꺼짐)
  yearly_goal int default 24,
  custom_prompts jsonb not null default '{}',
  notion_token text,
  notion_parent text,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 태그: 문장과 노트의 tags 배열을 하나로 모아보는 뷰
create or replace view public.tag_index with (security_invoker = on) as
  select user_id, unnest(tags) as name, 'quote'::text as source, id as item_id, book_id from public.quotes
  union all
  select user_id, unnest(tags) as name, 'note'::text as source, id as item_id, book_id from public.notes;

-- RLS
do $$
declare t text;
begin
  foreach t in array array['books','reading_sessions','quotes','notes','summaries','action_experiments','review_tasks','guide_sessions','settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- 스토리지: 페이지 사진 (비공개, 본인 폴더만)
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict (id) do nothing;
drop policy if exists "photos own select" on storage.objects;
drop policy if exists "photos own insert" on storage.objects;
drop policy if exists "photos own update" on storage.objects;
drop policy if exists "photos own delete" on storage.objects;
create policy "photos own select" on storage.objects for select to authenticated using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos own insert" on storage.objects for insert to authenticated with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos own update" on storage.objects for update to authenticated using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos own delete" on storage.objects for delete to authenticated using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
