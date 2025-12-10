import Link from "next/link";
import { Suspense } from "react"

import { ModeToggle } from "@/components/layouts/mode-toggle";
import { siteConfig } from "@/config/site";

export function SiteHeader() {
  return (
      <Suspense fallback={<p>Loading...</p>}>
        <header className="sticky top-0 z-50 w-full border-border/40 border-b bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/60">
          <div className="container flex h-14 items-center">
            <Link href="/" className="mr-2 flex items-center md:mr-6 md:space-x-2">
              <span className="hidden font-bold md:inline-block">
                {siteConfig.name}
              </span>
            </Link>
            <nav className="flex w-full items-center gap-6 text-sm">
              <Link
                href="/"
                className="text-foreground/60 transition-colors hover:text-foreground"
              >
                Check-In
              </Link>
              <Link
                href="/community-members-list"
                className="text-foreground/60 transition-colors hover:text-foreground"
              >
                Community Members
              </Link>
            </nav>
            <nav className="flex flex-1 items-center md:justify-end">
              <ModeToggle />
            </nav>
          </div>
        </header>
      </Suspense>
  );
}
