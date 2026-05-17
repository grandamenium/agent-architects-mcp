# Claude Code Install

Get your Agent Architects MCP key from the pinned community post or MCP setup lesson.

## Option 1: Add JSON Config

```bash
claude mcp add-json agent-architects '{"type":"http","url":"https://aa-mcp-server-production.up.railway.app/mcp","headers":{"Authorization":"Bearer <YOUR_AA_MCP_KEY>"}}'
```

Replace `<YOUR_AA_MCP_KEY>` with your key.

Then open Claude Code and run:

```text
/mcp
```

Use the MCP status view to confirm `agent-architects` is connected.

## Option 2: Add HTTP Server, Then Configure Auth

Some Claude Code versions support:

```bash
claude mcp add --transport http agent-architects https://aa-mcp-server-production.up.railway.app/mcp
```

If your version does not attach bearer headers through that command, use Option 1.

## Test Prompt

```text
Search Agent Architects for lessons about evals and testing agents.
```

If tools do not appear, restart Claude Code.
