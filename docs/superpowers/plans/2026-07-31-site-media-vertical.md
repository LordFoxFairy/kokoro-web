# Site Media Vertical Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Studio, Library, and Site BFF/client media vertical for each independently deployed Site without adding a second owner-state authority or exposing delivery capabilities and Platform URLs to browsers.

**Architecture:** A brand-neutral `@kokoro/media-app` factory renders Site-local Studio and Library routes while all authoritative media and artifact reads/actions cross an allowlisted `@kokoro/site-bff` API backed by the generated Platform Public client. The `@kokoro/chat-surface` owner-state module becomes the single shared closed-union model for Chat and Platform projections. Artifact content is a same-origin Site BFF stream: the BFF verifies the exact ready version, issues and immediately redeems a one-time server-only capability through a typed Node streaming transport, and forwards only validated 200/206 responses with backpressure.

**Tech Stack:** Node.js 24, TypeScript 5.9, React 19, Next.js 16 App Router, Vitest, Testing Library, generated Platform Public OpenAPI types and validators.

---

## Chunk 1: Authority model and generated-client seams

### Task 1: Reuse one closed owner-state model

**Files:**
- Modify: `packages/chat-surface/src/projection/owner-state.ts`
- Modify: `packages/chat-surface/src/index.ts`
- Modify: `packages/chat-surface/test/projection.test.ts`
- Create: `packages/media-app/test/owner-projection.test.ts`
- Create: `packages/media-app/src/owner-projection.ts`

- [ ] Add compile/runtime tests that Platform `MediaOperationView`, `ArtifactVersion`, and `MediaCostProjectionView` exhaustively map to the shared media/candidate/artifact/cost owner unions without fabricated fields.
- [ ] Run the focused tests and confirm RED because the common exports and Platform projectors do not exist.
- [ ] Generalize the existing owner unions only where Platform omits Chat-specific fields; retain `Chat*` compatibility aliases and existing transition validation.
- [ ] Implement exhaustive Platform-to-owner projectors with `never` checks and immutable snapshots.
- [ ] Run focused tests and existing Chat projection tests; confirm GREEN.

### Task 2: Add exact submit fingerprint and typed delivery client

**Files:**
- Modify: `packages/site-client/src/platform-public-client.ts`
- Create: `packages/site-client/src/artifact-delivery-client.ts`
- Modify: `packages/site-client/src/index.ts`
- Modify: `packages/site-client/src/server.ts`
- Create: `packages/site-client/test/platform-media-client.test.ts`
- Create: `packages/site-client/test/artifact-delivery-client.test.ts`
- Modify: `packages/site-client/INDEX.md`

- [ ] Write tests proving `submitMediaOperation` accepts only the exact generated caller fingerprint header and every other operation rejects it.
- [ ] Write tests proving the delivery client delegates generated Range/deadline validation, carries the capability only in the explicit server security field, rejects redirects/non-200-or-206 responses, validates the response-header allowlist and status/header invariants, and returns a stream without reading it.
- [ ] Run focused tests and confirm RED.
- [ ] Add the narrow handwritten client options and typed delivery transport/client; import generated helpers instead of editing generated files.
- [ ] Run focused tests and confirm GREEN.

## Chunk 2: Site runtime and BFF vertical

### Task 3: Implement Node artifact streaming transport

**Files:**
- Modify: `packages/site-runtime-node/src/index.ts`
- Modify: `packages/site-runtime-node/test/runtime.test.ts`
- Modify: `packages/site-runtime-node/INDEX.md`

- [ ] Add tests for ProductWorkload plus delivery capability headers, AbortSignal, deadline timeout, single bounded Range, no redirect following, response stream identity/backpressure, and rejection of invalid/multi-value/oversized headers.
- [ ] Run the runtime tests and confirm RED.
- [ ] Add `artifactDeliveryTransport` to `NodeSiteRuntimeProvider` using the existing mTLS agent and `IncomingMessage` to Web stream bridge without buffering.
- [ ] Run runtime tests and confirm GREEN.

### Task 4: Add allowlisted media/artifact BFF API

**Files:**
- Create: `packages/site-bff/src/media-api.ts`
- Modify: `packages/site-bff/src/index.ts`
- Create: `packages/site-bff/test/media-api.test.ts`
- Create: `packages/site-bff/test/artifact-content.test.ts`
- Modify: `packages/site-bff/INDEX.md`

