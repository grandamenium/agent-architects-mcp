import assert from 'node:assert/strict';

const url = process.env.AA_MCP_TEST_URL || 'http://127.0.0.1:3001/mcp';
const apiKey = process.env.AA_MCP_TEST_KEY || process.env.COMMUNITY_API_KEY;

if (!apiKey) {
  throw new Error('Set AA_MCP_TEST_KEY or COMMUNITY_API_KEY before running member tool smoke tests.');
}

function parseSse(text) {
  const dataLine = text
    .split(/\r?\n/)
    .find((line) => line.startsWith('data: '));
  if (!dataLine) throw new Error(`No SSE data line in response: ${text.slice(0, 500)}`);
  return JSON.parse(dataLine.slice('data: '.length));
}

async function mcp(method, params, id) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });

  const text = await response.text();
  assert.equal(response.status, 200, text);
  const parsed = parseSse(text);
  if (parsed.error) throw new Error(JSON.stringify(parsed.error));
  return parsed.result;
}

async function callTool(name, args, id) {
  const result = await mcp('tools/call', { name, arguments: args }, id);
  assert.equal(result.isError, undefined, JSON.stringify(result));
  return result.structuredContent;
}

const tools = await mcp('tools/list', {}, 1);
const names = new Set(tools.tools.map((tool) => tool.name));
assert.equal(names.has('search_members'), true, 'tools/list should expose search_members');
assert.equal(names.has('get_member'), true, 'tools/list should expose get_member');

const memberSearch = await callTool('search_members', {
  query: 'fitness health performance coach',
  limit: 5,
}, 2);
assert.equal(memberSearch.filters.source_types[0], 'member_bio');
assert.equal(memberSearch.filters.active_only, true);
assert.ok(memberSearch.results.length > 0, 'search_members should return at least one active profile');
assert.equal(
  memberSearch.results.every((result) => result.handle && result.content.includes('Member profile:')),
  true,
  'search_members should return member profile content only',
);
assert.equal(
  memberSearch.results.every((result) => result.status === 'active'),
  true,
  'active_only default should exclude non-active members',
);

const inactiveAllowed = await callTool('search_members', {
  query: 'fitness health performance coach',
  limit: 10,
  active_only: false,
}, 3);
assert.ok(
  inactiveAllowed.results.some((result) => result.status !== 'active') || inactiveAllowed.results.length >= memberSearch.results.length,
  'active_only=false should broaden or preserve member search results',
);

const exactMember = await callTool('get_member', {
  handle: '@roberto-cellini-6004',
  include_activity: true,
}, 4);
assert.equal(exactMember.results.length, 1);
assert.equal(exactMember.results[0].handle, 'roberto-cellini-6004');
assert.ok(exactMember.results[0].activity, 'include_activity should add bounded activity');
assert.ok(exactMember.results[0].activity.posts.length <= 5);
assert.ok(exactMember.results[0].activity.comments.length <= 5);

const missingMember = await callTool('get_member', {
  handle: '@definitely-not-a-real-aa-member',
}, 5);
assert.equal(missingMember.results.length, 0);
assert.equal(missingMember.candidates.length, 0);
assert.match(missingMember.message, /No matching/);

console.log('member MCP tool smoke tests passed');
