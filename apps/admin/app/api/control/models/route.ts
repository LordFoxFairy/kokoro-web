import { z } from "zod";
import { boundedJson, controlError, controlJson } from "@/lib/control-plane/http";
import { strictQuery } from "@/lib/control-plane/strict-query";
import {
  activateModelInventory, changeModelSitePolicy, importModelInventory,
  listModelInventoryBindings, listModelInventoryDefinitions, listModelInventoryProviders,
  listModelInventoryRevisions, listModelInventoryRoutes, listModelOptions,
  listModelSitePolicies, listModelSiteReleaseCatalogs, materializeModelOptions,
  publishModelSiteReleaseCatalog,
} from "@/lib/control-plane/client";

export const runtime = "nodejs";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const identifier = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/u);
const reference = z.string().min(1).max(256);
const uint64 = z.string().regex(/^(?:0|[1-9][0-9]*)$/u);
const product = z.enum(["chat", "music", "image", "video"]);
const role = z.enum(["main", "generation"]);
const pageToken = z.string().min(3).max(1024).optional();

const provider = z.object({ key: identifier, provider: identifier, accountKey: identifier,
  secretRef: z.string().min(1).max(512), adapterKind: z.enum(["litellm", "direct"]),
  priority: z.number().int().min(0).max(10_000) }).strict();
const model = z.object({ key: identifier, displayName: z.string().min(1).max(512),
  inputModalities: z.array(identifier).min(1).max(16), outputModalities: z.array(identifier).min(1).max(16),
  capabilities: z.array(identifier).max(128), contextWindow: z.number().int().positive().optional(),
  enabled: z.boolean() }).strict();
const binding = z.object({ key: identifier, modelKey: identifier, providerKey: identifier,
  upstreamModel: z.string().min(1).max(512), gatewayModelName: z.string().min(1).max(256),
  priority: z.number().int().min(0).max(10_000), enabled: z.boolean() }).strict();
const route = z.object({ product, role, modelKey: identifier, position: z.number().int().min(0).max(10_000),
  requiredCapabilities: z.array(identifier).max(128) }).strict();
const availability = z.object({ providerKey: identifier, status: z.enum(["active", "disabled"]),
  health: z.enum(["unknown", "healthy", "degraded", "down"]), epoch: uint64,
  observationRef: reference.optional(), observedAt: z.string().datetime({ offset: true }).optional() }).strict();
const assignment = z.object({ role, modelKey: identifier, position: z.number().int().min(0).max(10_000),
  requiredCapabilities: z.array(identifier).max(128), enabled: z.boolean() }).strict();
const selection = z.object({ primaryModelKey: identifier,
  fallbackModelKeys: z.array(identifier).max(32) }).strict();
const option = z.object({ optionKey: identifier, surface: product, label: z.string().min(1).max(160),
  description: z.string().min(1).max(512).optional(), tier: z.string().min(1).max(64).optional(),
  lifecycle: z.enum(["active", "disabled"]), orchestration: selection, generation: selection }).strict();
const surface = z.object({ surface: product, allowedOptionRevisionRefs: z.array(reference).min(1).max(256),
  defaultModelOptionRevisionRef: reference }).strict();

const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("import_inventory"), sourceReference: z.string().min(1).max(512),
    providers: z.array(provider).min(1).max(128), models: z.array(model).min(1).max(1024),
    bindings: z.array(binding).min(1).max(4096), productRoutes: z.array(route).min(1).max(4096),
    providerAvailability: z.array(availability).max(128) }).strict(),
  z.object({ action: z.literal("activate_inventory"), targetDigest: digest,
    expectedPointerRevision: uint64 }).strict(),
  z.object({ action: z.literal("change_site_policy"), siteId: z.string().min(1).max(128), product,
    enabled: z.boolean(), catalogMode: z.enum(["follow_active", "pinned"]),
    catalogDigest: digest.optional(), assignmentMode: z.enum(["inherit", "replace"]),
    expectedRevision: uint64, assignments: z.array(assignment).max(512) }).strict(),
  z.object({ action: z.literal("materialize_options"), inventoryDigest: digest,
    options: z.array(option).min(1).max(256) }).strict(),
  z.object({ action: z.literal("publish_site_release_catalog"), siteId: z.string().min(1).max(128),
    siteReleaseRef: reference, inventoryDigest: digest, surfaces: z.array(surface).min(1).max(4) }).strict(),
]).superRefine((value, issue) => {
  if (value.action === "change_site_policy" && (value.catalogMode === "pinned"
    ? value.catalogDigest === undefined : value.catalogDigest !== undefined)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "catalog digest does not match mode" });
  }
});

export async function GET(request: Request) {
  try {
    const query = strictQuery(request, { view: z.enum(["inventories", "providers", "definitions", "bindings",
      "routes", "options", "policies", "catalogs"]), inventoryDigest: digest.optional(),
    surface: product.optional(), siteId: z.string().min(1).max(128).optional(), pageToken });
    if (query.view === "inventories") return controlJson(await listModelInventoryRevisions(query.pageToken));
    if (["providers", "definitions", "bindings", "routes"].includes(query.view)) {
      const inventoryDigest = digest.parse(query.inventoryDigest);
      if (query.view === "providers") return controlJson(await listModelInventoryProviders(inventoryDigest, query.pageToken));
      if (query.view === "definitions") return controlJson(await listModelInventoryDefinitions(inventoryDigest, query.pageToken));
      if (query.view === "bindings") return controlJson(await listModelInventoryBindings(inventoryDigest, query.pageToken));
      return controlJson(await listModelInventoryRoutes(inventoryDigest, query.pageToken));
    }
    if (query.view === "options") return controlJson(await listModelOptions({
      ...(query.inventoryDigest ? { inventoryDigest: query.inventoryDigest } : {}),
      ...(query.surface ? { surface: query.surface } : {}), ...(query.pageToken ? { pageToken: query.pageToken } : {}) }));
    const siteId = z.string().min(1).max(128).parse(query.siteId);
    return controlJson(query.view === "policies" ? await listModelSitePolicies(siteId, query.pageToken)
      : await listModelSiteReleaseCatalogs(siteId, query.pageToken));
  } catch (error) { return controlError(error); }
}

export async function POST(request: Request) {
  try {
    const input = command.parse(await boundedJson(request, 256 * 1024));
    if (input.action === "import_inventory") return controlJson(await importModelInventory(input), { status: 201 });
    if (input.action === "activate_inventory") return controlJson(await activateModelInventory(
      input.targetDigest, input.expectedPointerRevision), { status: 201 });
    if (input.action === "change_site_policy") return controlJson(await changeModelSitePolicy(input), { status: 201 });
    if (input.action === "materialize_options") return controlJson(await materializeModelOptions(input), { status: 201 });
    return controlJson(await publishModelSiteReleaseCatalog(input), { status: 201 });
  } catch (error) { return controlError(error); }
}
