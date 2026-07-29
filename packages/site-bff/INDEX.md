# Site BFF

The single server-only composition root for an independently deployed Site. It combines the generated
Platform Public client, `bff-runtime` trust kernel, generated Session Browser v3 route registry, and the
registered node transport provider. It never accepts a Host-derived Site, raw backend URL, browser
credential, or a caller-selected purpose grant.

Auth.js owns the Site-local encrypted cookie and browser authentication ceremony. This package exchanges
credentials with Platform and resolves authoritative actor claims on every runtime bootstrap. Only the
browser-safe bootstrap projection may cross into React props or JSON responses.

One-time credential calls require a caller-supplied secret command that was persisted before dispatch. Generic transport failure
retains that exact identity. A superseding command is legal only after Platform returns typed `delivery_unavailable`, and must carry
the generated prior-command recovery input.
