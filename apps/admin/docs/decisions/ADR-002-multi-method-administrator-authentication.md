# ADR-002: Multi-Method Administrator Authentication

Status: Accepted

Date: 2026-08-17

## Context

Kokoro Admin has four related but different concerns:

1. administrator account supply;
2. administrator sign-in methods;
3. public user registration;
4. authenticated browser Session authority.

Earlier design discussion incorrectly treated password sign-in and email sign-in as competing
architectures. The AI Collection reference demonstrates the intended product model: multiple mature
Auth.js providers may coexist, registration remains a separate workflow, and development account
fixtures are not authentication providers.

Kokoro IAM already owns User credentials and database Sessions. Admin Web uses the IAM Credential
RPC for password sign-in and an Auth.js Nodemailer provider with the IAM Adapter for email sign-in.
Both paths terminate in the same IAM Session model and the same authorization checks.

## Decision

Kokoro Admin will support two explicit sign-in methods:

| Method | Entry | Authentication | Session result |
| --- | --- | --- | --- |
| Password | email/account plus password | IAM Credential RPC | IAM database Session |
| Email | email Magic Link | Auth.js Nodemailer provider plus IAM Adapter | IAM database Session |

The login page presents both methods as first-class choices. Neither method is a compatibility path,
fallback store, or separate identity authority.

Administrator account supply remains separate:

| Environment | Account supply |
| --- | --- |
| Production | IAM bootstrap command and explicit reset-password command |
| Development/test | Development-only account tool or fixture, plus the same IAM commands |

Admin Web does not expose public administrator registration. Future User Web registration may use
email verification, password setup, and social providers, but it is a separate product journey and
must not be inferred from Admin login behavior.

The following invariants apply to both Admin sign-in methods:

1. IAM User is the identity authority.
2. IAM database Session is the only authenticated browser-session authority.
3. The browser receives only the configured opaque HttpOnly Session cookie.
4. Every protected request revalidates active User, Session, and `platform_role=admin` state.
5. Logout and administrator revocation invalidate the same Session regardless of sign-in method.
6. Public failures do not disclose whether an account exists, is suspended, is deleted, lacks a
   password, or cannot use email sign-in.
7. Dev/test account creation is unavailable in production and never becomes a third sign-in method.

Email capability is configuration-driven. When SMTP is configured and healthy, the login page shows
email sign-in. When it is deliberately unavailable, password sign-in remains functional and the
email option is not rendered. Production must never silently replace email delivery with console
output. Pair acceptance uses an in-process local SMTP mailbox to execute the real email path.

## Consequences

### Positive

- Administrators can use password or passwordless email without duplicate identities.
- Local development and automated acceptance do not depend on external email delivery.
- Production can offer convenient email sign-in without weakening bootstrap/reset operations.
- Auth.js continues to own provider callbacks, CSRF, redirect policy, and database Session mechanics.
- IAM remains the single persistence and authorization authority.

### Negative

- Password and email flows both require complete automated and browser acceptance coverage.
- Configuration, health presentation, and login UI must distinguish an unavailable email capability
  from invalid credentials without exposing account state.
- The isolated email-path fixture is local, process-scoped, and has no external service prerequisite.

### Rejected Alternatives

- **Password only:** rejects an explicitly required mature passwordless login capability.
- **Email only:** makes development, recovery, and isolated testing unnecessarily dependent on mail.
- **Separate Session types per provider:** creates duplicate revocation and authorization behavior.
- **Public Admin registration:** conflicts with platform administrator account governance.
- **Dev plugin as a provider:** confuses account supply with authentication and risks production
  exposure.

## Verification

Repository and pair acceptance must prove:

- password success, uniform password failure, reload, logout, and Session revocation;
- email request, real SMTP delivery, callback consumption, replay rejection, reload, logout, and
  Session revocation;
- both methods resolve the same User and create ordinary IAM Sessions;
- suspended, deleted, non-admin, unknown, and revoked identities cannot enter protected routes;
- the development account tool is absent in production bundles and routes;
- reports classify password and email authentication separately with local/UTC timestamps and
  distinct screenshots.
