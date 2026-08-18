# Admin Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Kokoro Admin on the audited `shadcn-admin` visual and component baseline without restoring legacy Admin code.

**Architecture:** Next.js App Router owns routing, the browser session boundary, and the Admin BFF. shadcn/ui, Radix, Tailwind 4, TanStack Table, React Hook Form, and Zod own the frontend surface. Feature modules consume a versioned Admin API interface; contract fixtures and the generated ConnectRPC implementation are interchangeable adapters behind that interface.

**Tech Stack:** Next.js 16, React 19, Auth.js, shadcn/ui, Tailwind CSS 4, Radix UI, Lucide, TanStack Table, TanStack Query, React Hook Form, Zod, Vitest, Testing Library, Playwright.

## Global Constraints

- Upstream baseline is `satnaing/shadcn-admin` commit `e16c87f213a5ba5e45964e9b67c792105ec74d26`, version `2.2.1`.
- Preserve the upstream MIT copyright and license for copied or substantially derived files.
- Do not add Ant Design, ProComponents, Clerk, Vite, TanStack Router, template business routes, or legacy Admin compatibility code.
- Do not modify `kokoro-iam` during the independent Admin frontend phase.
- Browser code must not import generated IAM messages, IAM service credentials, or server-only transports.
- Every production route must map to a product requirement, API contract, capability, and test case.
- Fixture data is available only through the versioned Admin API interface and must never create a second production data branch.
- Every task ends with focused tests and a clean reviewable commit.

---

### Task 1: Establish The Application Baseline

**Files:**
- Create: `apps/admin/package.json`
- Create: `apps/admin/tsconfig.json`
- Create: `apps/admin/next.config.ts`
- Create: `apps/admin/eslint.config.mjs`
- Create: `apps/admin/postcss.config.mjs`
- Create: `apps/admin/components.json`
- Create: `apps/admin/next-env.d.ts`
- Create: `apps/admin/.gitignore`
- Create: `apps/admin/.env.example`
- Create: `apps/admin/README.md`
- Create: `apps/admin/THIRD_PARTY_NOTICES.md`
- Create: `apps/admin/src/app/layout.tsx`
- Create: `apps/admin/src/app/page.tsx`
- Create: `apps/admin/src/styles/index.css`
- Create: `apps/admin/src/styles/theme.css`
- Create: `apps/admin/src/lib/utils.ts`
- Test: `apps/admin/test/contract/baseline.test.ts`

**Interfaces:**
- Consumes: root pnpm workspace, `@kokoro/tsconfig`.
- Produces: a buildable `@kokoro/admin-web` Next.js application and the `@/*` source alias.

- [ ] Add a failing boundary test that requires the exact package name, Next 16, React 19, Tailwind 4, shadcn dependencies, upstream notice, and forbidden dependency scan.
- [ ] Run `pnpm --filter @kokoro/admin-web test -- baseline.test.ts` and verify it fails because the app baseline is absent.
- [ ] Add the package and configuration files, preserving the audited upstream theme tokens and MIT notice.
- [ ] Add the minimal root layout and placeholder page using semantic shadcn tokens, not legacy styles.
- [ ] Run the focused boundary test, `typecheck`, `lint`, and production `build`.
- [ ] Commit with `feat(admin): establish shadcn application baseline`.

### Task 2: Migrate The Shadcn Primitive Layer

**Files:**
- Create: `apps/admin/src/components/ui/*.tsx`
- Create: `apps/admin/src/components/password-input.tsx`
- Create: `apps/admin/src/components/confirm-dialog.tsx`
- Create: `apps/admin/src/components/long-text.tsx`
- Create: `apps/admin/src/components/select-dropdown.tsx`
- Create: `apps/admin/src/components/skip-to-main.tsx`
- Create: `apps/admin/src/hooks/use-mobile.ts`
- Test: `apps/admin/test/component/primitives.test.tsx`
- Test: `apps/admin/test/contract/upstream.test.ts`

**Interfaces:**
- Consumes: Task 1 aliases, theme, Radix and shadcn dependencies.
- Produces: accessible Button, Input, Form, Table, Dialog, AlertDialog, Sheet, Dropdown, Select, Tabs, Tooltip, Skeleton, Badge, Avatar, ScrollArea, Sidebar and feedback primitives.

- [ ] Add tests for button semantics, dialog focus, sheet keyboard close, form errors, tooltip labels, sidebar mobile behavior, and upstream attribution.
- [ ] Verify the tests fail before primitive migration.
- [ ] Migrate audited upstream primitives; preserve upstream behavior and replace Vite-only assumptions.
- [ ] Remove unused RTL customizations only when their absence is covered by a test; otherwise retain them.
- [ ] Run component tests, axe-compatible semantic assertions, typecheck and lint.
- [ ] Commit with `feat(admin): migrate shadcn primitive layer`.

