---
architectureIndex: 1
rootId: web.admin
owners:
  - "@LordFoxFairy"
---

# Admin Web application

## Responsibilities
Render operator workflows, own Auth.js Web sessions, and call privileged Platform APIs through a server-only generated client.

## Non-responsibilities
Admin Web does not own Platform tables, migrations, business transactions, public Site sessions, or Agent execution.

## Public boundary
Next.js routes/components are browser-facing; `lib/auth/client.ts` and Auth.js adapters are the server-only Platform boundary.

## Callers and dependencies
Operators use the app; server code calls Platform Admin Connect and consumes `@kokoro/i18n`.

## Data ownership and events
The app owns only Web authentication/session state and UI caches. Platform owns operators, verification effects, auth events, and receipts.

## Runtime and security
Workload credentials are lazy server runtime env, never browser/build-time data. RBAC and Platform authorization both fail closed.

## Idempotency, failure, and recovery
Admin effects use stable command IDs, canonical protobuf digests, bounded receipt polling, and explicit recoverable errors.

## Extension rules and forbidden dependencies
Add control-plane UI here and Platform behavior behind generated service methods. Never restore Prisma or `DATABASE_URL_ADMIN`.

## Current gotchas
Only Admin Auth uses generated Connect today; other resource screens must not imply stub data is production-complete.

## Verification
Run Admin tests, lint, typecheck, build, and the live Admin Auth compatibility command.
