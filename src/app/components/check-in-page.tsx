"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Mail, RefreshCw } from "lucide-react";
import type { Event, Attendee } from "@/db/schema";
import { format, formatDistanceToNow } from "date-fns";
import {
  exportDoorListToCSV,
  downloadCSV,
  generateDoorListFilename,
  emailCSVViaServer,
} from "@/lib/csv-export";
import { CheckInTable } from "./check-in-table-grouped";
import { toast } from "sonner";
import { getPastEvents, refreshAttendeesForEvent, getSyncCacheAge } from "../actions";
import { cn } from "@/lib/utils";
import { AddManualAttendeeDialog } from "./add-manual-attendee-dialog";

// Cache configuration
const PAST_EVENTS_CACHE_KEY = "tablecn_past_events";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedData<T> {
  data: T;
  timestamp: number;
}

// Cache utility functions
function getCachedPastEvents(): Event[] | null {
  if (typeof window === "undefined") return null;

  try {
    const cached = localStorage.getItem(PAST_EVENTS_CACHE_KEY);
    if (!cached) return null;

    const parsed = JSON.parse(cached) as CachedData<Event[]>;
    const isExpired = Date.now() - parsed.timestamp > CACHE_TTL_MS;

    if (isExpired) {
      localStorage.removeItem(PAST_EVENTS_CACHE_KEY);
      return null;
    }

    return parsed.data;
  } catch {
    return null;
  }
}

function setCachedPastEvents(events: Event[]) {
  if (typeof window === "undefined") return;

  try {
    const cached: CachedData<Event[]> = {
      data: events,
      timestamp: Date.now(),
    };
    localStorage.setItem(PAST_EVENTS_CACHE_KEY, JSON.stringify(cached));
  } catch (error) {
    console.warn("Failed to cache past events:", error);
  }
}

interface CheckInPageProps {
  futureEvents: Event[];
  initialEventId?: string;
  initialAttendees?: Attendee[];
}

