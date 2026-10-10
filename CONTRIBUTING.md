# Contributing

Thanks for helping!

```bash
npm ci
npm run typecheck && npm run build && npm test
```

- Tests use mocked API clients, so they need no Google credentials or network. Please keep it that way.
- New tools go in `src/tools.ts` with a group (`read` / `write` / `danger`) and a quota cost in `src/quota.ts`.
  - Anything that makes content public, deletes it or changes channel settings **must** be in `danger`, use a `danger_` name prefix, and require `confirm: true`.
- Never commit `.env`, tokens, client secrets or real channel ids. CI and reviewers will reject them.
- Keep PRs focused and add a line to `CHANGELOG.md`.
