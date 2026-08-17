# Admin Module Registry

## Responsibility

`registry.ts` is the platform-owned inventory of executable Admin modules. It projects accepted
module descriptors into the global navigation without importing business clients or generated RPC
messages.

## Public API

- `AdminModuleDescriptor`: stable route, scope, required capability, label, group, icon, and order contract.
- `adminModuleRegistry`: ordered, executable-only descriptors currently supplied by IAM.
- `projectAdminModules(capabilities)`: fail-closed capability projection consumed by navigation.

## Extension Rule

A module may be registered only after its route, authorization boundary, classified tests, and
acceptance evidence exist. Do not add placeholders or disabled future entries.
The independent Admin deployment currently accepts only `platform:admin`; user-web Site-scoped
administration must be added as a separate real integration rather than inferred from this registry.
