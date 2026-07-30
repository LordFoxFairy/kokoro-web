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
