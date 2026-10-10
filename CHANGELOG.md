# Changelog

## 0.2.0 (unreleased)
- Auth: `auth --manual` / `--headless` mode (sign in on any device, paste the redirect URL or code), `--redirect` / `YOUTUBE_AUTH_REDIRECT`, `auth --list`, `auth --remove <channelId>`, `--port`.
- `youtube-mcp auth` subcommand on the main binary (works through `npx`).
- Config: client id/secret from env or a `.env` file (`$YOUTUBE_MCP_ENV_FILE`, `$YOUTUBE_MCP_HOME/.env`, `$XDG_CONFIG_HOME/youtube-mcp/.env`). `YOUTUBE_MCP_HOME` sets the token dir (`YOUTUBE_MCP_CONFIG_DIR` still works).
- **Breaking default:** `YOUTUBE_MCP_GROUPS` now defaults to `read,write`. `danger` needs an explicit opt-in.
- Packaging: npm metadata, `bin`, `files`, `prepare` build, `engines`.
- Docs, SECURITY, CONTRIBUTING, CI.

## 0.1.0
- Initial server: read/write/danger tools, loopback OAuth per channel, quota guard.
