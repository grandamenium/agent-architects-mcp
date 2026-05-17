# Windsurf Install

1. Get your Agent Architects MCP key from the pinned community post or MCP setup lesson.
2. Open Windsurf MCP settings.
3. Add this remote MCP server:

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
5. Restart Windsurf.

Try:

```text
Who in Agent Architects is good with sales?
```

If Windsurf does not show the server, confirm your Windsurf version supports remote HTTP MCP servers.
