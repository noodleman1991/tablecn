"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { Event, Attendee } from "@/db/schema";

interface EventAttendeesResponse {
  event: Event;
  attendees: Attendee[];
  cacheAge: number | null;
}

async function fetchEventAttendees(eventId: string): Promise<EventAttendeesResponse> {
  const response = await fetch(`/api/events/${eventId}/attendees`);
  if (!response.ok) {
    throw new Error("Failed to fetch event attendees");
  }
  return response.json() as Promise<EventAttendeesResponse>;
}

/**
 * Hook to fetch attendees for a specific event using TanStack Query.
 * Provides caching, deduplication, and background refetching.
 */
export function useEventAttendees(eventId: string | undefined) {
  return useQuery({
    queryKey: ["event-attendees", eventId],
    queryFn: () => fetchEventAttendees(eventId!),
    enabled: !!eventId,
    staleTime: 2 * 60 * 1000, // Consider data fresh for 2 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchOnWindowFocus: false, // Don't refetch on tab focus (user can manually refresh)
  });
}

/**
 * Hook to prefetch attendees for an event.
 * Use this on hover/focus of event items in dropdown for instant switching.
 */
export function usePrefetchEventAttendees() {
  const queryClient = useQueryClient();

  return useCallback(
    (eventId: string) => {
      // Only prefetch if not already in cache
      const existing = queryClient.getQueryData(["event-attendees", eventId]);
      if (!existing) {
        queryClient.prefetchQuery({
          queryKey: ["event-attendees", eventId],
          queryFn: () => fetchEventAttendees(eventId),
          staleTime: 2 * 60 * 1000,
        });
      }
    },
    [queryClient]
  );
}

/**
 * Hook to invalidate the attendees cache for a specific event.
 * Use this after mutations (check-in, delete, etc.)
 */
export function useInvalidateEventAttendees() {
  const queryClient = useQueryClient();

  return useCallback(
    (eventId: string) => {
      queryClient.invalidateQueries({ queryKey: ["event-attendees", eventId] });
    },
    [queryClient]
  );
}

/**
 * Hook to update attendees cache optimistically.
 * Returns functions for optimistic updates and rollback.
 */
export function useOptimisticAttendees(eventId: string) {
  const queryClient = useQueryClient();

  const updateAttendee = useCallback(
    (attendeeId: string, updates: Partial<Attendee>) => {
      const previousData = queryClient.getQueryData<EventAttendeesResponse>([
        "event-attendees",
        eventId,
      ]);

      if (previousData) {
        queryClient.setQueryData<EventAttendeesResponse>(
          ["event-attendees", eventId],
          {
            ...previousData,
            attendees: previousData.attendees.map((a) =>
              a.id === attendeeId ? { ...a, ...updates } : a
            ),
          }
        );
      }

      return previousData;
    },
    [queryClient, eventId]
  );

  const rollback = useCallback(
    (previousData: EventAttendeesResponse | undefined) => {
      if (previousData) {
        queryClient.setQueryData(["event-attendees", eventId], previousData);
      }
    },
    [queryClient, eventId]
  );

  return { updateAttendee, rollback };
}
