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
Admin Web does not own Platform tables, migrations, business transactions, public Site sessions, Agent execution, or acquisition/payment operations.

## Public boundary
Next.js routes/components are browser-facing; `lib/auth/client.ts` and Auth.js adapters are the server-only Platform boundary.

## Callers and dependencies
Operators use the app; server code calls Platform Admin Connect and consumes `@kokoro/i18n`.

## Data ownership and events
The app owns only Web authentication/session state and UI caches. Platform owns operators, verification effects, auth events, and receipts.

## Runtime and security
Workload credentials are lazy server runtime env, never browser/build-time data. RBAC and Platform authorization both fail closed.
The proxy deletes the complete untrusted `x-kokoro-*` namespace before injecting Auth.js identity and the mandatory server secret; local filtered BFFs revalidate it. Admin JSON boundaries use bounded streaming reads.

## Idempotency, failure, and recovery
Admin effects use stable command IDs, canonical protobuf digests, bounded receipt polling, and explicit recoverable errors.

## Extension rules and forbidden dependencies
Add control-plane UI here and Platform behavior behind generated service methods. Never restore Prisma or `DATABASE_URL_ADMIN`.

## Current gotchas
Only Admin Auth uses generated Connect today; other resource screens must not imply stub data is production-complete.
The Admin payment control surface is intentionally absent: no Payment navigation/page, provider/order/refund/subscription UI, plan-grant action, or payment metrics. Local Route Handlers own `manifests`/`billing-overview`/`user360`/`resource`/`action`, expose deep positive schemas for manifests/credit/identity, normalize upstream errors, and return stable `ACQUISITION_CHANNEL_DISABLED` for direct payment commands before gateway egress. Credit/account operations remain, with operator grants restricted to `manual_adjustment`.

## Verification
Run Admin tests, lint, typecheck, build, and the live Admin Auth compatibility command.
