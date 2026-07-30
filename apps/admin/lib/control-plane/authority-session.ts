import "server-only";

import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { compactDecrypt, compactVerify, EncryptJWT, importPKCS8, importSPKI, jwtDecrypt } from "jose";
import { z } from "zod";

import { adminWorkloadConfig, type AdminWorkloadConfig } from "./config";
import { AUTHORITY_COOKIE, LOGIN_COOKIE, STEP_UP_COOKIE } from "./session-constants";

export { AUTHORITY_COOKIE, LOGIN_COOKIE, STEP_UP_COOKIE } from "./session-constants";

const positive = z.string().regex(/^[1-9][0-9]{0,19}$/u);
const instant = z.string().datetime({ offset: true });
const siteScope = z.object({
  site_id: z.string().min(1).max(128), environment: z.string().min(1), region: z.string().min(1),
  scope_epoch: positive, expires_at: instant,
}).strict();
const globalScope = z.object({
  grant_id: z.string().min(1).max(128), environment: z.string().min(1), region: z.string().min(1),
  scope_epoch: positive, expires_at: instant,
}).strict();
const breakGlassScope = globalScope.extend({
  incident_id: z.string().min(1), authorized_operation: z.string().min(1),
  resource_refs: z.array(z.string().min(1)).min(1), field_allowlist: z.array(z.string().min(1)).min(1),
}).strict();
const authority = z.object({
  permissions: z.array(z.string().min(1).max(128)).max(256),
  expires_at: instant,
  site_scopes: z.array(siteScope).max(1000),
  global_scopes: z.array(globalScope).max(100),
  break_glass_scopes: z.array(breakGlassScope).max(100),
}).strict();
const deliveryClaims = z.object({
  iss: z.string().url(), aud: z.union([z.string(), z.array(z.string())]), jti: z.string().min(1),
  iat: z.number().int(), nbf: z.number().int(), exp: z.number().int(),
  workload_identity_ref: z.string().startsWith("spiffe://"), environment: z.string().min(1),
  region: z.string().min(1), managed_device_ref: z.string().min(1), transaction_ref: z.string().min(1),
  exchange_request_digest: z.string().regex(/^[0-9a-f]{64}$/u), operator_ref: z.string().min(1),
  operator_generation: positive, operator_session_ref: z.string().min(1),
  opaque_session_credential: z.string().min(32).max(512).regex(/^\S+$/u), session_expires_at: instant,
  operator_security_epoch: positive, session_epoch: positive, restriction_epoch: positive, policy_epoch: positive,
  assurance_level: z.enum(["password", "mfa", "phishing_resistant"]),
  factor_classes: z.array(z.string().min(1).max(64)).min(1).max(16), authenticated_at: instant,
  step_up_at: instant.nullable(), operator_attestation_ref: z.string().min(1).max(256),
  operator_attestation_digest: z.string().regex(/^[0-9a-f]{64}$/u), authority,
}).strict();

const selectedScope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("site"), siteIds: z.array(z.string()).min(1), environment: z.string(), region: z.string() }).strict(),
  z.object({ kind: z.literal("global"), grantId: z.string(), environment: z.string(), region: z.string() }).strict(),
]);
const retainedGlobalScope = z.object({
  grantId: z.string().min(1).max(128), environment: z.string().min(1), region: z.string().min(1),
}).strict();
const authoritySessionSchema = z.object({
  operatorRef: z.string(), operatorGeneration: positive, operatorSessionRef: z.string(), credential: z.string().min(32),
  workloadIdentityRef: z.string().startsWith("spiffe://"), audience: z.string().min(1),
  environment: z.string(), region: z.string(), managedDeviceRef: z.string(), operatorSecurityEpoch: positive,
  sessionEpoch: positive, restrictionEpoch: positive, policyEpoch: positive,
  assuranceLevel: z.enum(["password", "mfa", "phishing_resistant"]), factorClasses: z.array(z.string()).min(1),
  authenticatedAt: instant, stepUpAt: instant.nullable(), operatorAttestationRef: z.string(),
  operatorAttestationDigest: z.string().regex(/^[0-9a-f]{64}$/u), expiresAt: instant,
  permissions: z.array(z.string()), scope: selectedScope, globalScope: retainedGlobalScope.nullable(),
}).strict();

export type AdminAuthoritySession = z.infer<typeof authoritySessionSchema>;
export interface AdminLoginTransaction { readonly transactionRef: string; readonly recoveryHandle: string; readonly expiresAt: string }
export interface AdminStepUpTransaction { readonly transactionRef: string; readonly operation: string;
  readonly resourceRefs: readonly string[]; readonly returnPath: string; readonly expiresAt: string }

