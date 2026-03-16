"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getFunnelByEvent, getFunnelByMonth, getReturningDetailsForEvent, getCommunityDetailsForEvent } from "../actions";
import type { PeriodFilter, FunnelEventRow, FunnelMonthRow } from "../types";

interface FunnelTabProps {
  period: PeriodFilter;
}

export function FunnelTab({ period }: FunnelTabProps) {
  const [viewMode, setViewMode] = React.useState<"event" | "month">("event");
  const [eventData, setEventData] = React.useState<FunnelEventRow[]>([]);
  const [monthData, setMonthData] = React.useState<FunnelMonthRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        if (viewMode === "event") {
          const data = await getFunnelByEvent(period);
          if (!cancelled) setEventData(data);
        } else {
          const data = await getFunnelByMonth(period);
          if (!cancelled) setMonthData(data);
        }
      } catch (err) {
        console.error("Failed to load funnel data:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [period, viewMode]);

  function TicketBreakdownTooltip({ breakdown }: { breakdown: Record<string, number> }) {
    const entries = Object.entries(breakdown);
    if (entries.length === 0) return null;
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help underline decoration-dotted">
              {entries.reduce((sum, [, c]) => sum + c, 0)}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs">
              {entries.map(([type, count]) => (
                <div key={type}>
                  {type}: {count}
                </div>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  function ReturningDetailPopover({ eventId, count }: { eventId: string; count: number }) {
    const [details, setDetails] = React.useState<
      Array<{ email: string; name: string; isNew: boolean; isCommunityMember: boolean }> | null
    >(null);
    const [loadingDetails, setLoadingDetails] = React.useState(false);

    const handleOpen = (open: boolean) => {
      if (open && details === null && !loadingDetails) {
        setLoadingDetails(true);
        getReturningDetailsForEvent(eventId)
          .then(setDetails)
          .catch(console.error)
          .finally(() => setLoadingDetails(false));
      }
    };

    return (
      <Popover onOpenChange={handleOpen}>
        <PopoverTrigger asChild>
          <button className="cursor-pointer underline decoration-dotted hover:text-foreground">
            {count}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 max-h-64 overflow-y-auto p-3" align="end">
          {loadingDetails ? (
            <div className="space-y-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          ) : details && details.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                {details.length} returning attendee(s)
              </p>
              {details.map((d) => (
                <div key={d.email} className="flex items-center justify-between text-sm">
                  <div className="truncate flex-1 mr-2">
                    <span className="font-medium">{d.name}</span>
                    <span className="text-muted-foreground text-xs ml-1">({d.email})</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {d.isNew && (
                      <Badge variant="outline" className="border-green-500 bg-green-50 text-green-700 text-xs">
                        New
                      </Badge>
                    )}
                    {d.isCommunityMember && (
                      <Badge variant="outline" className="border-blue-500 bg-blue-50 text-blue-700 text-xs">
                        Community
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No returning attendees found.</p>
          )}
        </PopoverContent>
      </Popover>
    );
  }

  function CommunityDetailPopover({
    eventId, gained, lost,
  }: {
    eventId: string; gained: number; lost: number;
  }) {
    const [details, setDetails] = React.useState<{
      gained: Array<{ email: string; name: string }>;
      lost: Array<{ email: string; name: string }>;
    } | null>(null);
    const [loadingDetails, setLoadingDetails] = React.useState(false);

    if (gained === 0 && lost === 0) {
      return <span className="text-muted-foreground">0</span>;
    }

    const handleOpen = (open: boolean) => {
      if (open && details === null && !loadingDetails) {
        setLoadingDetails(true);
        getCommunityDetailsForEvent(eventId)
          .then(setDetails)
          .catch(console.error)
          .finally(() => setLoadingDetails(false));
      }
    };

    return (
      <Popover onOpenChange={handleOpen}>
        <PopoverTrigger asChild>
          <button className="cursor-pointer underline decoration-dotted hover:text-foreground flex items-center gap-1">
            {gained > 0 && (
              <span className="font-medium text-blue-600">+{gained}</span>
            )}
            {lost > 0 && (
              <span className="font-medium text-orange-600">-{lost}</span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 max-h-64 overflow-y-auto p-3" align="end">
          {loadingDetails ? (
            <div className="space-y-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          ) : details ? (
            <div className="space-y-3">
              {details.gained.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <Badge variant="outline" className="border-blue-500 bg-blue-50 text-blue-700 text-xs">
                      +{details.gained.length}
                    </Badge>
                    Gained community status
                  </p>
                  <div className="space-y-0.5">
                    {details.gained.map((d) => (
                      <div key={d.email} className="text-sm truncate">
                        <span className="font-medium">{d.name}</span>
                        <span className="text-muted-foreground text-xs ml-1">({d.email})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {details.lost.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <Badge variant="outline" className="border-orange-500 bg-orange-50 text-orange-700 text-xs">
                      -{details.lost.length}
                    </Badge>
                    Lost community status
                  </p>
                  <div className="space-y-0.5">
                    {details.lost.map((d) => (
                      <div key={d.email} className="text-sm truncate">
                        <span className="font-medium">{d.name}</span>
                        <span className="text-muted-foreground text-xs ml-1">({d.email})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {details.gained.length === 0 && details.lost.length === 0 && (
                <p className="text-sm text-muted-foreground">No community changes found.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No community changes found.</p>
          )}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Funnel</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {new Date(period.from).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            {" – "}
            {new Date(period.to).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            variant={viewMode === "event" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("event")}
          >
            By Event
          </Button>
          <Button
            variant={viewMode === "month" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("month")}
          >
            By Month
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : viewMode === "event" ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead className="text-right">Date</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Tickets</TableHead>
                  <TableHead className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help underline decoration-dotted">Valid</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs max-w-[200px]">Tickets with non-cancelled order status (excludes cancelled, refunded, and deleted orders).</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead className="min-w-[160px]">Checked In</TableHead>
                  <TableHead className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help underline decoration-dotted">Returning</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs max-w-[200px]">Checked-in attendees who have attended a previous event.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help underline decoration-dotted">New</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs max-w-[200px]">First-time attendees (member record created at check-in).</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help underline decoration-dotted">Community</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs max-w-[200px]">Change in community membership. Gained: attendees whose 3rd countable event was this one. Lost: members whose 9-month recency expired.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eventData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground">
                      No events in this period
                    </TableCell>
                  </TableRow>
                ) : (
                  eventData.map((row) => (
                    <TableRow key={row.eventId}>
                      <TableCell className="font-medium whitespace-normal">
                        {row.eventName}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {new Date(row.eventDate).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "2-digit",
                        })}
                      </TableCell>
                      <TableCell className="text-right">{row.ordersCount}</TableCell>
                      <TableCell className="text-right">
                        {Object.keys(row.ticketBreakdown).length > 0 ? (
                          <TicketBreakdownTooltip breakdown={row.ticketBreakdown} />
                        ) : (
                          row.totalTickets
                        )}
                      </TableCell>
                      <TableCell className="text-right">{row.validTickets}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={row.checkedInPercent} className="h-2 flex-1" />
                          <span className="text-sm tabular-nums w-16 text-right">
                            {row.checkedInCount} ({row.checkedInPercent}%)
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <ReturningDetailPopover eventId={row.eventId} count={row.returningCount} />
                      </TableCell>
                      <TableCell className="text-right">
                        {row.newCount > 0 ? (
                          <span className="text-green-600 font-medium">+{row.newCount}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <CommunityDetailPopover
                            eventId={row.eventId}
                            gained={row.communityGained}
                            lost={row.communityLost}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        £{row.revenue.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Events</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Tickets</TableHead>
                  <TableHead className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help underline decoration-dotted">Valid</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs max-w-[200px]">Tickets with non-cancelled order status (excludes cancelled, refunded, and deleted orders).</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead className="min-w-[160px]">Checked In</TableHead>
                  <TableHead className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help underline decoration-dotted">Returning</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs max-w-[200px]">Checked-in attendees who have attended a previous event.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help underline decoration-dotted">New</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs max-w-[200px]">First-time attendees (member record created at check-in).</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help underline decoration-dotted">Community</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs max-w-[200px]">Change in community membership. Gained: attendees whose 3rd countable event was this one. Lost: members whose 9-month recency expired.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground">
                      No data in this period
                    </TableCell>
                  </TableRow>
                ) : (
                  monthData.map((row) => (
                    <TableRow key={row.month}>
                      <TableCell className="font-medium">{row.month}</TableCell>
                      <TableCell className="text-right">{row.eventsCount}</TableCell>
                      <TableCell className="text-right">{row.ordersCount}</TableCell>
                      <TableCell className="text-right">
                        {Object.keys(row.ticketBreakdown).length > 0 ? (
                          <TicketBreakdownTooltip breakdown={row.ticketBreakdown} />
                        ) : (
                          row.totalTickets
                        )}
                      </TableCell>
                      <TableCell className="text-right">{row.validTickets}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={row.checkedInPercent} className="h-2 flex-1" />
                          <span className="text-sm tabular-nums w-16 text-right">
                            {row.checkedInCount} ({row.checkedInPercent}%)
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{row.returningCount}</TableCell>
                      <TableCell className="text-right">
                        {row.newCount > 0 ? (
                          <span className="text-green-600 font-medium">+{row.newCount}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {row.communityGained > 0 && (
                            <span className="font-medium text-blue-600">+{row.communityGained}</span>
                          )}
                          {row.communityLost > 0 && (
                            <span className="font-medium text-orange-600">-{row.communityLost}</span>
                          )}
                          {row.communityGained === 0 && row.communityLost === 0 && (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        £{row.revenue.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
