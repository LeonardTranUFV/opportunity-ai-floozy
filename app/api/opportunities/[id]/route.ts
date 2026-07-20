import { NextResponse } from "next/server";
import { db as opportunityDb } from "@/lib/db/schema";

const VALID_STATUSES = ["new", "contacted", "qualified", "appointment", "proposal", "won", "lost"];

interface Opportunity {
  id: number;
  author_name: string;
  phone_number: string | null;
  category: string | null;
  urgency: string;
  status: string;
}

async function dispatchToGHL(opportunity: Opportunity) {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey || !locationId) {
    console.warn("⚠️ GHL Dispatch Skipped: GHL_API_KEY or GHL_LOCATION_ID is not defined in .env");
    return { success: false, reason: "GHL environment variables missing in dashboard .env." };
  }

  const nameParts = (opportunity.author_name || "Opportunity Contact").trim().split(/\s+/);
  const firstName = nameParts[0] || "New";
  const lastName = nameParts.slice(1).join(" ") || "Contact";

  const tags = [
    "OpportunityAI-Lead",
    `category-${opportunity.category || "other"}`,
    `urgency-${opportunity.urgency}`,
  ];

  const payload = {
    firstName,
    lastName,
    phone: opportunity.phone_number || undefined,
    locationId,
    tags,
    source: "Opportunity AI",
    customFields: [],
  };

  try {
    const response = await fetch("https://services.leadconnectorhq.com/contacts/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const data = await response.json();
      return { success: true, contactId: data.contact?.id };
    }
    const errText = await response.text();
    return { success: false, reason: `GHL API responded with ${response.status}: ${errText}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown GHL dispatch error";
    return { success: false, reason: message };
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const opportunityId = Number(id);

  if (!Number.isFinite(opportunityId)) {
    return NextResponse.json({ success: false, error: "Invalid opportunity id" }, { status: 400 });
  }

  const body = await request.json();
  const { status } = body;

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { success: false, error: `status must be one of ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const current = opportunityDb.prepare("SELECT * FROM opportunities WHERE id = ?").get(opportunityId) as
    | Opportunity
    | undefined;
  if (!current) {
    return NextResponse.json({ success: false, error: "Opportunity not found" }, { status: 404 });
  }

  if (status !== undefined) {
    opportunityDb.prepare("UPDATE opportunities SET status = ? WHERE id = ?").run(status, opportunityId);
  }

  const updated = opportunityDb.prepare("SELECT * FROM opportunities WHERE id = ?").get(
    opportunityId
  ) as Opportunity;

  // Qualifying an opportunity is the "approve" moment — dispatch it to GHL, same as the legacy pipeline.
  let ghlResult = null;
  if (status === "qualified" && current.status !== "qualified") {
    ghlResult = await dispatchToGHL(updated);
  }

  return NextResponse.json({ success: true, opportunity: updated, ghl: ghlResult });
}
