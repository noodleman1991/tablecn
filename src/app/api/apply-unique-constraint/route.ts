import { NextResponse } from "next/server";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/env";

/**
 * Apply unique constraint to woocommerceProductId
 * WARNING: This will fail if duplicates exist
 */
export async function POST() {
  const client = postgres(env.DATABASE_URL);

  try {
    // Add unique constraint
    await client`
      ALTER TABLE tablecn_events
      ADD CONSTRAINT tablecn_events_woocommerce_product_id_unique
      UNIQUE (woocommerce_product_id)
    `;

    await client.end();

    return NextResponse.json({
      success: true,
      message: "Unique constraint added successfully",
    });
  } catch (error: any) {
    console.error("Error adding unique constraint:", error);
    await client.end();

    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Unknown error",
        code: error?.code,
        detail: error?.detail,
        constraint: error?.constraint_name,
        hint: "This may have failed because duplicate product IDs exist or constraint already exists.",
      },
      { status: 500 }
    );
  }
}
