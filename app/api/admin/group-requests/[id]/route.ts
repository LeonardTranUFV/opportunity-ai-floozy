import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseGroupReview } from "@/lib/group-requests";
import { currentOperator } from "@/lib/operator";
import { collectorIds } from "@/lib/floozy-collect";
import { SERVICE_AREAS } from "@/lib/service-areas";
import { readJsonBody, validationErrorResponse } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await currentOperator())) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch (err) {
    return validationErrorResponse(err) ?? NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const admin = createAdminClient();
  const parsed = parseGroupReview(body, new Set(await collectorIds(admin)), new Set(SERVICE_AREAS.map((a) => a.id)));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const review = parsed.review;

  const { data: req } = await admin.from("group_requests").select("id, url, name").eq("id", id).maybeSingle();
  if (!req) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  const updated_at = new Date().toISOString();
  let patch: Record<string, unknown>;
  if (review.action === "decline") {
    patch = { status: "declined", decline_reason: review.reason, updated_at };
  } else if (review.action === "joining") {
    patch = { status: "joining", collector_id: review.collectorId, updated_at };
  } else {
    // Two clients can ask for the same group; Floozy still reads it only once.
    const { data: existing } = await admin
      .from("groups")
      .select("id")
      .eq("url", req.url)
      .eq("owner_kind", "floozy")
      .limit(1)
      .maybeSingle();
    let groupId = existing?.id as string | undefined;
    if (!groupId) {
      const { data: group, error } = await admin
        .from("groups")
        .upsert(
          {
            user_id: review.collectorId,
            platform: "facebook",
            name: req.name ?? req.url,
            url: req.url,
            active: true,
            owner_kind: "floozy",
            area_id: review.areaId,
            access: review.access,
          },
          { onConflict: "user_id,url" }
        )
        .select("id")
        .single();
      if (error || !group) {
        console.error("[group-requests] could not add the group:", error?.message);
        return NextResponse.json({ error: "Could not start collecting that group." }, { status: 500 });
      }
      groupId = group.id as string;
    }
    patch = { status: "active", collector_id: review.collectorId, group_id: groupId, decline_reason: null, updated_at };
  }

  const { error } = await admin.from("group_requests").update(patch).eq("id", id);
  if (error) {
    console.error("[group-requests] could not update:", error.message);
    return NextResponse.json({ error: "Could not update that request." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
