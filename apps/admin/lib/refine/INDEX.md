---
architectureIndex: 1
rootId: web.admin.refine
owners:
  - "@LordFoxFairy"
---

# Admin Refine boundary

## Responsibility

`admin-data-provider.ts` is the browser-only closed resource registry for Operators, Sites, Approvals, Audit and
the five Site-scoped Commerce resources. It maps each name to an exact same-origin route and validates positive
JSON projections before returning data to Refine.

## Pagination and detail rules

Lists use fixed 100-row `useInfiniteList` queries and explicit opaque continuations. Admin Query tokens are at
most 1024 characters; Commerce HMAC tokens are at most 2048. Neither the provider nor BFF decodes a token. The
cumulative window rejects loops, duplicate records and bounded-window overflow. Commerce list filters accept only
`siteId = eq`; Commerce details require `meta.siteId`.

## Mutation rule

The provider rejects every generic create/update/delete operation. Publish and batch transitions call their exact
BFF routes from domain components. Code Batch Issue deliberately bypasses Refine and React Query so first-delivery
raw codes cannot enter framework caches.
