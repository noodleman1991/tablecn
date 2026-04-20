"use client";

import { Download, Mail } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import type { OrphanBooker } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Member } from "@/db/schema";
import {
  downloadCSV,
  emailCSVViaServer,
  exportMembersToCSV,
  generateMembersFilename,
} from "@/lib/csv-export";
import { AddManualMemberDialog } from "./add-manual-member-dialog";
import { MembersTable } from "./members-table";
import { ReviewTab } from "./review-tab";

interface MembersPageProps {
  members: Member[];
  activeMemberCount: number;
  orphans: OrphanBooker[];
}

export function MembersPage({
  members,
  activeMemberCount,
  orphans,
}: MembersPageProps) {
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [isEmailing, setIsEmailing] = React.useState(false);

  const activeMembers = activeMemberCount;
  const totalMembers = members.length;

  const handleDownloadCSV = () => {
    setIsDownloading(true);
    try {
      const csv = exportMembersToCSV(members);
      const filename = generateMembersFilename();
      downloadCSV(csv, filename);
      toast.success("CSV downloaded successfully");
    } catch (_error) {
      toast.error("Failed to download CSV");
    } finally {
      setIsDownloading(false);
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
        error instanceof Error ? error.message : "Failed to send email",
      );
    } finally {
      setIsEmailing(false);
    }
  };

  return (
    <div className="container flex flex-col gap-6 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-bold text-3xl tracking-tight">Community Members</h1>
        <p className="text-muted-foreground">
          View all community members and their membership status
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm">Total Members</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">{totalMembers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm">
              Active Members
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">{activeMembers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm">
              Inactive Members
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">
              {totalMembers - activeMembers}
            </div>
          </CardContent>
        </Card>
      </div>

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
                  onClick={handleDownloadCSV}
                  disabled={isDownloading}
                  className="min-h-[44px] w-full gap-2 sm:w-auto"
                >
                  <Download className="size-4" />
                  <span className="sm:hidden">CSV</span>
                  <span className="hidden sm:inline">Download CSV</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Download the full members list as a spreadsheet file.
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleEmailCSV}
                  disabled={isEmailing}
                  className="min-h-[44px] w-full gap-2 sm:w-auto"
                >
                  <Mail className="size-4" />
                  <span className="sm:hidden">Email</span>
                  <span className="hidden sm:inline">Send Email</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Email the members list as a CSV attachment.
              </TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="members">
            <TabsList className="mb-4">
              <TabsTrigger value="members">All members</TabsTrigger>
              <TabsTrigger value="review" className="gap-2">
                Needs review
                {orphans.length > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {orphans.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="members">
              <MembersTable members={members} />
            </TabsContent>
            <TabsContent value="review">
              <ReviewTab orphans={orphans} members={members} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
