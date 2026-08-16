import "server-only";

import type { DefaultSession } from "next-auth";

type PlatformRole = "user" | "admin";
type UserStatus = "active" | "suspended" | "deleted";

declare module "next-auth" {
  interface User {
    id: string;
    platformRole: PlatformRole;
    status: UserStatus;
  }

  interface Session {
    user: DefaultSession["user"] & Readonly<{
      id: string;
      email: string;
      platformRole: PlatformRole;
      status: UserStatus;
    }>;
  }
}

declare module "@auth/core/adapters" {
  interface AdapterUser {
    platformRole: PlatformRole;
    status: UserStatus;
  }
}

export {};
