import { NextResponse } from "next/server";
import { db as opportunityDb } from "@/lib/db/schema";

const VALID_STATUSES = ["new", "contacted", "qualified", "appointment", "proposal", "won", "lost"];

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const opportunityId = Number(id);

  if (!Number.isFinite(opportunityId)) {
    return NextResponse.json({ success: false, error: "Invalid opportunity id" }, { status: 400 });
  }

  const body = await request.json();
  const { status } = body;

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ success: false, error: `status must be one of ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  const existing = opportunityDb.prepare("SELECT id FROM opportunities WHERE id = ?").get(opportunityId);
  if (!existing) {
    return NextResponse.json({ success: false, error: "Opportunity not found" }, { status: 404 });
  }

  if (status !== undefined) {
    opportunityDb.prepare("UPDATE opportunities SET status = ? WHERE id = ?").run(status, opportunityId);
  }

  const updated = opportunityDb.prepare("SELECT * FROM opportunities WHERE id = ?").get(opportunityId);
  return NextResponse.json({ success: true, opportunity: updated });
}
