# Cursor Install

1. Get your Agent Architects MCP key from the pinned community post or MCP setup lesson.
2. Open Cursor MCP settings.
3. Add the Agent Architects remote MCP server:

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

4. Replace `<YOUR_AA_MCP_KEY>` with your key.
5. Restart Cursor.

Try:

```text
Search Agent Architects for lessons about evals and testing agents.
```

If Cursor does not show the server, confirm your Cursor version supports remote HTTP MCP servers.
