"use client";

import { usePathname } from "next/navigation";
import { SiteHeader } from "./site-header";

const ROUTES_WITHOUT_HEADER = ["/newsletter-signup", "/newsletter-signup/embed"];

export function ConditionalSiteHeader() {
  const pathname = usePathname();

  if (ROUTES_WITHOUT_HEADER.includes(pathname)) {
    return null;
  }

  return <SiteHeader />;
}
