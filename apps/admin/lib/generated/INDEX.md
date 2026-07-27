# Admin generated contracts

## Responsibility

`contracts/**` is the checked-in Protobuf-ES mirror generated from the Root-owned Buf module. It contains the Admin Auth v1 message and service descriptors consumed by the server-only Connect client.

## Boundary

- Never edit generated files by hand; regenerate from the Root contract toolchain and commit the resulting byte-identical mirror.
- Admin Web imports only this repository-local mirror. Imports from Root, Platform, Session, or another sibling source tree are forbidden.
- Generated descriptors and `@connectrpc/connect-node` stay behind `lib/auth/client.ts`; client components must not import them.
- Protobuf descriptors define transport types. Auth.js-facing domain types remain in `lib/auth/client.ts` and do not expose Connect messages.
- Root generation emits ESM `.js` import specifiers with checked-in TypeScript sources. Admin Next dev/build therefore use webpack plus the `.js` extension alias in `next.config.ts`; keep that compatibility path until Turbopack resolves this generated form.
