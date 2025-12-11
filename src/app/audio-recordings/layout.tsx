import { ModeToggle } from "@/components/layouts/mode-toggle";
import { Toaster } from "@/components/ui/sonner";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Audio Recordings",
    template: "%s - Audio Recordings",
  },
  description: "Community audio recordings access",
};

export default function AudioRecordingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="relative flex min-h-screen flex-col">
        <header className="sticky top-0 z-50 w-full border-border/40 border-b bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/60">
          <div className="container flex h-14 items-center justify-between">
            <h1 className="text-lg font-semibold">Audio Recordings</h1>
            <ModeToggle />
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </div>
      <Toaster />
    </>
  );
}
