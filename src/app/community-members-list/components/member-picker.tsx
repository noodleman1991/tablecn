"use client";

import { Check, ChevronsUpDown, Search } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Member } from "@/db/schema";
import { cn } from "@/lib/utils";

interface MemberPickerProps {
  members: Pick<Member, "id" | "email" | "firstName" | "lastName">[];
  selectedMemberId: string | null;
  onSelect: (memberId: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function MemberPicker({
  members,
  selectedMemberId,
  onSelect,
  placeholder = "Select a member…",
  disabled = false,
}: MemberPickerProps) {
  const [open, setOpen] = React.useState(false);

  const selected = selectedMemberId
    ? members.find((m) => m.id === selectedMemberId)
    : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="min-h-[36px] w-full justify-between"
        >
          {selected ? (
            <span className="truncate">
              {selected.firstName} {selected.lastName}{" "}
              <span className="text-muted-foreground">({selected.email})</span>
            </span>
          ) : (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Search className="size-4" />
              {placeholder}
            </span>
          )}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command
          filter={(value, search) => {
            // Custom fuzzy filter: match on name OR email substring
            if (value.toLowerCase().includes(search.toLowerCase())) return 1;
            return 0;
          }}
        >
          <CommandInput placeholder="Search by name or email…" />
          <CommandList>
            <CommandEmpty>No member found.</CommandEmpty>
            <CommandGroup>
              {members.map((m) => {
                const label =
                  `${m.firstName ?? ""} ${m.lastName ?? ""} ${m.email}`
                    .trim()
                    .toLowerCase();
                return (
                  <CommandItem
                    key={m.id}
                    value={label}
                    onSelect={() => {
                      onSelect(m.id === selectedMemberId ? null : m.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 size-4",
                        selectedMemberId === m.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">
                        {m.firstName} {m.lastName}
                      </span>
                      <span className="truncate text-muted-foreground text-xs">
                        {m.email}
                      </span>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
