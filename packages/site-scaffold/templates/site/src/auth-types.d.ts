import "next-auth";

declare module "next-auth" {
  interface Session {
    authState: "authenticated" | "mfa_required" | "anonymous";
    mfaTransactionRef?: string;
  }
}
