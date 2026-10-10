import fs from "node:fs";
import readline from "node:readline/promises";
import path from "node:path";
import http from "node:http";
import { google } from "googleapis";

export const SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

import { homeDir } from "./config.js";
import { parseAuthInput } from "./manual.js";

export const configDir = () => homeDir();
export const tokenDir = () => path.join(configDir(), "tokens");
export const tokenFile = (channelId: string) => path.join(tokenDir(), `${channelId.replace(/[^\w-]/g, "")}.json`);

export function oauthClient(redirectUri?: string) {
  const id = process.env.YOUTUBE_CLIENT_ID, secret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!id || !secret) throw new Error(`YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET not set. Put them in the environment or in ${path.join(configDir(), ".env")} (see README); never commit them or paste them in chat.`);
  return new google.auth.OAuth2(id, secret, redirectUri);
}

/** One refresh token per signed-in channel (each Brand Account is a separate sign-in). */
export function listSignedInChannels(): string[] {
  try { return fs.readdirSync(tokenDir()).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)); } catch { return []; }
}
export function saveToken(channelId: string, tokens: object) {
  fs.mkdirSync(tokenDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(tokenFile(channelId), JSON.stringify(tokens), { mode: 0o600 });
  fs.chmodSync(tokenFile(channelId), 0o600);
}
export function authFor(channelId: string) {
  const f = tokenFile(channelId);
  if (!fs.existsSync(f)) throw new Error(`No token for channel ${channelId}. Run: npm run auth (and pick that channel in Google's account picker). Signed in: ${listSignedInChannels().join(", ") || "none"}`);
  const c = oauthClient();
  c.setCredentials(JSON.parse(fs.readFileSync(f, "utf8")));
  c.on("tokens", t => saveToken(channelId, { ...JSON.parse(fs.readFileSync(f, "utf8")), ...t }));
  return c;
}

export function removeToken(channelId: string): boolean {
  const f = tokenFile(channelId);
  if (!fs.existsSync(f)) return false;
  fs.unlinkSync(f); return true;
}

export interface SignInOptions { manual?: boolean; port?: number; redirectInput?: string; ask?: (q: string) => Promise<string>; log?: (s: string) => void; }

async function promptLine(q: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try { return await rl.question(q); } finally { rl.close(); }
}

/** One-time sign-in per channel. Google's picker lets you choose the personal channel or a Brand Account.
 *  loopback (default): a local server on 127.0.0.1 catches the redirect.
 *  manual/headless: sign in on any device; the browser lands on a failing 127.0.0.1 page; paste that URL (or the code). */
export async function interactiveSignIn(opts: SignInOptions = {}) {
  const log = opts.log ?? ((s: string) => console.error(s));
  const port = opts.port ?? Number(process.env.YOUTUBE_AUTH_PORT || 53682);
  const redirect = `http://127.0.0.1:${port}/callback`;
  const client = oauthClient(redirect);
  const url = client.generateAuthUrl({ access_type: "offline", prompt: "consent select_account", scope: SCOPES });
  const preset = opts.redirectInput ?? process.env.YOUTUBE_AUTH_REDIRECT;
  let code: string;
  if (opts.manual || preset) {
    if (!preset) {
      log("Manual sign-in. Open this URL on any device (phone is fine), sign in and pick the channel:\n\n" + url +
        "\n\nAfter approving, the browser will show a \"can't connect\" page at 127.0.0.1. That's expected.\nCopy the FULL address from the address bar (or just the code= value) and paste it below.\n");
    }
    code = parseAuthInput(preset ?? await (opts.ask ?? promptLine)("Redirect URL or code: "));
  } else {
    log("Open this URL, sign in and choose the channel (personal or Brand Account):\n\n" + url +
      `\n\nWaiting for the redirect on ${redirect} ... (no local browser? rerun with --manual)`);
    code = await new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        const u = new URL(req.url || "/", redirect);
        if (u.pathname !== "/callback") { res.statusCode = 404; res.end(); return; }
        const c = u.searchParams.get("code");
        res.end(c ? "Signed in. You can close this tab." : "No code received.");
        srv.close(); c ? resolve(c) : reject(new Error(u.searchParams.get("error") || "no code"));
      });
      srv.on("error", reject);
      srv.listen(port, "127.0.0.1");
    });
  }
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const yt = google.youtube({ version: "v3", auth: client });
  const r = await yt.channels.list({ part: ["snippet"], mine: true });
  const ch = r.data.items?.[0];
  if (!ch?.id) throw new Error("Signed in, but no YouTube channel on this identity.");
  saveToken(ch.id, tokens);
  log(`Saved token for "${ch.snippet?.title}" (${ch.id}) at ${tokenFile(ch.id)} (chmod 600).`);
  return { channelId: ch.id, title: ch.snippet?.title ?? "" };
}
