# Admin Web Architecture Map

## Responsibility

`@kokoro/admin-web` is the independently deployed Kokoro management console and browser BFF. It
owns the platform shell, browser authentication mechanics, presentation, server actions, generated
service consumption, tests, runtime scripts, configuration examples, and acceptance evidence. IAM
is the first executable management module and remains the authority for identity, Sessions,
organizations, RBAC, command idempotency, and SecurityEvents.

## Public Entries

- `app/api/auth/[...nextauth]/route.ts`: Auth.js HTTP boundary.
- `auth.ts`: server-only Auth.js runtime exports.
- `app/(public)`: enumeration-safe login and verification routes.
- `app/(control)`: protected control-plane shell and business routes.
- `server/auth/session.ts`: protected Server Component actor/session boundary.
- `components/`: thin Ant Design Pro wrappers and reusable presentation components; no generated
  messages or tokens.
- `modules/iam/`: executable User, Session, Organization, Member, selected-User Access, Audit, and
  Site, Overview slices plus the static IAM module registry; see its adjacent `INDEX.md`.

## Collaborators

- `contracts/iam/provider.json` freezes the accepted `kokoro-iam` provider identity and hashes.
- `generated/iam` is generated only from the Admin-owned contract snapshot.
- `@kokoro/i18n` supplies the framework-independent engine; dictionaries stay in `i18n/`.
- Auth.js provides browser authentication. Ant Design and Pro Components provide the light,
  compact enterprise console foundation.

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
