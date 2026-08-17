# PRD-001: IAM Administration Control Plane

Status: implemented baseline; multi-method authentication alignment in progress.

## 1. Product Summary

Kokoro Admin Web is the independently deployed operations console and browser BFF for Kokoro. Its
first clean release provides a complete management surface for the accepted `kokoro-iam` service:
password and email Magic Link authentication, user and session administration, organizations and members, live RBAC,
soft deletion and restore, and security audit review.

The release keeps the repository's mature Next.js, Auth.js, Ant Design, and Pro Components
foundation. It removes the previous Prisma database access and platform-admin proxy model. Admin Web
communicates with IAM only through generated ConnectRPC clients and never owns IAM data or SQL.

## 2. Problem

The current Admin Web has a useful application shell and component foundation, but its identity
model is coupled to an `OperatorAccount` database mapping and its business pages assume an old
platform-admin HTTP gateway. That model conflicts with the accepted IAM authority:

- authentication state exists in two data models;
- Admin Web can reach database tables it does not own;
- authorization depends on injected proxy headers instead of current IAM session/RBAC state;
- most existing pages have no current provider contract;
- four test files and 25 tests do not cover real authentication or management journeys;
- no repository-owned browser acceptance report proves the product behavior.

Keeping both old and new paths would preserve conflicting authorities and create permanent
compatibility debt. The first release therefore makes a hard cut to the IAM-backed control plane.

## 3. Goals

1. Use Auth.js for browser authentication mechanics with a complete IAM RPC Adapter.
2. Give active platform administrators a complete UI for every accepted IAM administration journey.
3. Use only generated IAM RPC clients; no Admin Web database connection or hand-written transport
   contract is allowed.
4. Preserve reusable Next.js, Ant Design Pro, theme, layout, and localization foundations when they
   remain valid after the authority change.
5. Establish a narrow module boundary so later backend repositories can add management modules
   through their own generated contracts without changing authentication or the application shell.
6. Make Admin Web independently buildable, configurable, testable, deployable, and auditable.
7. Finish with classified automated acceptance and two independent fresh Chromium rounds containing
   step-level evidence.

## 4. Non-Goals

- Reimplementing Auth.js cookies, CSRF, provider callbacks, or Magic Link state handling.
- Adding Keycloak, Better Auth, Refine, React Admin, AdminJS, or a second administration framework.
- Supporting the old OperatorAccount/Prisma, gateway rewrite, proxy-secret, or JWT-session model.
- Preserving legacy URLs, payloads, route aliases, hidden navigation, or compatibility adapters.
- Managing the global Permission catalog or built-in Role definitions. IAM owns those immutable
  definitions; Admin Web may manage Organization- and Site-scoped custom Roles and their permission
  bindings through the accepted generated RPC contract.
- Rebuilding unrelated credit, payment, model, site, hub, or approval management before those
  provider repositories publish approved generated contracts.
- Moving browser tests or shared system tests into IAM or the parent workspace.
- Directly querying IAM PostgreSQL from Admin Web runtime code, server actions, pages, component
  tests, or application integration tests. The formal pair orchestrator may use its isolated fixture
  owner connection only for bootstrap and provider-approved bounded SQL evidence.

## 5. Users and Access

### 5.1 Platform administrator

An active IAM User with `platform_role=admin` and an active IAM Session can access the control plane.
The operator can inspect all IAM tenants, perform documented administration commands, and review
SecurityEvents. IAM rechecks the active platform role for every protected operation.

### 5.2 Organization owner

Organization-scoped journeys may later be exposed in user-facing Web. This Admin Web release remains
a platform administration surface; it still exercises IAM organization permissions and last-owner
rules rather than bypassing them.

### 5.3 Unauthenticated or inactive user

An unauthenticated, suspended, deleted, revoked, expired, or non-admin identity cannot access a
protected route. Public login-request results do not reveal account existence or state.

## 6. Authority and Repository Boundary

| Concern | Authority |
|---|---|
| Browser cookies, CSRF, provider callbacks and redirect validation | Admin Web through Auth.js |
| Password credential verification | IAM Credential RPC |
| Email delivery and mail fixture | Admin Web |
| User, Account, Session and VerificationToken persistence | IAM |
| Platform role, organizations, members, roles and permissions | IAM |
| Command idempotency and SecurityEvents | IAM |
| Proto and generated service descriptors | IAM provider; consumed and generated in Admin Web |
| Browser and Admin Web acceptance evidence | `kokoro-web` |
| IAM migrations and PostgreSQL | `kokoro-iam` |

