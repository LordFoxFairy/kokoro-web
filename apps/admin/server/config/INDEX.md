# Admin Server Configuration

This directory owns the Node-only Admin runtime contract. `config.ts` validates environment names
and returns an immutable `AdminRuntimeConfig`; `secret-file.ts` is the sole filesystem secret reader.

Only server modules may import this directory. Runtime code reads the Admin repository's ignored
environment file through `process.env`; it never reads a parent repository environment file.
