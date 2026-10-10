import { describe, it, expect, vi, beforeEach } from "vitest";
import os from "node:os"; import fs from "node:fs"; import path from "node:path";
import { tools, runTool, type Deps } from "../src/tools.js";
import { QuotaTracker, cost } from "../src/quota.js";

const CH = "UCpersonal000000000000", BR = "UCbrand0000000000000000";
function mockDeps(limit = 10000) {
  const yt = {
    channels: { list: vi.fn(async () => ({ data: { items: [{ id: CH, contentDetails: { relatedPlaylists: { uploads: "UUx" } }, brandingSettings: { channel: { description: "old" } } }] } })), update: vi.fn(async () => ({ data: { ok: 1 } })) },
    playlistItems: { list: vi.fn(async () => ({ data: { items: [{ id: "v1" }] } })), insert: vi.fn(async () => ({ data: {} })) },
    videos: { list: vi.fn(async () => ({ data: { items: [{ snippet: { title: "T", description: "D", categoryId: "22" } }] } })), update: vi.fn(async () => ({ data: {} })), insert: vi.fn(async () => ({ data: { id: "new" } })), delete: vi.fn(async () => ({ data: "" })) },
    playlists: { list: vi.fn(async () => ({ data: { items: [] } })), insert: vi.fn(async () => ({ data: {} })) },
    commentThreads: { list: vi.fn(async () => ({ data: { items: [] } })) },
  };
  const an = { reports: { query: vi.fn(async () => ({ data: { rows: [[1]] } })) } };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "q-")), "ledger.json");
  const d: Deps = { youtube: () => yt, analytics: () => an, signedInChannels: () => [CH, BR], quota: new QuotaTracker(file, limit, 500) };
  return { d, yt, an, file };
}

describe("tool registry", () => {
  it("has the required read/write/danger tools", () => {
    const names = tools.map(t => t.name);
    for (const n of ["list_channels","list_videos","get_video","list_playlists","list_comments","get_analytics","update_video_metadata","upload_video","schedule_video","set_thumbnail","create_playlist","update_playlist","add_to_playlist","reply_to_comment","danger_publish_video","danger_delete_video","danger_delete_playlist","danger_delete_comment","danger_update_channel_settings"]) expect(names).toContain(n);
    for (const t of tools) expect(t.name.startsWith("danger_")).toBe(t.group === "danger");
    for (const t of tools.filter(t => t.group === "danger")) { expect(t.description).toMatch(/explicit OK/); expect(t.shape.confirm).toBeDefined(); }
  });
});

describe("read tools", () => {
  it("list_channels queries every signed-in channel", async () => {
    const { d, yt } = mockDeps();
    const r: any = await runTool("list_channels", d, {});
    expect(yt.channels.list).toHaveBeenCalledTimes(2); expect(r).toHaveLength(2);
  });
  it("list_videos uses uploads playlist (cheap)", async () => {
    const { d, yt } = mockDeps();
    await runTool("list_videos", d, { channel_id: CH });
    expect(yt.playlistItems.list).toHaveBeenCalledWith(expect.objectContaining({ playlistId: "UUx" }));
    expect(d.quota.used()).toBe(2);
  });
  it("get_analytics hits Analytics API", async () => {
    const { d, an } = mockDeps();
    await runTool("get_analytics", d, { channel_id: CH, start_date: "2026-09-01", end_date: "2026-09-30" });
    expect(an.reports.query).toHaveBeenCalledWith(expect.objectContaining({ ids: "channel==MINE" }));
  });
  it("rejects channels that are not signed in", async () => {
    const { d } = mockDeps();
    await expect(runTool("get_video", d, { channel_id: "UCother", video_id: "x" })).rejects.toThrow(/not signed in/);
  });
});

describe("safe writes", () => {
  it("upload_video refuses public", async () => {
    const { d } = mockDeps();
    await expect(runTool("upload_video", d, { channel_id: CH, file_path: "/etc/hostname", title: "t", privacy_status: "public" })).rejects.toThrow();
  });
  it("upload_video uploads private and charges 1600", async () => {
    const { d, yt } = mockDeps();
    const f = path.join(os.tmpdir(), "v.mp4"); fs.writeFileSync(f, "x");
    await runTool("upload_video", d, { channel_id: CH, file_path: f, title: "t" });
    expect((yt.videos.insert.mock.calls[0] as any)[0].requestBody.status.privacyStatus).toBe("private");
    expect(d.quota.used()).toBe(1600);
  });
  it("schedule_video sets private + publishAt and rejects past dates", async () => {
    const { d, yt } = mockDeps();
    await runTool("schedule_video", d, { channel_id: CH, video_id: "v", publish_at: "2099-01-01T10:00:00+03:00" });
    expect((yt.videos.update.mock.calls[0] as any)[0].requestBody.status).toEqual({ privacyStatus: "private", publishAt: "2099-01-01T07:00:00.000Z" });
    await expect(runTool("schedule_video", d, { channel_id: CH, video_id: "v", publish_at: "2000-01-01T10:00:00+03:00" })).rejects.toThrow(/future/);
  });
  it("update_video_metadata keeps unspecified fields", async () => {
    const { d, yt } = mockDeps();
    await runTool("update_video_metadata", d, { channel_id: CH, video_id: "v", title: "New" });
    expect((yt.videos.update.mock.calls[0] as any)[0].requestBody.snippet).toMatchObject({ title: "New", description: "D", categoryId: "22" });
  });
});

describe("danger tools", () => {
  it("refuse without confirm:true", async () => {
    const { d, yt } = mockDeps();
    await expect(runTool("danger_delete_video", d, { channel_id: CH, video_id: "v" })).rejects.toThrow(/confirm/);
    await expect(runTool("danger_publish_video", d, { channel_id: CH, video_id: "v", confirm: false })).rejects.toThrow();
    expect(yt.videos.delete).not.toHaveBeenCalled(); expect(yt.videos.update).not.toHaveBeenCalled();
  });
  it("run with confirm:true", async () => {
    const { d, yt } = mockDeps();
    await runTool("danger_publish_video", d, { channel_id: CH, video_id: "v", confirm: true });
    expect((yt.videos.update.mock.calls[0] as any)[0].requestBody.status.privacyStatus).toBe("public");
  });
});

describe("quota", () => {
  it("costs", () => { expect(cost("videos.insert")).toBe(1600); expect(cost("videos.list")).toBe(1); expect(cost("videos.update")).toBe(50); });
  it("refuses near the limit and logs a ledger", async () => {
    const { d, file } = mockDeps(2000);
    const f = path.join(os.tmpdir(), "v2.mp4"); fs.writeFileSync(f, "x");
    await expect(runTool("upload_video", d, { channel_id: CH, file_path: f, title: "t" })).rejects.toThrow(/Quota guard/);
    await runTool("get_video", d, { channel_id: BR, video_id: "v" });
    const l = JSON.parse(fs.readFileSync(file, "utf8")); expect(l.used).toBe(1); expect(l.calls[0].channel).toBe(BR);
    expect((fs.statSync(file).mode & 0o777)).toBe(0o600);
  });
});
