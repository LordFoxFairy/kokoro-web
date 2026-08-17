export const platformAdminCapability = "platform:admin" as const;
export const adminCapabilities = [platformAdminCapability] as const;
export type AdminCapability = (typeof adminCapabilities)[number];
export type AdminCapabilityScope = "platform";

export function hasAdminCapability(
  capabilities: readonly AdminCapability[],
  required: AdminCapability,
): boolean {
  return capabilities.includes(required);
}
