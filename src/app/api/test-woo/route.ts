import { NextResponse } from "next/server";
import { getProducts } from "@/lib/woocommerce";

export async function GET() {
  try {
    const products = await getProducts();

    return NextResponse.json({
      success: true,
      totalProducts: products.length,
      sampleProduct: products[0] || null,
      allProductNames: products.map((p: any) => ({
        id: p.id,
        name: p.name,
        categories: p.categories?.map((c: any) => c.name) || [],
      })),
    });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
