"use client";

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PeriodFilter } from "../types";

interface PeriodFilterSelectProps {
  value: PeriodFilter;
  onChange: (period: PeriodFilter) => void;
}

type PresetKey = "1m" | "3m" | "6m" | "9m" | "year" | "last-year" | "custom";

function computePreset(key: PresetKey): PeriodFilter | null {
  const now = new Date();
  if (key === "custom") return null;

  if (key === "last-year") {
    return {
      from: new Date(now.getFullYear() - 1, 0, 1),
      to: new Date(now.getFullYear() - 1, 11, 31),
    };
  }
  if (key === "year") {
    return {
      from: new Date(now.getFullYear(), 0, 1),
      to: now,
    };
  }

  const months = key === "1m" ? 1 : key === "3m" ? 3 : key === "6m" ? 6 : 9;
  if (key === "1m") {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
  }
  const from = new Date(now.getFullYear(), now.getMonth() - months, 1);
  return { from, to: now };
}

export function PeriodFilterSelect({ value, onChange }: PeriodFilterSelectProps) {
  const [preset, setPreset] = React.useState<PresetKey>("9m");
  const [customFrom, setCustomFrom] = React.useState("");
  const [customTo, setCustomTo] = React.useState("");

  const handlePresetChange = (key: string) => {
    setPreset(key as PresetKey);
    const period = computePreset(key as PresetKey);
    if (period) {
      onChange(period);
    }
  };

  const handleCustomChange = (fromStr: string, toStr: string) => {
    if (fromStr && toStr) {
      onChange({ from: new Date(fromStr), to: new Date(toStr) });
    }
  };

  return (
    <div className="flex items-end gap-2">
      <Select value={preset} onValueChange={handlePresetChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Period" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1m">This Month</SelectItem>
          <SelectItem value="3m">Last 3 Months</SelectItem>
          <SelectItem value="6m">Last 6 Months</SelectItem>
          <SelectItem value="9m">Last 9 Months</SelectItem>
          <SelectItem value="year">This Year</SelectItem>
          <SelectItem value="last-year">Last Year</SelectItem>
          <SelectItem value="custom">Custom Range</SelectItem>
        </SelectContent>
      </Select>

      {preset === "custom" && (
        <div className="flex items-end gap-2">
          <div>
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => {
                setCustomFrom(e.target.value);
                handleCustomChange(e.target.value, customTo);
              }}
              className="w-[150px]"
            />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              value={customTo}
              onChange={(e) => {
                setCustomTo(e.target.value);
                handleCustomChange(customFrom, e.target.value);
              }}
              className="w-[150px]"
            />
          </div>
        </div>
      )}
    </div>
  );
}
