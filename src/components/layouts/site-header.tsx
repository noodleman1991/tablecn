import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { Icons } from "@/components/icons";
import { ModeToggle } from "@/components/layouts/mode-toggle";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-border/40 border-b bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/60">
      <div className="container flex h-14 items-center">
        <Button variant="ghost" size="icon" className="size-8" asChild>
          <Link href="/">
            <LayoutGrid />
          </Link>
        </Button>
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
            Members
          </Link>
          <Link
            href="/data-grid"
            className="text-foreground/60 transition-colors hover:text-foreground"
          >
            Data Grid
          </Link>
          <Link
            href="/data-grid-live"
            className="text-foreground/60 transition-colors hover:text-foreground"
          >
            Data Grid Live
          </Link>
        </nav>
        <nav className="flex flex-1 items-center justify-end gap-2">
          <Button variant="ghost" size="icon" className="size-8" asChild>
            <Link
              aria-label="GitHub repo"
              href={siteConfig.links.github}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icons.gitHub className="size-4" aria-hidden="true" />
            </Link>
          </Button>
          <ModeToggle />
        </nav>
      </div>
    </header>
  );
}
