---
architectureIndex: 1
rootId: web.admin.commerce-ui
owners:
  - "@LordFoxFairy"
---

# AdminCommerce UI

## Responsibility

Render the five Refine resource lists/details, four immutable publication forms, the Code Batch state machine and
the explicit Site/permission/maker-checker matrix with Ant Design 5 and Pro Components.

## Sensitive delivery

`code-batch-console.tsx` alone may hold first-delivery raw codes, and only in mounted component-local state. The
blocking dialog never copies them into notifications, URL state, browser storage, clipboard, Refine or React
Query. Explicit Blob download revokes the object URL and clears state; close, unmount and the 45-second timeout
also discard the value. A replay has no raw codes and instructs abandon plus a new batch/new command reissue.

## Extension rule

Add resource-specific routes, schemas, permissions and transition buttons. Never add a dynamic action dispatcher,
generic CRUD manifest, raw-code table column, copy button or persistent draft for secret exports.
