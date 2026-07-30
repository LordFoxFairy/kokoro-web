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
The proxy deletes the complete untrusted `x-kokoro-*` namespace before injecting Auth.js identity and the mandatory server secret; local filtered BFFs revalidate it. Admin JSON boundaries use bounded streaming reads. Module OpenAPI documents use a dedicated BFF route with a fixed non-payment module allowlist, a 2 MiB response cap and a 5 second lifecycle deadline; Platform remains the `docs.read` authorization authority.

## Idempotency, failure, and recovery
Admin effects use stable command IDs, canonical protobuf digests, bounded receipt polling, and explicit recoverable errors.

## Extension rules and forbidden dependencies
Add control-plane UI here and Platform behavior behind generated service methods. Never restore Prisma or `DATABASE_URL_ADMIN`.

## Current gotchas
Only Admin Auth uses generated Connect today; other resource screens must not imply stub data is production-complete.
The Admin payment control surface is intentionally absent: no Payment navigation/page, provider/order/refund/subscription UI, plan-grant action, payment metrics, or Payment OpenAPI descriptor. Local Route Handlers own `manifests`/`openapi/:moduleId`/`billing-overview`/`user360`/`resource`/`action`, expose deep positive schemas for manifests/credit/identity, normalize upstream errors, and return stable `ACQUISITION_CHANNEL_DISABLED` for direct payment commands before gateway egress. Credit/account operations remain, with operator grants restricted to `manual_adjustment`.

The fresh Platform Admin process is not yet contract-complete for this UI. Its mounted Admin Query v2 surface currently covers only site, user, and audit queries, and its Admin Command v2 registry currently exposes only `admin.authority.change`. Admin Identity v1 covers the generated Auth.js operator/token/event/receipt path, but it does not cover the rest of the operations console. Before Admin Web can be production-qualified, Platform must expose one authoritative v2 contract and runtime implementation for every operation below:

- shell and governance reads: current operator/permissions/site scope, operators, roles, sites, approvals, and audit;
- module discovery: manifests and bounded OpenAPI for site, user, model, credit, and hub;
- module resources: site/domain/application/policy, user/team/member/role, model catalog/binding, credit account/ledger/usage/pricing, and Hub skill/MCP resources;
- aggregate reads: billing overview and user 360 identity-plus-credit;
- commands: operator status, approval approve/reject, and each manifest-declared site/user/model/credit/hub action.

Until those contracts are mounted, the affected pages are intentionally unavailable. Web has one configured Platform Admin destination, no mock data, no database access, and no fallback to a retired composition; an absent or invalid upstream response fails closed at the local BFF.

## Verification
Run Admin tests, lint, typecheck, build, and the live Admin Auth compatibility command.
