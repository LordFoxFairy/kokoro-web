export const iamBuiltInRoleKeys = ["owner", "admin", "member"] as const;
export type IamBuiltInRoleKey = (typeof iamBuiltInRoleKeys)[number];

// Kept as the UI-facing built-in catalog. Custom role selectors must use
// isIamRoleKey because their keys are provider-owned runtime values.
export const iamRoleKeys = iamBuiltInRoleKeys;
export type IamRoleKey = string;

export const iamRoleKeyPattern = /^[a-z][a-z0-9_]{0,63}$/u;

export function isIamRoleKey(value: string): boolean {
  return iamRoleKeyPattern.test(value);
}

export const iamAuthorizationReasons = [
  "allowed",
  "session_inactive",
  "user_inactive",
  "membership_inactive",
  "permission_unknown",
  "permission_denied",
] as const;
export type IamAuthorizationReason = (typeof iamAuthorizationReasons)[number];
