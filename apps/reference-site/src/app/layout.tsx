import type { Metadata } from "next";
import type { ReactNode } from "react";

import { referenceSite } from "../site-bootstrap";
import "./style.css";

export const metadata: Metadata = { title: referenceSite.displayName };

export default function Layout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