### Task 3: Build The Application Shell

**Files:**
- Create: `apps/admin/src/components/layout/app-sidebar.tsx`
- Create: `apps/admin/src/components/layout/header.tsx`
- Create: `apps/admin/src/components/layout/main.tsx`
- Create: `apps/admin/src/components/layout/nav-group.tsx`
- Create: `apps/admin/src/components/layout/nav-user.tsx`
- Create: `apps/admin/src/components/layout/types.ts`
- Create: `apps/admin/src/components/layout/sidebar-data.ts`
- Create: `apps/admin/src/components/command-menu.tsx`
- Create: `apps/admin/src/components/theme-switch.tsx`
- Create: `apps/admin/src/components/navigation-progress.tsx`
- Create: `apps/admin/src/context/layout-provider.tsx`
- Create: `apps/admin/src/context/search-provider.tsx`
- Create: `apps/admin/src/context/theme-provider.tsx`
- Create: `apps/admin/src/app/(control)/layout.tsx`
- Test: `apps/admin/test/component/shell.test.tsx`

**Interfaces:**
- Consumes: Task 2 primitives and Next `Link`, `usePathname`, `useRouter`.
- Produces: stable desktop/sidebar/mobile shell and static navigation filtered by capability projection.

- [ ] Add shell tests for active navigation, grouped routes, mobile Sheet, collapse persistence, theme initialization, skip link, command search, and no template routes.
- [ ] Verify tests fail before shell implementation.
- [ ] Migrate upstream shell and replace TanStack Router links and location hooks with Next equivalents.
- [ ] Replace template team switcher, billing, upgrades and example profile actions with Kokoro scope and account surfaces.
- [ ] Ensure initial theme is decided before paint and shell dimensions remain stable during route changes.
- [ ] Run focused tests, typecheck, lint and build.
- [ ] Commit with `feat(admin): add shadcn management shell`.

### Task 4: Establish Authentication And Route Protection

**Files:**
- Create: `apps/admin/src/auth.ts`
- Create: `apps/admin/src/server/auth/config.ts`
- Create: `apps/admin/src/contracts/auth.ts`
- Create: `apps/admin/src/server/auth/session.ts`
- Create: `apps/admin/src/server/auth/guard.ts`
- Create: `apps/admin/src/app/api/auth/[...nextauth]/route.ts`
- Create: `apps/admin/src/app/(auth)/layout.tsx`
- Create: `apps/admin/src/app/(auth)/login/page.tsx`
- Create: `apps/admin/src/features/auth/login-form.tsx`
- Create: `apps/admin/src/features/auth/auth-shell.tsx`
- Create: `apps/admin/src/app/forbidden/page.tsx`
- Test: `apps/admin/test/unit/auth.test.ts`
- Test: `apps/admin/test/integration/auth-routes.test.ts`
- Test: `apps/admin/test/component/login.test.tsx`

**Interfaces:**
- Consumes: Tasks 1-3 and Auth.js.
- Produces: versioned `AdminAuthApi`, HttpOnly browser Session, normalized `AdminIdentity`, protected control layout and non-enumerating login errors.

- [ ] Define tests for password login, optional email login capability, callback safety, missing/expired Session, ordinary-user forbidden response, logout and production-hidden dev fixture.
- [ ] Verify tests fail before implementation.
- [ ] Configure Auth.js without Clerk or client-owned auth state.
- [ ] Port the upstream auth visual structure into Kokoro login and callback states.
- [ ] Add server guards for every control route and preserve safe intended destinations.
- [ ] Run auth tests, typecheck, lint and build.
- [ ] Commit with `feat(admin): add Auth.js management boundary`.

### Task 5: Build Shared Management Patterns

**Files:**
- Create: `apps/admin/src/components/data-table/*.tsx`
- Create: `apps/admin/src/components/entity/entity-list.tsx`
- Create: `apps/admin/src/components/entity/entity-detail.tsx`
- Create: `apps/admin/src/components/entity/entity-picker.tsx`
- Create: `apps/admin/src/components/entity/entity-form.tsx`
- Create: `apps/admin/src/components/entity/entity-state.tsx`
- Create: `apps/admin/src/components/entity/lifecycle-actions.tsx`
- Create: `apps/admin/src/components/entity/action-guard.tsx`
- Create: `apps/admin/src/components/entity/date-time.tsx`
- Create: `apps/admin/src/components/entity/copy-id.tsx`
- Create: `apps/admin/src/hooks/use-table-url-state.ts`
- Test: `apps/admin/test/component/data-table.test.tsx`
- Test: `apps/admin/test/component/entity-patterns.test.tsx`

**Interfaces:**
- Consumes: shadcn primitives, TanStack Table, React Hook Form, Zod and Next URL state.
- Produces: reusable list/detail/picker/form/lifecycle patterns with explicit loading, empty, filtered-empty, error, forbidden and success states.

