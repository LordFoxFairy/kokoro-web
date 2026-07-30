import { z } from "zod";
import { boundedJson, controlError, controlJson } from "@/lib/control-plane/http";
import { strictQuery } from "@/lib/control-plane/strict-query";
import {
  activateModelInventory, changeModelSitePolicy, importModelInventory,
  getModelCommandReceipt,
  getModelInventoryRevision,
  listModelInventoryBindings, listModelInventoryDefinitions, listModelInventoryProviders,
  listModelInventoryRevisions, listModelInventoryRoutes, listModelOptions,
  listModelSitePolicies, listModelSiteReleaseCatalogs, materializeModelOptions,
  publishModelSiteReleaseCatalog,
} from "@/lib/control-plane/client";

export const runtime = "nodejs";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const name128 = z.string().min(1).max(128);
const reference = z.string().min(3).max(256);
const siteId = z.string().min(3).max(128);
const uint64 = z.string().regex(/^(?:0|[1-9][0-9]*)$/u)
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n);
const uint32 = z.number().int().min(0).max(2_147_483_647);
const position = uint32.max(10_000);
const product = z.enum(["chat", "music", "image", "video"]);
const role = z.enum(["main", "generation"]);
const pageToken = z.string().min(3).max(1024).optional();
const uniqueStrings = (minimum: number, maximum: number, item = name128) => z.array(item).min(minimum).max(maximum)
  .refine((items) => new Set(items).size === items.length, { message: "items must be unique" });

const provider = z.object({ key: name128, provider: name128, accountKey: name128,
  secretRef: z.string().min(3).max(512), adapterKind: z.enum(["litellm", "direct"]), priority: position }).strict();
const model = z.object({ key: name128, displayName: z.string().min(1).max(512),
  inputModalities: uniqueStrings(1, 32), outputModalities: uniqueStrings(1, 32),
  capabilities: uniqueStrings(1, 128), contextWindow: uint32.positive().optional(),
  enabled: z.boolean() }).strict();
const binding = z.object({ key: name128, modelKey: name128, providerKey: name128,
  upstreamModel: z.string().min(1).max(512), gatewayModelName: z.string().min(1).max(256),
  priority: position, enabled: z.boolean() }).strict();
const route = z.object({ product, role, modelKey: name128, position,
  requiredCapabilities: uniqueStrings(1, 128) }).strict();
const availability = z.object({ providerKey: name128, status: z.enum(["active", "disabled"]),
  health: z.enum(["unknown", "healthy", "degraded", "down"]), epoch: uint64,
  observationRef: z.string().min(1).max(256).optional(),
  observedAt: z.string().datetime({ offset: true }).optional() }).strict();
const assignment = z.object({ role, modelKey: name128, position,
  requiredCapabilities: uniqueStrings(1, 128), enabled: z.boolean() }).strict();
const selection = z.object({ primaryModelKey: name128,
  fallbackModelKeys: uniqueStrings(0, 64).default([]) }).strict();
const option = z.object({ optionKey: name128, surface: product, label: z.string().min(1).max(160),
  description: z.string().max(512).optional(), tier: z.string().min(1).max(64).optional(),
  lifecycle: z.enum(["active", "disabled"]), orchestration: selection, generation: selection }).strict();
const surface = z.object({ surface: product, allowedOptionRevisionRefs: uniqueStrings(1, 256, reference),
  defaultModelOptionRevisionRef: reference }).strict();

const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("import_inventory"), sourceReference: z.string().min(1).max(512),
    providers: z.array(provider).min(1).max(256), models: z.array(model).min(1).max(2048),
    bindings: z.array(binding).min(1).max(4096), productRoutes: z.array(route).max(4096).default([]),
    providerAvailability: z.array(availability).max(256).default([]) }).strict(),
  z.object({ action: z.literal("activate_inventory"), targetDigest: digest,
    expectedPointerRevision: uint64 }).strict(),
  z.object({ action: z.literal("change_site_policy"), siteId, product,
    enabled: z.boolean(), catalogMode: z.enum(["follow_active", "pinned"]),
    catalogDigest: digest.optional(), assignmentMode: z.enum(["inherit", "replace"]),
    expectedRevision: uint64, assignments: z.array(assignment).max(4096).default([]) }).strict(),
  z.object({ action: z.literal("materialize_options"), inventoryDigest: digest,
    options: z.array(option).min(1).max(256) }).strict(),
  z.object({ action: z.literal("publish_site_release_catalog"), siteId,
    siteReleaseRef: reference, inventoryDigest: digest, surfaces: z.array(surface).min(1).max(4) }).strict(),
]).superRefine((value, issue) => {
  if (value.action === "change_site_policy" && (value.catalogMode === "pinned"
    ? value.catalogDigest === undefined : value.catalogDigest !== undefined)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "catalog digest does not match mode" });
  }
});

export async function GET(request: Request) {
  try {
    const query = strictQuery(request, { view: z.enum(["inventories", "inventory", "providers", "definitions", "bindings",
      "routes", "options", "policies", "catalogs", "receipt"]), inventoryDigest: digest.optional(),
    surface: product.optional(), siteId: siteId.optional(), pageToken,
    receiptRef: z.string().regex(/^[a-f0-9]{32}$/u).optional(),
    requestDigest: digest.optional(),
    operation: z.enum(["import_inventory", "activate_inventory", "change_site_policy",
      "materialize_options", "publish_site_release_catalog"]).optional() });
    if (query.view === "receipt") {
      if (query.inventoryDigest !== undefined || query.surface !== undefined || query.pageToken !== undefined) {
        z.never().parse(query);
      }
      return controlJson(await getModelCommandReceipt({
        commandId: z.string().regex(/^[a-f0-9]{32}$/u).parse(query.receiptRef),
        requestDigest: digest.parse(query.requestDigest),
        operation: z.enum(["import_inventory", "activate_inventory", "change_site_policy",
          "materialize_options", "publish_site_release_catalog"]).parse(query.operation),
        ...(query.siteId ? { siteId: query.siteId } : {}),
      }));
    }
    if (query.receiptRef !== undefined || query.requestDigest !== undefined || query.operation !== undefined) {
      z.never().parse(query);
    }
    if (query.view === "inventories") return controlJson(await listModelInventoryRevisions(query.pageToken));
    if (query.view === "inventory") return controlJson(await getModelInventoryRevision(digest.parse(query.inventoryDigest)));
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
    const selectedSiteId = siteId.parse(query.siteId);
    return controlJson(query.view === "policies" ? await listModelSitePolicies(selectedSiteId, query.pageToken)
      : await listModelSiteReleaseCatalogs(selectedSiteId, query.pageToken));
  } catch (error) { return controlError(error); }
}

export async function POST(request: Request) {
  try {
    const input = command.parse(await boundedJson(request, 16 * 1024 * 1024));
    if (input.action === "import_inventory") return controlJson(await importModelInventory(input), { status: 201 });
    if (input.action === "activate_inventory") return controlJson(await activateModelInventory(
      input.targetDigest, input.expectedPointerRevision), { status: 201 });
    if (input.action === "change_site_policy") return controlJson(await changeModelSitePolicy(input), { status: 201 });
    if (input.action === "materialize_options") return controlJson(await materializeModelOptions(input), { status: 201 });
    return controlJson(await publishModelSiteReleaseCatalog(input), { status: 201 });
  } catch (error) { return controlError(error); }
}
