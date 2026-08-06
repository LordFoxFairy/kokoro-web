---
architectureIndex: 1
rootId: web.admin.generated
owners:
  - "@LordFoxFairy"
---

# Admin generated contracts

## Responsibility

`proto/**` and `contracts/**` are the only checked-in Admin mirrors generated from the Root contract authority. `proto/**` contains one dependency-complete descriptor tree shared by every privileged client; `contracts/**` contains boundary metadata, canonical command-envelope digest helpers, closed errors, and conformance corpus artifacts. Commerce owns CreditProgram publication; Credit owns account, grant, hold, journal, usage, and reconciliation state.

## Boundary

- `provenance.json` records the exact Root source revision, toolchain, inputs, outputs, and output hashes. Never edit generated files by hand; regenerate from the Root contract toolchain and commit the resulting byte-identical tree.
- Admin Web imports only this repository-local mirror. Imports from Root, Platform, Session, or another sibling source tree are forbidden.
- Per-boundary descriptor copies and compatibility re-export shims are forbidden. All descriptors resolve through `proto/**`; helpers resolve through their exact `contracts/<boundary>@<version>/**` owner.
- Generated descriptors and `@connectrpc/connect-node` stay behind `lib/control-plane/**`; client components must not import them.
- Protobuf descriptors define transport types. Browser routes expose only positively selected JSON fields and never protobuf messages.
- Command digests use the generated command-envelope helpers. Web must not recreate the algorithm with JSON or local field ordering.
- Root generation emits ESM `.js` import specifiers with checked-in TypeScript sources. Admin Next dev/build therefore use webpack plus the `.js` extension alias in `next.config.ts`; keep that compatibility path until Turbopack resolves this generated form.
