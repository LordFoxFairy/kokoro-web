# Authentication Model Lessons

Date: 2026-08-17

## What Went Wrong

The implementation discussion drifted because four concepts were collapsed into one:

- account registration;
- administrator account supply;
- sign-in method;
- authenticated Session authority.

The presence of an email callback that was not visible on the current password form was incorrectly
classified as legacy code. That led to a proposed removal of Nodemailer and Magic Link coverage
coverage even though the user had repeatedly identified AI Collection as the reference for multiple
coexisting sign-in methods.

## Root Causes

1. The reference repository was not inspected before drawing the authentication conclusion.
2. A single visible UI state was treated as the complete product contract.
3. "No public Admin registration" was incorrectly converted into "one Admin sign-in method".
4. Dev fixture creation was confused with a production authentication mechanism.
5. Cleanup was proposed before writing a capability matrix and identifying the shared Session
   authority.

## Correct Mental Model

```text
Account supply       Sign-in methods            Session authority
---------------      -----------------------    -----------------
bootstrap script --> password -----------------+
reset script ------> password                   |
dev fixture -------> existing test account      +--> IAM Session --> IAM RBAC
                      email Magic Link ---------+
```

Registration is a fourth, independent workflow. Admin has no public registration. User Web may have
email verification and password setup without changing the Admin sign-in matrix.

## Mandatory Guardrails

Before changing authentication code or documentation:

1. Inspect the named reference implementation first.
2. Write separate rows for account supply, registration, sign-in, Session, and authorization.
3. Identify whether two paths terminate in the same persisted Session before calling them duplicate.
4. Do not classify a hidden or incomplete UI entry as legacy solely because it is not currently
   rendered.
5. Do not remove a provider until PRD, ADR, UI, runtime config, and test catalog agree that the
   capability is out of scope.
6. Treat dev-only account creation as fixture tooling, never as an authentication provider.
7. Require one browser acceptance case per supported sign-in method and shared revocation tests.
8. Keep registration decisions in the owning Web product, not in Admin by implication.

## Current Closure State

This table is the handoff truth until the implementation plan below is complete. A previous password
Pair pass proves only the password row and shared management journeys; it is not evidence that the
email UI and email Pair journey are complete.

| Capability | Current state | Closure evidence required |
| --- | --- | --- |
| IAM bootstrap/reset | Implemented in `kokoro-iam`; verified by IAM tests | Fresh bootstrap and reset command logs |
| Password login | Implemented and visible | Password Pair case and uniform-failure case |
| IAM Adapter/Nodemailer backend | Present | Adapter/integration tests plus real local SMTP delivery |
| Email choice on `/login` | Not yet exposed | Component test and visible browser screenshot |
| Email callback/replay journey | Helper exists; current Pair catalog does not execute it | Dedicated email Pair case |
| Shared Session/revocation | Implemented for IAM Sessions | Cross-method Session and revocation case |
| Public Admin registration | Deliberately absent | Route and production-bundle boundary tests |

Do not mark multi-method authentication closed until every row with closure evidence has a passing
catalog entry and the classified acceptance report contains both password and email sections.

## Review Checklist

- [ ] Are registration and sign-in described separately?
- [ ] Are bootstrap/reset/dev account creation described separately from providers?
- [ ] Do all providers resolve IAM User and IAM Session?
- [ ] Is the production exposure rule explicit for every dev tool?
- [ ] Does the login UI expose every supported production sign-in method?
- [ ] Does the P0 catalog test every supported method and the shared Session lifecycle?
- [ ] Do PRD, technical design, ADR, `.env.example`, and runtime validation agree?
- [ ] Are removed capabilities truly removed from routes, dependencies, tests, and docs?
