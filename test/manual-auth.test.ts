import { describe, it, expect } from "vitest";
import { parseAuthInput } from "../src/manual.js";
import { parseAuthArgs } from "../src/auth-cli.js";

describe("manual auth input", () => {
  it("extracts the code from a full loopback redirect URL", () => {
    expect(parseAuthInput("http://127.0.0.1:53682/callback?code=4%2F0AbC-xyz&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube")).toBe("4/0AbC-xyz");
  });
  it("trims whitespace and quotes", () => { expect(parseAuthInput('  "http://localhost/callback?code=abc"  \n')).toBe("abc"); });
  it("accepts a bare query string", () => { expect(parseAuthInput("?code=q1&scope=x")).toBe("q1"); expect(parseAuthInput("code=q2")).toBe("q2"); });
  it("accepts a raw code (url-encoded or not)", () => { expect(parseAuthInput("4/0AbC")).toBe("4/0AbC"); expect(parseAuthInput("4%2F0AbC")).toBe("4/0AbC"); });
  it("surfaces Google errors", () => { expect(() => parseAuthInput("http://127.0.0.1:53682/callback?error=access_denied")).toThrow(/access_denied/); });
  it("rejects empty, code-less URLs and junk", () => {
    expect(() => parseAuthInput("   ")).toThrow(/Nothing pasted/);
    expect(() => parseAuthInput("http://127.0.0.1:53682/callback?scope=x")).toThrow(/No `code=`/);
    expect(() => parseAuthInput("hello there")).toThrow();
  });
});

describe("auth CLI args", () => {
  it("defaults to loopback sign-in", () => { expect(parseAuthArgs([])).toEqual({ mode: "signin", manual: false }); });
  it("--manual / --headless", () => { expect(parseAuthArgs(["--manual"]).manual).toBe(true); expect(parseAuthArgs(["--headless"]).manual).toBe(true); });
  it("--list, --remove, --port, --redirect", () => {
    expect(parseAuthArgs(["--list"]).mode).toBe("list");
    expect(parseAuthArgs(["--remove", "UCx"])).toMatchObject({ mode: "remove", channel: "UCx" });
    expect(parseAuthArgs(["--port", "9000"]).port).toBe(9000);
    expect(parseAuthArgs(["--redirect", "code=z"]).redirect).toBe("code=z");
  });
  it("errors on unknown or missing values", () => {
    expect(() => parseAuthArgs(["--nope"])).toThrow(/Unknown/);
    expect(() => parseAuthArgs(["--remove"])).toThrow(/needs a value/);
  });
});
