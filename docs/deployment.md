# Deployment

The production Agent Architects MCP server is hosted on Railway.

## Required Environment Variables

```text
AA_SUPABASE_URL=
AA_SUPABASE_SERVICE_KEY=
OPENAI_API_KEY=
COMMUNITY_API_KEY=
```

Optional:

```text
AA_MIN_SIMILARITY=0.4
AA_MAX_CONTENT_CHARS=4000
AA_MAX_REQUEST_BYTES=32768
AA_RATE_LIMIT_WINDOW_MS=60000
AA_RATE_LIMIT_MAX_REQUESTS=60
```

## Build

```bash
npm ci
npm run typecheck
npm run build
```

## Railway

1. Create a Railway service from this repo.
2. Add the required environment variables in Railway.
3. Deploy from the main branch.
4. Verify:

```bash
curl https://aa-mcp-server-production.up.railway.app/health
curl https://aa-mcp-server-production.up.railway.app/version
```

5. Run the production smoke suite:

```bash
AA_MCP_TEST_KEY=<YOUR_AA_MCP_KEY> npm run test:production-smoke
```

## Rollback

Use Railway's deployment rollback if a release fails smoke tests.
