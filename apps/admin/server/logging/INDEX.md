# Server Logging

`logger.ts` serializes only the bounded IAM log record schema. It accepts no raw upstream message,
headers, tokens, cookies, environment values, or arbitrary metadata.

`auth-logger.ts` replaces Auth.js default console output with an allowlisted error kind and never
serializes the framework error message, cause, callback URL, email, or token.