export function CheckInPage({
  futureEvents,
  initialEventId,
  initialAttendees = [],
}: CheckInPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [selectedEventId, setSelectedEventId] = useState<string | undefined>(
    initialEventId,
  );
  const [pastEvents, setPastEvents] = useState<Event[]>([]);
  const [isPending, startTransition] = useTransition();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cacheAge, setCacheAge] = useState<number | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>(initialAttendees);

  // Load cached past events on client-side only (after hydration) - SINGLE effect
  useEffect(() => {
    const cached = getCachedPastEvents();
    if (cached && cached.length > 0) {
      setPastEvents(cached);
    }
  }, []);

  const allEvents = [...futureEvents, ...pastEvents];
  const selectedEvent = allEvents.find((e) => e.id === selectedEventId);

  // Filter out deleted/cancelled/refunded tickets for counts
  const activeAttendees = attendees.filter(
    (a) => a.orderStatus !== "deleted" && a.orderStatus !== "cancelled" && a.orderStatus !== "refunded"
  );
  const deletedCount = attendees.length - activeAttendees.length;
  const checkedInCount = activeAttendees.filter((a) => a.checkedIn).length;
  const totalCount = activeAttendees.length;
  const membersOnlyCount = activeAttendees.filter((a) => a.isMembersOnlyTicket).length;

  const handleLoadPastEvents = () => {
    // Check cache first
    const cached = getCachedPastEvents();
    if (cached && cached.length > 0) {
      setPastEvents(cached);
      return;
    }

    // Fetch from server if cache miss
    startTransition(async () => {
      const events = await getPastEvents();
      setPastEvents(events);
      setCachedPastEvents(events);
    });
  };

  // Sync selectedEventId: prioritize URL params, then initialEventId
  // Combined into ONE effect to avoid race conditions
  useEffect(() => {
    const eventIdFromUrl = searchParams.get("eventId");
    const targetEventId = eventIdFromUrl || initialEventId;

    if (targetEventId && targetEventId !== selectedEventId) {
      setSelectedEventId(targetEventId);
    }
  }, [searchParams, initialEventId]); // Removed selectedEventId from deps to prevent loops

  // Sync attendees when initialAttendees prop changes
  useEffect(() => {
    setAttendees(initialAttendees);
  }, [initialAttendees]);

  // Fetch cache age when event changes
  useEffect(() => {
    if (selectedEventId && selectedEvent) {
      // Only check cache age for future/today events
      const eventDate = new Date(selectedEvent.eventDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (eventDate >= today) {
        getSyncCacheAge(selectedEventId).then(setCacheAge);
      } else {
        setCacheAge(null); // Past events don't have cache
      }
    }
  }, [selectedEventId]); // Removed selectedEvent - only need eventId

  // Handle manual refresh
  const handleRefresh = async () => {
    if (!selectedEventId) return;

    setIsRefreshing(true);
    try {
      await refreshAttendeesForEvent(selectedEventId);
      setCacheAge(0); // Just refreshed
      // Page will auto-reload due to revalidatePath in the action
    } catch (error) {
      console.error("Refresh failed:", error);
      // You could add toast notification here
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="container flex flex-col gap-6 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Event Check-In</h1>
        <p className="text-muted-foreground">
          Select an event and check in attendees as they arrive
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select Event</CardTitle>
        </CardHeader>
        <CardContent>
          <Select
            value={selectedEventId}
            onValueChange={(value) => {
              if (value === "load-past-events") {
                handleLoadPastEvents();
                return;
              }
              // Use startTransition for smooth UI during navigation
              startTransition(() => {
                setSelectedEventId(value);
                // Preserve existing query params (perPage, filters, etc.) when changing events
                const params = new URLSearchParams(searchParams.toString());
                params.set('eventId', value);
                params.set('page', '1'); // Reset to page 1 for new event
                router.push(`/?${params.toString()}`);
              });
            }}
          >
            <SelectTrigger className="w-full md:w-[600px]">
              <SelectValue placeholder="Choose an event..." />
            </SelectTrigger>
            <SelectContent className="max-w-[600px]">
              {futureEvents.length > 0 && (
                <>
                  {futureEvents.map((event) => (
                    <SelectItem key={event.id} value={event.id}>
                      {event.name} - {format(new Date(event.eventDate), "PPP")}
                    </SelectItem>
                  ))}
                </>
              )}
              {pastEvents.length > 0 && (
                <>
                  <SelectSeparator />
                  {pastEvents.map((event) => (
                    <SelectItem key={event.id} value={event.id}>
                      {event.name} - {format(new Date(event.eventDate), "PPP")}
                    </SelectItem>
                  ))}
                </>
              )}
              {pastEvents.length === 0 && (
                <>
                  {futureEvents.length > 0 && <SelectSeparator />}
                  <SelectItem
                    value="load-past-events"
                    className="italic text-muted-foreground"
                    disabled={isPending}
                  >
                    {isPending ? "Loading past events..." : "Load past events"}
                  </SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedEvent && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total Attendees
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalCount}</div>
                <div className="flex flex-col gap-0.5 mt-1">
                  {membersOnlyCount > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {membersOnlyCount} via members link
                    </p>
                  )}
                  {deletedCount > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {deletedCount} deleted
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Checked In
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{checkedInCount}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Remaining
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {totalCount - checkedInCount}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-col gap-4 space-y-0 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-col gap-1">
                <CardTitle>Door List</CardTitle>
                {selectedEvent && (() => {
                  const eventDate = new Date(selectedEvent.eventDate);
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const isFutureEvent = eventDate >= today;

                  return isFutureEvent && cacheAge !== null && (
                    <p className="text-sm text-muted-foreground">
                      Last synced: {cacheAge === 0 ? "just now" : formatDistanceToNow(Date.now() - cacheAge * 1000, { addSuffix: true })}
                    </p>
                  );
                })()}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-2">
                <AddManualAttendeeDialog eventId={selectedEvent.id} />
                {selectedEvent && (() => {
                  const eventDate = new Date(selectedEvent.eventDate);
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const isFutureEvent = eventDate >= today;

                  return isFutureEvent && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRefresh}
                      disabled={isRefreshing}
                      className="min-h-[44px] w-full sm:w-auto gap-2"
                    >
                      <RefreshCw className={cn("size-4", isRefreshing && "animate-spin")} />
                      <span className="sm:hidden">Refresh</span>
                      <span className="hidden sm:inline">{isRefreshing ? "Refreshing..." : "Refresh"}</span>
                    </Button>
                  );
                })()}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const csv = exportDoorListToCSV(selectedEvent, attendees);
                    const filename = generateDoorListFilename(selectedEvent);
                    downloadCSV(csv, filename);
                    toast.success("CSV downloaded successfully");
                  }}
                  className="min-h-[44px] w-full sm:w-auto gap-2"
                >
                  <Download className="size-4" />
                  <span className="sm:hidden">CSV</span>
                  <span className="hidden sm:inline">Download CSV</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      const csv = exportDoorListToCSV(selectedEvent, attendees);
                      const filename = generateDoorListFilename(selectedEvent);
                      await emailCSVViaServer(csv, filename);
                      toast.success("Email sent successfully");
                    } catch (error) {
                      toast.error(
                        error instanceof Error ? error.message : "Failed to send email"
                      );
                    }
                  }}
                  className="min-h-[44px] w-full sm:w-auto gap-2"
                >
                  <Mail className="size-4" />
                  <span className="sm:hidden">Email</span>
                  <span className="hidden sm:inline">Send Email</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* Show loading overlay during event transition */}
              <div className={cn("relative", isPending && "opacity-50 pointer-events-none")}>
                {isPending && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                    <div className="flex flex-col items-center gap-2">
                      <RefreshCw className="size-6 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Loading event...</span>
                    </div>
                  </div>
                )}
                <CheckInTable attendees={attendees} />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
