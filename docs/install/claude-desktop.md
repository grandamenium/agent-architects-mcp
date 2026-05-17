# Claude Desktop Install

1. Get your Agent Architects MCP key from the pinned community post or MCP setup lesson.
2. Open your Claude Desktop config file.

macOS:

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

Windows:

```text
%APPDATA%\Claude\claude_desktop_config.json
```

3. Add this server config:

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
5. Save the file.
6. Fully quit and reopen Claude Desktop.

Try:

```text
Search Agent Architects for lessons about evals and testing agents.
```

If it fails, check [troubleshooting](../troubleshooting.md).
