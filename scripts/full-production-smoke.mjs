import assert from 'node:assert/strict';

const baseUrl = process.env.AA_MCP_TEST_BASE_URL || 'https://aa-mcp-server-production.up.railway.app';
const mcpUrl = `${baseUrl.replace(/\/$/, '')}/mcp`;
const apiKey = process.env.AA_MCP_TEST_KEY || process.env.COMMUNITY_API_KEY;

if (!apiKey) {
  throw new Error('Set AA_MCP_TEST_KEY or COMMUNITY_API_KEY.');
}

function parseSse(text) {
  const dataLine = text
    .split(/\r?\n/)
    .find((line) => line.startsWith('data: '));
  if (!dataLine) throw new Error(`No SSE data line in response: ${text.slice(0, 500)}`);
  return JSON.parse(dataLine.slice('data: '.length));
}

async function mcp(method, params, id, key = apiKey) {
  const response = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });

  const text = await response.text();
  assert.equal(response.status, 200, `${method} failed: ${text}`);
  assert.ok(response.headers.get('x-ratelimit-limit'), `${method} should include rate-limit headers`);
  const parsed = parseSse(text);
  if (parsed.error) throw new Error(`${method} error: ${JSON.stringify(parsed.error)}`);
  return parsed.result;
}

async function callTool(name, args, id) {
  const result = await mcp('tools/call', { name, arguments: args }, id);
  assert.equal(result.isError, undefined, `${name} returned MCP error: ${JSON.stringify(result)}`);
  assert.ok(result.structuredContent, `${name} should return structuredContent`);
  return result.structuredContent;
}

async function unauthorizedCheck() {
  const response = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  assert.equal(response.status, 401, 'Missing bearer token should return 401');

  const wrong = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer wrong-key',
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  assert.equal(wrong.status, 401, 'Wrong bearer token should return 401');
}

async function requestSizeCheck() {
  const largeQuery = 'x'.repeat(40_000);
  const response = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
      params: { largeQuery },
    }),
  });
  assert.equal(response.status, 413, 'Oversized requests should return 413');
}

const report = [];
function pass(name, details = '') {
  report.push({ name, status: 'PASS', details });
  console.log(`PASS ${name}${details ? ` - ${details}` : ''}`);
}

const health = await fetch(`${baseUrl.replace(/\/$/, '')}/health`);
assert.equal(health.status, 200, 'Health endpoint should return 200');
assert.deepEqual(await health.json(), { ok: true, service: 'aa-mcp-server' });
pass('health');

const version = await fetch(`${baseUrl.replace(/\/$/, '')}/version`);
assert.equal(version.status, 200, 'Version endpoint should return 200');
const versionJson = await version.json();
assert.equal(versionJson.service, 'aa-mcp-server');
assert.equal(versionJson.corpus, 'aa-knowledge');
assert.ok(versionJson.tools.includes('search_knowledge_base'));
pass('version endpoint', versionJson.version);

await unauthorizedCheck();
pass('auth rejects missing/wrong bearer tokens');

await requestSizeCheck();
pass('request size limit rejects oversized bodies');

const tools = await mcp('tools/list', {}, 10);
const toolNames = new Set(tools.tools.map((tool) => tool.name));
for (const expected of ['search_knowledge_base', 'get_lesson', 'search_members', 'get_member']) {
  assert.equal(toolNames.has(expected), true, `tools/list missing ${expected}`);
}
pass('tools/list exposes all expected tools', [...toolNames].join(', '));

const broad = await callTool('search_knowledge_base', {
  query: 'windows cortextOS install WSL PowerShell Claude Code',
  limit: 8,
}, 20);
assert.ok(broad.results.length >= 3, 'Broad search should return several results');
assert.ok(
  broad.results.some((result) => ['post', 'comment', 'lesson', 'member_bio'].includes(result.source_type)),
  'Broad search should include source typed results',
);
pass('broad search', `${broad.results.length} results`);