Admin Web must not depend on an IAM Prisma client, migration, table name, SQL query, or owner
credential. The pair acceptance orchestrator may invoke IAM-owned fixture commands to prepare a
fresh database, but the Web process never receives that database connection.

## 7. Frozen IAM Provider Input

| Field | Accepted value |
|---|---|
| IAM candidate commit | `16afccdbec9c22176f9fd493feeb0ed0d7fe3445` |
| IAM candidate tree | `a72b870c8e890eb63176ddb80cc34df3658a474f` |
| Proto SHA-256 | `4daad8affaa7eb36e8f587dca3a016dd080b3ca4f3e36f08a19963133a27e38a` |
| Migration SHA-256 | `846491c5a72331a8d7aa1a2b51a153165dc636957ac1edf867e3836405f358c2` |
| IAM P0 catalog SHA-256 | `e388f4a865fa98744989f3e7a6d41d2bf8e6367ae51b8eeee804c763b4bc8552` |
| IAM accepted run | `iam-20260816T111434155Z-16afccdbec9c` |

A change to IAM production code, Proto, or migrations requires a new accepted candidate before pair
acceptance. Admin Web records provider hashes in generated-client tests and every pair manifest.

## 8. Information Architecture

The first release uses one quiet, work-focused Admin Web shell with these routes:

| Route | Purpose |
|---|---|
| `/login` | Choose password or email Magic Link sign-in with enumeration-safe public feedback. |
| `/auth/verify` | Uniform delivery/callback guidance without identity disclosure. |
| `/` | IAM operational overview and recent security activity. |
| `/users` | Search and filter active, suspended, and deleted Users. |
| `/users/[userId]` | User identity, lifecycle, sessions, and audit context. |
| `/organizations` | Search, filter, create, and inspect Organizations. |
| `/organizations/[organizationId]` | Organization lifecycle, Members, and role catalog. |
| `/sessions` | Session inventory and revocation workflows. |
| `/access` | Built-in Role and Permission catalogs with live authorization inspection. |
| `/audit` | Filtered, paginated SecurityEvent ledger. |

Desktop navigation is compact and grouped by Identity, Access, and Operations. Mobile uses a stable
drawer and preserves the same route hierarchy. Page sections are unframed layouts; cards are limited
to repeated entities, dialogs, and genuine dashboard metrics. Tables prioritize scanning, filtering,
pagination, and repeated operator actions.

## 9. Primary Journeys

### 9.1 Administrator account supply

Admin Web has no public administrator registration. Production administrators are created through
the IAM bootstrap command and have passwords rotated through the IAM reset-password command.
Development and test may use an explicitly enabled account fixture/tool. Account supply does not
create a new authentication provider and is never exposed in production UI.

### 9.2 Password login

1. The operator selects password sign-in and submits email/account plus password from `/login`.
2. Auth.js applies CSRF and return-URL policy, then delegates credential verification to the IAM
   Credential RPC.
3. A successful result creates an ordinary IAM database Session and the configured opaque HttpOnly
   Session cookie.
4. Protected routes resolve the Session through IAM and recheck active platform-administrator state.
5. Unknown, suspended, deleted, non-admin, passwordless, and incorrect-password attempts return the
   same public failure state.

### 9.3 Email Magic Link login

1. The operator submits an email from `/login`.
2. Auth.js validates origin, CSRF state, and redirect targets.
3. The IAM-backed Adapter resolves the User and creates a one-time VerificationToken.
4. Admin Web sends the real link through its configured mail provider.
5. The callback consumes the token once, creates an IAM database Session, and sets the Auth.js
   Secure, HttpOnly, SameSite cookie.
6. The protected route resolves the Session through IAM and verifies platform administration.
7. Replaying the link does not create another Session and produces the same safe public state as
   another unusable link.

Unknown, suspended, deleted, and active login requests expose the same public response structure and
timing class. Detailed reasons remain in authorized security events and structured server logs.

The email choice is rendered only when SMTP capability is configured. Its absence does not disable
password login, and production never substitutes console delivery for email.

### 9.4 User lifecycle and sessions

1. The administrator searches or filters Users and opens a detail route.
2. The detail shows authoritative IAM state, active/deleted status, paginated Sessions, and related
   SecurityEvents without exposing raw tokens. Memberships are managed from Organization details
   because the accepted contract does not expose a cross-organization membership query by User.
3. Suspend, reactivate, soft delete, restore, and revoke-session actions require a reason and
   confirmation where destructive.
4. Each logical mutation has one stable command ID. A double submission returns one durable result.
5. The page reloads authoritative RPC state and displays correlated SecurityEvents.
6. Revoked or deleted identities lose access on the next server interaction.

