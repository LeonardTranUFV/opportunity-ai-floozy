import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseGroupRequest } from "@/lib/group-requests";
import { announceGroupRequest } from "@/lib/operator";
import { readJsonBody, validationErrorResponse } from "@/lib/validate";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Stops one account filling the operators' queue. */
const MAX_OPEN_REQUESTS = 20;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(`group-requests:${user.id}`, LIMITS.strict.limit, LIMITS.strict.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "group requests");

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch (err) {
    return validationErrorResponse(err) ?? NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const parsed = parseGroupRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // Written with the service role: clients have read-only access to this table,
  // so a request can't be created already marked as active.
  const admin = createAdminClient();
  const { count } = await admin
    .from("group_requests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .in("status", ["requested", "joining"]);
  if ((count ?? 0) >= MAX_OPEN_REQUESTS) {
    return NextResponse.json({ error: "You have a lot of requests waiting. We'll work through those first." }, { status: 429 });
  }

  const { data, error } = await admin
    .from("group_requests")
    .insert({ user_id: user.id, ...parsed.input })
    .select("id, url, name, note, status, decline_reason, created_at")
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "You've already asked for this group." }, { status: 409 });
    console.error("[group-requests] could not save:", error.message);
    return NextResponse.json({ error: "Could not send that request. Please try again." }, { status: 500 });
  }

  const { data: profile } = await admin.from("company_profiles").select("business_name").eq("user_id", user.id).maybeSingle();
  await announceGroupRequest(profile?.business_name || user.email || "A client", parsed.input);

  return NextResponse.json({ success: true, request: data });
}
