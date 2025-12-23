"use client";

import { ArrowLeftRight } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DataTableScrollToggleProps {
  enabled: boolean;
  onToggle: () => void;
}

export function DataTableScrollToggle({
  enabled,
  onToggle,
}: DataTableScrollToggleProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={onToggle}
            className="ml-auto h-8 font-normal inline-flex"
            aria-label={enabled ? "Disable horizontal scroll" : "Enable horizontal scroll"}
          >
            <ArrowLeftRight className={enabled ? "text-primary" : "text-muted-foreground"} />
            <span className="ml-2">{enabled ? "Scroll On" : "Scroll Off"}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{enabled ? "Disable" : "Enable"} horizontal scrolling</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
