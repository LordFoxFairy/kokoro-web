# IAM Administration Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Admin Web's obsolete Prisma/platform-gateway authority with a complete Auth.js
database-session BFF and production IAM management console backed only by generated ConnectRPC
clients, then prove it through repository acceptance and two fresh Chromium pair rounds.

**Architecture:** Next.js App Router and Auth.js own browser authentication; a deterministic
consumer-owned Proto snapshot generates server-only IAM clients. Protected Server Components and
server actions exchange the opaque Auth.js database Session cookie for a short-lived IAM actor JWT
on every operation. Ant Design Pro renders static IAM modules, while IAM remains the only business
and persistence authority.

**Tech Stack:** Node 22, pnpm 11.2.2, Next.js 16.2.6, React 19.2.4, NextAuth
5.0.0-beta.31, Ant Design 6.5.0, Pro Components 2.8.10, ConnectRPC 2.1.2, Protobuf
2.14.0, Buf 1.72.0, Zod 4.4.3, Vitest 4.1.10, Testing Library, Playwright 1.51.1.

## Global Constraints

- Follow `apps/admin/docs/product/PRD-001-iam-control-plane.md`,
  `apps/admin/docs/architecture/iam-control-plane-technical-design.md`, and
  `apps/admin/docs/decisions/ADR-001-iam-rpc-control-plane.md`.
- Consume IAM candidate `16afccdbec9c22176f9fd493feeb0ed0d7fe3445`, tree
  `a72b870c8e890eb63176ddb80cc34df3658a474f`, and frozen hashes exactly.
- Keep Next.js, React, Auth.js, Ant Design, Pro Components, Tailwind tokens, and `@kokoro/i18n`.
- Do not add another authentication, administration, component, query-state, or form framework.
- Admin Web runtime, pages, actions, and application tests never receive an IAM database credential.
- Generated descriptors and IAM transports are server-only and never imported by Client Components.
- Use Auth.js database Sessions; do not retain JWT-session, middleware/proxy, Prisma, gateway rewrite,
  proxy-secret, dynamic manifest, compatibility route, or legacy directory code.
- Every command uses one stable command UUID, one request UUID, a non-empty reason, and current actor.
- Write production behavior test-first. No P0 case may be skipped, marked todo/only, retried, or
  replaced by a mocked IAM/PostgreSQL result in formal acceptance.
- Every subrepository owns its config, tests, reports, CI, runtime entry, and ignored real `.env`.
- Do not declare completion before a fresh full verification and immutable acceptance report.

---

## File Map

```text
package.json / pnpm-lock.yaml                       repository toolchain and whole-Web gates
apps/admin/package.json                            exact Admin commands/dependencies
apps/admin/contracts/iam/**                        frozen provider metadata and Proto snapshot
apps/admin/generated/iam/**                        committed deterministic Protobuf-ES output
apps/admin/server/config/**                        strict Node-only environment and secret files
apps/admin/server/auth/**                          Auth.js Adapter, cookie, session/actor boundary
apps/admin/server/iam/**                           Connect transport, errors, records, typed clients
apps/admin/server/commands/**                      stable command identity and action result
apps/admin/modules/iam/**                          feature-owned queries/actions/view models
apps/admin/components/**                           shell and reusable control-plane UI
apps/admin/app/(public)/**                          login and verification surfaces
apps/admin/app/(control)/**                         protected IAM routes
apps/admin/test/catalog/p0.yaml                     executable requirement/evidence authority
apps/admin/test/<category>/**                       repository-owned test categories
apps/admin/scripts/test/**                          acceptance/pair runners and evidence helpers
apps/admin/reports/**                               report templates and accepted immutable runs
```

### Task 1: Deterministic Toolchain and P0 Test Authority

**Files:**
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `apps/admin/package.json`
- Modify: `apps/admin/eslint.config.mjs`
- Modify: `apps/admin/vitest.config.ts`
- Modify: `apps/admin/tsconfig.json`
- Create: `apps/admin/test/setup/component.ts`
- Create: `apps/admin/test/catalog/p0.yaml`
- Create: `apps/admin/scripts/test/catalog.ts`
- Create: `apps/admin/test/contract/catalog.test.ts`
- Create: `apps/admin/test/contract/toolchain-boundary.test.ts`
- Create: `apps/admin/reports/templates/acceptance-report.md`
- Create: `apps/admin/test/README.md`
- Modify: `apps/admin/docs/README.md`

**Interfaces:**
- Consumes: PRD requirement/acceptance IDs and ten IAM shared pair IDs.
- Produces: exact toolchain scripts, classified Vitest environments, executable catalog loader, and
  report structure used by all later tasks.

- [x] **Step 1: Write failing toolchain and catalog tests**

The toolchain test reads source/config files and requires native Next 16 flat config, no
`FlatCompat`, exact Admin dependency pins, and scripts for every category.
The catalog test parses YAML with a strict Zod schema and asserts:

```ts
expect(catalog.schemaVersion).toBe(1);
expect(catalog.acceptance.retryCount).toBe(0);
expect(catalog.acceptance.chromiumRounds).toBe(2);
expect(new Set(catalog.cases.map((entry) => entry.id)).size).toBe(catalog.cases.length);
expect(sharedPairIds).toEqual([
  "IAM-SEC-ENUM-001",
  "IAM-SEC-REDIRECT-001",
  "IAM-E2E-AUTH-001",
  "IAM-E2E-SESSION-001",
  "IAM-E2E-ORG-001",
  "IAM-E2E-MEMBER-001",
  "IAM-E2E-RBAC-001",
  "IAM-E2E-DELETE-001",
  "IAM-E2E-IDEM-001",
  "IAM-E2E-FRESH-001",
]);
```

Catalog Admin-owned cases under `unit`, `component`, `contract`, `integration`, and `security` and
map every `WEB-IAM-FR-*`/`WEB-IAM-ACC-*` exactly once or more.

Use this initial case inventory; later tasks implement the named executable files without renaming
the IDs:

