#!/usr/bin/env node
import path from "node:path";
import { createRequire } from "node:module";
import { google } from "googleapis";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, enabledGroups } from "./config.js";
import { authFor, configDir, listSignedInChannels } from "./auth.js";
import { runAuthCli } from "./auth-cli.js";
import { QuotaTracker } from "./quota.js";
import { tools, runTool, type Deps } from "./tools.js";

loadConfig();
const argv = process.argv.slice(2);
if (argv[0] === "auth") {
  try { await runAuthCli(argv.slice(1)); process.exit(0); }
  catch (e: any) { console.error(e?.message ?? e); process.exit(1); }
}
if (argv[0] === "--help" || argv[0] === "-h") {
  console.log("youtube-mcp              start the MCP server on stdio\nyoutube-mcp auth --help  sign in / list / remove channels");
  process.exit(0);
}

const deps: Deps = {
  youtube: id => google.youtube({ version: "v3", auth: authFor(id) }),
  analytics: id => google.youtubeAnalytics({ version: "v2", auth: authFor(id) }),
  signedInChannels: listSignedInChannels,
  quota: new QuotaTracker(path.join(configDir(), "quota-ledger.json"), Number(process.env.YOUTUBE_DAILY_QUOTA || 10000), Number(process.env.YOUTUBE_QUOTA_RESERVE || 500)),
};
const enabled: string[] = enabledGroups();
const version: string = createRequire(import.meta.url)("../package.json").version;
const server = new McpServer({ name: "youtube-mcp", version });
for (const t of tools.filter(t => enabled.includes(t.group))) {
  server.registerTool(t.name, { description: `[${t.group}] ${t.description}`, inputSchema: t.shape,
    annotations: { readOnlyHint: t.group === "read", destructiveHint: t.group === "danger" } },
    async (args: any) => {
      try { return { content: [{ type: "text" as const, text: JSON.stringify(await runTool(t.name, deps, args), null, 2) }] }; }
      catch (e: any) { return { isError: true, content: [{ type: "text" as const, text: String(e?.message ?? e) }] }; }
    });
}
await server.connect(new StdioServerTransport());
