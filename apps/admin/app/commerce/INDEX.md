---
architectureIndex: 1
rootId: web.admin.commerce-pages
owners:
  - "@LordFoxFairy"
---

# AdminCommerce pages

## Routes

`credit-programs`, `entitlement-templates`, `offers`, `redemption-programs`, and `code-batches` each own one list
page and one immutable-record detail route. Every page consumes the global selected Site and hides/disables reads
or writes that the signed operator permission matrix does not grant.

## Boundary

Pages use the closed Refine provider for list/detail reads and exact `/api/control/commerce/**` calls for writes.
They never import generated protobuf descriptors or control-plane clients.
