import { redirect } from "next/navigation";

import { signOut } from "@/auth";
import { AdminShell, type SafeAdministrator } from "@/components/shell/admin-shell";
import { platformAdminCapability } from "@/lib/admin-capabilities";
import { requireAdminCapability } from "@/server/auth/session";

export const dynamic = "force-dynamic";

async function loadAdministrator(): Promise<SafeAdministrator> {
  try {
    const session = await requireAdminCapability(platformAdminCapability);
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    };
  } catch {
    redirect("/login");
  }
}

async function logout(): Promise<void> {
  "use server";
  await signOut({ redirectTo: "/login" });
}

export default async function ControlLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): Promise<React.ReactElement> {
  const administrator = await loadAdministrator();
  return (
    <AdminShell administrator={administrator} capabilities={[platformAdminCapability]} signOutAction={logout}>
      {children}
    </AdminShell>
  );
}