```text
unit:
  WEB-UNIT-CONFIG-001       strict environment and paired SMTP
  WEB-UNIT-SECRET-001       exact-0600 secret file boundary
  WEB-UNIT-COOKIE-001       explicit secure/local Session cookie
  WEB-UNIT-ADAPTER-001      fourteen Auth.js Adapter mappings
  WEB-UNIT-ERROR-001        safe IAM ErrorDetail translation
  WEB-UNIT-RECORD-001       generated record validation/mapping
  WEB-UNIT-COMMAND-001      stable command identity/recovery
  WEB-UNIT-PAGE-001         filter/cursor/limit rules
component:
  WEB-COMP-LOGIN-001        login and uniform verification states
  WEB-COMP-SHELL-001        navigation/logout/responsive shell
  WEB-COMP-STATE-001        loading/empty/forbidden/unavailable/malformed
  WEB-COMP-USER-001         User list/detail/lifecycle dialogs
  WEB-COMP-SESSION-001      Session inventory/revocation
  WEB-COMP-ORG-001          Organization list/detail/lifecycle
  WEB-COMP-MEMBER-001       Member lifecycle/last-owner state
  WEB-COMP-ACCESS-001       Role/Permission/live authorization
  WEB-COMP-AUDIT-001        SecurityEvent filters/correlation
  WEB-COMP-A11Y-001         keyboard/focus/announcements/360px semantics
contract:
  WEB-CONTRACT-CATALOG-001  complete unique PRD/test mapping
  WEB-CONTRACT-TOOLS-001    exact scripts/dependencies/native ESLint
  WEB-CONTRACT-PROTO-001    frozen provider metadata/deterministic output
  WEB-CONTRACT-RPC-001      five services and required methods
  WEB-CONTRACT-BOUNDARY-001 server-only IAM/no SQL/Prisma/sibling imports
  WEB-CONTRACT-I18N-001     complete Chinese/English key sets
  WEB-CONTRACT-BUILD-001    production bundle/route/import boundary
  WEB-CONTRACT-RUNTIME-001  real Next listener and generated client
integration:
  WEB-INT-AUTH-001          real Auth.js request/callback route behavior
  WEB-INT-SESSION-001       database Session/actor exchange/logout
  WEB-INT-USER-001          User command/result/reload behavior
  WEB-INT-SESSION-002       Session revoke one/all behavior
  WEB-INT-ORG-001           Organization command/result/reload behavior
  WEB-INT-MEMBER-001        Member and live authorization behavior
  WEB-INT-AUDIT-001         exact filters/cursors/event correlation
  WEB-INT-SMOKE-001         production-shaped HTTP smoke
security:
  WEB-SEC-ENUM-001          login-request enumeration resistance
  WEB-SEC-REDIRECT-001      callback/return URL rejection
  WEB-SEC-SECRET-001        source/log/error/artifact secret leakage
  WEB-SEC-ROUTE-001         protected route/platform-admin fail closed
  WEB-SEC-TENANT-001        cross-organization nondisclosure
  WEB-SEC-OWNER-001         last-owner preservation
  WEB-SEC-HEADER-001        browser and BFF security headers
  WEB-SEC-INPUT-001         hostile boundary inputs
  WEB-SEC-METADATA-001      audit metadata safe projection
pair_e2e:
  IAM-SEC-ENUM-001          IAM-SEC-REDIRECT-001
  IAM-E2E-AUTH-001          IAM-E2E-SESSION-001
  IAM-E2E-ORG-001           IAM-E2E-MEMBER-001
  IAM-E2E-RBAC-001          IAM-E2E-DELETE-001
  IAM-E2E-IDEM-001          IAM-E2E-FRESH-001
```

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm --filter @kokoro/admin-web exec vitest run test/contract/catalog.test.ts test/contract/toolchain-boundary.test.ts
```

Expected: fail because the catalog does not exist and Admin still uses `FlatCompat`, Prisma build
scripts/dependencies, caret ranges, and unclassified test scripts.

- [x] **Step 3: Replace the stale ESLint bridge and define exact scripts**

Use the proven native Next 16 shape:

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "generated/**", "test-results/**", "next-env.d.ts"]),
]);
```

Add `test:unit`, `test:component`, `test:contract`, `test:integration`, `test:security`, `test:catalog`,
`proto:lint`, `proto:generate`, `proto:check`, `smoke`, `verify`, `acceptance`, and `acceptance:pair`.
Configure Vitest projects for Node categories and jsdom components, using the same isolated-linker
matcher registration already proven in `apps/user/tests/setup.ts`.

- [x] **Step 4: Add the catalog and report template**

Define each case with stable ID, category, title, PRD requirements, acceptance IDs, executable test
file, expected evidence types, retry `0`, and initial status. Pair cases remain `NOT_STARTED`; every
Admin-owned case starts `PLANNED` and must become executable before repository acceptance.

- [x] **Step 5: Install exactly and verify GREEN**

Run:

```bash
pnpm install --frozen-lockfile=false
pnpm --filter @kokoro/admin-web test:catalog
pnpm --filter @kokoro/admin-web typecheck
pnpm --filter @kokoro/admin-web lint --max-warnings=0
```

Expected: catalog/toolchain tests pass and ESLint evaluates source with zero warnings. Existing
Prisma production removal remains for Task 5 after the replacement Auth.js Adapter is executable.

