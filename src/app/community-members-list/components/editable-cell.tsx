"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface EditableCellProps {
  value: string | null;
  memberId: string;
  field: "firstName" | "lastName" | "email";
  onSave: (memberId: string, field: string, value: string) => Promise<void>;
  placeholder?: string;
  type?: "text" | "email";
}

export function EditableCell({
  value,
  memberId,
  field,
  onSave,
  placeholder = "",
  type = "text",
}: EditableCellProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(value || "");
  const [isSaving, setIsSaving] = React.useState(false);
  // Optimistic display value - shows new value immediately while saving
  const [optimisticValue, setOptimisticValue] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Reset edit value when value prop changes
  React.useEffect(() => {
    if (!isEditing && !isSaving) {
      setEditValue(value || "");
      setOptimisticValue(null);
    }
  }, [value, isEditing, isSaving]);

  // Auto-focus when entering edit mode
  React.useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleClick = () => {
    if (!isEditing && !isSaving) {
      setIsEditing(true);
    }
  };

  const handleCancel = () => {
    setEditValue(value || "");
    setIsEditing(false);
  };

  const handleSave = async () => {
    const trimmedValue = editValue.trim();

    // Validate email if type is email
    if (type === "email" && trimmedValue) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedValue)) {
        toast.error("Please enter a valid email address");
        return;
      }
    }

    // No change, just cancel
    if (trimmedValue === (value || "")) {
      handleCancel();
      return;
    }

    // Don't allow empty values for required fields
    if (!trimmedValue) {
      toast.error(`${field} cannot be empty`);
      return;
    }

    // OPTIMISTIC UPDATE: Close edit mode immediately and show new value
    setOptimisticValue(trimmedValue);
    setIsEditing(false);
    setIsSaving(true);

    try {
      await onSave(memberId, field, trimmedValue);
      // Success - optimistic value will be replaced by actual value on revalidation
      toast.success(`${field} updated`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `Failed to update ${field}`
      );
      // Rollback: clear optimistic value so original value shows
      setOptimisticValue(null);
      setEditValue(value || "");
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  };

  const handleBlur = () => {
    // Only save on blur if not cancelled via ESC
    if (isEditing && !isSaving) {
      handleSave();
    }
  };

  // Display value: use optimistic value if saving, otherwise actual value
  const displayValue = optimisticValue ?? value;

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        type={type}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        disabled={isSaving}
        className="h-8 text-base md:text-sm w-full min-w-0"
        placeholder={placeholder}
      />
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={isSaving}
      className="text-left hover:underline cursor-pointer min-h-[44px] md:min-h-0 flex items-center w-full gap-1"
    >
      <span className="truncate">{displayValue || placeholder || "-"}</span>
      {isSaving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
    </button>
  );
}
