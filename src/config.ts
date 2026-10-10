import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Group = "read" | "write" | "danger";
const expand = (p: string) => p.replace(/^~(?=$|[\\/])/, os.homedir());

/** Directory for tokens, quota ledger and the optional .env file.
 *  Order: YOUTUBE_MCP_HOME, YOUTUBE_MCP_CONFIG_DIR (legacy), $XDG_CONFIG_HOME/youtube-mcp, ~/.config/youtube-mcp. */
export function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  const d = env.YOUTUBE_MCP_HOME || env.YOUTUBE_MCP_CONFIG_DIR
    || path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "youtube-mcp");
  return expand(d);
}

/** Minimal dotenv parser: KEY=VALUE, # comments, optional quotes, optional `export `. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    const q = v.match(/^(['"])(.*)\1$/);
    if (q) v = q[2]; else v = v.replace(/\s+#.*$/, "").trim();
    out[m[1]] = v;
  }
  return out;
}

/** Candidate .env files, highest priority first. */
export function envFiles(env: NodeJS.ProcessEnv = process.env): string[] {
  const files = [env.YOUTUBE_MCP_ENV_FILE && expand(env.YOUTUBE_MCP_ENV_FILE), path.join(homeDir(env), ".env"),
    path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "youtube-mcp", ".env")].filter(Boolean) as string[];
  return [...new Set(files)];
}

/** Load config files into env without overriding variables that are already set (real env always wins). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  const loaded: string[] = [];
  for (const f of envFiles(env)) {
    let text: string;
    try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
    for (const [k, v] of Object.entries(parseDotenv(text))) if (env[k] === undefined || env[k] === "") env[k] = v;
    loaded.push(f);
  }
  return loaded;
}

/** Enabled tool groups. Default read,write. `danger` only when explicitly listed. */
export function enabledGroups(env: NodeJS.ProcessEnv = process.env): Group[] {
  const raw = (env.YOUTUBE_MCP_GROUPS || "read,write").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const valid = raw.filter((g): g is Group => g === "read" || g === "write" || g === "danger");
  return valid.length ? [...new Set(valid)] : ["read", "write"];
}
