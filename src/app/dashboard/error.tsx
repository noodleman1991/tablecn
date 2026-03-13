"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
      <h2 className="text-xl font-semibold">Dashboard error</h2>
      <p className="text-muted-foreground text-sm">
        Failed to load dashboard data. Please try again.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
