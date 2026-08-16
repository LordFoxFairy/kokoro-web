# Admin Web Acceptance Reports

Formal repository runs are created under ignored `test-results/admin-<UTC>-<commit>/`. A reviewed
run is copied verbatim to `reports/accepted/<run-id>/`; pair runs remain under `reports/pairs/iam/`.

Every accepted directory must contain its report, manifest, raw command/JUnit/JSON/coverage/runtime
evidence, secret-scan result, and ordered `sha256sums.txt`. Browser screenshots, trace, video, HAR,
RPC, SQL, logs, and step timestamps are owned by the later pair report rather than manufactured by
repository-only tests.
