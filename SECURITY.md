# Security Policy

## Reporting a vulnerability

Please **don't** open a public issue. Use GitHub's private [security advisory](https://github.com/armstoo-dot/youtube-mcp/security/advisories/new) form instead. You'll get a reply within 7 days.

## Scope and design

- No credentials are bundled. Each user supplies their own Google OAuth Desktop client.
- OAuth refresh tokens are stored locally per channel (`$YOUTUBE_MCP_HOME/tokens`, mode 600) and only sent to Google.
- Public or irreversible actions are isolated in the opt-in `danger` group and require `confirm: true`.

If you think a token or client secret was leaked, revoke the app at https://myaccount.google.com/permissions, delete the token with `youtube-mcp auth --remove <channelId>`, and rotate the client secret in Google Cloud Console.
