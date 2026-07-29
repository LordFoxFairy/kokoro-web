---
architectureIndex: 1
rootId: web.chat-surface
owners: ["@LordFoxFairy"]
---

# Chat surface foundation

Owns the browser-safe Kokoro Chat projection and assistant-ui `useExternalStoreRuntime` adapter. Session snapshots and durable events enter one reducer; snapshot actions replace history. Unsupported and incomplete parts, connection state, command conflict, and repair state are first-class and are preserved in adapter extras.

Assistant UI is a rendering/runtime adapter only: it never becomes persistence or terminal-run authority. Commands cross one explicit `ChatCommandPort` call and do not optimistically mutate the projection. Edit/reload/cancel handlers are advertised only when an authoritative port exists.

This foundation does not claim Wave 3 Task 15 complete: Root Task 2 and Session Tasks 11–12 must provide complete typed parts, opaque cursor repair, and branch/edit/regenerate contracts before live wiring.
