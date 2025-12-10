"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

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
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Reset edit value when value prop changes
  React.useEffect(() => {
    if (!isEditing) {
      setEditValue(value || "");
    }
  }, [value, isEditing]);

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

    setIsSaving(true);

    try {
      await onSave(memberId, field, trimmedValue);
      toast.success(`${field} updated successfully`);
      setIsEditing(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `Failed to update ${field}`
      );
      // Rollback to original value
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
      className="text-left hover:underline cursor-pointer min-h-[44px] md:min-h-0 flex items-center w-full"
    >
      <span className="truncate">{value || placeholder || "-"}</span>
    </button>
  );
}
