# Admin Module Registry

## Responsibility

`registry.ts` is the platform-owned inventory of executable Admin modules. It projects accepted
module descriptors into the global navigation without importing business clients or generated RPC
messages.

## Public API

- `AdminModuleDescriptor`: stable platform navigation contract.
- `adminModuleRegistry`: ordered, executable-only descriptors currently supplied by IAM.

## Extension Rule

A module may be registered only after its route, authorization boundary, classified tests, and
acceptance evidence exist. Do not add placeholders or disabled future entries.
