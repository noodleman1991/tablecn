import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { MembersPage } from "./components/members-page";
import { getMembers } from "../actions";
import { requireAuth } from "@/lib/auth";

export const metadata = {
  title: "Community Members List",
  description: "View and manage community membership",
};

export default async function CommunityMembersListPage() {
  // Require authentication
  await requireAuth();

  return (
    <Suspense
      fallback={
        <div className="container flex flex-col gap-6 py-8">
          <Skeleton className="h-12 w-64" />
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      }
    >
      <MembersPageWrapper />
    </Suspense>
  );
}

async function MembersPageWrapper() {
  const members = await getMembers();

  return <MembersPage members={members} />;
}
