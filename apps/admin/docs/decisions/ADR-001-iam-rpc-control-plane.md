# ADR-001: IAM RPC Control Plane

Status: Accepted

Date: 2026-08-15

## Context

Admin Web currently combines mature Next.js, Auth.js, and Ant Design Pro foundations with an obsolete
authority model. Authentication reads Platform `OperatorAccount`, VerificationToken, and AuthEvent
tables through Prisma; protected pages use an Auth.js JWT session; browser API requests are rewritten
to a platform-admin gateway with injected operator/proxy headers.

The accepted `kokoro-iam` service now owns User, Account, Session, VerificationToken, Organization,
Member, Role, Permission, command receipt, SecurityEvent, and signing-key state. It exposes five
generated ConnectRPC services, requires an `admin-web` workload credential, and revalidates current
database state through short-lived IAM actor JWTs. Its accepted candidate contains zero SQL foreign
keys and performs relationship and soft-delete behavior in application transactions.

Keeping both models would create two identity roots, two session authorities, and two administration
paths. Replacing the existing frontend framework would discard working layout, accessibility,
localization, and operations-console components without improving the authority boundary.

## Decision

We will keep the existing Next.js App Router, React, Auth.js, Ant Design, Ant Design Pro Components,
Tailwind tokens, and shared i18n engine.

We will hard-cut Admin Web authentication and IAM management to the accepted IAM generated contract:

1. Auth.js will use a complete ConnectRPC-backed Adapter and database Session strategy.
2. Admin Web will own browser cookies, CSRF, redirect policy, provider callbacks, and email delivery;
   IAM will own all authentication and authorization persistence.
3. Protected routes will run in the Node.js BFF runtime. They will resolve Auth.js through IAM,
   retrieve the explicit server-only session cookie, call `IssueAccessToken`, and use the returned
   short-lived actor JWT only on server-to-IAM requests.
4. All IAM transport code, workload credentials, actor JWTs, and generated descriptors will remain
   behind `server-only` modules.
5. Admin Web will vendor the exact provider Proto snapshot, record its source commit and hashes,
   generate its own checked-in client descriptors deterministically, and reject drift in CI.
6. IAM management modules will use Server Components for reads and server actions for commands. One
   stable command ID will represent one logical UI mutation.
7. Future backend management modules will register static navigation/routes and generated clients in
   this repository. They will not reuse IAM persistence or introduce a generic remote-manifest CRUD
   gateway.
8. Prisma, Platform database mappings, gateway rewrites, proxy-secret headers, JWT-session
   compatibility, and unowned legacy routes will be deleted.

We will not introduce Keycloak, Better Auth, Refine, React Admin, AdminJS, or another design system.

## Consequences

### Positive

- There is one identity/session/RBAC authority and one browser authentication framework.
- Admin Web cannot bypass IAM application transactions or couple to IAM SQL.
- Auth.js retains its mature cookie, CSRF, provider, and callback behavior.
- Generated contracts make the provider/consumer boundary typed and reviewable.
- The existing Ant Design Pro shell and shared i18n investment remain useful.
- Static module registration gives later repositories a predictable integration point without a
  super-gateway or centralized system-test repository.
- Database-session revocation, User suspension/deletion, and current platform role take effect on the
  next protected server interaction.

### Negative

- Auth.js database sessions require the BFF to read one explicitly configured session-cookie name so
  it can exchange the opaque token through `IssueAccessToken`.
- The accepted IAM snapshot must be deliberately imported and regenerated when its provider changes.
- The first release removes currently visible non-IAM routes until their providers publish approved
  generated contracts.
- NextAuth `5.0.0-beta.31` remains an explicit release risk. It is kept fixed during the authority
  migration to avoid combining a framework upgrade with a boundary rewrite; any later upgrade needs
  its own verification and decision update.

### Neutral

- IAM SQL may still be inspected by the isolated pair acceptance orchestrator for provider-approved
  setup/evidence. Product runtime code and ordinary Web tests receive no database credential.
- Full browser evidence remains in `kokoro-web`; IAM imports only the approved pair manifest/report
  reference.