- [x] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml apps/admin
git commit -m "test(admin): establish IAM control plane gates"
```

### Task 2: Frozen IAM Contract and Deterministic Generated Client

**Files:**
- Modify: `apps/admin/package.json`
- Create: `apps/admin/contracts/iam/provider.json`
- Create: `apps/admin/contracts/iam/buf.yaml`
- Create: `apps/admin/contracts/iam/buf.lock`
- Create: `apps/admin/contracts/iam/buf.gen.yaml`
- Create: `apps/admin/contracts/iam/proto/kokoro/common/v1/error.proto`
- Create: `apps/admin/contracts/iam/proto/kokoro/iam/v1/*.proto`
- Create: `apps/admin/generated/iam/**`
- Create: `apps/admin/generated/iam/INDEX.md`
- Create: `apps/admin/scripts/contracts/import-iam.ts`
- Create: `apps/admin/test/contract/provider-snapshot.test.ts`
- Create: `apps/admin/test/contract/generated-services.test.ts`

**Interfaces:**
- Consumes: exact IAM candidate and provider-owned Proto.
- Produces: checked-in Protobuf-ES descriptors for all five IAM services and a verified provider
  metadata contract consumed by every server client and pair report.

- [x] **Step 1: Write failing provider/service inventory tests**

Assert exact metadata values and generated method inventories. The Adapter inventory is exactly the
fourteen provider methods; Administration, Organization, Authorization, and Session inventories are
read from their accepted Proto descriptors. Assert generated source contains no sibling absolute
path and all generated files carry the exact `@generated` tool marker.

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @kokoro/admin-web test:contract -- provider-snapshot generated-services
```

Expected: fail because provider metadata and generated descriptors do not exist.

- [x] **Step 3: Implement the exact import and generation flow**

`provider.json` records:

```json
{
  "repository": "kokoro-iam",
  "commit": "16afccdbec9c22176f9fd493feeb0ed0d7fe3445",
  "tree": "a72b870c8e890eb63176ddb80cc34df3658a474f",
  "protoSha256": "4daad8affaa7eb36e8f587dca3a016dd080b3ca4f3e36f08a19963133a27e38a",
  "migrationSha256": "846491c5a72331a8d7aa1a2b51a153165dc636957ac1edf867e3836405f358c2",
  "catalogSha256": "e388f4a865fa98744989f3e7a6d41d2bf8e6367ae51b8eeee804c763b4bc8552",
  "acceptedRunId": "iam-20260816T111434155Z-16afccdbec9c"
}
```

The import script executes read-only `git show`/`git archive`, copies only the approved files,
computes ordered per-file hashes, and rejects any mismatch. Buf generation uses `target=ts` with
extensionless imports and cleans `generated/iam` before output.

- [x] **Step 4: Generate and verify GREEN**

Run:

```bash
pnpm --filter @kokoro/admin-web proto:generate
pnpm --filter @kokoro/admin-web proto:check
pnpm --filter @kokoro/admin-web test:contract -- provider-snapshot generated-services
```

Expected: deterministic diff is empty on the second generation and both contract tests pass.

- [x] **Step 5: Commit**

```bash
git add apps/admin/contracts apps/admin/generated apps/admin/scripts/contracts apps/admin/package.json pnpm-lock.yaml apps/admin/test/contract
git commit -m "feat(admin): consume frozen IAM RPC contract"
```

### Task 3: Strict Server Boundary, Transport, Errors, and Domain Records

**Files:**
- Create: `apps/admin/server/config/secret-file.ts`
- Create: `apps/admin/server/config/config.ts`
- Create: `apps/admin/server/config/INDEX.md`
- Create: `apps/admin/server/iam/transport.ts`
- Create: `apps/admin/server/iam/error.ts`
- Create: `apps/admin/server/iam/records.ts`
- Create: `apps/admin/server/iam/INDEX.md`
- Create: `apps/admin/server/logging/logger.ts`
- Modify: `apps/admin/.env.example`
- Create: `apps/admin/test/unit/config.test.ts`
- Create: `apps/admin/test/unit/secret-file.test.ts`
- Create: `apps/admin/test/unit/iam-error.test.ts`
- Create: `apps/admin/test/unit/iam-records.test.ts`
- Create: `apps/admin/test/contract/server-boundary.test.ts`
- Create: `apps/admin/test/security/secret-leakage.test.ts`

**Interfaces:**
- Consumes: generated IAM descriptors and exact runtime environment names.
- Produces: `loadAdminConfig()`, `createWorkloadTransport()`, `createActorTransport()`,
  `toIamWebError()`, strict domain record mappers, and structured safe logging.

- [x] **Step 1: Write failing config/security/boundary tests**

Test absolute normalized non-symlink exact-0600 secret files, 64 lowercase-hex IAM credential,
Auth.js secret length, paired SMTP authentication, production browser HTTPS/secure-cookie
requirement, configured IAM ConnectRPC endpoint, distinct request/response limits, and rejection of
raw upstream messages.
Boundary tests scan Client Components and compiled entry imports for `connect-node`, generated IAM,
secret-file modules, SQL, Prisma, and secret environment names.

- [x] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @kokoro/admin-web test:unit -- config secret-file iam-error iam-records
pnpm --filter @kokoro/admin-web test:contract -- server-boundary
pnpm --filter @kokoro/admin-web test:security -- secret-leakage
```

- [x] **Step 3: Implement strict Node-only modules**

Every file starts with `import "server-only"`. Expose these stable signatures:

```ts
export function loadAdminConfig(source?: NodeJS.ProcessEnv): AdminRuntimeConfig;
export function createWorkloadTransport(config: IamTransportConfig): Transport;
export function createActorTransport(config: IamTransportConfig, actorToken: string): Transport;
export function toIamWebError(error: unknown): IamWebError;
export function userFromRecord(record: UserRecord | undefined): AdminUser;
export function organizationFromRecord(record: OrganizationRecord | undefined): AdminOrganization;
```

Configuration reads `AUTH_URL`, `AUTH_SECRET_FILE`, `AUTH_SECURE_COOKIES`, `KOKORO_IAM_BASE_URL`,
`KOKORO_IAM_ADMIN_WEB_TOKEN_FILE`, Magic Link, and SMTP fields. The transport sets workload and actor
Bearer headers only on the server and never retries commands.

- [x] **Step 4: Verify GREEN and commit**

```bash
pnpm --filter @kokoro/admin-web test:unit
pnpm --filter @kokoro/admin-web test:contract
pnpm --filter @kokoro/admin-web test:security
pnpm --filter @kokoro/admin-web typecheck
git add apps/admin
git commit -m "feat(admin): establish secure IAM client boundary"
```

### Task 4: Complete Auth.js RPC Adapter and Database Session Actor Exchange

**Files:**
- Rewrite: `apps/admin/auth.ts`
- Rewrite: `apps/admin/lib/auth/adapter.ts` to `apps/admin/server/auth/adapter.ts`
- Delete: `apps/admin/lib/auth/events.ts`
- Rewrite: `apps/admin/lib/auth/email.ts` to `apps/admin/server/auth/email.ts`
- Delete: `apps/admin/lib/env.ts`
- Delete: `apps/admin/lib/env.test.ts`
- Create: `apps/admin/server/auth/cookie.ts`
- Create: `apps/admin/server/auth/session.ts`
- Create: `apps/admin/server/auth/next-auth.d.ts`
- Create: `apps/admin/server/auth/INDEX.md`
- Create: `apps/admin/server/iam/auth-adapter-client.ts`
- Create: `apps/admin/server/iam/session-client.ts`
- Modify: `apps/admin/app/api/auth/[...nextauth]/route.ts`
- Create: `apps/admin/test/unit/auth-cookie.test.ts`
- Rewrite: `apps/admin/lib/auth/adapter.test.ts` to `apps/admin/test/unit/auth-adapter.test.ts`
- Create: `apps/admin/test/integration/auth-routes.test.ts`
- Create: `apps/admin/test/integration/database-session.test.ts`
- Create: `apps/admin/test/security/enumeration.test.ts`
- Create: `apps/admin/test/security/redirect-policy.test.ts`

**Interfaces:**
- Consumes: workload transport, generated AuthAdapter/Session services, strict config, Auth.js.
- Produces: `createIamAuthAdapter()`, exported Auth.js `handlers/auth/signIn/signOut`,
  `sessionCookie()`, `requireAdminSession()`, and `requireIamActor()`.

- [x] **Step 1: Write failing Adapter and Session tests**

Test all fourteen methods, `null` optional mapping, WKT dates, safe int64 account expiry, registration
denial, active/suspended/deleted session resolution, database Session creation/update/delete, explicit
cookie names/options, platform-admin route guard, actor exchange, logout, enumeration-safe request
state, callback replay, and redirect rejection.

- [x] **Step 2: Verify RED**

```bash
pnpm --filter @kokoro/admin-web test:unit -- auth-adapter auth-cookie
pnpm --filter @kokoro/admin-web test:integration -- auth-routes database-session
pnpm --filter @kokoro/admin-web test:security -- enumeration redirect-policy
```

- [x] **Step 3: Implement Adapter and Auth.js database Session**

The Adapter maps one-for-one to IAM. Auth.js config uses:

```ts
session: { strategy: "database", maxAge: 28_800, updateAge: 3_600 },
adapter: createIamAuthAdapter(authAdapterClient),
cookies: { sessionToken: sessionCookie(config) },
pages: { signIn: "/login", verifyRequest: "/auth/verify", error: "/auth/verify" },
```

The public Session includes safe `id`, `email`, `name`, `platformRole`, and `status`; it never includes
the opaque Session token or IAM actor JWT. `requireIamActor()` reads the explicit cookie server-side,
calls `IssueAccessToken`, and returns an actor transport/client bundle for one server operation.

Expose narrow Adapter/Session ports rather than generated clients:

```ts
export interface IamAuthAdapterClient {
  createUser(value: AdapterUser): Promise<AdapterUser>;
  getUser(id: string): Promise<AdapterUser | null>;
  getUserByEmail(email: string): Promise<AdapterUser | null>;
  getUserByAccount(key: Pick<AdapterAccount, "provider" | "providerAccountId">): Promise<AdapterUser | null>;
  updateUser(value: Partial<AdapterUser> & Pick<AdapterUser, "id">): Promise<AdapterUser>;
  deleteUser(id: string): Promise<void>;
  linkAccount(value: AdapterAccount): Promise<AdapterAccount | null>;
  unlinkAccount(key: Pick<AdapterAccount, "provider" | "providerAccountId">): Promise<void>;
  createSession(value: AdapterSession): Promise<AdapterSession>;
  getSessionAndUser(token: string): Promise<{ session: AdapterSession; user: AdapterUser } | null>;
  updateSession(value: Partial<AdapterSession> & Pick<AdapterSession, "sessionToken">): Promise<AdapterSession | null>;
  deleteSession(token: string): Promise<void>;
  createVerificationToken(value: VerificationToken): Promise<VerificationToken>;
  useVerificationToken(key: Pick<VerificationToken, "identifier" | "token">): Promise<VerificationToken | null>;
}

export interface IamSessionClient {
  issueAccessToken(sessionToken: string, organizationId?: string): Promise<{ accessToken: string; expiresAt: Date }>;
}
```

- [x] **Step 4: Verify GREEN and commit**

```bash
pnpm --filter @kokoro/admin-web test:unit
pnpm --filter @kokoro/admin-web test:integration
pnpm --filter @kokoro/admin-web test:security
pnpm --filter @kokoro/admin-web typecheck
git add apps/admin
git commit -m "feat(admin): use IAM-backed Auth.js database sessions"
```

### Task 5: Protected Shell, Public Authentication UI, and Hard Authority Cut

**Files:**
- Rewrite: `apps/admin/app/layout.tsx`
- Move/rewrite: `apps/admin/app/login/page.tsx` to `apps/admin/app/(public)/login/page.tsx`
- Move/rewrite: `apps/admin/app/auth/verify/page.tsx` to `apps/admin/app/(public)/auth/verify/page.tsx`
- Create: `apps/admin/app/(control)/layout.tsx`
- Rewrite: `apps/admin/components/shell/app-shell.tsx` to `apps/admin/components/shell/admin-shell.tsx`
- Create: `apps/admin/components/shell/navigation.ts`
- Create: `apps/admin/components/feedback/page-state.tsx`
- Create: `apps/admin/components/command/command-dialog.tsx`
- Create: `apps/admin/components/data/cursor-pagination.tsx`
- Create: `apps/admin/components/data/status-tag.tsx`
- Rewrite: `apps/admin/lib/i18n/messages.ts` to `apps/admin/i18n/messages.ts`
- Rewrite: `apps/admin/lib/i18n/en.ts` to `apps/admin/i18n/en.ts`
- Move: `apps/admin/lib/i18n/context.tsx` to `apps/admin/i18n/context.tsx`
- Modify: `apps/admin/app/globals.css`
- Modify: `apps/admin/lib/theme.ts`
- Modify: `apps/admin/next.config.ts`
- Delete: `apps/admin/auth.config.ts`
- Delete: `apps/admin/middleware.ts`
- Delete: `apps/admin/prisma/schema.prisma`
- Delete: `apps/admin/lib/prisma.ts`
- Delete: `apps/admin/app/teams/page.tsx`
- Delete: `apps/admin/app/credit/page.tsx`
- Delete: `apps/admin/app/payment/page.tsx`
- Delete: `apps/admin/app/sites/page.tsx`
- Delete: `apps/admin/app/models/page.tsx`
- Delete: `apps/admin/app/hub/page.tsx`
- Delete: `apps/admin/app/approvals/page.tsx`
- Delete: `apps/admin/app/operators/page.tsx`
- Delete: `apps/admin/app/users/page.tsx`
- Delete: `apps/admin/app/audit/page.tsx`
- Delete: `apps/admin/app/page.tsx`
- Delete: `apps/admin/components/shell/resource-table.tsx`
- Delete: `apps/admin/components/shell/endpoint-table.tsx`
- Delete: `apps/admin/components/shell/skill-upload-modal.tsx`
- Delete: `apps/admin/components/ui/badge.tsx`
- Delete: `apps/admin/components/ui/button.tsx`
- Delete: `apps/admin/components/ui/card.tsx`
- Delete: `apps/admin/components/ui/dialog.tsx`
- Delete: `apps/admin/components/ui/input.tsx`
- Delete: `apps/admin/components/ui/label.tsx`
- Delete: `apps/admin/components/ui/select.tsx`
- Delete: `apps/admin/components/ui/table.tsx`
- Delete: `apps/admin/components.json`
- Delete: `apps/admin/lib/actions.ts`
- Delete: `apps/admin/lib/api.ts`
- Delete: `apps/admin/lib/api.test.ts`
- Delete: `apps/admin/lib/format.ts`
- Delete: `apps/admin/lib/resource-forms.ts`
- Delete: `apps/admin/lib/resource-forms.test.ts`
- Delete: `apps/admin/lib/schemas.ts`
- Delete: `apps/admin/lib/utils.ts`
- Create: `apps/admin/app/(control)/page.tsx`
- Modify: `apps/admin/package.json`
- Modify: `pnpm-workspace.yaml`
- Create: `apps/admin/test/component/login.test.tsx`
- Create: `apps/admin/test/component/admin-shell.test.tsx`
- Create: `apps/admin/test/component/page-state.test.tsx`
- Create: `apps/admin/test/component/command-dialog.test.tsx`
- Create: `apps/admin/test/contract/hard-cut-boundary.test.ts`
- Create: `apps/admin/test/contract/i18n-completeness.test.ts`
- Create: `apps/admin/test/security/headers.test.ts`

**Interfaces:**
- Consumes: Auth.js route/session boundary and static IAM module registry shape.
- Produces: public auth routes, Node-protected control layout, reusable accessible UI primitives,
  complete bilingual copy, and zero old authority files/dependencies.

- [x] **Step 1: Write failing shell/hard-cut/i18n/header tests**

Assert protected/public route behavior, compact grouped navigation, mobile drawer, logout, loading /
empty / filtered-empty / forbidden / unavailable / malformed states, required-reason dialog, keyboard
focus/announcements, exact Chinese/English key equality, security headers, and absence of Prisma,
gateway URLs/secrets, rewrites, old routes, JWT strategy, no-op Adapter methods, Radix/shadcn dead code,
and console Magic Link output.

- [x] **Step 2: Verify RED**

```bash
pnpm --filter @kokoro/admin-web test:component
pnpm --filter @kokoro/admin-web test:contract -- hard-cut i18n
pnpm --filter @kokoro/admin-web test:security -- headers
```

- [x] **Step 3: Implement the final shell and delete obsolete code**

Use route groups without changing public URLs. `app/layout.tsx` contains global providers only;
`(control)/layout.tsx` calls `requireAdminSession`. The initial static registry contains Overview;
Tasks 6-8 add their routes and navigation entries as each vertical slice becomes executable. Keep
AntdRegistry, ProLayout, Ant icons, theme tokens, Tailwind login layout, stable table/dialog
dimensions, 360px support, and reduced motion. The initial Overview renders real IAM readiness and
the authenticated administrator summary, not a placeholder feature page.

Remove every unimported legacy file and dependency in the same task; do not create redirect aliases or
feature flags.

- [x] **Step 4: Verify GREEN and commit**

```bash
pnpm install --frozen-lockfile=false
pnpm --filter @kokoro/admin-web test:component
pnpm --filter @kokoro/admin-web test:contract
pnpm --filter @kokoro/admin-web test:security
pnpm --filter @kokoro/admin-web typecheck
pnpm --filter @kokoro/admin-web lint --max-warnings=0
git add pnpm-workspace.yaml pnpm-lock.yaml apps/admin
git commit -m "refactor(admin): cut over to IAM control plane shell"
```

### Task 6: Users and Sessions Vertical Slice

**Files:**
- Create: `apps/admin/server/iam/management-client.ts`
- Create: `apps/admin/server/commands/identity.ts`
- Create: `apps/admin/server/commands/result.ts`
- Create: `apps/admin/modules/iam/users/query.ts`
- Create: `apps/admin/modules/iam/users/url.ts`
- Create: `apps/admin/modules/iam/users/actions.ts`
- Create: `apps/admin/modules/iam/users/action-server.ts`
- Create: `apps/admin/modules/iam/users/schema.ts`
- Create: `apps/admin/modules/iam/users/user-table.tsx`
- Create: `apps/admin/modules/iam/users/user-detail.tsx`
- Create: `apps/admin/modules/iam/sessions/query.ts`
- Create: `apps/admin/modules/iam/sessions/url.ts`
- Create: `apps/admin/modules/iam/sessions/actions.ts`
- Create: `apps/admin/modules/iam/sessions/action-server.ts`
- Create: `apps/admin/modules/iam/sessions/session-table.tsx`
- Create: `apps/admin/app/(control)/users/page.tsx`
- Create: `apps/admin/app/(control)/users/[userId]/page.tsx`
- Create: `apps/admin/app/(control)/sessions/page.tsx`
- Create: `apps/admin/test/unit/command-identity.test.ts`
- Create: `apps/admin/test/unit/pagination.test.ts`
- Create: `apps/admin/test/component/users.test.tsx`
- Create: `apps/admin/test/component/sessions.test.tsx`
- Create: `apps/admin/test/integration/user-actions.test.ts`
- Create: `apps/admin/test/integration/session-actions.test.ts`

**Interfaces:**
- Consumes: actor management/session clients, command/error boundary, shared UI.
- Produces: authoritative User search/detail/lifecycle and Session list/revocation routes with stable
  URL filters/cursors and command recovery.

- [x] **Step 1: Write failing query/action/component tests**

Cover query/status/include-deleted, cursor reset/round-trip, page limit 25/max 100, missing/deleted
detail, Session token exclusion, suspend/reactivate/delete/restore, revoke one/all, required reason,
expected version, stable command ID on double submit/in-progress, safe errors, reload after success,
and correlated User events.

- [x] **Step 2: Verify RED**

```bash
pnpm --filter @kokoro/admin-web test:unit -- command-identity pagination
pnpm --filter @kokoro/admin-web test:component -- users sessions
pnpm --filter @kokoro/admin-web test:integration -- user-actions session-actions
```

- [x] **Step 3: Implement reads and commands through narrow clients**

Server page queries return `Readonly<{ items; nextCursor; filters }>` view models. Actions return:

```ts
type CommandActionResult =
  | Readonly<{ status: "success"; commandId: string; replayed: boolean }>
  | Readonly<{ status: "error"; commandId: string; kind: IamWebError["kind"]; requestId: string; field?: string }>;
```

Tables receive no generated message or secret. After success, actions revalidate the list/detail path.

- [x] **Step 4: Verify GREEN and commit**

```bash
pnpm --filter @kokoro/admin-web test:unit
pnpm --filter @kokoro/admin-web test:component
pnpm --filter @kokoro/admin-web test:integration
pnpm --filter @kokoro/admin-web typecheck
git add apps/admin
git commit -m "feat(admin): manage IAM users and sessions"
```

### Task 7: Organizations, Members, and Live Access Vertical Slice

**Files:**
- Create: `apps/admin/modules/iam/organizations/query.ts`
- Create: `apps/admin/modules/iam/organizations/actions.ts`
- Create: `apps/admin/modules/iam/organizations/action-server.ts`
- Create: `apps/admin/modules/iam/organizations/schema.ts`
- Create: `apps/admin/modules/iam/organizations/url.ts`
- Create: `apps/admin/modules/iam/organizations/organization-table.tsx`
- Create: `apps/admin/modules/iam/organizations/organization-detail.tsx`
- Create: `apps/admin/modules/iam/members/actions.ts`
- Create: `apps/admin/modules/iam/members/action-server.ts`
- Create: `apps/admin/modules/iam/members/schema.ts`
- Create: `apps/admin/modules/iam/members/member-table.tsx`
- Create: `apps/admin/modules/iam/access/query.ts`
- Create: `apps/admin/modules/iam/access/schema.ts`
- Create: `apps/admin/modules/iam/access/url.ts`
- Create: `apps/admin/modules/iam/access/access-catalog.tsx`
- Create: `apps/admin/app/(control)/organizations/page.tsx`
- Create: `apps/admin/app/(control)/organizations/[organizationId]/page.tsx`
- Create: `apps/admin/app/(control)/access/page.tsx`
- Create: `apps/admin/test/component/organizations.test.tsx`
- Create: `apps/admin/test/component/members.test.tsx`
- Create: `apps/admin/test/component/access.test.tsx`
- Create: `apps/admin/test/integration/organization-actions.test.ts`
- Create: `apps/admin/test/integration/member-actions.test.ts`
- Create: `apps/admin/test/security/tenant-isolation.test.ts`
- Create: `apps/admin/test/security/last-owner.test.ts`

**Interfaces:**
- Consumes: Organization/Authorization generated methods through `IamManagementClient`.
- Produces: Organization lifecycle, complete Member lifecycle, Role/Permission catalog, live
  authorization probe, tenant isolation, and last-owner UI behavior.

**Provider contract:** the frozen Provider requires `organization_id` on every non-add Member
command and exposes administrator-only `InspectUserAuthorization` for a selected User. Admin Web
validates Organization and User response correlation; real pair evidence must still prove the full
grant/deny transition.

- [x] **Step 1: Write failing organization/member/RBAC tests**

Cover create/update/reload/delete/find-deleted/restore, slug/name validation, restore conflict,
add/list/change/suspend/reactivate/remove/restore Member, active User lookup, built-in role options,
last-owner preservation, cross-organization nondisclosure, permission/role catalogs, and grant/allow
then role-change or suspension/revoke/deny.

- [x] **Step 2: Verify RED**

```bash
pnpm --filter @kokoro/admin-web test:component -- organizations members access
pnpm --filter @kokoro/admin-web test:integration -- organization-actions member-actions
pnpm --filter @kokoro/admin-web test:security -- tenant-isolation last-owner
```

- [x] **Step 3: Implement the vertical slice**

Use `IamAdministrationService/ListOrganizations` for platform search and
`IamOrganizationService` for lifecycle/member commands. Load Role catalog per Organization and
Permission catalog on Access. Do not expose custom Role/Permission mutation controls. Preserve IAM
`last_owner`, `conflict`, and `not_found` results without a client fallback.

- [x] **Step 4: Verify GREEN and commit**

```bash
pnpm --filter @kokoro/admin-web test:component
pnpm --filter @kokoro/admin-web test:integration
pnpm --filter @kokoro/admin-web test:security
pnpm --filter @kokoro/admin-web typecheck
git add apps/admin
git commit -m "feat(admin): manage IAM organizations and access"
```

### Task 8: Audit Ledger, Overview, and Final UI States

**Files:**
- Create: `apps/admin/modules/iam/audit/query.ts`
- Create: `apps/admin/modules/iam/audit/schema.ts`
- Create: `apps/admin/modules/iam/audit/event-table.tsx`
- Create: `apps/admin/modules/iam/overview/query.ts`
- Create: `apps/admin/modules/iam/overview/overview.tsx`
- Create: `apps/admin/modules/iam/registry.ts`
- Create: `apps/admin/modules/iam/INDEX.md`
- Create: `apps/admin/app/(control)/audit/page.tsx`
- Modify: `apps/admin/app/(control)/page.tsx`
- Create: `apps/admin/test/component/audit.test.tsx`
- Create: `apps/admin/test/component/overview.test.tsx`
- Create: `apps/admin/test/integration/audit-query.test.ts`
- Create: `apps/admin/test/security/audit-metadata.test.ts`

**Interfaces:**
- Consumes: readiness and `ListSecurityEvents` through safe server ports.
- Produces: filtered/cursor Audit route, safe metadata projection, honest overview, and final static
  IAM module registry for the shell.

- [x] **Step 1: Write failing audit/overview tests**

Cover all exact event filters, invalid UUID/time range, cursor navigation, copyable request/command
IDs, malformed/oversized/secret-bearing metadata hidden, IAM readiness, recent event limit 10, no
fabricated totals, unavailable/malformed states, and complete registry/navigation.

- [x] **Step 2: Verify RED**

```bash
pnpm --filter @kokoro/admin-web test:component -- audit overview
pnpm --filter @kokoro/admin-web test:integration -- audit-query
pnpm --filter @kokoro/admin-web test:security -- audit-metadata
```

- [x] **Step 3: Implement, verify GREEN, and commit**

```bash
pnpm --filter @kokoro/admin-web test:component
pnpm --filter @kokoro/admin-web test:integration
pnpm --filter @kokoro/admin-web test:security
pnpm --filter @kokoro/admin-web typecheck
pnpm --filter @kokoro/admin-web lint --max-warnings=0
git add apps/admin
git commit -m "feat(admin): add IAM audit and operations overview"
```

### Task 9: Build Boundary, Runtime Smoke, and Repository Acceptance

**Files:**
- Create: `apps/admin/scripts/test/evidence.ts`
- Create: `apps/admin/scripts/test/smoke-runtime.ts`
- Create: `apps/admin/scripts/test/run-acceptance.ts`
- Create: `apps/admin/test/contract/build-boundary.test.ts`
- Create: `apps/admin/test/contract/runtime-listener.test.ts`
- Create: `apps/admin/test/security/hostile-input.test.ts`
- Create: `apps/admin/test/security/production-bundle.test.ts`
- Create: `apps/admin/test/security/route-authorization.test.ts`
- Modify: `apps/admin/test/unit/config.test.ts`
- Modify: `apps/admin/server/config/config.ts`
- Modify: `apps/admin/modules/iam/audit/schema.ts`
- Modify: `apps/admin/test/catalog/p0.yaml`
- Modify: `apps/admin/test/README.md`
- Modify: `apps/admin/README.md`
- Modify: `apps/admin/package.json`
- Modify: `apps/admin/docs/architecture/iam-control-plane-technical-design.md`
- Create: `apps/admin/reports/README.md`

**Interfaces:**
- Consumes: complete Admin Web, executable P0 catalog, production build.
- Produces: `pnpm verify`, real server smoke, immutable Web repository report/manifest/checksums, and
  a clean candidate ready for pair execution.

- [x] **Step 1: Write failing build/runtime/acceptance tests**

Assert production manifest/bundles contain no Prisma, SQL, database URL, workload credential value,
actor/session/verification token, generated IAM import in a client chunk, sibling path, wildcard API
rewrite, or old route. Start `next start`, verify security headers/public login/protected redirect,
and invoke a real generated IAM-compatible listener. Catalog test now requires every Admin-owned P0
case executable with no `PLANNED` status.

- [x] **Step 2: Verify RED**

```bash
pnpm --filter @kokoro/admin-web test:contract -- build-boundary runtime-listener
pnpm --filter @kokoro/admin-web test:security -- hostile-input production-bundle
```

- [x] **Step 3: Implement evidence and acceptance runner**

Record local/UTC timestamps, timezone offset, git commit/tree/dirty state, Node/pnpm versions,
browser requirement status, provider hashes, command start/finish/duration/exit, JUnit, coverage,
runtime HTTP/RPC evidence, structured logs, case/category totals, retry/skip/todo/unclassified
counts, decision, and ordered SHA-256 values. Never record secret values. Use a unique ignored
`test-results/admin-<UTC>-<commit>/` directory and fail if it already exists.

- [x] **Step 4: Create a clean candidate and run full repository acceptance**

Commit production code before acceptance so the candidate starts clean:

```bash
git add apps/admin INDEX.md package.json pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "test(admin): add repository acceptance runner"
pnpm --filter @kokoro/admin-web acceptance
```

Expected: every install/generate/test/typecheck/lint/build/smoke gate exits 0, all Admin-owned P0 cases
pass once, pair cases remain `NOT_STARTED`, and `ADMIN_WEB_REPOSITORY_DECISION=PASS` while
`PRODUCT_PAIR_DECISION=NOT_READY`.

- [x] **Step 5: Inspect, archive, verify, and commit the report**

Independently verify manifest JSON, case totals, zero retries/skips, candidate cleanliness, secret
scan, and all checksums. Copy the entire run verbatim to `apps/admin/reports/accepted/<run-id>/`,
force-add normally ignored evidence only inside that accepted directory, re-run SHA-256 verification,
then commit:

```bash
git commit -m "test(admin): record repository acceptance evidence"
```

### Task 10: Two-Round Real Chromium Pair Acceptance

**Files:**
- Create: `apps/admin/playwright.config.ts`
- Create: `apps/admin/test/pair/evidence.ts`
- Create: `apps/admin/test/pair/mailpit.ts`
- Create: `apps/admin/test/pair/fixture.ts`
- Create: `apps/admin/test/pair/evidence.test.ts`
- Create: `apps/admin/test/pair/fixture.test.ts`
- Create: `apps/admin/test/pair/authentication.spec.ts`
- Create: `apps/admin/test/pair/sessions.spec.ts`
- Create: `apps/admin/test/pair/users.spec.ts`
- Create: `apps/admin/test/pair/organizations.spec.ts`
- Create: `apps/admin/test/pair/members-access.spec.ts`
- Create: `apps/admin/test/pair/audit-idempotency.spec.ts`
- Create: `apps/admin/scripts/test/run-pair-acceptance.ts`
- Modify: `apps/admin/test/catalog/p0.yaml`
- Create: `apps/admin/reports/pairs/iam/README.md`

**Interfaces:**
- Consumes: exact accepted IAM candidate, accepted Admin Web repository candidate, PostgreSQL,
  Mailpit, production Admin Web, Chromium.
- Produces: two fresh round manifests, complete browser artifacts, combined pair report/checksums,
  and `PRODUCT_PAIR_DECISION=PASS` only when every shared case passes twice.

- [ ] **Step 1: Write the pair evidence/fixture tests before journeys**

Test unique round IDs, detached IAM worktree, distinct database/credentials/Auth secret/mailbox/browser
contexts, exact process/PID cleanup, step local/UTC timing, screenshot naming/hashes, trace/video/HAR
association, SQL snapshot allowlist, manifest schema, zero retry, and failure on any missing artifact.
Test the sensitive callback boundary: no callback URL/token or storage-state file is retained; the
real emitted link is consumed in an ephemeral recording-disabled context; only digests and safe
pre/post evidence persist.

- [ ] **Step 2: Run fixture tests and verify RED**

```bash
pnpm --filter @kokoro/admin-web exec vitest run test/pair/evidence.test.ts test/pair/fixture.test.ts
```

- [ ] **Step 3: Implement fixture supervision and secret-safe evidence**

The runner starts IAM at the frozen commit, migrates a new database, generates exact-0600 secrets,
bootstraps one platform admin through the isolated owner connection, starts
`axllent/mailpit:v1.30.6` and production Admin Web, waits on readiness conditions, and starts
Chromium. It records the resolved Mailpit image digest and Chromium version in the manifest. It
transfers the callback Session cookie only in memory and scans retained text/JSON/HAR/trace archives
for all generated secret values before hashing.

- [ ] **Step 4: Implement all shared P0 journeys without shortcuts**

Each spec executes visible step-by-step business behavior for:

```text
IAM-SEC-ENUM-001       IAM-SEC-REDIRECT-001
IAM-E2E-AUTH-001       IAM-E2E-SESSION-001
IAM-E2E-ORG-001        IAM-E2E-MEMBER-001
IAM-E2E-RBAC-001       IAM-E2E-DELETE-001
IAM-E2E-IDEM-001       IAM-E2E-FRESH-001
```

Capture a screenshot after every expected visible state and correlate RPC/SQL/log evidence. Use real
UI controls, Auth.js, emitted mail, IAM listener, and PostgreSQL; do not invoke management RPCs from
the test to replace a browser action.

- [ ] **Step 5: Verify the pair harness before formal execution**

Run component/unit tests for the harness and one non-formal smoke journey. Inspect screenshots and
trace with the real Playwright viewer. Delete the non-formal evidence so it cannot be confused with
formal rounds.

- [ ] **Step 6: Commit the clean pair harness candidate**

```bash
git add apps/admin
git commit -m "test(admin): add real IAM browser pair acceptance"
```

- [ ] **Step 7: Execute two fresh formal Chromium rounds**

```bash
pnpm --filter @kokoro/admin-web acceptance:pair
```

Expected: two distinct fresh round IDs; every shared case passes once per round; retry/skip/todo counts
are zero; screenshots, trace, video, HAR, Web/IAM logs, RPC and SQL evidence have per-step timestamps;
secret scan and SHA-256 verification pass; both round decisions and combined product decision are
`PASS`.

- [ ] **Step 8: Independently inspect and commit pair evidence**

Open every screenshot at desktop/mobile sizes, inspect both traces, confirm no overlap/clipping,
verify all business state transitions against SQL/RPC/log evidence, parse manifests, and run all
checksums. Copy the full immutable combined run into `apps/admin/reports/pairs/iam/<pair-run-id>/` and
commit:

```bash
git commit -m "test(admin): accept IAM browser pair"
```

### Task 11: Provider Import and Product Release Closure

**Files in `kokoro-iam`:**
- Create: `reports/pairs/admin-web/<pair-run-id>/manifest.json`
- Create: `reports/pairs/admin-web/<pair-run-id>/report-reference.md`
- Create: `reports/pairs/admin-web/<pair-run-id>/sha256sums.txt`
- Modify: `reports/pairs/admin-web/README.md`
- Modify: `README.md`
- Modify: `test/catalog/p0.yaml`

**Interfaces:**
- Consumes: approved combined pair manifest and exact IAM frozen provider values.
- Produces: IAM-owned reference to the Admin Web result and final product release decision without
  copying browser artifacts or creating a centralized system-test repository.

- [ ] **Step 1: Validate the incoming pair result in IAM**

Require exact provider commit/tree/hashes, two round IDs, all ten shared cases `PASS` in both rounds,
zero retries/skips, local/UTC ranges, evidence hashes, Admin Web candidate commit/tree, and verified
combined checksum. Reject any provider drift or missing reference.

- [ ] **Step 2: Import only the approved reference**

Commit the combined manifest, report location/repository/commit, and checksums. Full screenshots,
traces, videos, HAR, Web logs, and Playwright code remain in `kokoro-web`.

- [ ] **Step 3: Run both repository gates fresh**

Run IAM `pnpm verify`, accepted evidence checksums, Admin Web `pnpm verify`, pair checksums, and git
cleanliness. Update IAM shared pair catalog statuses only after the imported evidence validates.

- [ ] **Step 4: Commit release closure**

```bash
git commit -m "test(iam): accept Admin Web browser pair"
```

The final decision may be `PRODUCT_RELEASE_DECISION=PASS` only after this commit and fresh completion
audit prove every PRD, technical-design, catalog, report, and pair requirement.
