-- AA MCP Phase 1.2 schema
create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists members (
  id uuid default gen_random_uuid() primary key,
  handle text unique not null,
  name text,
  bio text,
  level integer,
  join_date date,
  subscription_price numeric,
  subscription_period text,
  tab text,
  acquisition_source text,
  profile_url text,
  social_links jsonb default '{}'::jsonb,
  metadata jsonb default '{}'::jsonb,
  content_hash text,
  scraped_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists posts (
  id uuid default gen_random_uuid() primary key,
  post_id text unique not null,
  author_handle text references members(handle) on update cascade on delete set null,
  title text,
  body text,
  channel text,
  post_url text,
  posted_at timestamptz,
  likes integer,
  comment_count integer,
  metadata jsonb default '{}'::jsonb,
  content_hash text,
  scraped_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists comments (
  id uuid default gen_random_uuid() primary key,
  comment_id text unique not null,
  post_id text references posts(post_id) on update cascade on delete cascade,
  author_handle text references members(handle) on update cascade on delete set null,
  body text,
  posted_at timestamptz,
  likes integer,
  metadata jsonb default '{}'::jsonb,
  content_hash text,
  scraped_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists lessons (
  id uuid default gen_random_uuid() primary key,
  lesson_id text unique not null,
  module_title text,
  lesson_title text,
  body text,
  transcript text,
  lesson_url text,
  metadata jsonb default '{}'::jsonb,
  content_hash text,
  scraped_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists embeddings (
  id uuid default gen_random_uuid() primary key,
  source_type text not null check (source_type in ('post', 'comment', 'lesson', 'member_bio')),
  source_id text not null,
  source_url text,
  chunk_text text not null,
  chunk_index integer not null default 0,
  embedding vector(1536),
  embedding_model text not null default 'text-embedding-3-small',
  embedding_dimensions integer not null default 1536,
  content_hash text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (source_type, source_id, chunk_index, embedding_model)
);

-- Alias table for generic vector-store language requested by Phase 1.2.
create table if not exists documents (
  id uuid default gen_random_uuid() primary key,
  source_type text not null check (source_type in ('post', 'comment', 'lesson', 'member_bio')),
  source_id text not null,
  source_url text,
  content text not null,
  chunk_index integer not null default 0,
  embedding vector(1536),
  embedding_model text not null default 'text-embedding-3-small',
  embedding_dimensions integer not null default 1536,
  content_hash text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (source_type, source_id, chunk_index, embedding_model)
);

create index if not exists members_handle_idx on members(handle);
create index if not exists posts_posted_at_idx on posts(posted_at desc);
create index if not exists posts_author_handle_idx on posts(author_handle);
create index if not exists comments_post_id_idx on comments(post_id);
create index if not exists lessons_module_title_idx on lessons(module_title);
create index if not exists embeddings_source_idx on embeddings(source_type, source_id);
create index if not exists documents_source_idx on documents(source_type, source_id);

-- HNSW is preferred for incrementally changing corpora; only indexes non-null vectors.
create index if not exists embeddings_embedding_hnsw_idx on embeddings using hnsw (embedding vector_cosine_ops) where embedding is not null;
create index if not exists documents_embedding_hnsw_idx on documents using hnsw (embedding vector_cosine_ops) where embedding is not null;

create table if not exists api_keys (
  id uuid default gen_random_uuid() primary key,
  key_hash text unique not null,
  member_handle text,
  label text,
  created_at timestamptz default now(),
  last_used_at timestamptz,
  revoked boolean default false
);

alter table members enable row level security;
alter table posts enable row level security;
alter table comments enable row level security;
alter table lessons enable row level security;
alter table embeddings enable row level security;
alter table documents enable row level security;
alter table api_keys enable row level security;

-- Public read for content queried by the MCP server. api_keys intentionally has no anon policy.
do $$ begin
  create policy public_read_members on members for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy public_read_posts on posts for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy public_read_comments on comments for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy public_read_lessons on lessons for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy public_read_embeddings on embeddings for select to anon using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy public_read_documents on documents for select to anon using (true);
exception when duplicate_object then null; end $$;

create or replace function match_embeddings(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10,
  filter_source_types text[] default null
)
returns table (
  id uuid,
  source_type text,
  source_id text,
  source_url text,
  chunk_text text,
  chunk_index integer,
  metadata jsonb,
  similarity float
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    e.id,
    e.source_type,
    e.source_id,
    e.source_url,
    e.chunk_text,
    e.chunk_index,
    e.metadata,
    1 - (e.embedding <=> query_embedding) as similarity
  from embeddings e
  where e.embedding is not null
    and (filter_source_types is null or e.source_type = any(filter_source_types))
    and 1 - (e.embedding <=> query_embedding) >= match_threshold
  order by e.embedding <=> query_embedding
  limit least(match_count, 50);
$$;

create or replace function match_documents(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10,
  filter_source_types text[] default null
)
returns table (
  id uuid,
  source_type text,
  source_id text,
  source_url text,
  content text,
  chunk_index integer,
  metadata jsonb,
  similarity float
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    d.id,
    d.source_type,
    d.source_id,
    d.source_url,
    d.content,
    d.chunk_index,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from documents d
  where d.embedding is not null
    and (filter_source_types is null or d.source_type = any(filter_source_types))
    and 1 - (d.embedding <=> query_embedding) >= match_threshold
  order by d.embedding <=> query_embedding
  limit least(match_count, 50);
$$;
