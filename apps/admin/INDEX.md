# Admin Web Architecture Map

## Responsibility

`@kokoro/admin-web` is the independently deployed IAM operations console and browser BFF. It owns
browser authentication mechanics, presentation, server actions, generated IAM consumption, tests,
runtime scripts, configuration examples, and acceptance evidence. IAM remains the authority for
identity, Sessions, organizations, RBAC, command idempotency, and SecurityEvents.

## Public Entries

- `app/api/auth/[...nextauth]/route.ts`: Auth.js HTTP boundary.
- `auth.ts`: server-only Auth.js runtime exports.
- `app/(public)`: enumeration-safe login and verification routes.
- `app/(control)`: protected control-plane shell and business routes.
- `server/auth/session.ts`: protected Server Component actor/session boundary.
- `components/`: local reusable presentation components; no generated messages or tokens.

## Collaborators

- `contracts/iam/provider.json` freezes the accepted `kokoro-iam` provider identity and hashes.
- `generated/iam` is generated only from the Admin-owned contract snapshot.
- `@kokoro/i18n` supplies the framework-independent engine; dictionaries stay in `i18n/`.
- Auth.js, Ant Design, and Pro Components provide authentication and console foundations.

## Runtime Constraints

- Only `server/` and `auth.ts` may use Node transports, secret files, or generated IAM descriptors.
- Client Components receive validated view models and safe administrator fields only.
- Runtime configuration comes from the app's `.env.local`; secret values come from exact `0600`
  files and never appear in logs, errors, browser payloads, or evidence.
- There is no Admin database, SQL, Prisma, generic API proxy, legacy route alias, or sibling-repository
  runtime import.

## Extension Rules

- Add each management capability as a vertical module with its own query, action, schema, component,
  route, and classified tests.
- Add navigation only when the route and provider contract are executable.
- Extend narrow IAM clients in `server/iam`; do not expose generated records to UI modules.
- Update the P0 catalog and repository-owned report evidence for every new business journey.
