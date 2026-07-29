import type { Metadata } from "next";
import type { ReactNode } from "react";

import { site } from "../site-bootstrap";
import "./site.css";

export const metadata: Metadata = {
  title: site.displayName,
  description: `${site.displayName} AI workspace`,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