export async function openPlatformDelivery(input: Readonly<{
  envelope: string; transactionRef: string; exchangeRequestDigest: string; operatorSessionRef: string;
}>): Promise<AdminAuthoritySession> {
  const config = await adminWorkloadConfig();
  const jweHeader = JSON.parse(Buffer.from(input.envelope.split(".")[0] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  exactHeader(jweHeader, { alg: "RSA-OAEP-256", enc: "A256GCM", typ: "kokoro-admin-session-delivery+jwe", cty: "JWT" });
  const deliveryKid = stringHeader(jweHeader.kid);
  const deliveryPem = config.delivery.deliveryKeys.get(deliveryKid);
  if (deliveryPem === undefined) throw new Error("admin_delivery_key_unknown");
  const decrypted = await compactDecrypt(input.envelope, await importPKCS8(deliveryPem, "RSA-OAEP-256"), {
    keyManagementAlgorithms: ["RSA-OAEP-256"], contentEncryptionAlgorithms: ["A256GCM"],
  });
  const compactJws = new TextDecoder("utf-8", { fatal: true }).decode(decrypted.plaintext);
  const jwsHeader = JSON.parse(Buffer.from(compactJws.split(".")[0] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  exactHeader(jwsHeader, { alg: "ES256", typ: "kokoro-admin-session-delivery+jwt" });
  const signingPem = config.delivery.signingKeys.get(stringHeader(jwsHeader.kid));
  if (signingPem === undefined) throw new Error("admin_delivery_signing_key_unknown");
  const verified = await compactVerify(compactJws, await importSPKI(signingPem, "ES256"), { algorithms: ["ES256"] });
  const claims = deliveryClaims.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(verified.payload)));
  validateDeliveryClaims(claims, config, input);
  const { scope, globalScope } = selectScopes(claims.authority, config);
  return authoritySessionSchema.parse({
    operatorRef: claims.operator_ref, operatorGeneration: claims.operator_generation,
    operatorSessionRef: claims.operator_session_ref, credential: claims.opaque_session_credential,
    workloadIdentityRef: claims.workload_identity_ref, audience: config.axes.audience,
    environment: claims.environment, region: claims.region, managedDeviceRef: claims.managed_device_ref,
    operatorSecurityEpoch: claims.operator_security_epoch, sessionEpoch: claims.session_epoch,
    restrictionEpoch: claims.restriction_epoch, policyEpoch: claims.policy_epoch,
    assuranceLevel: claims.assurance_level, factorClasses: claims.factor_classes,
    authenticatedAt: claims.authenticated_at, stepUpAt: claims.step_up_at,
    operatorAttestationRef: claims.operator_attestation_ref,
    operatorAttestationDigest: claims.operator_attestation_digest,
    expiresAt: claims.session_expires_at, permissions: claims.authority.permissions, scope, globalScope,
  });
}

export async function setAuthoritySession(value: AdminAuthoritySession): Promise<void> {
  const token = await sealCookie("authority", authoritySessionSchema.parse(value), new Date(value.expiresAt));
  (await cookies()).set(AUTHORITY_COOKIE, token, cookieOptions(new Date(value.expiresAt)));
}

export async function authoritySession(): Promise<AdminAuthoritySession | null> {
  const token = (await cookies()).get(AUTHORITY_COOKIE)?.value;
  if (token === undefined) return null;
  try {
    const payload = await openCookie("authority", token);
    return authoritySessionSchema.parse(payload);
  } catch {
    return null;
  }
}

export async function requireAuthoritySession(): Promise<AdminAuthoritySession> {
  const value = await authoritySession();
  if (value === null) throw new Error("admin_session_required");
  return value;
}

export async function clearAuthoritySession(): Promise<void> {
  (await cookies()).delete(AUTHORITY_COOKIE);
}

export async function updateAuthoritySessionStepUp(input: Readonly<{ stepUpAt: string; sessionEpoch: string;
  assuranceLevel: AdminAuthoritySession["assuranceLevel"]; factorClasses: readonly string[];
  operatorAttestationRef: string; operatorAttestationDigest: string }>): Promise<void> {
  const value = await requireAuthoritySession();
  await setAuthoritySession({ ...value, stepUpAt: input.stepUpAt, sessionEpoch: input.sessionEpoch,
    assuranceLevel: input.assuranceLevel, factorClasses: [...input.factorClasses],
    operatorAttestationRef: input.operatorAttestationRef,
    operatorAttestationDigest: input.operatorAttestationDigest });
}

export async function setLoginTransaction(value: AdminLoginTransaction): Promise<void> {
  const expires = new Date(value.expiresAt);
  (await cookies()).set(LOGIN_COOKIE, await sealCookie("login", value, expires), cookieOptions(expires));
}

export async function takeLoginTransaction(): Promise<AdminLoginTransaction | null> {
  const jar = await cookies();
  const token = jar.get(LOGIN_COOKIE)?.value;
  jar.delete(LOGIN_COOKIE);
  if (token === undefined) return null;
  try {
    const payload = await openCookie("login", token);
    return z.object({ transactionRef: z.string().min(1), recoveryHandle: z.string().min(43).max(43), expiresAt: instant }).strict().parse(payload);
  } catch {
    return null;
  }
}

export async function setStepUpTransaction(value: AdminStepUpTransaction): Promise<void> {
  const expires = new Date(value.expiresAt);
  (await cookies()).set(STEP_UP_COOKIE, await sealCookie("step-up", value, expires), cookieOptions(expires));
}

export async function takeStepUpTransaction(): Promise<AdminStepUpTransaction | null> {
  const jar = await cookies(); const token = jar.get(STEP_UP_COOKIE)?.value; jar.delete(STEP_UP_COOKIE);
  if (token === undefined) return null;
  try { const payload = await openCookie("step-up", token); return z.object({ transactionRef: z.string().min(1),
    operation: z.string().min(1).max(128), resourceRefs: z.array(z.string().min(1)).min(1).max(100),
    returnPath: z.string().startsWith("/").max(256), expiresAt: instant }).strict().parse(payload); }
  catch { return null; }
}

function validateDeliveryClaims(claims: z.infer<typeof deliveryClaims>, config: AdminWorkloadConfig,
  input: Readonly<{ transactionRef: string; exchangeRequestDigest: string; operatorSessionRef: string }>): void {
  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== config.delivery.issuer || !audience.includes(config.axes.workloadIdentityRef) ||
      claims.workload_identity_ref !== config.axes.workloadIdentityRef || claims.environment !== config.axes.environment ||
      claims.region !== config.axes.region || claims.managed_device_ref !== config.axes.managedDeviceRef ||
      claims.transaction_ref !== input.transactionRef || claims.exchange_request_digest !== input.exchangeRequestDigest ||
      claims.operator_session_ref !== input.operatorSessionRef || claims.nbf > now + 5 || claims.exp <= now - 5 ||
      Date.parse(claims.session_expires_at) <= Date.now()) throw new Error("admin_delivery_claim_mismatch");
  const ref = `admin-session:${claims.operator_session_ref}:${claims.session_epoch}`;
  const digest = createHash("sha256").update("kokoro.admin-operator-attestation.v1").update("\0")
    .update(JSON.stringify({ ref, operatorRef: claims.operator_ref, operatorGeneration: claims.operator_generation,
      operatorSecurityEpoch: claims.operator_security_epoch, restrictionEpoch: claims.restriction_epoch,
      policyEpoch: claims.policy_epoch, workloadIdentityRef: claims.workload_identity_ref,
      environment: claims.environment, region: claims.region, managedDeviceRef: claims.managed_device_ref,
      audience: config.axes.audience })).digest("hex");
  if (claims.operator_attestation_ref !== ref || claims.operator_attestation_digest !== digest) {
    throw new Error("admin_delivery_attestation_invalid");
  }
}

function selectScopes(value: z.infer<typeof authority>, config: AdminWorkloadConfig): Readonly<{
  scope: z.infer<typeof selectedScope>; globalScope: z.infer<typeof retainedGlobalScope> | null;
}> {
  const active = (expiresAt: string) => Date.parse(expiresAt) > Date.now();
  const matchingSites = [...new Set(value.site_scopes
    .filter((scope) => scope.environment === config.axes.environment && scope.region === config.axes.region &&
      active(scope.expires_at))
    .map((scope) => scope.site_id))].sort();
  const global = value.global_scopes.filter((scope) => scope.environment === config.axes.environment &&
    scope.region === config.axes.region && active(scope.expires_at)).sort((left, right) =>
      left.grant_id.localeCompare(right.grant_id))[0];
  const retained = global === undefined ? null : { grantId: global.grant_id,
    environment: global.environment, region: global.region };
  if (matchingSites.length > 0) return { scope: { kind: "site", siteIds: matchingSites,
    environment: config.axes.environment, region: config.axes.region }, globalScope: retained };
  if (global !== undefined) return { scope: { kind: "global", grantId: global.grant_id,
    environment: global.environment, region: global.region }, globalScope: retained };
  throw new Error("admin_authority_scope_unavailable");
}

async function cookieKey(): Promise<Uint8Array> {
  const secret = process.env.AUTH_SECRET;
  if (secret === undefined || secret.length < 32) throw new Error("admin_session_secret_invalid");
  return createHash("sha256").update("kokoro.admin-web.session.v1\0").update(secret).digest();
}

async function sealCookie(kind: string, value: unknown, expires: Date): Promise<string> {
  return new EncryptJWT({ value }).setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: `kokoro-admin-${kind}+jwe` })
    .setIssuedAt().setExpirationTime(Math.floor(expires.getTime() / 1000)).encrypt(await cookieKey());
}

async function openCookie(kind: string, token: string): Promise<unknown> {
  const result = await jwtDecrypt(token, await cookieKey(), { keyManagementAlgorithms: ["dir"],
    contentEncryptionAlgorithms: ["A256GCM"], typ: `kokoro-admin-${kind}+jwe` });
  return result.payload.value;
}

function cookieOptions(expires: Date) {
  return { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", expires };
}

function exactHeader(actual: Record<string, unknown>, required: Record<string, string>): void {
  if (Object.keys(actual).sort().join(",") !== [...Object.keys(required), "kid"].sort().join(",") ||
      Object.entries(required).some(([key, value]) => actual[key] !== value)) throw new Error("admin_delivery_header_invalid");
}
function stringHeader(value: unknown): string {
  if (typeof value !== "string" || value.length < 3 || value.length > 128) throw new Error("admin_delivery_kid_invalid");
  return value;
}
