import { NextRequest, NextResponse } from "next/server";

interface UpdateContactRequest {
  email: string;
}

interface LoopsUpdateResponse {
  success: boolean;
  id?: string;
  message?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as UpdateContactRequest;
    const { email } = body;

    // Validate email
    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { success: false, message: "Email is required" },
        { status: 400 }
      );
    }

    // Get Loops API key from environment
    const loopsApiKey = process.env.LOOPS_API_KEY;
    if (!loopsApiKey) {
      console.error("LOOPS_API_KEY is not configured");
      return NextResponse.json(
        { success: false, message: "Server configuration error" },
        { status: 500 }
      );
    }

    // Call Loops API to update contact with resubscribed property
    const loopsResponse = await fetch(
      "https://app.loops.so/api/v1/contacts/update",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${loopsApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          resubscribed: true,
          resubscriptionDate: new Date().toISOString(),
        }),
      }
    );

    const loopsData = (await loopsResponse.json()) as LoopsUpdateResponse;

    if (!loopsResponse.ok) {
      console.error("Loops API error:", loopsData);
      return NextResponse.json(
        {
          success: false,
          message: loopsData.message || "Failed to update contact",
        },
        { status: loopsResponse.status }
      );
    }

    // Log successful re-subscription for tracking
    console.log(`✅ Re-subscription tracked: ${email} at ${new Date().toISOString()}`);

    return NextResponse.json({
      success: true,
      message: "Contact updated successfully",
    });
  } catch (error) {
    console.error("Error tracking resubscription:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}