const lesson = await callTool('get_lesson', {
  course: 'Claude Code Fundamentals',
  lesson: '7.1 Context Engineering',
}, 30);
assert.equal(lesson.results.length, 1, 'get_lesson should return exactly one result for 7.1');
assert.equal(lesson.results[0].title, '7.1 Context Engineering');
assert.equal(lesson.results[0].course, 'Claude Code Fundamentals');
pass('get_lesson exact retrieval', lesson.results[0].source_id);

const lessonScoped = await callTool('search_knowledge_base', {
  query: 'context engineering trunk branch leaf skills memory',
  limit: 5,
  source_types: ['lesson'],
  course: 'Claude Code Fundamentals',
  lesson: '7.1 Context Engineering',
}, 31);
assert.ok(lessonScoped.results.length >= 1, 'Scoped lesson search should return at least one result');
assert.equal(
  lessonScoped.results.every((result) => result.source_type === 'lesson' && result.title === '7.1 Context Engineering'),
  true,
  'Scoped lesson search should not bleed into posts/comments/other lessons',
);
pass('lesson-scoped search has no bleed', `${lessonScoped.results.length} result(s)`);

const openClawLesson = await callTool('get_lesson', {
  course: 'OpenClaw Fundamentals',
  lesson: '3. Install & Onboard',
}, 32);
assert.equal(openClawLesson.results.length, 1);
assert.equal(openClawLesson.results[0].title, '3. Install & Onboard');
pass('get_lesson OpenClaw lesson');

const members = await callTool('search_members', {
  query: 'sales business development outbound lead generation closing CRM sales automation account executive sales systems member profile',
  limit: 8,
}, 40);
assert.ok(members.results.length > 0, 'search_members should return member profiles');
assert.equal(
  members.results.every((result) => result.status === 'active' && result.content.includes('Member profile:')),
  true,
  'search_members default should return active member profile content only',
);
assert.ok(
  members.results.some((result) => ['luke-stevens-3238', 'sascha-guck-4456', 'barry-brooks-8718', 'dovid-thomas-1795'].includes(result.handle)),
  'Sales query should return at least one known sales-related active member',
);
pass('search_members active member-only search', members.results.map((result) => result.handle).join(', '));

const membersWithInactive = await callTool('search_members', {
  query: 'fitness health performance coach',
  limit: 10,
  active_only: false,
}, 41);
assert.ok(membersWithInactive.results.length > 0);
assert.equal(
  membersWithInactive.results.every((result) => result.handle && result.content.includes('Member profile:')),
  true,
  'active_only=false should still return member profile content only',
);
pass('search_members active_only=false');

const member = await callTool('get_member', {
  handle: '@roberto-cellini-6004',
  include_activity: true,
}, 50);
assert.equal(member.results.length, 1, 'get_member should return exact handle match');
assert.equal(member.results[0].handle, 'roberto-cellini-6004');
assert.ok(member.results[0].activity, 'include_activity should include activity object');
assert.ok(member.results[0].activity.posts.length <= 5);
assert.ok(member.results[0].activity.comments.length <= 5);
pass('get_member exact handle + bounded activity');

const missingMember = await callTool('get_member', {
  handle: '@not-a-real-aa-member',
}, 51);
assert.equal(missingMember.results.length, 0);
assert.equal(missingMember.candidates.length, 0);
assert.match(missingMember.message, /No matching/);
pass('get_member missing member clean response');

const noArgsMember = await callTool('get_member', {}, 52);
assert.equal(noArgsMember.results.length, 0);
assert.match(noArgsMember.message, /Provide either handle or name/);
pass('get_member validates handle or name');

const invalidTool = await mcp('tools/call', {
  name: 'search_members',
  arguments: { query: 'sales', limit: 1000 },
}, 60);
assert.equal(invalidTool.isError, true, 'Invalid limit should return MCP tool validation error');
pass('schema validation rejects invalid limit');

console.log('\nSUMMARY');
for (const item of report) {
  console.log(`${item.status} ${item.name}${item.details ? `: ${item.details}` : ''}`);
}
