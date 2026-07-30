---
architectureIndex: 1
rootId: web.admin.credit-console
owners:
  - "@LordFoxFairy"
---

# Admin Credit console

## Responsibility
Render a read-only, Site-scoped trace across Credit accounts, grants, holds, hold allocations, journal transactions and entries, rated usage, and rated-usage source allocations.

## Boundary
The component calls only `/api/control/credit/**`. Browser payloads must pass the strict schemas in `lib/credit-contract.ts`; protobuf clients, workload credentials, raw evidence, and provider payloads remain server-only.

## Navigation and observation semantics
Trace actions preserve explicit Grant ↔ Hold ↔ RatedUsage relationships. Source filters are an atomic `sourceType` plus `sourceRef` pair. Cursor accumulation is bounded and late responses are discarded. List membership watermarks and per-page observation times are displayed separately because reads are authoritative database observations, not a cross-request transactional snapshot.

## Extension rule
Add a generated AdminCredit operation and reviewed BFF mapping before adding a new console fact. Never route Credit data through the legacy generic resource API.
