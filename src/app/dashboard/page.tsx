import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAuth } from "@/lib/auth";
import { getDashboardStats } from "./actions";
import { DashboardPage } from "./components/dashboard-page";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Event analytics and validation dashboard",
};

function getDefaultPeriod() {
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - 9);
  from.setDate(1);
  return { from, to };
}

export default async function DashboardRoute() {
  await requireAuth();

  return (
    <Suspense
      fallback={
        <div className="container flex flex-col gap-6 py-8">
          <Skeleton className="h-12 w-64" />
          <div className="grid gap-4 md:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      }
    >
      <DashboardPageWrapper />
    </Suspense>
  );
}

async function DashboardPageWrapper() {
  const defaultPeriod = getDefaultPeriod();
  const stats = await getDashboardStats(defaultPeriod);

  return <DashboardPage initialStats={stats} defaultPeriod={defaultPeriod} />;
}
