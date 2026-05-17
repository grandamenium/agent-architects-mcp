import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { Request } from 'express';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import * as z from 'zod/v4';

const port = Number(process.env.PORT || 3000);
const minSimilarity = Number(process.env.AA_MIN_SIMILARITY || 0.4);
const maxContentChars = Number(process.env.AA_MAX_CONTENT_CHARS || 4000);
const serverVersion = '0.1.0';
const maxRequestBytes = Number(process.env.AA_MAX_REQUEST_BYTES || 32_768);
const rateLimitWindowMs = Number(process.env.AA_RATE_LIMIT_WINDOW_MS || 60_000);
const rateLimitMaxRequests = Number(process.env.AA_RATE_LIMIT_MAX_REQUESTS || 60);

const required = [
  'AA_SUPABASE_URL',
  'AA_SUPABASE_SERVICE_KEY',
  'OPENAI_API_KEY',
  'COMMUNITY_API_KEY',
] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const supabase = createClient(
  process.env.AA_SUPABASE_URL!,
  process.env.AA_SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

type SearchResult = {
  id: string;
  source_type: string;
  source_id: string;
  source_url: string | null;
  content: string;
  chunk_index: number;
  metadata: Record<string, unknown> | null;
  similarity: number;
};

type SourceType = 'lesson' | 'post' | 'comment' | 'member_bio';

type SearchFilters = {
  sourceTypes?: SourceType[];
  course?: string;
  lesson?: string;
  lessonId?: string;
};

type LessonDocument = {
  source_id: string;
  source_url: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
};

type MemberRow = {
  handle: string;
  name: string | null;
  bio: string | null;
  level: number | null;
  join_date: string | null;
  subscription_price: number | null;
  subscription_period: string | null;
  tab: string | null;
  acquisition_source: string | null;
  profile_url: string | null;
  metadata: Record<string, unknown> | null;
  scraped_at: string | null;
};

type PostRow = {
  post_id: string;
  title: string | null;
  post_url: string | null;
  posted_at: string | null;
};

type CommentRow = {
  comment_id: string;
  post_id: string;
  body: string | null;
  posted_at: string | null;
};

type MemberLookupResult = {
  handle: string;
  name: string | null;
  status: string | null;
  status_source?: string;
  status_observed_at?: string | null;
  activity_status?: string | null;
  cancelled_churns_in_days?: number | null;
  churn_date?: string | null;
  level: number | null;
  tier: string | null;
  joined: string | null;
  url: string | null;
  bio: string | null;
  metadata: Record<string, unknown> | null;
  activity?: {
    posts: PostRow[];
    comments: CommentRow[];
  };
};

type MemberSearchResult = Omit<MemberLookupResult, 'bio' | 'activity'> & {
  similarity: number;
  content: string;
  truncated: boolean;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();

function bearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

function validateApiKey(apiKey: string): boolean {
  const provided = Buffer.from(hashApiKey(apiKey), 'hex');
  const expected = Buffer.from(hashApiKey(process.env.COMMUNITY_API_KEY!), 'hex');
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

function clientIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  if (Array.isArray(forwardedFor) && forwardedFor[0]) {
    return forwardedFor[0].split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function requestIdentity(req: Request, token: string): string {
  return `${clientIp(req)}:${hashApiKey(token).slice(0, 16)}`;
}

function isRateLimited(identity: string, now = Date.now()): { limited: boolean; resetAt: number } {
  const existing = rateLimitBuckets.get(identity);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + rateLimitWindowMs;
    rateLimitBuckets.set(identity, { count: 1, resetAt });
    return { limited: false, resetAt };
  }

  existing.count += 1;
  if (existing.count > rateLimitMaxRequests) {
    return { limited: true, resetAt: existing.resetAt };
  }
  return { limited: false, resetAt: existing.resetAt };
}

function pruneRateLimitBuckets(now = Date.now()): void {
  for (const [identity, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(identity);
    }
  }
}

function requestContentLength(req: Request): number | null {
  const raw = req.headers['content-length'];
  if (typeof raw !== 'string') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeHandle(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/^@+/, '');
}

function textMatches(value: unknown, needle: string): boolean {
  if (typeof value !== 'string') return false;
  return normalize(value).includes(normalize(needle));
}

type MemberLikeForTier = Pick<MemberRow, 'subscription_price' | 'subscription_period'>;

function memberTier(member: MemberLikeForTier): string | null {
  if (member.subscription_price === null || member.subscription_price === undefined) return null;
  return `$${member.subscription_price}/${member.subscription_period || 'period'}`;
}

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' ? value : null;
}

function metadataNumber(metadata: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = metadata?.[key];
  return typeof value === 'number' ? value : null;
}

function mapMemberBase(member: MemberRow): MemberLookupResult {
  return {
    handle: member.handle,
    name: member.name,
    status: member.tab,
    status_source: metadataString(member.metadata, 'current_status_source') || 'aa_knowledge_members',
    status_observed_at: metadataString(member.metadata, 'current_status_observed_at') || member.scraped_at || null,
    activity_status: metadataString(member.metadata, 'activity_status') ?? undefined,
    cancelled_churns_in_days: metadataNumber(member.metadata, 'cancelled_churns_in_days') ?? undefined,
    churn_date: metadataString(member.metadata, 'churn_date') ?? undefined,
    level: member.level,
    tier: memberTier(member),
    joined: member.join_date,
    url: member.profile_url || `https://www.skool.com/@${member.handle}`,
    bio: member.bio,
    metadata: member.metadata,
  };
}

function mapMember(
  member: MemberRow,
  activity?: MemberLookupResult['activity'],
): MemberLookupResult {
  return {
    ...mapMemberBase(member),
    ...(activity ? { activity } : {}),
  };
}

function metadataCourse(metadata: Record<string, unknown> | null | undefined): unknown {
  const course = metadata?.course;
  if (typeof course === 'object' && course !== null && 'title' in course) {
    return (course as { title?: unknown }).title;
  }
  return course;
}

function resultMatchesFilters(result: SearchResult, filters: SearchFilters): boolean {
  if (filters.course && !textMatches(metadataCourse(result.metadata), filters.course)) return false;
  if (filters.lesson && !textMatches(result.metadata?.title, filters.lesson)) return false;
  if (filters.lessonId && result.source_id !== filters.lessonId) return false;
  return true;
}

async function searchKnowledgeBase(
  query: string,
  limit: number,
  filters: SearchFilters = {},
): Promise<SearchResult[]> {
  const embedding = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  });

  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: embedding.data[0].embedding,
    match_threshold: minSimilarity,
    match_count: filters.course || filters.lesson || filters.lessonId ? Math.max(limit * 5, 30) : limit,
    filter_source_types: filters.sourceTypes ?? null,
  });

  if (error) {
    throw new Error(`match_documents failed: ${error.message}`);
  }

  const results = (data || []) as SearchResult[];
  return results.filter((result) => resultMatchesFilters(result, filters)).slice(0, limit);
}