### 9.5 Organization lifecycle

1. The administrator creates an Organization with validated name and slug.
2. IAM creates the Organization and built-in role catalog and assigns the owner according to its
   accepted application rules.
3. Update, soft delete, and restore actions require current authorization and an operator reason.
4. Deleted Organizations are excluded by default and visible only through an explicit status filter.
5. Restore reuses the same identifier; conflicts are shown without generating another record.

### 9.6 Membership and RBAC

1. The administrator opens an Organization and adds an active User as a Member with a built-in role.
2. Role changes, suspension, reactivation, removal, and restore go through IAM commands.
3. Last-owner removal or demotion is rejected and the UI retains the authoritative state.
4. Cross-organization IDs do not disclose or mutate another tenant.
5. The Access view displays the provider-owned Role and Permission catalogs.
6. The administrator selects a User and inspects that User's authorization. A granted operation is
   allowed, then becomes denied immediately after role change, suspension, or membership removal.
   No permission decision is cached as Web authority, and the administrator Session is not the
   inspected subject.

### 9.7 Audit review

1. The administrator filters SecurityEvents by kind, actor, target User, Organization, command ID,
   and time range.
2. Results use keyset pagination and show request/command correlation without secret metadata.
3. User, Organization, membership, session, and authentication lifecycle actions remain visible
   across soft deletion and restore.

## 10. Functional Requirements

| ID | Requirement |
|---|---|
| `WEB-IAM-FR-AUTH-001` | Admin Web implements every Auth.js Adapter method required by the accepted IAM AuthAdapterService. |
| `WEB-IAM-FR-AUTH-002` | Password sign-in delegates verification to IAM Credential RPC and creates an ordinary IAM database Session. |
| `WEB-IAM-FR-AUTH-003` | Magic Link requests, callback, expiry, replay, origin, and redirect handling use Auth.js and a real mail provider/fixture. |
| `WEB-IAM-FR-AUTH-004` | Public failures do not distinguish unknown, suspended, deleted, non-admin, passwordless, invalid-password, or unusable-link identities. |
| `WEB-IAM-FR-AUTH-005` | `/login` exposes password and, when SMTP is configured, email as explicit choices; Admin has no public registration. |
| `WEB-IAM-FR-AUTH-006` | Production administrator supply and password recovery use IAM-owned bootstrap/reset commands; dev/test fixtures are production-disabled. |
| `WEB-IAM-FR-SESSION-001` | Auth.js uses IAM database Sessions, and every protected request revalidates current IAM state. |
| `WEB-IAM-FR-SESSION-002` | Operators can list, revoke one, revoke all, reload, and log out without exposing raw session tokens. |
| `WEB-IAM-FR-USER-001` | Operators can list, search, filter, inspect, suspend, reactivate, soft delete, and restore Users. |
| `WEB-IAM-FR-ORG-001` | Operators can list, search, filter, create, inspect, update, soft delete, and restore Organizations. |
| `WEB-IAM-FR-MEMBER-001` | Operators can list, add, role-change, suspend, reactivate, remove, and restore Members. |
| `WEB-IAM-FR-RBAC-001` | Role/Permission catalogs and live authorization results come from IAM on demand. |
| `WEB-IAM-FR-RBAC-002` | Last-owner and tenant-isolation failures are preserved and displayed without a client-side bypass. |
| `WEB-IAM-FR-IDEM-001` | A logical mutation creates one command ID and recovers the same result after double submit or ambiguous completion. |
| `WEB-IAM-FR-AUDIT-001` | Operators can filter and paginate SecurityEvents and correlate them to the originating command/request. |
| `WEB-IAM-FR-DELETE-001` | Deleted records are excluded by default, explicitly discoverable, and restored in place. |
| `WEB-IAM-FR-RPC-001` | Every IAM call uses generated ConnectRPC types and provider-owned protobuf descriptors. |
| `WEB-IAM-FR-MODULE-001` | Later provider modules register navigation, server-only clients, permissions, and routes without changing Auth.js or importing another module's persistence. |
| `WEB-IAM-FR-I18N-001` | User-visible control-plane copy uses the repository-owned i18n package with complete Chinese and English keys. |

## 11. Interaction and State Requirements

- Every data page has explicit loading, empty, filtered-empty, unavailable, forbidden, and malformed
  response states.
- List filters are URL-addressable so reload and browser navigation preserve operator context.
- Pagination is cursor-based where the RPC supplies a cursor. Pages do not fetch unbounded datasets.
- Mutations show pending state, disable accidental duplicate interaction, and retain the same command
  ID for recovery. UI disabling is not treated as the idempotency guarantee.
