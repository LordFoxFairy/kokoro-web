import { redirect } from "next/navigation";

import { signIn } from "@/auth";
import { LoginForm } from "@/components/auth/login-form";

async function requestLoginLink(formData: FormData): Promise<void> {
  "use server";

  const email = String(formData.get("email") ?? "").trim().slice(0, 254);
  try {
    await signIn("nodemailer", { email, redirect: false, redirectTo: "/" });
  } catch {
    // Public responses remain identical for unknown, inactive, invalid, and provider-error cases.
  }
  redirect("/auth/verify");
}

export default function LoginPage(): React.ReactElement {
  return (
    <main className="auth-page">
      <LoginForm action={requestLoginLink} />
    </main>
  );
}
