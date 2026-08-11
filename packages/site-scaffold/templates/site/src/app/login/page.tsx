import { redirect } from "next/navigation";

import { auth } from "../../auth";
import { site } from "../../site-bootstrap";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await auth();
  if (session?.authState === "authenticated") redirect("/");
  const transactionRef = session?.authState === "mfa_required" ? session.mfaTransactionRef : undefined;
  return (
    <main>
      <p className="eyebrow">{site.displayName}</p>
      <h1>{transactionRef ? "Verify sign-in" : "Sign in"}</h1>
      <LoginForm transactionRef={transactionRef} />
      __CREATE_ACCOUNT_LINK_FRAGMENT__
    </main>
  );
}