- Destructive and restore actions require a confirmation dialog and non-empty operator reason.
- Success is shown only after IAM confirms the command result and the page refreshes authoritative
  state.
- `last_owner`, conflict, deleted, forbidden, unauthenticated, and unavailable results have distinct
  authorized operator states, while public authentication failures remain uniform.
- IDs, timestamps, status, and command correlation remain easy to copy without exposing secrets.
- Session and verification tokens, workload credentials, actor JWTs, provider tokens, and private
  key material never render into HTML, React props sent to a Client Component, screenshots, or HAR.

## 12. Non-Functional Requirements

### 12.1 Framework and maintainability

- Keep Next.js App Router, React, Auth.js, Ant Design, Ant Design Pro Components, Zod, and the shared
  i18n package as the primary mature framework foundation.
- Add ConnectRPC/Protobuf generated clients and Playwright using repository-owned exact dependency
  pins and one lockfile.
- Use Server Components for reads and small Client Components only for interactions that require
  browser state.
- Use server actions or explicit BFF route handlers for mutations; no browser-to-IAM calls.
- Feature modules own routes, schemas, actions, components, tests, and architecture maps near their
  code. Shared shell primitives must remain domain-neutral.
- No `any`, unvalidated boundary payload, direct private import, dead compatibility directory, or
  duplicate styling system is accepted.

### 12.2 Security

- Workload credentials and IAM actor JWTs are server-only and loaded through strict configuration.
- Admin Web has no runtime database dependency or `DATABASE_URL` setting.
- Authentication and authorization fail closed when their required capability is unavailable. Mail
  unavailability disables only email sign-in; password sign-in remains available when IAM is healthy.
- Trusted-host and callback/return URL allowlists are explicit; open redirects are rejected.
- CSP, clickjacking, content-type, referrer, and permissions headers remain enabled and are tested.
- Browser errors contain safe codes and request IDs, never raw upstream messages or secret-bearing
  payloads.

### 12.3 Accessibility and responsive behavior

- Keyboard navigation, visible focus, semantic landmarks, labeled inputs, status announcements, and
  dialog focus containment meet WCAG 2.2 AA expectations.
- Desktop widths from 1280px and mobile widths down to 360px have no overlap, clipped controls, or
  inaccessible table actions.
- Motion is limited to functional transitions and respects `prefers-reduced-motion`.

### 12.4 Reliability and performance

- Every RPC call has a request ID, bounded deadline, typed error translation, and structured Web log.
- Mutations are never automatically replayed with a new command ID.
- On the local pair fixture, protected navigation reaches usable content within 2.5 seconds at P95,
  excluding Magic Link delivery; server-side IAM calls preserve the IAM read/write latency gates.
- The production build contains no Prisma client, IAM SQL, raw protobuf hand mapping duplicated
  outside the boundary adapters, or browser bundle reference to workload credentials.

## 13. Hard-Cut Cleanup

The release removes the following current authority and surfaces instead of preserving them behind
flags or aliases:

- `@auth/prisma-adapter`, Prisma client/generator, `apps/admin/prisma`, and `DATABASE_URL_ADMIN`;
- `OperatorAccount`, Web-owned VerificationToken, and Web-owned AuthEvent persistence;
- `KOKORO_GATEWAY_URL`, `KOKORO_ADMIN_PROXY_SECRET`, generic gateway rewrites, and injected operator
  headers;
- legacy `/teams`, `/credit`, `/payment`, `/sites`, `/models`, `/hub`, `/approvals`, and `/operators`
  routes until their provider repositories publish approved contracts;
- gateway-specific ResourceTable, EndpointTable, resource/action schemas, and unused UI primitives;
- JWT-session compatibility, no-op Adapter methods, and console-delivered Magic Links.

The implementation keeps only code that is imported by the final route tree and matches the new
boundaries. Git history remains the audit record; no preservation ledger or `legacy/` directory is
created.

## 14. Test Ownership and Classification

Admin Web owns all tests and reports under this repository:

| Category | Required coverage |
|---|---|
| unit | Adapter mapping, timestamp conversion, error translation, command identity, URL policy, configuration, and pagination. |
| component | Login, navigation, filters, tables, detail panels, dialogs, every state, keyboard behavior, and responsive constraints. |
| contract | Frozen Proto/hash inventory, complete Adapter methods, generated service inventory, no Prisma/SQL boundary, and i18n completeness. |
| integration | Auth.js with the real RPC Adapter, server-only actor exchange, command recovery, headers, and real Next.js route behavior. |
| security | Enumeration, redirect rejection, secret leakage, unauthorized routes, tenant isolation, replay, CSRF/origin, and hostile inputs. |
| pair E2E | Real IAM listener, fresh PostgreSQL, mail fixture, production-shaped Admin Web, and fresh Chromium. |

