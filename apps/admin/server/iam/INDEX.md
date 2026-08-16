# IAM Server Boundary

This directory is the only handwritten Admin Web layer allowed to import generated IAM descriptors
or `@connectrpc/connect-node`.

- `transport.ts` creates workload-only and actor transports with fixed limits and no retry policy.
- `error.ts` converts Connect errors to the public-safe `IamWebError` union.
- `records.ts` validates generated provider records into immutable Admin domain records.
- `auth-adapter-client.ts` maps all fourteen Auth.js Adapter operations to generated IAM RPC methods.
- `session-client.ts` maps the workload-only Session token exchange and validates its response.
- `management-client.ts` is the actor-only Administration/Session port for bounded reads and
  idempotent management commands. It returns immutable User, token-free Session, and safe event
  records only.

Client Components import local module view models only. New provider modules add narrow server ports
beside this boundary and do not import IAM persistence or sibling repositories.