async function getLesson(filters: Pick<SearchFilters, 'course' | 'lesson' | 'lessonId'>): Promise<LessonDocument[]> {
  let query = supabase
    .from('documents')
    .select('source_id, source_url, content, metadata')
    .eq('source_type', 'lesson')
    .order('source_id', { ascending: true });

  if (filters.lessonId) {
    query = query.eq('source_id', filters.lessonId);
  }

  const { data, error } = await query.limit(100);
  if (error) {
    throw new Error(`get_lesson failed: ${error.message}`);
  }

  return ((data || []) as LessonDocument[])
    .filter((lesson) => {
      if (filters.course && !textMatches(metadataCourse(lesson.metadata), filters.course)) return false;
      if (filters.lesson && !textMatches(lesson.metadata?.title, filters.lesson)) return false;
      return true;
    })
    .slice(0, 10);
}

async function getMembersByHandles(handles: string[]): Promise<Map<string, MemberRow>> {
  if (handles.length === 0) return new Map();

  const { data, error } = await supabase
    .from('members')
    .select('handle,name,bio,level,join_date,subscription_price,subscription_period,tab,acquisition_source,profile_url,metadata,scraped_at')
    .in('handle', [...new Set(handles)]);

  if (error) {
    throw new Error(`members lookup failed: ${error.message}`);
  }

  return new Map(((data || []) as MemberRow[]).map((member) => [member.handle, member]));
}

