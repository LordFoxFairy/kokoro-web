import { VerificationState } from "@/components/auth/login-form";

type VerifyPageProps = Readonly<{
  searchParams: Promise<Readonly<{ error?: string | string[] }>>;
}>;

export default async function VerifyPage({ searchParams }: VerifyPageProps): Promise<React.ReactElement> {
  const rawError = (await searchParams).error;
  const error = Array.isArray(rawError) ? rawError[0] ?? null : rawError ?? null;

  return (
    <main className="auth-page">
      <VerificationState error={error} />
    </main>
  );
}
