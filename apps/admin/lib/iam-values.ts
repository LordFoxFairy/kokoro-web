export const iamRoleKeys = ["owner", "admin", "member"] as const;
export type IamRoleKey = (typeof iamRoleKeys)[number];

export const iamAuthorizationReasons = [
  "allowed",
  "session_inactive",
  "user_inactive",
  "membership_inactive",
  "permission_unknown",
  "permission_denied",
] as const;
export type IamAuthorizationReason = (typeof iamAuthorizationReasons)[number];
