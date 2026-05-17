# Agent Architects MCP

Search Agent Architects lessons, posts, comments, and member profiles directly from your AI client.

This is a read-only remote MCP server. It lets compatible clients query the Agent Architects knowledge base, but it cannot change your Skool account, post on your behalf, or modify the community.

## Quick Install

Get your Agent Architects MCP key from the pinned community post or setup lesson inside Agent Architects. Do not paste your key into public GitHub issues.

```json
{
  "mcpServers": {
    "agent-architects": {
      "url": "https://aa-mcp-server-production.up.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_AA_MCP_KEY>"
      }
    }
  }
}
```

Restart your MCP client after saving the config.

## Supported Clients

- Claude Desktop
- Claude Code
- Cursor
- Windsurf
- Any client that supports remote HTTP MCP servers with bearer headers

Client-specific guides:

- [Claude Desktop](docs/install/claude-desktop.md)
- [Claude Code](docs/install/claude-code.md)
- [Cursor](docs/install/cursor.md)
- [Windsurf](docs/install/windsurf.md)

## Tools

- `search_knowledge_base`: broad semantic search across lessons, posts, comments, and member profiles.
- `get_lesson`: exact classroom lesson lookup by course, lesson, or lesson id.
- `search_members`: find members by niche, skill, role, or background.
- `get_member`: exact member lookup by handle or name.

Full tool guide: [docs/tools.md](docs/tools.md)

## Try These Prompts

```text
Search Agent Architects for lessons about evals and testing agents.
```

```text
Get the Claude Code Fundamentals lesson on context engineering.
```

```text
Who in Agent Architects is good with sales?
```

```text
Find posts or comments about Windows setup issues with CortextOS.
```

```text
Which members should I meet if I run a marketing agency and want to implement AI?
```

More examples: [examples/prompts.md](examples/prompts.md)

## Production Endpoints

- MCP: `https://aa-mcp-server-production.up.railway.app/mcp`
- Health: `https://aa-mcp-server-production.up.railway.app/health`
- Version: `https://aa-mcp-server-production.up.railway.app/version`

## Notes

- This is read-only.
- The corpus refresh is not real time. Brand-new posts, comments, lessons, or member updates may lag.
- The public repo never contains the real shared community key.
- The current launch access model uses one shared Agent Architects community key.

## Local Development

```bash
npm ci
npm run typecheck
npm run build
```

Run locally:

```bash
cp .env.example .env
# fill required values
npm run dev
```

Run production smoke tests:

```bash
AA_MCP_TEST_KEY=<YOUR_AA_MCP_KEY> npm run test:production-smoke
```

## Deployment

The production service is hosted on Railway. See [docs/deployment.md](docs/deployment.md).

## Troubleshooting

See [docs/troubleshooting.md](docs/troubleshooting.md).

## Security

Do not post API keys, bearer tokens, Supabase credentials, Railway tokens, or OpenAI keys in GitHub issues. See [SECURITY.md](SECURITY.md).
