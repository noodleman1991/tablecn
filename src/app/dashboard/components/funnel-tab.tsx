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
import { Skeleton } from "@/components/ui/skeleton";
import { getFunnelByEvent, getFunnelByMonth } from "../actions";
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
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eventData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
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
                      <TableCell className="text-right">{row.memberConversions}</TableCell>
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
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
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
                      <TableCell className="text-right">{row.memberConversions}</TableCell>
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
