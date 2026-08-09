import type { Site } from "./schemas";

export interface EffectiveSiteScope {
  readonly siteId: string;
  readonly environment: string;
  readonly region: string;
  readonly scopeEpoch: string;
  readonly expiresAt: string;
}

export interface OperatorAuthority {
  readonly operatorRef: string;
  readonly operatorGeneration: string;
  readonly state: string;
  readonly effectivePermissions: readonly string[];
  readonly effectiveSiteScopes: readonly EffectiveSiteScope[];
  readonly operatorSecurityEpoch: string;
  readonly authorizationEpoch: string;
  readonly expiresAt: string;
}

interface CatalogSite {
  readonly siteRef: string;
}

export function adminAuthorityFingerprint(authority: OperatorAuthority): string {
  const effectivePermissions = [...new Set(authority.effectivePermissions)].sort();
  const effectiveSiteScopes = authority.effectiveSiteScopes
    .map((scope) => ({
      siteId: scope.siteId,
      environment: scope.environment,
      region: scope.region,
      scopeEpoch: scope.scopeEpoch,
      expiresAt: scope.expiresAt,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify({
    operatorRef: authority.operatorRef,
    operatorGeneration: authority.operatorGeneration,
    state: authority.state,
    operatorSecurityEpoch: authority.operatorSecurityEpoch,
    authorizationEpoch: authority.authorizationEpoch,
    expiresAt: authority.expiresAt,
    effectivePermissions,
    effectiveSiteScopes,
  });
}

/** The catalog may label an authorized Site, but can never add authority. */
export function authoritySites(
  scopes: readonly EffectiveSiteScope[],
  catalog: readonly CatalogSite[] = [],
): Site[] {
  const catalogLabels = new Map(catalog.map((site) => [site.siteRef, site.siteRef]));
  const seen = new Set<string>();
  const sites: Site[] = [];
  for (const scope of scopes) {
    if (seen.has(scope.siteId)) continue;
    seen.add(scope.siteId);
    const label = catalogLabels.get(scope.siteId) ?? scope.siteId;
    sites.push({ id: scope.siteId, name: label, key: scope.siteId });
  }
  return sites;
}
