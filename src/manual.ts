/** Extract an OAuth authorization code from whatever the user pasted:
 *  the full redirect URL (http://127.0.0.1:PORT/callback?code=...), a bare query string, or the raw code. */
export function parseAuthInput(input: string): string {
  const s = input.trim().replace(/^['"<]|['">]$/g, "");
  if (!s) throw new Error("Nothing pasted. Paste the full address from the browser bar, or just the code.");
  let params: URLSearchParams | undefined;
  if (/^https?:\/\//i.test(s)) params = new URL(s).searchParams;
  else if (s.includes("code=") || s.includes("error=")) params = new URLSearchParams(s.slice(s.indexOf("?") + 1));
  if (params) {
    const err = params.get("error");
    if (err) throw new Error(`Google returned an error: ${err}`);
    const code = params.get("code");
    if (!code) throw new Error("No `code=` parameter found in that URL.");
    return code;
  }
  if (/\s/.test(s)) throw new Error("That doesn't look like a code or a redirect URL.");
  return decodeURIComponent(s);
}
