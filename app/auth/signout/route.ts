import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clearOperatorPass, readOperatorPass } from "@/lib/account-switch-server";

export async function POST(request: Request) {
  const supabase = await createClient();
  if (await readOperatorPass()) {
    // An operator inside a client's account: end this browser's session only.
    // The default scope would sign the client out on all their devices too.
    await supabase.auth.signOut({ scope: "local" });
    await clearOperatorPass();
  } else {
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/login", request.url));
}
