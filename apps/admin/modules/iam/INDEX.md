# IAM Management Modules

This tree owns Admin-facing vertical slices built on the narrow `IamManagementClient`. Generated
messages, actor tokens, Connect transports, and raw provider errors do not cross into components.

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

- `sessions/query.ts`: user-scoped/global cursor reads and token-free Session view models.
- `sessions/url.ts`: Client-safe Session cursor URL construction.
- `sessions/actions.ts`: injectable revoke-one/revoke-all command handler.
- `sessions/action-server.ts`: real actor/client Server Action assembly.
- `sessions/session-table.tsx`: inventory, safe status, command confirmation, and refresh.

## Constraints

- Reads are Server Component operations; filters are URL state and page size is bounded to 100.
- Commands use a new request ID and one stable command ID per logical interaction. Recovery retains
  the command ID; automatic mutation retry is prohibited.
- Client Components receive ISO dates, decimal version strings, IDs, and safe enums only.
- New IAM capabilities add a sibling vertical module and navigation only after its route is
  executable and classified tests pass.
