import { cookies } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminIdentity } from "@/lib/privileges";
import {
  OPERATOR_COOKIE,
  accountLabel,
  openOperatorPass,
  sealOperatorPass,
  sortAccounts,
  type OperatorPass,
  type SwitchAccount,
  type Switcher,
} from "@/lib/account-switch";

/**
 * Outlives the pass on purpose. If the cookie vanished when the switch expired,
 * the operator would be left inside a client's account with no banner saying so.
 */
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export async function readOperatorPass(): Promise<OperatorPass | null> {
  const store = await cookies();
  return openOperatorPass(store.get(OPERATOR_COOKIE)?.value);
}

export async function writeOperatorPass(pass: OperatorPass): Promise<void> {
  const store = await cookies();
  store.set(OPERATOR_COOKIE, sealOperatorPass(pass), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearOperatorPass(): Promise<void> {
  const store = await cookies();
  store.delete(OPERATOR_COOKIE);
}

/** True when this session is an operator working inside a client's account. */
export async function isSwitchedInto(userId: string): Promise<boolean> {
  const pass = await readOperatorPass();
  return pass?.viewingId === userId;
}

/**
 * What the switcher shows, or null for everyone who is not an operator. Clients
 * must get null: the list holds every customer's email.
 */
export async function getSwitcher(user: User): Promise<Switcher | null> {
  const stored = await readOperatorPass();
  const pass = stored?.viewingId === user.id ? stored : null;
  if (!pass && !isAdminIdentity(user.id, user.email)) return null;

  const admin = createAdminClient();
  let operatorId = user.id;
  if (pass) {
    const { data } = await admin.auth.admin.getUserById(pass.operatorId);
    if (!data.user || !isAdminIdentity(data.user.id, data.user.email)) return null;
    operatorId = pass.operatorId;
  }

  const [{ data: users }, names] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 200 }),
    businessNames(admin),
  ]);

  const accounts: SwitchAccount[] = (users?.users ?? [])
    .filter((u) => u.email && (u.id === operatorId || !isAdminIdentity(u.id, u.email)))
    .map((u) => ({
      id: u.id,
      email: u.email as string,
      label: accountLabel(u.email as string, names.get(u.id)),
      isOperator: u.id === operatorId,
    }));

  const current = accounts.find((a) => a.id === user.id);
  return {
    accounts: sortAccounts(accounts),
    currentId: user.id,
    operatorId,
    viewing: pass
      ? { label: current?.label ?? user.email ?? "this client", email: user.email ?? "" }
      : null,
    expired: pass ? Date.now() >= pass.expiresAt : false,
  };
}

/** A missing table or failed read just means labels fall back to emails. */
async function businessNames(admin: SupabaseClient): Promise<Map<string, string>> {
  const { data } = await admin.from("company_profiles").select("user_id, business_name");
  return new Map(
    (data ?? [])
      .filter((row) => row.business_name)
      .map((row) => [row.user_id as string, row.business_name as string])
  );
}
