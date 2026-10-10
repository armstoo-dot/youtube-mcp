import fs from "node:fs";
import path from "node:path";

/** Approximate YouTube Data API v3 unit costs (Analytics API has its own quota; tracked as 1). */
export const COSTS: Record<string, number> = {
  "list": 1, "insert": 50, "update": 50, "delete": 50,
  "videos.insert": 1600, "thumbnails.set": 50, "commentThreads.list": 1,
  "comments.insert": 50, "analytics.query": 1, "search.list": 100,
};
export function cost(op: string): number {
  return COSTS[op] ?? COSTS[op.split(".").pop() as string] ?? 50;
}

/** Day key in Pacific time: YouTube quota resets at midnight PT. */
export function quotaDay(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

export class QuotaTracker {
  constructor(private file: string, private limit = 10000, private reserve = 500) {}
  private read(): { day: string; used: number; calls: { t: string; op: string; units: number; channel?: string }[] } {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (j.day === quotaDay()) return j;
    } catch {}
    return { day: quotaDay(), used: 0, calls: [] };
  }
  used(): number { return this.read().used; }
  remaining(): number { return this.limit - this.used(); }
  /** Throws before the call if it would push usage into the reserve. */
  charge(op: string, channel?: string): number {
    const units = cost(op);
    const s = this.read();
    if (s.used + units > this.limit - this.reserve)
      throw new Error(`Quota guard: ${op} needs ${units} units, ${s.used}/${this.limit} used today (reserve ${this.reserve}). Refusing.`);
    s.used += units;
    s.calls.push({ t: new Date().toISOString(), op, units, channel });
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(s, null, 2), { mode: 0o600 });
    return units;
  }
}
