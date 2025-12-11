import Link from "next/link";
import { DoorOpen } from "lucide-react";
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
            <DoorOpen />
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
            Community Members
          </Link>
        </nav>
        <nav className="flex flex-1 items-center justify-end gap-2">
          <ModeToggle />
        </nav>
      </div>
    </header>
  );
}
