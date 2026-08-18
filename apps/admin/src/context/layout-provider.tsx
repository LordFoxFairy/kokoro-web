"use client";

import * as React from "react";

export type SidebarCollapsible = "icon" | "offcanvas" | "none";

type LayoutContextValue = {
  collapsible: SidebarCollapsible;
};

const LayoutContext = React.createContext<LayoutContextValue>({ collapsible: "icon" });

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  return <LayoutContext value={{ collapsible: "icon" }}>{children}</LayoutContext>;
}

export function useLayout() {
  return React.useContext(LayoutContext);
}
