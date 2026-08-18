"use client";

import { useEffect, useState } from "react";

export function NavigationProgress() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    const onNavigation = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest("a[href]");
      if (!link || link.getAttribute("target") || event.metaKey || event.ctrlKey) return;
      setVisible(true);
      timer = window.setTimeout(() => setVisible(false), 600);
    };
    document.addEventListener("click", onNavigation);
    return () => { document.removeEventListener("click", onNavigation); if (timer) window.clearTimeout(timer); };
  }, []);
  return <div aria-hidden="true" className="fixed inset-x-0 top-0 z-50 h-0.5 bg-primary transition-opacity" data-visible={visible} style={{ opacity: visible ? 1 : 0 }} />;
}