async function searchMembers(
  query: string,
  limit: number,
  options: { activeOnly?: boolean; minLevel?: number } = {},
): Promise<MemberSearchResult[]> {
  const candidateLimit = Math.min(Math.max(limit * 5, 20), 50);
  const results = await searchKnowledgeBase(query, candidateLimit, { sourceTypes: ['member_bio'] });
  const handles = results.map((result) => result.source_id);
  const memberMap = await getMembersByHandles(handles);

  const mapped: MemberSearchResult[] = [];
  for (const result of results) {
    const member = memberMap.get(result.source_id);
    if (!member) continue;
    const mappedMember = mapMemberBase(member);
    if (options.activeOnly !== false && mappedMember.status !== 'active') continue;
    if (options.minLevel !== undefined && (mappedMember.level ?? -1) < options.minLevel) continue;

    const { content, truncated } = truncateContent(result.content);
    mapped.push({
      handle: mappedMember.handle,
      name: mappedMember.name,
      status: mappedMember.status,
      status_source: mappedMember.status_source,
      status_observed_at: mappedMember.status_observed_at,
      activity_status: mappedMember.activity_status,
      cancelled_churns_in_days: mappedMember.cancelled_churns_in_days,
      churn_date: mappedMember.churn_date,
      level: mappedMember.level,
      tier: mappedMember.tier,
      joined: mappedMember.joined,
      url: member.profile_url || result.source_url || `https://www.skool.com/@${member.handle}`,
      similarity: result.similarity,
      content,
      truncated,
      metadata: {
        ...(result.metadata || {}),
        member: member.metadata || {},
      },
    });
  }

  return mapped.slice(0, limit);
}

async function getMemberActivity(handle: string): Promise<MemberLookupResult['activity']> {
  const [posts, comments] = await Promise.all([
    supabase
      .from('posts')
      .select('post_id,title,post_url,posted_at')
      .eq('author_handle', handle)
      .order('posted_at', { ascending: false })
      .limit(5),
    supabase
      .from('comments')
      .select('comment_id,post_id,body,posted_at')
      .eq('author_handle', handle)
      .order('posted_at', { ascending: false })
      .limit(5),
  ]);

  if (posts.error) throw new Error(`member posts lookup failed: ${posts.error.message}`);
  if (comments.error) throw new Error(`member comments lookup failed: ${comments.error.message}`);

  return {
    posts: (posts.data || []) as PostRow[],
    comments: (comments.data || []) as CommentRow[],
  };
}

async function getMember(
  filters: { handle?: string; name?: string; includeActivity?: boolean },
): Promise<{ results: MemberLookupResult[]; candidates: MemberLookupResult[] }> {
  let rows: MemberRow[] = [];

  if (filters.handle) {
    const { data, error } = await supabase
      .from('members')
      .select('handle,name,bio,level,join_date,subscription_price,subscription_period,tab,acquisition_source,profile_url,metadata,scraped_at')
      .eq('handle', normalizeHandle(filters.handle))
      .limit(1);
    if (error) throw new Error(`get_member failed: ${error.message}`);
    rows = (data || []) as MemberRow[];
  } else if (filters.name) {
    const { data, error } = await supabase
      .from('members')
      .select('handle,name,bio,level,join_date,subscription_price,subscription_period,tab,acquisition_source,profile_url,metadata,scraped_at')
      .limit(1000);
    if (error) throw new Error(`get_member failed: ${error.message}`);

    const allRows = (data || []) as MemberRow[];
    const normalizedName = normalize(filters.name);
    const exact = allRows.filter((member) => normalize(member.name || '') === normalizedName);
    rows = exact.length > 0
      ? exact
      : allRows.filter((member) => normalize(member.name || '').includes(normalizedName));
  }

  const mapped = await Promise.all(rows.slice(0, 10).map(async (member) => {
    const activity = filters.includeActivity ? await getMemberActivity(member.handle) : undefined;
    return mapMember(member, activity);
  }));

  return {
    results: mapped.length === 1 ? mapped : [],
    candidates: mapped.length === 1 ? [] : mapped,
  };
}

