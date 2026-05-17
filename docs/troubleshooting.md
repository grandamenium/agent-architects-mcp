# Troubleshooting

## The MCP Server Does Not Appear

- Restart your AI client after editing MCP config.
- Make sure your client supports remote HTTP MCP servers.
- Check that the JSON is valid.
- Confirm the server name is inside `mcpServers`.

## 401 Unauthorized

- Make sure the header is exactly:

```text
Authorization: Bearer <YOUR_AA_MCP_KEY>
```

- Replace `<YOUR_AA_MCP_KEY>` with the key from Agent Architects.
- Do not include extra quotes inside the token.
- Ask for a fresh key if yours was rotated.

## JSON Config Error

Common issues:

- Missing comma between MCP servers.
- Curly quotes copied from a rich text editor.
- Extra trailing characters after the JSON block.
- Header placed outside the server config object.

## No Results

- Try a broader query.
- New content may not be indexed yet.
- Exact lesson/member lookups need a recognizable course, lesson, handle, or name.

## Results Seem Stale

The corpus refresh is not real time. New community posts, comments, lessons, or member profile changes may lag behind Skool.

## Still Broken

Open a GitHub issue with:

- Your client name and version.
- The install guide you followed.
- The error message.
- A screenshot with your API key fully hidden.

Never post your actual key.
