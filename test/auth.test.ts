import { describe, it, expect, beforeEach } from "vitest";
import os from "node:os"; import fs from "node:fs"; import path from "node:path";
describe("token storage", () => {
  beforeEach(() => { process.env.YOUTUBE_MCP_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "yc-")); });
  it("saves per-channel tokens chmod 600 outside the repo", async () => {
    const a = await import("../src/auth.js");
    a.saveToken("UCabc", { refresh_token: "r" });
    expect(a.listSignedInChannels()).toEqual(["UCabc"]);
    expect(fs.statSync(a.tokenFile("UCabc")).mode & 0o777).toBe(0o600);
    expect(a.tokenFile("UCabc").startsWith(process.cwd())).toBe(false);
  });
  it("errors clearly without client secrets", async () => {
    delete process.env.YOUTUBE_CLIENT_ID; delete process.env.YOUTUBE_CLIENT_SECRET; const a = await import("../src/auth.js");
    expect(() => a.oauthClient()).toThrow(/YOUTUBE_CLIENT_ID/);
  });
});
describe("token removal and manual sign-in", () => {
  it("removeToken deletes a stored token", async () => {
    process.env.YOUTUBE_MCP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "yh-"));
    const a = await import("../src/auth.js");
    a.saveToken("UCdel", { refresh_token: "r" });
    expect(a.removeToken("UCdel")).toBe(true);
    expect(a.listSignedInChannels()).toEqual([]);
    expect(a.removeToken("UCdel")).toBe(false);
    delete process.env.YOUTUBE_MCP_HOME;
  });
});
