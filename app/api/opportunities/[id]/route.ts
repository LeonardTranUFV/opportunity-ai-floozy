import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const VALID_STATUSES = ["new", "contacted", "qualified", "appointment", "proposal", "won", "lost"];

interface Opportunity {
  id: string;
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
  const { id: opportunityId } = await params;
  const supabase = await createClient();

  const body = await request.json();
  const { status } = body;

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { success: false, error: `status must be one of ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const { data: current, error: fetchError } = await supabase
    .from("opportunities")
    .select("*")
    .eq("id", opportunityId)
    .single();

  if (fetchError || !current) {
    return NextResponse.json({ success: false, error: "Opportunity not found" }, { status: 404 });
  }

  if (status !== undefined) {
    const { error: updateError } = await supabase
      .from("opportunities")
      .update({ status })
      .eq("id", opportunityId);
    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }
  }

  const { data: updated } = await supabase
    .from("opportunities")
    .select("*")
    .eq("id", opportunityId)
    .single();

  // Qualifying an opportunity is the "approve" moment. GHL dispatch is opt-in
  // per business (Settings → Integrations) since not every customer using
  // this app has a GoHighLevel account to push into.
  let ghlResult = null;
  if (status === "qualified" && current.status !== "qualified" && updated) {
    const { data: ghlSetting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "ghl_dispatch_enabled")
      .maybeSingle();
    if (ghlSetting?.value === "true") {
      ghlResult = await dispatchToGHL(updated as Opportunity);
    }
  }

  return NextResponse.json({ success: true, opportunity: updated, ghl: ghlResult });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: opportunityId } = await params;
  const supabase = await createClient();

  const { error, count } = await supabase
    .from("opportunities")
    .delete({ count: "exact" })
    .eq("id", opportunityId);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  if (!count) {
    return NextResponse.json({ success: false, error: "Opportunity not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, deleted: opportunityId });
}
