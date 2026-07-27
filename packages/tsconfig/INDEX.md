---
architectureIndex: 1
rootId: web.tsconfig
owners:
  - "@LordFoxFairy"
---

# Shared TypeScript configuration

## Responsibilities
Own the Web repository's shared strict TypeScript baseline consumed by user/admin apps and shared packages.

## Non-responsibilities
This package does not own runtime code, framework-specific app settings, dependencies, or cross-repository TypeScript policy.

## Public boundary
Published JSON configurations referenced through `@kokoro/tsconfig` package exports are the complete boundary.

## Callers and dependencies
Web workspace packages extend the shared baseline and keep their own framework/build overrides locally.

## Data ownership and events
The package owns configuration files only and has no runtime data or events.

## Runtime and security
Strictness, module resolution, and browser/server library selection must not accidentally expose server code to client bundles.

## Idempotency, failure, and recovery
Configuration is deterministic; downstream typechecks fail immediately on incompatible changes and rollback uses the previous package commit.

## Extension rules and forbidden dependencies
Add only truly shared compiler options. Do not hide app-specific exceptions or path aliases that create private deep imports.

## Current gotchas
Cross-repository TypeScript versions remain independently locked even when target versions are intentionally aligned.

## Verification
Run `pnpm -r typecheck` and both app production builds after changing this package.
