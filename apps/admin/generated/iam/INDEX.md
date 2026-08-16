# Generated IAM Contract

`proto/` contains committed Protobuf-ES output generated from `contracts/iam/proto`. It is the only
IAM transport contract imported by Admin Web server code.

## Public Boundary

- Service and message descriptors are exported by the generated `*_pb.ts` modules.
- Server-only IAM clients may import these modules; Client Components and browser bundles may not.
- `@bufbuild/protobuf` is the runtime dependency. Generation uses the exact tool versions in
  `apps/admin/package.json` and the committed Buf dependency lock.

## Regeneration

Run `pnpm --filter @kokoro/admin-web proto:generate` from the Web repository root. Generated files
under `proto/` are replaced as one output tree and must never be edited manually. `proto:check`
regenerates and requires an empty diff.
