import fs from "node:fs";
import { z } from "zod";
import type { QuotaTracker } from "./quota.js";

export interface Deps {
  youtube(channelId: string): any;     // google.youtube v3 client authed for that channel
  analytics(channelId: string): any;   // google.youtubeAnalytics v2 client
  signedInChannels(): string[];
  quota: QuotaTracker;
}
export type Group = "read" | "write" | "danger";
export interface ToolDef { name: string; group: Group; description: string; shape: z.ZodRawShape; handler(d: Deps, a: any): Promise<unknown>; }

const ch = z.string().describe("Target channel id (UC...). Each call acts on exactly one channel.");
const confirm = z.literal(true).describe("Must be true. Only pass after the channel owner has explicitly approved this exact action.");
const DANGER = "DANGEROUS / PUBLIC: requires the channel owner's explicit OK before calling. ";
const SAFE_PRIVACY = z.enum(["private", "unlisted"]);

async function call(d: Deps, op: string, channel: string, fn: () => Promise<any>) {
  d.quota.charge(op, channel);
  const r = await fn();
  return r?.data ?? r;
}

export const tools: ToolDef[] = [
  // ---------- READ ----------
  { name: "list_channels", group: "read", description: "List every channel this server holds a token for (personal + Brand Accounts), with stats.", shape: {},
    async handler(d) {
      const out = [];
      for (const id of d.signedInChannels())
        out.push(await call(d, "channels.list", id, () => d.youtube(id).channels.list({ part: ["snippet", "statistics", "contentDetails"], mine: true })));
      return out.flatMap((r: any) => r.items ?? []);
    } },
  { name: "list_videos", group: "read", description: "List the channel's uploads (newest first) via its uploads playlist (1 unit/page, cheaper than search).",
    shape: { channel_id: ch, max_results: z.number().int().min(1).max(50).default(25), page_token: z.string().optional() },
    async handler(d, a) {
      const c = await call(d, "channels.list", a.channel_id, () => d.youtube(a.channel_id).channels.list({ part: ["contentDetails"], id: [a.channel_id] }));
      const uploads = c.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploads) throw new Error("Uploads playlist not found");
      return call(d, "playlistItems.list", a.channel_id, () => d.youtube(a.channel_id).playlistItems.list({ part: ["snippet", "status", "contentDetails"], playlistId: uploads, maxResults: a.max_results, pageToken: a.page_token }));
    } },
  { name: "get_video", group: "read", description: "Get full details of one video (snippet, status, stats, processing).",
    shape: { channel_id: ch, video_id: z.string() },
    handler: (d, a) => call(d, "videos.list", a.channel_id, () => d.youtube(a.channel_id).videos.list({ part: ["snippet", "status", "statistics", "contentDetails", "processingDetails"], id: [a.video_id] })) },
  { name: "list_playlists", group: "read", description: "List the channel's playlists.",
    shape: { channel_id: ch, max_results: z.number().int().min(1).max(50).default(25), page_token: z.string().optional() },
    handler: (d, a) => call(d, "playlists.list", a.channel_id, () => d.youtube(a.channel_id).playlists.list({ part: ["snippet", "status", "contentDetails"], mine: true, maxResults: a.max_results, pageToken: a.page_token })) },
  { name: "list_comments", group: "read", description: "List comment threads on a video, or on all the channel's videos if video_id omitted.",
    shape: { channel_id: ch, video_id: z.string().optional(), max_results: z.number().int().min(1).max(100).default(20), page_token: z.string().optional() },
    handler: (d, a) => call(d, "commentThreads.list", a.channel_id, () => d.youtube(a.channel_id).commentThreads.list({ part: ["snippet", "replies"], ...(a.video_id ? { videoId: a.video_id } : { allThreadsRelatedToChannelId: a.channel_id }), maxResults: a.max_results, pageToken: a.page_token })) },
  { name: "get_analytics", group: "read", description: "YouTube Analytics API report for the channel (or one video via filters 'video==ID').",
    shape: { channel_id: ch, start_date: z.string().describe("YYYY-MM-DD"), end_date: z.string(), metrics: z.string().default("views,estimatedMinutesWatched,averageViewDuration,subscribersGained,likes,comments"), dimensions: z.string().optional().describe("e.g. day, video, country"), filters: z.string().optional(), sort: z.string().optional(), max_results: z.number().int().optional() },
    handler: (d, a) => call(d, "analytics.query", a.channel_id, () => d.analytics(a.channel_id).reports.query({ ids: "channel==MINE", startDate: a.start_date, endDate: a.end_date, metrics: a.metrics, dimensions: a.dimensions, filters: a.filters, sort: a.sort, maxResults: a.max_results })) },
  { name: "quota_status", group: "read", description: "Show estimated YouTube API units used today (resets midnight Pacific) and remaining.", shape: {},
    async handler(d) { return { used: d.quota.used(), remaining: d.quota.remaining() }; } },

  // ---------- SAFE WRITE (never public) ----------
  { name: "update_video_metadata", group: "write", description: "Update title/description/tags/category of a video. Does NOT change privacy (use danger_publish_video for public).",
    shape: { channel_id: ch, video_id: z.string(), title: z.string().max(100).optional(), description: z.string().max(5000).optional(), tags: z.array(z.string()).optional(), category_id: z.string().optional() },
    async handler(d, a) {
      const cur = await call(d, "videos.list", a.channel_id, () => d.youtube(a.channel_id).videos.list({ part: ["snippet"], id: [a.video_id] }));
      const s = cur.items?.[0]?.snippet; if (!s) throw new Error("Video not found");
      const snippet = { title: a.title ?? s.title, description: a.description ?? s.description, tags: a.tags ?? s.tags, categoryId: a.category_id ?? s.categoryId };
      return call(d, "videos.update", a.channel_id, () => d.youtube(a.channel_id).videos.update({ part: ["snippet"], requestBody: { id: a.video_id, snippet } }));
    } },
  { name: "upload_video", group: "write", description: "Upload a local video file as PRIVATE or UNLISTED only (~1600 units; max ~6 per day).",
    shape: { channel_id: ch, file_path: z.string(), title: z.string().max(100), description: z.string().max(5000).default(""), tags: z.array(z.string()).optional(), category_id: z.string().default("22"), privacy_status: SAFE_PRIVACY.default("private"), made_for_kids: z.boolean().default(false) },
    async handler(d, a) {
      if (!fs.existsSync(a.file_path)) throw new Error(`File not found: ${a.file_path}`);
      return call(d, "videos.insert", a.channel_id, () => d.youtube(a.channel_id).videos.insert({ part: ["snippet", "status"], notifySubscribers: false,
        requestBody: { snippet: { title: a.title, description: a.description, tags: a.tags, categoryId: a.category_id }, status: { privacyStatus: SAFE_PRIVACY.parse(a.privacy_status), selfDeclaredMadeForKids: a.made_for_kids } },
        media: { body: fs.createReadStream(a.file_path) } }));
    } },
  { name: "schedule_video", group: "write", description: "Set a private video to auto-publish at publish_at (ISO 8601, e.g. 2026-10-20T15:00:00+03:00). Scheduling itself is reversible; the scheduled go-live should still be owner-approved.",
    shape: { channel_id: ch, video_id: z.string(), publish_at: z.string().datetime({ offset: true }) },
    async handler(d, a) {
      if (new Date(a.publish_at).getTime() <= Date.now()) throw new Error("publish_at must be in the future");
      return call(d, "videos.update", a.channel_id, () => d.youtube(a.channel_id).videos.update({ part: ["status"], requestBody: { id: a.video_id, status: { privacyStatus: "private", publishAt: new Date(a.publish_at).toISOString() } } }));
    } },
  { name: "set_thumbnail", group: "write", description: "Set a custom thumbnail from a local JPG/PNG (<2MB; channel must be verified for custom thumbnails).",
    shape: { channel_id: ch, video_id: z.string(), image_path: z.string() },
    async handler(d, a) {
      if (!fs.existsSync(a.image_path)) throw new Error(`File not found: ${a.image_path}`);
      return call(d, "thumbnails.set", a.channel_id, () => d.youtube(a.channel_id).thumbnails.set({ videoId: a.video_id, media: { body: fs.createReadStream(a.image_path) } }));
    } },
  { name: "create_playlist", group: "write", description: "Create a playlist (private or unlisted only).",
    shape: { channel_id: ch, title: z.string(), description: z.string().default(""), privacy_status: SAFE_PRIVACY.default("private") },
    handler: (d, a) => call(d, "playlists.insert", a.channel_id, () => d.youtube(a.channel_id).playlists.insert({ part: ["snippet", "status"], requestBody: { snippet: { title: a.title, description: a.description }, status: { privacyStatus: SAFE_PRIVACY.parse(a.privacy_status) } } })) },
  { name: "update_playlist", group: "write", description: "Update a playlist's title/description (privacy unchanged).",
    shape: { channel_id: ch, playlist_id: z.string(), title: z.string(), description: z.string().optional() },
    handler: (d, a) => call(d, "playlists.update", a.channel_id, () => d.youtube(a.channel_id).playlists.update({ part: ["snippet"], requestBody: { id: a.playlist_id, snippet: { title: a.title, description: a.description } } })) },
  { name: "add_to_playlist", group: "write", description: "Add a video to a playlist.",
    shape: { channel_id: ch, playlist_id: z.string(), video_id: z.string(), position: z.number().int().optional() },
    handler: (d, a) => call(d, "playlistItems.insert", a.channel_id, () => d.youtube(a.channel_id).playlistItems.insert({ part: ["snippet"], requestBody: { snippet: { playlistId: a.playlist_id, position: a.position, resourceId: { kind: "youtube#video", videoId: a.video_id } } } })) },
  { name: "reply_to_comment", group: "write", description: "Reply to a comment as the channel. Replies are publicly visible; agents should follow the owner's tone/approval rules.",
    shape: { channel_id: ch, parent_comment_id: z.string(), text: z.string().min(1).max(10000) },
    handler: (d, a) => call(d, "comments.insert", a.channel_id, () => d.youtube(a.channel_id).comments.insert({ part: ["snippet"], requestBody: { snippet: { parentId: a.parent_comment_id, textOriginal: a.text } } })) },

  // ---------- DANGER (gate on the owner's OK) ----------
  { name: "danger_publish_video", group: "danger", description: DANGER + "Makes a video PUBLIC immediately.",
    shape: { channel_id: ch, video_id: z.string(), confirm },
    handler: (d, a) => call(d, "videos.update", a.channel_id, () => d.youtube(a.channel_id).videos.update({ part: ["status"], requestBody: { id: a.video_id, status: { privacyStatus: "public" } } })) },
  { name: "danger_delete_video", group: "danger", description: DANGER + "Permanently deletes a video. Irreversible.",
    shape: { channel_id: ch, video_id: z.string(), confirm },
    handler: (d, a) => call(d, "videos.delete", a.channel_id, () => d.youtube(a.channel_id).videos.delete({ id: a.video_id })) },
  { name: "danger_delete_playlist", group: "danger", description: DANGER + "Permanently deletes a playlist.",
    shape: { channel_id: ch, playlist_id: z.string(), confirm },
    handler: (d, a) => call(d, "playlists.delete", a.channel_id, () => d.youtube(a.channel_id).playlists.delete({ id: a.playlist_id })) },
  { name: "danger_delete_comment", group: "danger", description: DANGER + "Deletes a comment (own comment) permanently.",
    shape: { channel_id: ch, comment_id: z.string(), confirm },
    handler: (d, a) => call(d, "comments.delete", a.channel_id, () => d.youtube(a.channel_id).comments.delete({ id: a.comment_id })) },
  { name: "danger_update_channel_settings", group: "danger", description: DANGER + "Changes channel branding settings (description, keywords, country, default language).",
    shape: { channel_id: ch, description: z.string().optional(), keywords: z.string().optional(), country: z.string().optional(), default_language: z.string().optional(), confirm },
    async handler(d, a) {
      const cur = await call(d, "channels.list", a.channel_id, () => d.youtube(a.channel_id).channels.list({ part: ["brandingSettings"], id: [a.channel_id] }));
      const b = cur.items?.[0]?.brandingSettings ?? {}; const c = { ...(b.channel ?? {}) };
      if (a.description !== undefined) c.description = a.description;
      if (a.keywords !== undefined) c.keywords = a.keywords;
      if (a.country !== undefined) c.country = a.country;
      if (a.default_language !== undefined) c.defaultLanguage = a.default_language;
      return call(d, "channels.update", a.channel_id, () => d.youtube(a.channel_id).channels.update({ part: ["brandingSettings"], requestBody: { id: a.channel_id, brandingSettings: { ...b, channel: c } } }));
    } },
];

/** Validate args with zod and run; danger tools refuse without confirm:true (schema enforces it too). */
export async function runTool(name: string, d: Deps, args: unknown) {
  const t = tools.find(x => x.name === name); if (!t) throw new Error(`Unknown tool ${name}`);
  if (t.group === "danger" && (args as any)?.confirm !== true) throw new Error(`${name} requires confirm: true after the channel owner's explicit OK.`);
  const parsed = z.object(t.shape).parse(args ?? {});
  if ("channel_id" in parsed && !d.signedInChannels().includes((parsed as any).channel_id))
    throw new Error(`Channel ${(parsed as any).channel_id} is not signed in. Signed in: ${d.signedInChannels().join(", ") || "none"}`);
  return t.handler(d, parsed);
}
