-- Prac-sys 練習紀錄（Supabase / Postgres）
-- 在 Supabase 的 SQL Editor 貼上整份執行一次即可；可重複執行。
--
-- 網站是 GitHub Pages 純靜態頁，用 anon（publishable）金鑰連線，金鑰會公開在網頁裡。
-- 因此資料表全部開 RLS 且「不給任何 policy」：瀏覽器不能直接讀寫資料表，
-- 只能呼叫下面幾個函式（security definer），每個函式只做它該做的事。
--
-- 學生只用名字登入（沒有密碼）：知道名字就能用那個名字練習。學生的 id（uuid）由登入函式發給瀏覽器。
-- 老師總覽要密碼：執行完後用下面這行設定（換成你自己的密碼）：
--   select pracsys_set_teacher_key('換成老師密碼');

create extension if not exists pgcrypto;

create table if not exists pracsys_student (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    name_key    text not null unique,                 -- 比對用：去頭尾空白、壓縮空白、小寫
    scope       jsonb not null default '[]'::jsonb,   -- 練習範圍：單元鍵陣列
    created_at  timestamptz not null default now()
);

-- 一個學生一天一列；items 是當天 20 題與作答：[{q, unit, type, r, ok, at}]
create table if not exists pracsys_set (
    student_id  uuid not null references pracsys_student(id) on delete cascade,
    day         date not null,
    scope       jsonb not null,
    items       jsonb not null,
    updated_at  timestamptz not null default now(),
    primary key (student_id, day)
);

-- 爬山高度（0～1，熟練度換算，由學生的網頁算好後回存；排行榜與爬山畫面用）
alter table pracsys_student add column if not exists climb_height real not null default 0;
alter table pracsys_student add column if not exists climb_at timestamptz;

create table if not exists pracsys_config (
    key    text primary key,
    value  text not null
);

alter table pracsys_student enable row level security;
alter table pracsys_set     enable row level security;
alter table pracsys_config  enable row level security;
revoke all on pracsys_student, pracsys_set, pracsys_config from anon, authenticated;

create or replace function pracsys_norm(p text) returns text language sql immutable as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;