- [ ] Add tests for server cursor pagination, URL filters, sorting, columns, bulk selection, mobile action overflow, long values, Dialog/Sheet forms, mutation locking and capability hiding.
- [ ] Verify tests fail before pattern implementation.
- [ ] Migrate upstream DataTable modules and replace local-demo pagination assumptions with explicit server cursor interfaces.
- [ ] Implement entity compositions without accepting generated protobuf messages.
- [ ] Run focused tests, typecheck, lint and build.
- [ ] Commit with `feat(admin): add reusable management patterns`.

### Task 6: Freeze The Versioned Frontend API

**Files:**
- Create: `apps/admin/src/contracts/admin-api.ts`
- Create: `apps/admin/src/contracts/models.ts`
- Create: `apps/admin/src/contracts/errors.ts`
- Create: `apps/admin/src/contracts/capabilities.ts`
- Create: `apps/admin/src/contracts/pagination.ts`
- Create: `apps/admin/src/server/api/index.ts`
- Create: `apps/admin/src/server/api/fixture.ts`
- Create: `apps/admin/src/server/api/rpc.ts`
- Create: `apps/admin/src/fixtures/scenarios/*.ts`
- Test: `apps/admin/test/contract/admin-api.test.ts`
- Test: `apps/admin/test/contract/fixture-parity.test.ts`
- Test: `apps/admin/test/security/server-boundary.test.ts`

**Interfaces:**
- Consumes: `AdminAuthApi` and `AdminIdentity` from Task 4.
- Produces: `AdminApi`, normalized view models, stable error kinds, independent cursors and capability projections.
- The fixture and generated ConnectRPC adapters implement the same interface; feature code imports only the interface.

- [ ] Add compile-time and runtime tests for every method, page cursor, capability, error kind and fixture scenario.
- [ ] Add a client-bundle boundary test that rejects server transport, service credentials and generated IAM imports.
- [ ] Implement the normalized frontend contract without duplicating IAM business rules.
- [ ] Implement deterministic success, empty, forbidden, conflict and unavailable fixture scenarios.
- [ ] Leave the RPC adapter explicit and fail-fast until the accepted generated provider is imported; do not fabricate methods.
- [ ] Run contract, security, typecheck and lint gates.
- [ ] Commit with `feat(admin): define versioned frontend API`.

### Task 7: Implement Dashboard And Identity Features

**Files:**
- Create: `apps/admin/src/features/dashboard/**`
- Create: `apps/admin/src/features/users/**`
- Create: `apps/admin/src/features/sessions/**`
- Create: `apps/admin/src/app/(control)/page.tsx`
- Create: `apps/admin/src/app/(control)/users/page.tsx`
- Create: `apps/admin/src/app/(control)/users/[userId]/page.tsx`
- Create: `apps/admin/src/app/(control)/sessions/page.tsx`
- Test: `apps/admin/test/component/dashboard.test.tsx`
- Test: `apps/admin/test/component/users.test.tsx`
- Test: `apps/admin/test/component/sessions.test.tsx`

**Interfaces:**
- Consumes: Tasks 3, 5 and 6.
- Produces: authoritative dashboard, user lifecycle/detail/access workspace and session management pages.

- [ ] Add failing tests for every state and operation named in `page-matrix.md`.
- [ ] Implement Dashboard with metric navigation and no invented trends or risk labels.
- [ ] Implement User list/detail/forms/lifecycle using shared entity patterns.
- [ ] Implement Session list/details/revocation with explicit time semantics and no raw token display.
- [ ] Run focused feature tests, typecheck, lint and build.
- [ ] Commit with `feat(admin): add dashboard and identity management`.

### Task 8: Implement Tenant And Membership Features

**Files:**
- Create: `apps/admin/src/features/organizations/**`
- Create: `apps/admin/src/features/sites/**`
- Create: `apps/admin/src/features/members/**`
- Create: `apps/admin/src/app/(control)/organizations/**`
- Create: `apps/admin/src/app/(control)/sites/**`
- Test: `apps/admin/test/component/organizations.test.tsx`
- Test: `apps/admin/test/component/sites.test.tsx`
- Test: `apps/admin/test/component/members.test.tsx`

**Interfaces:**
- Consumes: shared entity patterns and scope-bound Admin API methods.
- Produces: Organization and Site list/detail/member workspaces with independent domain semantics.

- [ ] Add failing tests for Organization and Site lifecycle, member lifecycle, scope switching, owner protection feedback and responsive detail tabs.
- [ ] Implement Organization pages without treating Organization as Site.
- [ ] Implement Site pages with fixed Site scope in embedded mode and explicit platform scope in standalone mode.
- [ ] Implement one shared `MemberWorkspace` configured by scope adapter, not two copied components.
- [ ] Run focused feature tests and static/build gates.
- [ ] Commit with `feat(admin): add tenant and membership management`.

