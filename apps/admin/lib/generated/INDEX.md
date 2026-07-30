---
architectureIndex: 1
rootId: web.admin.generated
owners:
  - "@LordFoxFairy"
---

# Admin generated contracts

## Responsibility

`admin-identity/**`, `admin-query-v2/**`, and `admin-commerce/**` are checked-in mirrors generated from the Root-owned Buf module. They contain the privileged typed service descriptors and canonical command-envelope digest helpers.

## Boundary

- Never edit generated files by hand; regenerate from the Root contract toolchain and commit the resulting byte-identical mirror.
- Admin Web imports only this repository-local mirror. Imports from Root, Platform, Session, or another sibling source tree are forbidden.
- Generated descriptors and `@connectrpc/connect-node` stay behind `lib/control-plane/**`; client components must not import them.
- Protobuf descriptors define transport types. Browser routes expose only positively selected JSON fields and never protobuf messages.
- Command digests use the generated command-envelope helpers. Web must not recreate the algorithm with JSON or local field ordering.
- Root generation emits ESM `.js` import specifiers with checked-in TypeScript sources. Admin Next dev/build therefore use webpack plus the `.js` extension alias in `next.config.ts`; keep that compatibility path until Turbopack resolves this generated form.
