import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";
import { isAdmin } from "@/lib/privileges";

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
    source: "Floozy Opportunity AI",
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
    // Logged, not returned: GoHighLevel's error bodies name locations and
    // fields belonging to the operator's account, and this reason travels
    // back to the browser.
    const errText = await response.text();
    console.error(`[ghl] dispatch failed ${response.status}: ${errText.slice(0, 300)}`);
    return { success: false, reason: `GoHighLevel refused the contact (${response.status}).` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown GHL dispatch error";
    return { success: false, reason: message };
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: opportunityId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  const rl = await rateLimit(`opp-update:${user.id}`, LIMITS.standard.limit, LIMITS.standard.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "updates");

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

  /**
   * Qualifying is the "approve" moment, and it can push the lead to
   * GoHighLevel — but only for the operator's own account.
   *
   * GHL_API_KEY and GHL_LOCATION_ID are deployment environment variables:
   * one GoHighLevel account for the whole install, the operator's. The
   * on/off switch, though, was a per-user setting. So any customer who
   * turned it on and qualified a lead sent that person's name and phone
   * number into somebody else's CRM — not their own, which is what the
   * toggle led them to believe, and not anywhere they could ever see it.
   *
   * Two problems in one: a contractor's lead data leaving for a third party
   * they never chose, and a feature that silently did nothing for them.
   *
   * Gated to admin until dispatch takes per-customer credentials. The
   * settings toggle is hidden for everyone else for the same reason — this
   * check is the control, that one is the explanation.
   */
  let ghlResult = null;
  if (status === "qualified" && current.status !== "qualified" && updated) {
    const { data: ghlSetting } = await supabase
      .from("settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "ghl_dispatch_enabled")
      .maybeSingle();
    if (ghlSetting?.value === "true" && (await isAdmin(supabase, user.id))) {
      ghlResult = await dispatchToGHL(updated as Opportunity);
    }
  }

  return NextResponse.json({ success: true, opportunity: updated, ghl: ghlResult });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: opportunityId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  const rl = await rateLimit(`opp-delete:${user.id}`, LIMITS.standard.limit, LIMITS.standard.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "deletions");

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
