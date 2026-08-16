import type { MessageKey } from "@/i18n/messages";

export type AdminNavigationItem = Readonly<{
  href: string;
  labelKey: MessageKey;
}>;

export const adminNavigation: readonly AdminNavigationItem[] = Object.freeze([
  Object.freeze({ href: "/", labelKey: "nav.overview" }),
]);
