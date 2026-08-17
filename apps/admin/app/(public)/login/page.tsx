import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { signIn } from "@/auth";
import { LoginForm } from "@/components/auth/login-form";
import { authenticateAdministrator } from "@/server/auth/credential-login";
import { sessionCookie } from "@/server/auth/cookie";
import { loadAdminConfig } from "@/server/config/config";
import { createIamCredentialClient } from "@/server/iam/credential-client";
import { createWorkloadTransport } from "@/server/iam/transport";

async function loginWithPassword(formData: FormData): Promise<void> {
  "use server";

  const config = loadAdminConfig();
  const result = await authenticateAdministrator({
    email: formData.get("email"),
    password: formData.get("password"),
  }, createIamCredentialClient(createWorkloadTransport(config.iam)));
  if (result.status !== "success") {
    redirect(`/login?error=${result.status}`);
  }
  const contract = sessionCookie(config.auth);
  (await cookies()).set(contract.name, result.login.session.token, {
    ...contract.options,
    expires: result.login.session.expires,
  });
  redirect("/");
}

async function loginWithEmail(formData: FormData): Promise<void> {
  "use server";

  if (loadAdminConfig().smtp === null) redirect("/login?error=unavailable");
  const email = formData.get("email");
  await signIn("nodemailer", {
    email: typeof email === "string" ? email.trim() : "",
    redirectTo: "/",
  });
}

const publicErrors = new Set(["invalid", "invalid_credentials", "unavailable"]);

export default async function LoginPage({ searchParams }: Readonly<{
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>): Promise<React.ReactElement> {
  const value = (await searchParams).error;
  const error = typeof value === "string" && publicErrors.has(value) ? value : null;
  const emailEnabled = loadAdminConfig().smtp !== null;
  return (
    <main className="auth-page">
      <LoginForm passwordAction={loginWithPassword} emailAction={loginWithEmail} emailEnabled={emailEnabled} error={error} />
    </main>
  );
}
