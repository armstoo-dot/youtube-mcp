# youtube-mcp

An [MCP](https://modelcontextprotocol.io) server (stdio) that lets AI assistants such as Claude Desktop, Cursor and other MCP clients manage your YouTube channels, including **Brand Account** channels. It uses the official **YouTube Data API v3** and **YouTube Analytics API** with your own Google OAuth client.

- Multiple channels at once: one sign-in per channel (personal or Brand Account), and every tool targets exactly one `channel_id`.
- Sign-in that works anywhere. The default is loopback on a desktop. There's also a **headless/phone mode**: sign in on any device and paste the redirect URL back.
- Safe by default. Write tools never make anything public. Publish, delete and settings tools sit in a separate `danger` group that is **off unless you opt in** and also need `confirm: true`.
- A built-in **quota guard** tracks the 10,000 units/day budget locally and refuses calls that would blow it.
- Tokens are stored per channel with `chmod 600`, outside the repo.

## Tools

| Group | Tool | What it does | Approx. quota |
|---|---|---|---|
| read | `list_channels` | Signed-in channels with stats | 1 each |
| read | `list_videos` | Uploads of a channel | 1–2 |
| read | `get_video` | Full video details | 1 |
| read | `list_playlists` | Playlists of a channel | 1 |
| read | `list_comments` | Comment threads (channel or video) | 1 |
| read | `get_analytics` | YouTube Analytics report (views, watch time, …) | Analytics quota |
| read | `quota_status` | Units used today / remaining | 0 |
| write | `update_video_metadata` | Title, description, tags, category (never privacy) | 51 |
| write | `upload_video` | Upload a local file as **private or unlisted** | ~1,600 |
| write | `schedule_video` | Set a private video to auto-publish at a time | 51 |
| write | `set_thumbnail` | Custom thumbnail | 50 |
| write | `create_playlist` / `update_playlist` / `add_to_playlist` | Manage playlists | 50 |
| write | `reply_to_comment` | Reply as the channel (publicly visible) | 50 |
| danger | `danger_publish_video` | Make a video **public** now | 51 |
| danger | `danger_delete_video` | Delete a video (irreversible) | 50 |
| danger | `danger_delete_playlist` | Delete a playlist | 50 |
| danger | `danger_delete_comment` | Delete a comment | 50 |
| danger | `danger_update_channel_settings` | Change channel description, keywords, country, language | 51 |

### The `danger` group

These tools are public or irreversible. They are **not registered** unless `YOUTUBE_MCP_GROUPS` includes `danger`. Even then, each call must pass `confirm: true`, and the tool descriptions tell the model to get the channel owner's explicit OK first. MCP annotations mark them `destructiveHint: true`, so clients that support it will prompt you. A good pattern is to leave `danger` off and turn it on only for a session where you need it.

`schedule_video` and `reply_to_comment` are in `write`, but they lead to public visibility (a timed go-live, a public reply). Review them in your client if that matters to you.

### Quota

The default project quota is **10,000 units per day**, resetting at midnight Pacific Time. A single upload costs ~1,600 units, so with the default 500-unit reserve that's **about 6 uploads per day**. Reads cost 1 unit. The server keeps a local ledger at `$YOUTUBE_MCP_HOME/quota-ledger.json` and refuses calls that would exceed `YOUTUBE_DAILY_QUOTA − YOUTUBE_QUOTA_RESERVE`. The ledger is an estimate, so the Google Cloud console is the source of truth. You can request more quota from Google.

## Setup

### 1. Create a Google Cloud OAuth client (about 10 minutes, once)

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a new project (any name).
2. Enable both APIs for it: [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) and [YouTube Analytics API](https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com). No billing is needed.
3. Open the **OAuth consent screen** (now called *Google Auth Platform*) and tap **Get started**. Fill in an app name and your support email, choose Audience **External**, add your contact email and **Create**.
4. Under **Data Access**, add these scopes: `.../auth/youtube`, `.../auth/youtube.upload`, `.../auth/youtube.force-ssl`, `.../auth/yt-analytics.readonly`.
5. Under **Audience**, add your Google account as a test user, then choose **Publish app**.
   > While the app is in *Testing*, Google expires refresh tokens after **7 days**. Publishing (you don't need verification for personal use) avoids that. You'll see an "unverified app" warning at sign-in: tap **Advanced → Go to <app name>**.
6. Under **Clients** (Credentials), choose **Create OAuth client**, type **Desktop app**, then **Create**. Keep the Client ID and Client secret.

### 2. Give the server your client credentials

Put them in a config file so you don't need a wrapper script. It's read from the first of these that exists, and real environment variables always win:

1. `$YOUTUBE_MCP_ENV_FILE`
2. `$YOUTUBE_MCP_HOME/.env`
3. `$XDG_CONFIG_HOME/youtube-mcp/.env` (default `~/.config/youtube-mcp/.env`)

```bash
mkdir -p ~/.config/youtube-mcp && chmod 700 ~/.config/youtube-mcp
cat > ~/.config/youtube-mcp/.env <<'ENV'
YOUTUBE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=xxxxxxxx
ENV
chmod 600 ~/.config/youtube-mcp/.env
```

You can also pass `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` through your MCP client's `env` block.

### 3. Sign in once per channel

```bash
npx -y github:armstoo-dot/youtube-mcp auth            # desktop with a browser (loopback)
npx -y github:armstoo-dot/youtube-mcp auth --manual   # headless server / SSH / phone
```

(From a clone, use `npm run auth -- --manual`.)

**Loopback (default):** the CLI prints a URL and listens on `http://127.0.0.1:53682/callback`. Open the URL in a browser on the same machine, sign in, pick the channel, and you're done.

**Manual / headless / phone:** the CLI prints the URL. Open it on **any device**, even your phone, sign in and approve. The browser then lands on a page at `127.0.0.1` that **fails to load. That's expected.** Copy the full address from the address bar (it starts with `http://127.0.0.1:53682/callback?code=`), or just the `code` value, and paste it at the prompt.
- On iPhone, the YouTube app may hijack Google links. Paste the URL into a Safari **Private** tab instead.
- You can do it non-interactively: `youtube-mcp auth --redirect '<pasted url>'` or `YOUTUBE_AUTH_REDIRECT='<url>' youtube-mcp auth`.
- Codes are single-use and expire within minutes, so paste promptly.

**Brand Account channels:** run `auth` again and pick the Brand Account in Google's "Choose an account or brand account" screen. Each channel gets its own token file, named by channel id.

```bash
youtube-mcp auth --list               # signed-in channel ids
youtube-mcp auth --remove UCxxxxxxxx  # delete a stored token
youtube-mcp auth --help
```

To fully revoke access, also remove the app at <https://myaccount.google.com/permissions>.

## Install in an MCP client

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "youtube": {
      "command": "npx",
      "args": ["-y", "github:armstoo-dot/youtube-mcp"],
      "env": { "YOUTUBE_MCP_GROUPS": "read,write" }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "youtube": {
      "command": "npx",
      "args": ["-y", "github:armstoo-dot/youtube-mcp"],
      "env": { "YOUTUBE_MCP_GROUPS": "read,write" }
    }
  }
}
```

### Other clients / from source

Any stdio MCP client works. Run the command `youtube-mcp` (or `node /path/to/youtube-mcp/dist/index.js`).

```bash
git clone https://github.com/armstoo-dot/youtube-mcp && cd youtube-mcp
npm ci && npm run build && npm test
node dist/index.js        # stdio server
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | none | Desktop OAuth client (env or `.env` file) |
| `YOUTUBE_MCP_HOME` | `$XDG_CONFIG_HOME/youtube-mcp` or `~/.config/youtube-mcp` | Tokens, quota ledger, `.env`. `YOUTUBE_MCP_CONFIG_DIR` is accepted as a legacy alias |
| `YOUTUBE_MCP_ENV_FILE` | none | Explicit `.env` path (highest priority) |
| `YOUTUBE_MCP_GROUPS` | `read,write` | Comma list of `read`, `write`, `danger` |
| `YOUTUBE_DAILY_QUOTA` | `10000` | Your project's daily units |
| `YOUTUBE_QUOTA_RESERVE` | `500` | Units held back |
| `YOUTUBE_AUTH_PORT` | `53682` | Loopback redirect port |
| `YOUTUBE_AUTH_REDIRECT` | none | Pre-supplied redirect URL or code for non-interactive auth |

## Security notes

- Bring your own OAuth client. No credentials ship with this package.
- Refresh tokens grant full management of the channel. They're stored as `$YOUTUBE_MCP_HOME/tokens/<channelId>.json`, mode `600`, in a `700` directory. Never commit them, and keep the folder off synced or shared drives.
- The `.gitignore` excludes `.env`, `tokens/`, `client_secret*.json` and the quota ledger.
- Keep `danger` off by default, and give the model only the groups it needs (`YOUTUBE_MCP_GROUPS=read` for analysis-only agents).
- `upload_video` and `set_thumbnail` read local files at paths the model supplies, so run the server as a user that can only read what you'd be happy to upload.
- See [SECURITY.md](SECURITY.md) to report vulnerabilities.

## Limits

- Unverified apps are capped at 100 users. That's fine for personal use, but verify the app if you distribute a shared client.
- Uploads from unverified API projects may be locked to private by YouTube until the project passes an [audit](https://support.google.com/youtube/contact/yt_api_form).
- Quota tracking is local and approximate. Captions, live streaming, Shorts-specific endpoints, community posts and monetisation aren't covered.
- Brand Accounts need one sign-in each. Channels you manage only as a channel *manager* (not owner) appear only if Google's picker offers them.

## License

[MIT](LICENSE) © 2026 Armstrong Kiprotich
