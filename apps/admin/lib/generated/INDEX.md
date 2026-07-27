---
architectureIndex: 1
rootId: web.admin.generated
owners:
  - "@LordFoxFairy"
---

# Admin generated contracts

## Responsibility

`contracts/**` is the checked-in mirror generated from the Root-owned Buf module. It contains the Admin Auth v1 message/service descriptors and the Node-only canonical Effect digest helper consumed by the server-only Connect client.

## Boundary

- Never edit generated files by hand; regenerate from the Root contract toolchain and commit the resulting byte-identical mirror.
- Admin Web imports only this repository-local mirror. Imports from Root, Platform, Session, or another sibling source tree are forbidden.
- Generated descriptors and `@connectrpc/connect-node` stay behind `lib/auth/client.ts`; client components must not import them.
- Protobuf descriptors define transport types. Auth.js-facing domain types remain in `lib/auth/client.ts` and do not expose Connect messages.
- Command digests use the generated `SHA256_PROTOBUF_V1` helper over normalized method-specific Effect messages; Web must not recreate the algorithm with JSON or local field ordering.
- Root generation emits ESM `.js` import specifiers with checked-in TypeScript sources. Admin Next dev/build therefore use webpack plus the `.js` extension alias in `next.config.ts`; keep that compatibility path until Turbopack resolves this generated form.