No P0 case may be skipped, marked todo, silently caught, replaced by a mocked IAM/PostgreSQL result,
or retried during formal acceptance.

## 15. Acceptance Criteria

| ID | Criterion | Shared pair case |
|---|---|---|
| `WEB-IAM-ACC-AUTH-001` | Sign in with a bootstrap administrator password, create an IAM Session, reload, log out, and reject invalid/inactive identities uniformly. | `IAM-E2E-AUTHPASSWORD-001`, `IAM-SEC-ENUMPASSWORD-001` |
| `WEB-IAM-ACC-AUTH-002` | Request and consume one real Magic Link through the local SMTP mailbox fixture, create an IAM Session, reload, log out, and reject replay. | `IAM-E2E-AUTHEMAIL-001` |
| `WEB-IAM-ACC-AUTH-003` | Both methods resolve the same IAM User and obey the same Session revocation and platform-role checks. | `IAM-E2E-AUTHSESSION-001` |
| `WEB-IAM-ACC-AUTH-004` | Unsafe return/callback URLs are rejected for both sign-in entries. | `IAM-SEC-REDIRECT-001` |
| `WEB-IAM-ACC-SESSION-001` | Reload restores an active session; logout and administrator revocation invalidate existing cookies. | `IAM-E2E-SESSION-001` |
| `WEB-IAM-ACC-USER-001` | Search, inspect, suspend, reactivate, delete, restore, and revoke sessions through visible UI state. | `IAM-E2E-DELETE-001` |
| `WEB-IAM-ACC-ORG-001` | Create, update, reload, delete, find-deleted, and restore one Organization. | `IAM-E2E-ORG-001` |
| `WEB-IAM-ACC-MEMBER-001` | Add, role-change, suspend, reactivate, remove, restore, and protect the last owner. | `IAM-E2E-MEMBER-001` |
| `WEB-IAM-ACC-RBAC-001` | Grant/allow then revoke/deny, with a separate cross-organization denial. | `IAM-E2E-RBAC-001` |
| `WEB-IAM-ACC-IDEM-001` | Double-submit one destructive action and observe one state change, event, and durable result. | `IAM-E2E-IDEM-001` |
| `WEB-IAM-ACC-AUDIT-001` | Correlate authentication and every management mutation to filtered SecurityEvents. | `IAM-E2E-DELETE-001` |
| `WEB-IAM-ACC-FRESH-001` | Run the complete P0 catalog twice with distinct databases, credentials, mailboxes, contexts, and evidence roots. | `IAM-E2E-FRESH-001` |

## 16. Formal Browser Evidence

Each Chromium round starts from a clean database, browser context, workload credentials, Auth.js
secret, mailbox, and evidence directory. Every business step records:

- category, case ID, step ID, expected result, actual result, and PASS/FAIL;
- local and UTC start/finish timestamps, timezone offset, and duration;
- a readable screenshot with timestamp and case/step association;
- Playwright trace, video, and HAR;
- correlated Admin Web log, IAM RPC log, bounded SQL state evidence, and request/command IDs;
- Web commit/tree/dirty state and the frozen IAM provider values;
- SHA-256 for every retained artifact.

The real emitted Magic Link must be consumed, but its secret-bearing callback URL is never retained
in HAR, trace, screenshot, report, or browser storage-state output. The callback executes in an
ephemeral recording-disabled Chromium context; the resulting Session cookie moves only in runner
memory to the round's recording context. The callback step references the pre-callback request
trace/HAR, a safe post-redirect screenshot and trace/HAR, link/token digests, IAM logs, and bounded
SQL evidence. This changes evidence capture, not the executed business flow.

The report groups authentication/security, sessions, users, organizations, membership/RBAC,
deletion/restore/idempotency, audit, accessibility/responsive, and operational gates. It carries both
round decisions and one overall product mark. Missing evidence makes the relevant case and overall
decision `FAIL`.

## 17. Release Gate

Admin Web repository acceptance is `PASS` only when dependency installation, deterministic code
generation, unit/component/contract/integration/security tests, typecheck, lint, production build,
and real server smoke all pass from a clean candidate with zero skips and retries.

Product pair acceptance is `PASS` only after two fresh Chromium rounds pass every shared P0 case and
the immutable combined report verifies all checksums. IAM remains `NOT_READY` until that approved
pair manifest is imported into its own repository.
