"use client";

import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import type { ValidationCheck } from "../types";

interface ValidationResultCardProps {
  check: ValidationCheck;
  index: number;
}

const statusConfig = {
  pass: { label: "Pass", className: "border-green-500 bg-green-50 text-green-700" },
  warn: { label: "Warning", className: "border-yellow-500 bg-yellow-50 text-yellow-700" },
  fail: { label: "Fail", className: "border-red-500 bg-red-50 text-red-700" },
};

export function ValidationResultCard({ check, index }: ValidationResultCardProps) {
  const config = statusConfig[check.status];

  return (
    <AccordionItem value={`check-${index}`}>
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={config.className}>
            {config.label}
          </Badge>
          <span className="font-medium">{check.name}</span>
          {check.count > 0 && (
            <span className="text-sm text-muted-foreground">({check.count})</span>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-2 pl-2">
          <p className="text-sm">{check.message}</p>
          {check.details.length > 0 && (
            <div className="rounded border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-2 text-left font-medium">Item</th>
                    {check.details.some((d) => d.expected !== undefined) && (
                      <th className="p-2 text-left font-medium">Expected</th>
                    )}
                    {check.details.some((d) => d.actual !== undefined) && (
                      <th className="p-2 text-left font-medium">Actual</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {check.details.map((detail, i) => (
                    <tr key={i} className="border-b last:border-b-0">
                      <td className="p-2">{detail.label}</td>
                      {check.details.some((d) => d.expected !== undefined) && (
                        <td className="p-2 text-muted-foreground">
                          {detail.expected ?? "-"}
                        </td>
                      )}
                      {check.details.some((d) => d.actual !== undefined) && (
                        <td className="p-2 text-muted-foreground">
                          {detail.actual ?? "-"}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
