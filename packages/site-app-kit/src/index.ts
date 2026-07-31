export const SITE_APP_KIT_VERSION = "0.1.0" as const;

const SITE_KEY_PATTERN = /^[a-z][a-z0-9-]{1,62}$/u;
const PACKAGE_NAME_PATTERN = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u;
const RELEASE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{7,127}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export interface SiteContractFloor {
  readonly contract: "platform-public-v1";
  readonly version: "1";
  readonly schemaSha256: string;
  readonly signature: string;
  readonly signingKeyId: string;
}

export interface SiteContractFloorExpectation {
  readonly contract: SiteContractFloor["contract"];
  readonly version: SiteContractFloor["version"];
  readonly schemaSha256: string;
}

/** Trust is supplied by deployment/CI authority, never by a Site artifact being verified. */
export interface SiteContractFloorKeyring<KeyMaterial> {
  resolve(signingKeyId: string): Promise<KeyMaterial | undefined> | KeyMaterial | undefined;
}

/** Cryptography is an injected runtime port so this package remains environment-neutral. */
export interface SiteContractFloorVerificationPort<KeyMaterial> {
  verify(input: {
    readonly keyMaterial: KeyMaterial;
    readonly payload: string;
    readonly signature: string;
  }): Promise<boolean> | boolean;
}

export type SiteContractFloorVerificationCode =
  | "FLOOR_MISMATCH"
  | "INVALID_SIGNATURE"
  | "UNTRUSTED_SIGNING_KEY"
  | "VERIFIER_UNAVAILABLE";

export class SiteContractFloorVerificationError extends Error {
  constructor(readonly code: SiteContractFloorVerificationCode) {
    super(`Site contract floor verification failed: ${code}`);
    this.name = "SiteContractFloorVerificationError";
  }
}

export interface SiteDomainBinding {
  readonly hostname: string;
  readonly environment: "preview" | "production";
}

export interface SiteReleaseIdentity {
  readonly releaseId: string;
  readonly artifactSha256: string;
  readonly profileRevision: string;
}

export type SiteProductId = "memory";

export interface SiteAppManifest {
  readonly packageName: string;
  readonly siteKey: string;
  readonly displayName: string;
  readonly domains: readonly SiteDomainBinding[];
  readonly release: SiteReleaseIdentity;
  readonly contractFloor: SiteContractFloor;
  readonly enabledProductIds: readonly SiteProductId[];
}

/**
 * Web-only bridge used by an Auth.js integration. Platform credentials remain
 * authoritative; a Site implementation may only seal them into its own cookie.
 */
export interface SiteWebSessionBridge {
  commit(input: {
    /** Opaque envelope created by the Site's server-only Auth.js integration. */
    readonly sealedSessionEnvelope: string;
    readonly expiresAt: string;
  }): Promise<void>;
  clear(): Promise<void>;
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`${field} must not be empty`);
  }
  return normalized;
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/u, "");
  if (
    normalized.length === 0 ||
    normalized.length > 253 ||
    normalized.includes(":") ||
    normalized.includes("/") ||
    normalized === "localhost"
  ) {
    throw new TypeError("domains[].hostname must be a bounded DNS hostname without scheme or port");
  }
  return normalized;
}

export function siteContractFloorPayload(floor: SiteContractFloorExpectation): string {
  return `${floor.contract}:${floor.version}:${floor.schemaSha256}`;
}

export async function verifySiteContractFloor<KeyMaterial>(input: {
  readonly floor: SiteContractFloor;
  readonly expected: SiteContractFloorExpectation;
  readonly keyring: SiteContractFloorKeyring<KeyMaterial>;
  readonly verification: SiteContractFloorVerificationPort<KeyMaterial>;
}): Promise<void> {
  const { expected, floor } = input;
  if (
    floor.contract !== expected.contract ||
    floor.version !== expected.version ||
    floor.schemaSha256 !== expected.schemaSha256 ||
    !SHA256_PATTERN.test(floor.schemaSha256)
  ) {
    throw new SiteContractFloorVerificationError("FLOOR_MISMATCH");
  }
  const keyMaterial = await input.keyring.resolve(floor.signingKeyId);
  if (keyMaterial === undefined) {
    throw new SiteContractFloorVerificationError("UNTRUSTED_SIGNING_KEY");
  }
  let valid: boolean;
  try {
    valid = await input.verification.verify({
      keyMaterial,
      payload: siteContractFloorPayload(floor),
      signature: floor.signature,
    });
  } catch {
    throw new SiteContractFloorVerificationError("VERIFIER_UNAVAILABLE");
  }
  if (!valid) throw new SiteContractFloorVerificationError("INVALID_SIGNATURE");
}

export function defineSiteAppManifest(input: SiteAppManifest): Readonly<SiteAppManifest> {
  if (!PACKAGE_NAME_PATTERN.test(input.packageName)) {
    throw new TypeError("packageName must be a scoped npm package name");
  }
  if (!SITE_KEY_PATTERN.test(input.siteKey)) {
    throw new TypeError("siteKey must be a stable lowercase slug");
  }
  if (!RELEASE_ID_PATTERN.test(input.release.releaseId)) {
    throw new TypeError("release.releaseId must be an opaque immutable release identifier");
  }
  if (!SHA256_PATTERN.test(input.release.artifactSha256)) {
    throw new TypeError("release.artifactSha256 must be lowercase SHA-256");
  }
  if (!SHA256_PATTERN.test(input.contractFloor.schemaSha256)) {
    throw new TypeError("contractFloor.schemaSha256 must be lowercase SHA-256");
  }
  if (input.contractFloor.contract !== "platform-public-v1" || input.contractFloor.version !== "1") {
    throw new TypeError("contractFloor must target platform-public-v1 contract version 1");
  }
  if (input.domains.length === 0) {
    throw new TypeError("at least one domain binding is required");
  }
  if (
    new Set(input.enabledProductIds).size !== input.enabledProductIds.length ||
    input.enabledProductIds.some((productId) => productId !== "memory")
  ) {
    throw new TypeError("enabledProductIds must be a unique closed product set");
  }

  const seen = new Set<string>();
  const domains = input.domains.map((domain) => {
    const hostname = normalizeHostname(domain.hostname);
    const identity = `${domain.environment}:${hostname}`;
    if (seen.has(identity)) {
      throw new TypeError(`duplicate domain binding: ${identity}`);
    }
    seen.add(identity);
    return Object.freeze({ hostname, environment: domain.environment });
  });

  return Object.freeze({
    packageName: input.packageName,
    siteKey: input.siteKey,
    displayName: requireText(input.displayName, "displayName"),
    domains: Object.freeze(domains),
    release: Object.freeze({
      releaseId: input.release.releaseId,
      artifactSha256: input.release.artifactSha256,
      profileRevision: requireText(input.release.profileRevision, "release.profileRevision"),
    }),
    contractFloor: Object.freeze({
      ...input.contractFloor,
      signature: requireText(input.contractFloor.signature, "contractFloor.signature"),
      signingKeyId: requireText(input.contractFloor.signingKeyId, "contractFloor.signingKeyId"),
    }),
    enabledProductIds: Object.freeze([...input.enabledProductIds]),
  });
}