- [ ] Write route tests for definition/model-option/quote/submit/cancel/recover/list/get and artifact list/version operations; assert project identity always comes from resolved Site bootstrap and browser payload cannot replace it.
- [ ] Write streaming tests proving content is available only for exact ready owner versions; processing/deleted/restricted/unavailable are typed and never receive URLs or delivery authorization; capability and Platform URL never appear in browser responses; valid Range and the strict response headers are forwarded; body is not buffered; abort propagates.
- [ ] Run focused tests and confirm RED.
- [ ] Add precise `SiteBffRuntime` media methods and an exact route table with same-origin/auth/CSRF/bounded-body/query/path validation and stable problem responses.
- [ ] Add the server-side ready-check → issue → immediate redeem content path and strict header/status forwarding.
- [ ] Run BFF tests and confirm GREEN.

## Chunk 3: Reusable Site UI and independent-Site integration

### Task 5: Build the brand-neutral media app factory

**Files:**
- Create: `packages/media-app/package.json`
- Create: `packages/media-app/tsconfig.json`
- Create: `packages/media-app/tsconfig.build.json`
- Create: `packages/media-app/eslint.config.mjs`
- Create: `packages/media-app/src/index.ts`
- Create: `packages/media-app/src/browser-client.ts`
- Create: `packages/media-app/src/command-recovery.ts`
- Create: `packages/media-app/src/studio-product.tsx`
- Create: `packages/media-app/src/library-product.tsx`
- Create: `packages/media-app/src/media-product.module.css`
- Create: `packages/media-app/test/browser-client.test.ts`
- Create: `packages/media-app/test/products.test.tsx`
- Create: `packages/media-app/INDEX.md`

- [ ] Write browser-client tests for exact BFF paths/responses and a command-identity-only recovery record that reconciles through the owner command endpoint rather than storing operation state.
- [ ] Write UI tests for published definitions/options, quote-before-submit, submit/cancel/recover, closed operation states, and Library ready/restricted/unavailable/processing/deleted behavior; assert only ready versions receive same-origin content URLs.
- [ ] Run focused tests and confirm RED.
- [ ] Implement the minimal accessible Studio form and operation list plus Library artifact/version list using existing Site tokens and a compact owner-state status rail; keep all brand/theme inputs injectable and avoid a global redesign.
- [ ] Run media-app tests and confirm GREEN.

### Task 6: Wire every generated Site, not a shared platform workspace

**Files:**
- Create: `packages/site-scaffold/templates/site/src/app/api/media/[[...path]]/route.ts`
- Create: `packages/site-scaffold/templates/site/src/app/studio/page.tsx`
- Create: `packages/site-scaffold/templates/site/src/app/library/page.tsx`
- Modify: `packages/site-scaffold/templates/site/src/app/page.tsx`
- Modify: `packages/site-scaffold/templates/site/src/app/site.css`
- Modify: `packages/site-scaffold/templates/site/package.json`
- Modify: `packages/site-scaffold/templates/site/pnpm-workspace.yaml`
- Modify: `packages/site-scaffold/templates/site/next.config.ts`
- Modify: `packages/site-scaffold/templates/site/deploy/artifact-manifest.json`
- Modify: `packages/site-scaffold/templates/site/scripts/verify-artifact.mjs`
- Modify: `packages/site-scaffold/src/scaffold.ts`
- Modify: `scripts/certify-external-sites.mjs`
- Modify: `test/site/site-project-isolation.test.ts`
- Modify: `test/repository/reference-app-v3.test.mjs`
- Modify: relevant `INDEX.md` files

- [ ] Extend repository/scaffold tests first to require the media package artifact, Site-local `/studio` and `/library` routes gated by the published `image` surface, and the exact media BFF route; run and confirm RED.
- [ ] Add the media-app tarball to the immutable package supply chain and template-local dependencies/transpilation.
- [ ] Wire Server Component route gates and inject only Site-specific name/theme/copy into the shared factories.
- [ ] Keep Chat on Session HTTP/SSE; link navigation without importing Platform media authority into Session reducers.
- [ ] Run repository and scaffold tests and confirm GREEN.

## Chunk 4: Verification and one requested commit

### Task 7: Verify under Node 24 and commit once

**Files:**
- Modify: `pnpm-lock.yaml` only through pnpm if workspace dependency resolution requires it

- [ ] Run package-focused lint, typecheck, test, and build for all changed packages under Node 24.
- [ ] Run root `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm build` under Node 24; separately record any unchanged generated lint baseline.
- [ ] Inspect `git diff --check`, generated-file diffs (must be empty), and the final requirements checklist.
- [ ] Commit all implementation, tests, plan, and index updates as one user-requested commit and report the exact SHA plus remaining gaps.
