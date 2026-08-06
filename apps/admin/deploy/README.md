# Admin Web production release

`admin-web` is the only fixed production workload built from this repository. The reference Site is a
composition fixture, and generated customer Sites remain independently released artifacts.

## Build and publish

Build from the Web repository root. Runtime credentials and private files are never build arguments:

```bash
docker build --file apps/admin/Dockerfile --tag registry/repository:build-id .
docker push registry/repository:build-id
docker inspect --format='{{index .RepoDigests 0}}' registry/repository:build-id
```

The release system records and promotes only `registry/repository@sha256:<64-hex>`. A tag is only a
temporary publisher handle and is never a deployment or rollback input.

## Runtime contract

Mount the files named by `KOKORO_ADMIN_TLS_*_FILE` and
`KOKORO_ADMIN_DELIVERY_KEY_RING_FILE` read-only, inject the remaining values from a secret/config
store, and run the exact digest as UID/GID 10001. The container root filesystem is read-only; `/tmp`
is the only writable in-memory mount.

```bash
docker run --detach --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev \
  --user 10001:10001 --cap-drop ALL --security-opt no-new-privileges \
  --env-file /secure/admin-web.env \
  --mount type=bind,src=/secure/admin-web,dst=/run/secrets,readonly \
  --publish 127.0.0.1:3000:3000 \
  registry/repository@sha256:<64-hex>
```

Terminate public TLS, rate limits and request-size limits at the reverse proxy. Expose the app only
through that proxy; the loopback example is not a public listener.

- `GET /api/health/live` returns `204` when the Next process can serve requests.
- `GET /api/health/ready` returns `204` only after the complete server-only environment, bounded mTLS
  files, delivery key ring and referenced cryptographic keys load successfully and Platform Admin
  completes a bounded mTLS HTTP/2 settings exchange. Failure returns only
  `{"status":"unavailable"}` with `503`; it never returns a path, key, token or parse error.

Promote traffic only after readiness succeeds. The inventory at `deployables.yaml` is the Web-owned
activation declaration consumed by release orchestration.

## Rollback

Rollback promotes the immediately previous verified OCI digest through the same environment,
read-only security context and readiness gate. It does not rebuild source, switch a mutable tag,
change Platform data, or reverse migrations. Keep the current container until the previous digest is
ready, then switch proxy traffic and retain the failed digest and release evidence for audit.
