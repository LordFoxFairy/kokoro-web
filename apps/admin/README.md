# @kokoro/admin-web

The Kokoro Admin application is a standalone Next.js 16 and shadcn/ui surface.

## Commands

```bash
pnpm --filter @kokoro/admin-web dev
pnpm --filter @kokoro/admin-web test
pnpm --filter @kokoro/admin-web typecheck
pnpm --filter @kokoro/admin-web lint
pnpm --filter @kokoro/admin-web build
```

The UI token baseline is derived from the audited
[`satnaing/shadcn-admin`](https://github.com/satnaing/shadcn-admin) source at
`e16c87f213a5ba5e45964e9b67c792105ec74d26`. Attribution is recorded in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
