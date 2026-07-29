import { notFound } from "next/navigation"

export default function LegacySharedSessionPage(): never {
  // Browser v3 has no public-share projection contract. Keep the legacy URL fail-closed.
  notFound()
}
