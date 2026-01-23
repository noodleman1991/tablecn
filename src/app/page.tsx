import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckInPage } from "./components/check-in-page";
import { getFutureEvents, getAttendeesForEvent, getEventById } from "./actions";
import { requireAuth } from "@/lib/auth";

interface IndexPageProps {
  searchParams: Promise<{ eventId?: string }>;
}

export const metadata: Metadata = {
  title: "Event Check-In",
  description: "Check in attendees for events",
};

export default async function IndexPage(props: IndexPageProps) {
  // Require authentication
  await requireAuth();

  const searchParams = await props.searchParams;
  const eventId = searchParams.eventId;

  return (
    <Suspense
      fallback={
        <div className="container flex flex-col gap-6 py-8">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-32 w-full" />
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      }
    >
      <CheckInPageWrapper eventId={eventId} />
    </Suspense>
  );
}

async function CheckInPageWrapper({ eventId }: { eventId?: string }) {
  // Fetch future events and validate event ID in parallel
  const [futureEvents, eventData] = await Promise.all([
    getFutureEvents(),
    eventId ? getEventById(eventId) : Promise.resolve(null),
  ]);

  // Determine selected event ID
  const selectedEventId = eventData?.id ?? futureEvents[0]?.id;

  // Fetch attendees (depends on knowing the selected event)
  const attendees = selectedEventId
    ? await getAttendeesForEvent(selectedEventId)
    : [];

  return (
    <CheckInPage
      futureEvents={futureEvents}
      initialEventId={selectedEventId}
      initialAttendees={attendees}
    />
  );
}
