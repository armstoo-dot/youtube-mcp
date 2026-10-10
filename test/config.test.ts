import { describe, it, expect } from "vitest";
import os from "node:os"; import fs from "node:fs"; import path from "node:path";
import { parseDotenv, loadConfig, homeDir, enabledGroups, envFiles } from "../src/config.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ymc-"));

describe("config", () => {
  it("parses dotenv with comments, quotes and export", () => {
    expect(parseDotenv(`# c\nexport A=1\nB="two words"\nC='x#y'\nD=val # trailing\nbad line\n`)).toEqual({ A: "1", B: "two words", C: "x#y", D: "val" });
  });
  it("YOUTUBE_MCP_HOME wins, then legacy CONFIG_DIR, then XDG", () => {
    expect(homeDir({ YOUTUBE_MCP_HOME: "/a", YOUTUBE_MCP_CONFIG_DIR: "/b" })).toBe("/a");
    expect(homeDir({ YOUTUBE_MCP_CONFIG_DIR: "/b" })).toBe("/b");
    expect(homeDir({ XDG_CONFIG_HOME: "/x" })).toBe(path.join("/x", "youtube-mcp"));
    expect(homeDir({ YOUTUBE_MCP_HOME: "~/y" })).toBe(path.join(os.homedir(), "y"));
  });
  it("loads client id/secret from <home>/.env without overriding real env", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, ".env"), "YOUTUBE_CLIENT_ID=file-id\nYOUTUBE_CLIENT_SECRET=file-secret\n");
    const env: NodeJS.ProcessEnv = { YOUTUBE_MCP_HOME: d, XDG_CONFIG_HOME: tmp(), YOUTUBE_CLIENT_SECRET: "env-secret" };
    expect(loadConfig(env)).toEqual([path.join(d, ".env")]);
    expect(env.YOUTUBE_CLIENT_ID).toBe("file-id");
    expect(env.YOUTUBE_CLIENT_SECRET).toBe("env-secret");
  });
  it("falls back to the XDG .env and honours YOUTUBE_MCP_ENV_FILE first", () => {
    const x = tmp(); fs.mkdirSync(path.join(x, "youtube-mcp"));
    fs.writeFileSync(path.join(x, "youtube-mcp", ".env"), "YOUTUBE_CLIENT_ID=xdg\n");
    const custom = path.join(tmp(), "my.env"); fs.writeFileSync(custom, "YOUTUBE_CLIENT_ID=custom\n");
    const env: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: x, YOUTUBE_MCP_ENV_FILE: custom };
    expect(envFiles(env)[0]).toBe(custom);
    loadConfig(env); expect(env.YOUTUBE_CLIENT_ID).toBe("custom");
    const env2: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: x }; loadConfig(env2); expect(env2.YOUTUBE_CLIENT_ID).toBe("xdg");
  });
  it("missing files are fine", () => { expect(loadConfig({ YOUTUBE_MCP_HOME: tmp(), XDG_CONFIG_HOME: tmp() })).toEqual([]); });
  it("groups default to read,write; danger only on explicit opt-in", () => {
    expect(enabledGroups({})).toEqual(["read", "write"]);
    expect(enabledGroups({ YOUTUBE_MCP_GROUPS: "read" })).toEqual(["read"]);
    expect(enabledGroups({ YOUTUBE_MCP_GROUPS: " read , WRITE ,danger" })).toEqual(["read", "write", "danger"]);
    expect(enabledGroups({ YOUTUBE_MCP_GROUPS: "bogus" })).toEqual(["read", "write"]);
  });
});
