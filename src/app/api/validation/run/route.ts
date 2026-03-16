import { NextRequest, NextResponse } from "next/server";
import { runQuickValidation, runDeepValidation } from "@/app/dashboard/actions";
import type { PeriodFilter } from "@/app/dashboard/types";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { mode, period } = body as { mode: "quick" | "deep"; period: PeriodFilter };

    if (!mode || !period?.from || !period?.to) {
      return NextResponse.json({ error: "Missing mode or period" }, { status: 400 });
    }

    const result =
      mode === "deep"
        ? await runDeepValidation(period)
        : await runQuickValidation(period);

    return NextResponse.json(result);
  } catch (err) {
    console.error("Validation API error:", err);
    return NextResponse.json(
      { error: "Validation failed" },
      { status: 500 },
    );
  }
}