function truncateContent(content: string): { content: string; truncated: boolean } {
  if (content.length <= maxContentChars) {
    return { content, truncated: false };
  }

  return {
    content: `${content.slice(0, maxContentChars).trimEnd()}\n\n[truncated]`,
    truncated: true,
  };
}

function createServer(): McpServer {
  const server = new McpServer({
    name: 'agent-architects-knowledge-base',
    version: serverVersion,
  });

  server.registerTool(
    'search_knowledge_base',
    {
      title: 'Search Agent Architects Knowledge Base',
      description: 'Semantic search over the static Agent Architects knowledge base corpus.',
      inputSchema: {
        query: z.string().min(1).describe('Search query. Ask for concepts, lessons, tools, or implementation details.'),
        limit: z.number().int().min(1).max(20).default(8).describe('Maximum number of relevant chunks to return.'),
        source_types: z.array(z.enum(['lesson', 'post', 'comment', 'member_bio'])).optional()
          .describe('Optional source type filter. Use ["lesson"] when the user wants classroom/course material only.'),
        course: z.string().optional()
          .describe('Optional course title filter, e.g. "Claude Code Fundamentals" or "OpenClaw Fundamentals".'),
        lesson: z.string().optional()
          .describe('Optional lesson title filter, e.g. "7.1 Context Engineering" or "3. Install & Onboard". Use this when the user asks for one specific lesson.'),
        lesson_id: z.string().optional()
          .describe('Optional exact lesson source_id filter. Strongest way to avoid bleed when a lesson id is known.'),
      },
      outputSchema: {
        message: z.string().optional(),
        min_similarity: z.number(),
        results: z.array(z.object({
          title: z.string().nullable(),
          source_type: z.string(),
          source_id: z.string(),
          url: z.string().nullable(),
          similarity: z.number(),
          content: z.string(),
          truncated: z.boolean(),
        })),
      },
    },
    async ({ query, limit, source_types, course, lesson, lesson_id }) => {
      const filters: SearchFilters = {
        sourceTypes: source_types,
        course,
        lesson,
        lessonId: lesson_id,
      };
      const results = await searchKnowledgeBase(query, limit ?? 8, filters);
      const mappedResults = results.map((result) => {
        const { content, truncated } = truncateContent(result.content);
        return {
          title: typeof result.metadata?.title === 'string' ? result.metadata.title : null,
          source_type: result.source_type,
          source_id: result.source_id,
          url: result.source_url,
          similarity: result.similarity,
          content,
          truncated,
        };
      });
      const structuredContent = {
        min_similarity: minSimilarity,
        filters,
        message: mappedResults.length === 0
          ? 'No sufficiently relevant Agent Architects knowledge base results found.'
          : undefined,
        results: mappedResults,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(structuredContent, null, 2),
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    'get_lesson',
    {
      title: 'Get Agent Architects Lesson',
      description: 'Fetch exact classroom lesson text by lesson id, course title, and/or lesson title. Use this instead of semantic search when the user wants results only from one particular lesson.',
      inputSchema: {
        lesson_id: z.string().optional().describe('Exact lesson source_id if known.'),
        course: z.string().optional().describe('Course title filter, e.g. "Claude Code Fundamentals" or "OpenClaw Fundamentals".'),
        lesson: z.string().optional().describe('Lesson title filter, e.g. "7.1 Context Engineering" or "3. Install & Onboard".'),
      },
      outputSchema: {
        message: z.string().optional(),
        results: z.array(z.object({
          title: z.string().nullable(),
          course: z.string().nullable(),
          source_id: z.string(),
          url: z.string().nullable(),
          content: z.string(),
          truncated: z.boolean(),
        })),
      },
    },
    async ({ lesson_id, course, lesson }) => {
      const lessons = await getLesson({ lessonId: lesson_id, course, lesson });
      const mappedResults = lessons.map((result) => {
        const { content, truncated } = truncateContent(result.content);
        return {
          title: typeof result.metadata?.title === 'string' ? result.metadata.title : null,
          course: typeof metadataCourse(result.metadata) === 'string' ? metadataCourse(result.metadata) as string : null,
          source_id: result.source_id,
          url: result.source_url,
          content,
          truncated,
        };
      });
      const structuredContent = {
        message: mappedResults.length === 0
          ? 'No matching Agent Architects lesson found. Try a shorter lesson title or provide lesson_id.'
          : undefined,
        results: mappedResults,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(structuredContent, null, 2),
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    'search_members',
    {
      title: 'Search Agent Architects Members',
      description: 'Find Agent Architects community members by background, niche, skills, or use case. Use this instead of broad semantic search when the user asks who to meet, which members fit a domain, or asks for member profiles only.',
      inputSchema: {
        query: z.string().min(1).describe('Member search query, e.g. "marketers implementing AI" or "fitness health performance coach".'),
        limit: z.number().int().min(1).max(20).default(8).describe('Maximum number of member profiles to return.'),
        active_only: z.boolean().default(true).describe('When true, return only active members. Set false if churned/inactive historical profiles are acceptable.'),
        min_level: z.number().int().min(1).max(10).optional().describe('Optional minimum Skool member level.'),
      },
      outputSchema: {
        message: z.string().optional(),
        filters: z.object({
          source_types: z.array(z.string()),
          active_only: z.boolean(),
          min_level: z.number().optional(),
        }),
        results: z.array(z.object({
          handle: z.string(),
          name: z.string().nullable(),
          status: z.string().nullable(),
          status_source: z.string().optional(),
          status_observed_at: z.string().nullable().optional(),
          activity_status: z.string().nullable().optional(),
          cancelled_churns_in_days: z.number().nullable().optional(),
          churn_date: z.string().nullable().optional(),
          level: z.number().nullable(),
          tier: z.string().nullable(),
          joined: z.string().nullable(),
          url: z.string().nullable(),
          similarity: z.number(),
          content: z.string(),
          truncated: z.boolean(),
          metadata: z.record(z.string(), z.unknown()).nullable(),
        })),
      },
    },
    async ({ query, limit, active_only, min_level }) => {
      const results = await searchMembers(query, limit ?? 8, {
        activeOnly: active_only ?? true,
        minLevel: min_level,
      });
      const structuredContent = {
        filters: {
          source_types: ['member_bio'],
          active_only: active_only ?? true,
          min_level,
        },
        message: results.length === 0
          ? 'No matching Agent Architects member profiles found. Try a broader query or set active_only=false.'
          : undefined,
        results,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(structuredContent, null, 2),
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    'get_member',
    {
      title: 'Get Agent Architects Member',
      description: 'Fetch an exact Agent Architects member profile by handle or name. Use this instead of semantic search when the user asks about a specific member.',
      inputSchema: {
        handle: z.string().optional().describe('Exact Skool handle, with or without @, e.g. "@roberto-cellini-6004".'),
        name: z.string().optional().describe('Member display name. If multiple people match, candidates are returned instead of guessing.'),
        include_activity: z.boolean().default(false).describe('When true, include up to 5 recent posts and 5 recent comments from this member.'),
      },
      outputSchema: {
        message: z.string().optional(),
        results: z.array(z.object({
          handle: z.string(),
          name: z.string().nullable(),
          status: z.string().nullable(),
          status_source: z.string().optional(),
          status_observed_at: z.string().nullable().optional(),
          activity_status: z.string().nullable().optional(),
          cancelled_churns_in_days: z.number().nullable().optional(),
          churn_date: z.string().nullable().optional(),
          level: z.number().nullable(),
          tier: z.string().nullable(),
          joined: z.string().nullable(),
          url: z.string().nullable(),
          bio: z.string().nullable(),
          metadata: z.record(z.string(), z.unknown()).nullable(),
          activity: z.object({
            posts: z.array(z.object({
              post_id: z.string(),
              title: z.string().nullable(),
              post_url: z.string().nullable(),
              posted_at: z.string().nullable(),
            })),
            comments: z.array(z.object({
              comment_id: z.string(),
              post_id: z.string(),
              body: z.string().nullable(),
              posted_at: z.string().nullable(),
            })),
          }).optional(),
        })),
        candidates: z.array(z.object({
          handle: z.string(),
          name: z.string().nullable(),
          status: z.string().nullable(),
          status_source: z.string().optional(),
          status_observed_at: z.string().nullable().optional(),
          activity_status: z.string().nullable().optional(),
          cancelled_churns_in_days: z.number().nullable().optional(),
          churn_date: z.string().nullable().optional(),
          level: z.number().nullable(),
          tier: z.string().nullable(),
          joined: z.string().nullable(),
          url: z.string().nullable(),
          bio: z.string().nullable(),
          metadata: z.record(z.string(), z.unknown()).nullable(),
        })),
      },
    },
    async ({ handle, name, include_activity }) => {
      if (!handle && !name) {
        const structuredContent = {
          message: 'Provide either handle or name.',
          results: [],
          candidates: [],
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      }

      const lookup = await getMember({
        handle,
        name,
        includeActivity: include_activity ?? false,
      });
      const structuredContent = {
        message: lookup.results.length === 0 && lookup.candidates.length === 0
          ? 'No matching Agent Architects member found. Try an exact handle, including the numeric suffix.'
          : lookup.candidates.length > 1
            ? 'Multiple members matched. Use a handle to fetch one exact profile.'
            : undefined,
        results: lookup.results,
        candidates: lookup.candidates,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(structuredContent, null, 2),
          },
        ],
        structuredContent,
      };
    },
  );

  return server;
}

const app = createMcpExpressApp({ host: '0.0.0.0' });

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'aa-mcp-server' });
});

app.get('/version', (_req, res) => {
  res.json({
    service: 'aa-mcp-server',
    version: serverVersion,
    transport: 'streamable-http',
    tools: ['search_knowledge_base', 'get_lesson', 'search_members', 'get_member'],
    corpus: 'aa-knowledge',
  });
});

app.post('/mcp', async (req, res) => {
  const token = bearerToken(req.headers.authorization);
  if (!token || !validateApiKey(token)) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized' },
      id: null,
    });
    return;
  }

  const contentLength = requestContentLength(req);
  if (contentLength !== null && contentLength > maxRequestBytes) {
    res.status(413).json({
      jsonrpc: '2.0',
      error: { code: -32013, message: 'Request too large' },
      id: null,
    });
    return;
  }

  pruneRateLimitBuckets();
  const rateLimit = isRateLimited(requestIdentity(req, token));
  res.setHeader('X-RateLimit-Limit', String(rateLimitMaxRequests));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(rateLimit.resetAt / 1000)));
  if (rateLimit.limited) {
    res.status(429).json({
      jsonrpc: '2.0',
      error: { code: -32029, message: 'Too many requests' },
      id: null,
    });
    return;
  }

  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request failed', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  } finally {
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
  }
});

app.get('/mcp', (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Use POST /mcp for Streamable HTTP MCP requests.' },
    id: null,
  });
});

app.delete('/mcp', (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`AA MCP server listening on port ${port}`);
});
