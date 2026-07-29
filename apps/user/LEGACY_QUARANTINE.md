# Legacy user app quarantine

The active root page now builds the Session Browser v3 reference harness from `src/reference/**`. The previous universal-skin
implementation remains temporarily for extraction history, but is excluded from the active TypeScript and Vitest surfaces.

Quarantined code assumes raw GA event folding, legacy billing/delivery/Hub/Team surfaces, and pre-v3 reconnect semantics. It must not
be imported by the reference page or used to restore the Browser v2 contract. `test/repository/reference-app-v3.test.mjs` freezes
this boundary.

The harness exposes two real upstream gaps: sessions without `model_history` cannot submit until Platform publishes a default model
revision, and approval/interaction parts remain read-only until Browser v3 publishes the owner decision command.
