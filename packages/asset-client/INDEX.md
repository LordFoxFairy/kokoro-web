---
architectureIndex: 1
rootId: web.asset-client
owners:
  - "@LordFoxFairy"
---

# Asset client

Browser-only orchestration for the registered Asset upload contract. It sends owner-control commands only
to the current Site's same-origin BFF and sends bytes only to the HTTPS data-plane endpoint carried by a
short-lived, origin-bound capability. It never receives Platform workload credentials, provider upload IDs,
object keys, buckets, provider receipts, or storage credentials.

Recovery records contain only file fingerprints, opaque owner/upload references, and idempotency identities.
The upload capability remains memory-only. After a refresh, selecting the same file replays the exact owner
create command to obtain a fresh capability and resumes committed multipart state.

Browser work is bounded before trust: files default to 32 MiB, structured owner/data-plane responses stream
into a 512 KiB ceiling, and one uploader runs at most two files concurrently (configurable only from one to
four). This prevents a multi-select from hashing several maximum-size files or buffering an untrusted JSON
response at once on mobile clients.

## Responsibilities

Orchestrate bounded, resumable browser uploads through owner commands and short-lived Asset data-plane capabilities.

## Non-responsibilities

This package does not select a Site, store provider or object-store facts, issue capabilities, or expose workload credentials.

## Public boundary

`@kokoro/asset-client` exposes the browser-safe upload controller and recovery types from `src/index.ts`.

## Callers and dependencies

Chat and Memory product packages consume this client. It depends on `@kokoro/site-client` for generated owner and data-plane contract shapes.

## Data ownership and events

The browser may retain bounded file fingerprints and opaque recovery identities. Platform remains owner of uploads, parts, capabilities, and artifacts.

## Runtime and security

Capabilities stay memory-only; files, concurrency, structured responses, and streamed chunks are capped before trust. No Platform endpoint or storage credential crosses this boundary.

## Idempotency, failure, and recovery

Create and part commands reuse stable identities. Refresh replays the exact create command for a fresh capability and resumes only owner-confirmed committed parts.

## Extension rules and forbidden dependencies

Add upload behavior behind generated Asset contracts. Do not add provider SDKs, server credentials, arbitrary endpoints, unbounded buffering, or a second owner schema.

## Current gotchas

A page refresh requires the user to reselect the same fingerprinted file; the expired upload capability is intentionally never persisted.

## Verification

Run `pnpm --filter @kokoro/asset-client lint`, `pnpm --filter @kokoro/asset-client typecheck`, and `pnpm --filter @kokoro/asset-client test`.