-- 用名字登入（沒有就建立），回傳學生資料
create or replace function pracsys_login(p_name text, p_default_scope jsonb default '[]'::jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  n text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  s pracsys_student;
begin
  if char_length(n) < 1 or char_length(n) > 20 then
    raise exception '名字請填 1～20 個字';
  end if;
  insert into pracsys_student (name, name_key, scope)
  values (n, pracsys_norm(n), coalesce(p_default_scope, '[]'::jsonb))
  on conflict (name_key) do nothing;
  select * into s from pracsys_student where name_key = pracsys_norm(n);
  return json_build_object('id', s.id, 'name', s.name, 'scope', s.scope);
end $$;

-- 登入畫面的名字選單：只回傳名字
create or replace function pracsys_names()
returns json language sql stable security definer set search_path = public, extensions as $$
  select coalesce(json_agg(name order by name), '[]'::json) from pracsys_student
$$;

-- 讀一個學生的資料與全部練習
create or replace function pracsys_get(p_student uuid)
returns json language sql stable security definer set search_path = public, extensions as $$
  select json_build_object(
    'id', s.id, 'name', s.name, 'scope', s.scope,
    'sets', coalesce((select json_object_agg(d.day::text, json_build_object('scope', d.scope, 'items', d.items))
                      from pracsys_set d where d.student_id = s.id), '{}'::json))
  from pracsys_student s where s.id = p_student
$$;

create or replace function pracsys_save_scope(p_student uuid, p_scope jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if jsonb_typeof(p_scope) <> 'array' or jsonb_array_length(p_scope) > 50 then
    raise exception 'scope 格式不對';
  end if;
  update pracsys_student set scope = p_scope where id = p_student;
end $$;

-- 存一天的練習（整列覆寫）
create or replace function pracsys_save_set(p_student uuid, p_day date, p_scope jsonb, p_items jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from pracsys_student where id = p_student) then
    raise exception '找不到這位學生';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 or pg_column_size(p_items) > 65536 then
    raise exception 'items 格式不對';
  end if;
  if p_day < current_date - 2 or p_day > current_date + 2 then
    raise exception '只能存最近的練習';
  end if;
  insert into pracsys_set (student_id, day, scope, items, updated_at)
  values (p_student, p_day, p_scope, p_items, now())
  on conflict (student_id, day) do update set scope = excluded.scope, items = excluded.items, updated_at = now();
end $$;

-- 回存爬山高度
create or replace function pracsys_save_height(p_student uuid, p_height real)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_height is null or p_height < 0 or p_height > 1 then
    raise exception 'height 格式不對';
  end if;
  update pracsys_student set climb_height = p_height, climb_at = now() where id = p_student;
end $$;

-- 排行榜（公開）：每人只回傳名字、期間內作答題數、達標天數、爬山高度，不含作答細節
create or replace function pracsys_board(p_from date, p_to date, p_goal int default 10, p_rest int[] default '{4}')
returns json language sql stable security definer set search_path = public, extensions as $$
  with per_day as (
    select d.student_id, d.day,
           (select count(*) from jsonb_array_elements(d.items) e
             where jsonb_typeof(e->'ok') = 'boolean') as n
    from pracsys_set d where d.day between p_from and p_to
  )
  select coalesce(json_agg(json_build_object(
    'name', s.name, 'height', s.climb_height,
    'done', coalesce((select sum(n) from per_day x where x.student_id = s.id), 0),
    'goalDays', coalesce((select count(*) from per_day x where x.student_id = s.id and x.n >= p_goal
                          and extract(dow from x.day)::int <> all(p_rest)), 0)
  ) order by s.name), '[]'::json)
  from pracsys_student s
$$;

-- 老師總覽：全部學生與全部練習（要老師密碼）
create or replace function pracsys_overview(p_key text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare h text;
begin
  select value into h from pracsys_config where key = 'teacher_key';
  if h is null or crypt(coalesce(p_key, ''), h) <> h then
    raise exception '密碼不對';
  end if;
  return coalesce((
    select json_agg(json_build_object(
      'id', s.id, 'name', s.name, 'scope', s.scope,
      'sets', coalesce((select json_object_agg(d.day::text, json_build_object('scope', d.scope, 'items', d.items))
                        from pracsys_set d where d.student_id = s.id), '{}'::json)) order by s.name)
    from pracsys_student s), '[]'::json);
end $$;

-- 設定老師密碼（只能在 SQL Editor 用管理身分執行，網頁呼叫不到）
create or replace function pracsys_set_teacher_key(p_key text)
returns void language sql security definer set search_path = public, extensions as $$
  insert into pracsys_config (key, value) values ('teacher_key', crypt(p_key, gen_salt('bf')))
  on conflict (key) do update set value = excluded.value
$$;

-- Supabase 預設會把 public schema 新建的函式直接授權給 anon、authenticated，
-- 所以除了 public 也要明確收回，否則網頁也能呼叫 pracsys_set_teacher_key 改掉老師密碼
revoke all on function pracsys_save_height(uuid, real), pracsys_board(date, date, int, int[]),
  pracsys_norm(text), pracsys_names(), pracsys_login(text, jsonb), pracsys_get(uuid), pracsys_save_scope(uuid, jsonb),
  pracsys_save_set(uuid, date, jsonb, jsonb), pracsys_overview(text), pracsys_set_teacher_key(text)
  from public, anon, authenticated;
grant execute on function pracsys_save_height(uuid, real), pracsys_board(date, date, int, int[]), pracsys_names(), pracsys_login(text, jsonb), pracsys_get(uuid), pracsys_save_scope(uuid, jsonb),
  pracsys_save_set(uuid, date, jsonb, jsonb), pracsys_overview(text) to anon, authenticated;
