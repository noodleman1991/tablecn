"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Mail } from "lucide-react";
import type { Member } from "@/db/schema";
import {
  exportMembersToCSV,
  downloadCSV,
  generateMembersFilename,
  emailCSVViaServer,
} from "@/lib/csv-export";
import { toast } from "sonner";
import { MembersTable } from "./members-table";
import { AddManualMemberDialog } from "./add-manual-member-dialog";

interface MembersPageProps {
  members: Member[];
}

export function MembersPage({ members }: MembersPageProps) {
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [isEmailing, setIsEmailing] = React.useState(false);

  const activeMembers = members.filter((m) => m.isActiveMember).length;
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

      <Card>
        <CardHeader className="flex flex-col gap-4 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Members List</CardTitle>
          <div className="flex flex-col gap-2 sm:flex-row">
            <AddManualMemberDialog />
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadCSV}
              disabled={isDownloading}
              className="min-h-[44px] w-full sm:w-auto"
            >
              <Download className="mr-2 size-4" />
              Download CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleEmailCSV}
              disabled={isEmailing}
              className="min-h-[44px] w-full sm:w-auto"
            >
              <Mail className="mr-2 size-4" />
              Send Email
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <MembersTable members={members} />
        </CardContent>
      </Card>
    </div>
  );
}
