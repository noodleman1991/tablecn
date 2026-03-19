"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Mail, RefreshCw } from "lucide-react";
import type { Member } from "@/db/schema";
import {
  exportMembersToCSV,
  downloadCSV,
  generateMembersFilename,
  emailCSVViaServer,
} from "@/lib/csv-export";
import { toast } from "sonner";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { MembersTable } from "./members-table";
import { AddManualMemberDialog } from "./add-manual-member-dialog";
import { resyncAllEvents } from "@/app/actions";
import { BatchProgressIndicator } from "./batch-progress-indicator";

interface MembersPageProps {
  members: Member[];
  activeMemberCount: number;
}

export function MembersPage({ members, activeMemberCount }: MembersPageProps) {
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [isEmailing, setIsEmailing] = React.useState(false);
  const [isResyncing, setIsResyncing] = React.useState(false);
  const [showBatchProgress, setShowBatchProgress] = React.useState(false);

  const activeMembers = activeMemberCount;
  const totalMembers = members.length;

  const handleDownloadCSV = () => {
    setIsDownloading(true);
    try {
      const csv = exportMembersToCSV(members);
      const filename = generateMembersFilename();
      downloadCSV(csv, filename);
      toast.success("CSV downloaded successfully");
    } catch (error) {
      toast.error("Failed to download CSV");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleResyncAll = async () => {
    setIsResyncing(true);
    try {
      const result = await resyncAllEvents();
      if (!result.success) {
        toast.error(`Failed to start re-sync: ${result.error ?? "Unknown error"}`);
        return;
      }
      if (result.progressTrackable) {
        setShowBatchProgress(true);
        toast.success(
          "Batch re-sync started. Events will be processed in the background."
        );
      } else {
        toast.success(
          "Batch re-sync started. Progress tracking is unavailable — the job is running in the background."
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to re-sync events"
      );
    } finally {
      setIsResyncing(false);
    }
  };

  const handleEmailCSV = async () => {
    setIsEmailing(true);
    try {
      const csv = exportMembersToCSV(members);
      const filename = generateMembersFilename();
      await emailCSVViaServer(csv, filename);
      toast.success("Email sent successfully");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to send email"
      );
    } finally {
      setIsEmailing(false);
    }
  };

  return (
    <div className="container flex flex-col gap-6 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Community Members
        </h1>
        <p className="text-muted-foreground">
          View all community members and their membership status
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Members
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalMembers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Active Members
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeMembers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Inactive Members
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalMembers - activeMembers}
            </div>
          </CardContent>
        </Card>
      </div>

      <BatchProgressIndicator isActive={showBatchProgress} />

      <Card>
        <CardHeader className="flex flex-col gap-4 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Members List</CardTitle>
          <div className="flex flex-col gap-2 sm:flex-row">
            <AddManualMemberDialog />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResyncAll}
                  disabled={isResyncing}
                  className="min-h-[44px] w-full sm:w-auto gap-2"
                >
                  <RefreshCw className={`size-4 ${isResyncing ? "animate-spin" : ""}`} />
                  <span className="sm:hidden">Re-sync</span>
                  <span className="hidden sm:inline">{isResyncing ? "Re-syncing..." : "Re-sync All Events"}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Pulls the latest ticket data from WooCommerce for every event, then recalculates all membership statuses. Runs in the background — may take a few minutes.</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadCSV}
                  disabled={isDownloading}
                  className="min-h-[44px] w-full sm:w-auto gap-2"
                >
                  <Download className="size-4" />
                  <span className="sm:hidden">CSV</span>
                  <span className="hidden sm:inline">Download CSV</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Download the full members list as a spreadsheet file.</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleEmailCSV}
                  disabled={isEmailing}
                  className="min-h-[44px] w-full sm:w-auto gap-2"
                >
                  <Mail className="size-4" />
                  <span className="sm:hidden">Email</span>
                  <span className="hidden sm:inline">Send Email</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Email the members list as a CSV attachment.</TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>
        <CardContent>
          <MembersTable members={members} />
        </CardContent>
      </Card>
    </div>
  );
}
