import { redirect } from "next/navigation"

export default function LegacySettingsPage(): never {
  // Settings depended on legacy model/billing owners; the v3 reference exposes no fake controls.
  redirect("/")
}