### Task 9: Implement Access Control And Audit Features

**Files:**
- Create: `apps/admin/src/features/roles/**`
- Create: `apps/admin/src/features/access/**`
- Create: `apps/admin/src/features/audit/**`
- Create: `apps/admin/src/app/(control)/roles/page.tsx`
- Create: `apps/admin/src/app/(control)/access/page.tsx`
- Create: `apps/admin/src/app/(control)/audit/page.tsx`
- Test: `apps/admin/test/component/roles.test.tsx`
- Test: `apps/admin/test/component/access.test.tsx`
- Test: `apps/admin/test/component/audit.test.tsx`

**Interfaces:**
- Consumes: capability projection, permission catalog, scope adapters and audit event view models.
- Produces: one RoleWorkspace, read-only AccessInspector and structured AuditTable/AuditDetail.

- [ ] Add failing tests for Organization/Site role modes, built-in immutability, permission tree half-selection, usage pagination, diagnostic invalidation, audit filters and metadata redaction.
- [ ] Implement a single RoleWorkspace with scope-specific API adapters.
- [ ] Implement permission selection and before/after review without calculating effective IAM permissions locally.
- [ ] Implement access diagnosis and audit detail using structured fields rather than raw JSON dumps.
- [ ] Run focused feature tests and static/build gates.
- [ ] Commit with `feat(admin): add access control and audit workspaces`.

### Task 10: Import The Accepted Generated RPC Provider

**Files:**
- Create: `apps/admin/contracts/iam/**`
- Create: `apps/admin/generated/iam/**`
- Modify: `apps/admin/src/server/api/rpc.ts`
- Create: `apps/admin/scripts/import-iam.ts`
- Test: `apps/admin/test/contract/provider.test.ts`
- Test: `apps/admin/test/integration/rpc-adapter.test.ts`

**Interfaces:**
- Consumes: an accepted, immutable IAM provider candidate.
- Produces: the real server-only `AdminApi` implementation with exact method and runtime record validation.

- [ ] Add tests that pin provider commit, tree, proto hashes and generated service inventory.
- [ ] Import the provider through an explicit script; generated files are never hand-edited.
- [ ] Implement exact RPC-to-view-model mappings and stable error normalization.
- [ ] Verify the fixture and RPC adapters satisfy the same contract test suite.
- [ ] Run provider, integration, security, typecheck, lint and build gates.
- [ ] Commit with `feat(admin): connect accepted IAM provider`.

### Task 11: Add Complete Acceptance Infrastructure

**Files:**
- Create: `apps/admin/playwright.config.ts`
- Create: `apps/admin/test/catalog/p0.yaml`
- Create: `apps/admin/test/e2e/**`
- Create: `apps/admin/scripts/acceptance/**`
- Create: `apps/admin/reports/templates/report.md`
- Test: `apps/admin/test/contract/catalog.test.ts`
- Test: `apps/admin/test/contract/evidence.test.ts`

**Interfaces:**
- Consumes: `acceptance-matrix.md` and real Admin/IAM runtime.
- Produces: two visible fresh-fixture rounds and an immutable categorized evidence report.

- [ ] Encode every acceptance matrix row with zero skip, todo and retry allowance.
- [ ] Record local/UTC timestamps, screenshots, trace, video, RPC, bounded SQL, audit and log assertions per step.
- [ ] Ensure visible in-app-browser execution runs two independent rounds; headless results cannot substitute.
- [ ] Add desktop, tablet, mobile, refresh first-frame, navigation latency and FOUC checks.
- [ ] Run catalog and evidence self-tests.
- [ ] Commit with `test(admin): add complete acceptance runner`.

### Task 12: Execute Final Acceptance

**Files:**
- Create: `apps/admin/reports/accepted/<run-id>/**`
- Modify: `apps/admin/docs/plans/acceptance-matrix.md`

**Interfaces:**
- Consumes: clean Admin candidate, accepted IAM provider and fresh PostgreSQL fixtures.
- Produces: reproducible acceptance evidence or an explicit `NOT_READY` report.

- [ ] Run frozen install, dependency boundary, unit, component, contract, security, typecheck, lint and production build gates.
- [ ] Run performance, responsive, accessibility and FOUC gates at all required viewports.
- [ ] Keep the in-app browser visible and execute every business step in Round 1 with a fresh fixture.
- [ ] Execute every business step again in Round 2 with a different fresh fixture.
- [ ] Verify every mutation has screenshot, RPC, bounded SQL, audit, log and timestamp evidence.
- [ ] Generate and checksum the categorized report; keep overall status `NOT_READY` if any evidence or case is missing.
- [ ] Commit the accepted evidence only when all cases pass, then mark the project `ACCEPTED`.
