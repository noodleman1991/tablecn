import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { getBatchJob } from "@/lib/batch-processor";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const type = request.nextUrl.searchParams.get("type");
  if (!type) {
    return NextResponse.json(
      { error: "Missing 'type' query parameter" },
      { status: 400 },
    );
  }

  const job = await getBatchJob(type);
  if (!job) {
    return NextResponse.json({ status: "no_job", type });
  }

  return NextResponse.json(job);
}
