# IAM Management Modules

This tree owns Admin-facing vertical slices built on the narrow `IamManagementClient`. Generated
messages, actor tokens, Connect transports, and raw provider errors do not cross into components.
Screens use the platform-owned `AdminPage`, `AdminTable`, and `AdminQueryFilter` wrappers over Ant
Design Pro; IAM modules own only their validated view models, URL state, and business actions.

## Users

- `users/schema.ts`: serializable view models and strict lifecycle action input.
- `users/query.ts`: strict URL filters, list/detail reads, and safe event projection.
- `users/url.ts`: Client-safe filter/cursor URL construction; it imports no server query code.
- `users/actions.ts`: injectable command handler with stable identity, version, safe errors, and
  authoritative path revalidation.
- `users/action-server.ts`: real actor/client Server Action assembly.
- `users/user-table.tsx` and `users/user-detail.tsx`: filters, lifecycle controls, Sessions, and
  correlated event presentation.

## Sessions

- `sessions/schema.ts`: Client-safe Session filters, view models, and command inputs.
- `sessions/query.ts`: user-scoped/global cursor reads and token-free Session view models.
- `sessions/url.ts`: Client-safe Session cursor URL construction.
- `sessions/actions.ts`: injectable revoke-one/revoke-all command handler.
- `sessions/action-server.ts`: real actor/client Server Action assembly.
- `sessions/session-table.tsx`: inventory, safe status, command confirmation, and refresh.

## Organizations

- `organizations/schema.ts`: strict Organization/Member view models, filters, and lifecycle inputs.
- `organizations/query.ts`: platform search, deleted detail, active User lookup, Member/Role reads,
  and exact Organization-scoped event projection.
- `organizations/url.ts`: Client-safe list/detail filter and cursor URL construction.
- `organizations/actions.ts` and `organizations/action-server.ts`: generated RPC lifecycle commands,
  version propagation, stable identity, safe errors, and authoritative revalidation.
- `organizations/organization-table.tsx` and `organizations/organization-detail.tsx`: creation,
  update, soft delete, restore, details, Members, and correlated events.

## Sites

- `sites/schema.ts`, `sites/query.ts`, and `sites/url.ts`: strict Site, SiteMember, authorization,
  and Site-scoped SecurityEvent view models with independent list/member/audit cursor state.
- `sites/actions.ts` and `sites/action-server.ts`: Site and SiteMember lifecycle, current Site
  selection, stable command identity, version propagation, safe errors, and exact revalidation.
- `sites/site-table.tsx`: server-filtered Site inventory, create, select, suspend, reactivate,
  soft delete, restore, and cursor pagination.
- `sites/site-detail.tsx`, `site-members.tsx`, `site-access.tsx`, and `site-audit.tsx`: fixed
  Overview/Members/Access/Security events Tabs, complete member lifecycle, live authorization,
  filtered Site audit statistics, and structured event details.

## Members

- `members/schema.ts`: strict client-safe add and lifecycle command inputs.
- `members/actions.ts` and `members/action-server.ts`: add, role change, suspend, reactivate, remove,
  and restore commands through the global platform-administrator actor.
- `members/member-table.tsx`: active User selection, provider Role options, complete lifecycle
  controls, deleted discovery, command recovery, and Role catalog presentation.

## Access

- `access/schema.ts` and `access/url.ts`: strict searchable Organization and User selection state
  plus Client-safe URL construction.
- `access/query.ts`: searchable Organization and active User selection with selected-record
  retention, Permission/Role catalogs, and a fresh IAM `InspectUserAuthorization` decision.
- `access/access-catalog.tsx`: read-only catalogs and live allow/deny evidence; it exposes no custom
  Role or Permission mutation control.

## Audit And Overview

- `audit/schema.ts`, `audit/query.ts`, and `audit/url.ts`: exact Provider filter validation,
  cursor state, bounded metadata parsing, and safe allowlisted SecurityEvent projection.
- `audit/event-table.tsx`: filterable event ledger with copyable request/command/entity correlation.
- `overview/schema.ts`, `overview/query.ts`, and `overview/overview.tsx`: Client-safe state, IAM
  readiness, current administrator context, and exactly ten recent SecurityEvents without
  fabricated totals.
- `registry.ts`: final static route/label/group/icon descriptors consumed by the shell navigation.

## Constraints

- Reads are Server Component operations; filters are URL state and page size is bounded to 100.
- Commands use a new request ID and one stable command ID per logical interaction. Recovery retains
  the command ID and freezes the original digest payload after the first RPC attempt; automatic
  mutation retry is prohibited.
- Client Components receive ISO dates, decimal version strings, IDs, and safe enums only.
- Client Components and every transitive local dependency are contract-tested against `server-only`
  imports; shared action results and IAM enum values live in `lib/`.
- Organization detail rejects Member or SecurityEvent records whose Organization scope differs from
  the requested record instead of relabeling or rendering them.
- Site detail rejects SiteMember, authorization, or SecurityEvent records whose Site scope differs
  from the requested Site instead of relabeling or rendering them.
- Every non-add Member command carries both Member and Organization IDs; IAM verifies that scope
  transactionally before any state, receipt, or SecurityEvent mutation.
- Access inspection requires an explicit active User, validates both User and Organization response
  correlation, and never treats the administrator's Session as the inspected subject.
- Raw SecurityEvent metadata remains server-only; malformed, oversized, or secret-bearing values
  produce no Client-visible metadata, and only validated allowlisted fields are rendered.
- New IAM capabilities add a sibling vertical module and navigation only after its route is
  executable and classified tests pass.
