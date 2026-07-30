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

`lib/admin-surface-permissions.ts` is the single Web mapping from each typed Credit/User surface to its Platform permission. Summary, Account, Grant, Hold, Journal, and RatedUsage are independently visible and mounted. Hold allocation inherits `credit.hold.read`; Settlement and rated-usage source allocation inherit `credit.rated-usage.read`. A drawer or trace link may not cross into another surface unless that target permission is present. Every server client repeats this check against the verified encrypted authority session before opening the Platform transport; browser state is never an authority source.

## Navigation and observation semantics
Trace actions preserve explicit Grant ↔ Hold ↔ RatedUsage relationships, including both RatedUsage-ref and Settlement-ref source-allocation entry points. Source filters are an atomic `sourceType` plus `sourceRef` pair. Cursor accumulation is bounded, late responses are discarded, the first membership watermark is locked across all later pages, and any page observed before that watermark is rejected. List membership watermarks and per-page observation times are displayed separately because reads are authoritative database observations, not a cross-request transactional snapshot.

## Extension rule
Add a generated AdminCredit operation and reviewed BFF mapping before adding a new console fact. Never route Credit data through the legacy generic resource API.
