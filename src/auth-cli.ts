#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { interactiveSignIn, listSignedInChannels, removeToken, tokenDir } from "./auth.js";

export const AUTH_HELP = `youtube-mcp auth [options]

  (no option)          Sign in with a local loopback redirect (needs a browser on this machine)
  --manual, --headless Print the URL; sign in on any device; paste the redirect URL or code back
  --redirect <url>     Non-interactive: exchange an already-obtained redirect URL / code
                       (or set YOUTUBE_AUTH_REDIRECT)
  --port <n>           Loopback port (default 53682 or YOUTUBE_AUTH_PORT)
  --list               List signed-in channel ids
  --remove <channelId> Delete the stored token for a channel
  -h, --help           Show this help`;

export interface AuthArgs { mode: "signin" | "list" | "remove" | "help"; manual: boolean; port?: number; redirect?: string; channel?: string; }

export function parseAuthArgs(argv: string[]): AuthArgs {
  const a: AuthArgs = { mode: "signin", manual: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i], next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${x} needs a value`); return v; };
    if (x === "--manual" || x === "--headless" || x === "--no-browser") a.manual = true;
    else if (x === "--list" || x === "list") a.mode = "list";
    else if (x === "--remove" || x === "remove") { a.mode = "remove"; a.channel = next(); }
    else if (x === "--port") { a.port = Number(next()); if (!Number.isInteger(a.port)) throw new Error("--port must be a number"); }
    else if (x === "--redirect") a.redirect = next();
    else if (x === "-h" || x === "--help") a.mode = "help";
    else throw new Error(`Unknown option ${x}\n\n${AUTH_HELP}`);
  }
  return a;
}

export async function runAuthCli(argv: string[]) {
  loadConfig();
  const a = parseAuthArgs(argv);
  if (a.mode === "help") { console.log(AUTH_HELP); return; }
  if (a.mode === "list") {
    const ids = listSignedInChannels();
    console.log(ids.length ? ids.join("\n") : `No channels signed in (${tokenDir()}).`); return;
  }
  if (a.mode === "remove") {
    if (!removeToken(a.channel!)) throw new Error(`No token for ${a.channel}.`);
    console.log(`Removed token for ${a.channel}. (To fully revoke, also remove the app at https://myaccount.google.com/permissions)`); return;
  }
  await interactiveSignIn({ manual: a.manual, port: a.port, redirectInput: a.redirect });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAuthCli(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1); });
}
