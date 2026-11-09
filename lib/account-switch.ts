import { openStorageState, sealStorageState, type SealedState } from "@/lib/session-crypto";

/**
 * The rules behind the operator's account switcher. No cookies or network in
 * here, so `npm run check` can pin every decision down.
 *
 * Switching really signs the operator in as the client. Every page and every
 * RLS policy keys off the signed-in user, so this is the only way what the
 * operator sees is what the client sees, rather than a copy that drifts from it.
 *
 * Once switched, the session no longer says who the operator is. The pass does:
 * an encrypted, httpOnly cookie naming the operator and the account they went
 * into. It holds no token. Each switch still re-checks that the operator is on
 * the ADMIN_USER_IDS / ADMIN_EMAILS allowlist, so removing someone from the
 * list ends their ability to switch at once.
 */

export const OPERATOR_COOKIE = "oa_operator";

/** How long one switch lasts before the operator has to sign in again. */
export const SWITCH_LIFETIME_MS = 12 * 60 * 60 * 1000;

export type OperatorPass = {
  operatorId: string;
  viewingId: string;
  expiresAt: number;
};

/** Marks the sealed payload, so no other sealed blob can be read as a pass. */
const PASS_KIND = "operator-pass";

export function sealOperatorPass(pass: OperatorPass): string {
  const sealed = sealStorageState({ kind: PASS_KIND, ...pass });
  return Buffer.from(JSON.stringify(sealed), "utf8").toString("base64url");
}

/** Null for anything that is not an intact pass. Expiry is decideSwitch's job. */
export function openOperatorPass(value: string | undefined | null): OperatorPass | null {
  if (!value) return null;
  try {
    const sealed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as SealedState;
    const pass = openStorageState(sealed) as (Partial<OperatorPass> & { kind?: unknown }) | null;
    if (
      !pass ||
      pass.kind !== PASS_KIND ||
      typeof pass.operatorId !== "string" ||
      typeof pass.viewingId !== "string" ||
      typeof pass.expiresAt !== "number"
    ) {
      return null;
    }
    return { operatorId: pass.operatorId, viewingId: pass.viewingId, expiresAt: pass.expiresAt };
  } catch {
    return null;
  }
}

export type SwitchDecision =
  | { ok: true; operatorId: string }
  | { ok: false; status: number; error: string; expired?: boolean };

/** Whether this signed-in session may move to the target account. */
export function decideSwitch(input: {
  sessionUserId: string;
  targetUserId: string;
  pass: OperatorPass | null;
  /** Is the signed-in user on the allowlist? */
  sessionIsAdmin: boolean;
  /** Is the operator named by the pass still on the allowlist? */
  passOperatorIsAdmin: boolean;
  /** Is the target on the allowlist? */
  targetIsAdmin: boolean;
  now: number;
}): SwitchDecision {
  // A pass only counts for the account it was issued for. A leftover one from
  // an earlier switch must not make whoever signed in next an operator.
  const pass = input.pass && input.pass.viewingId === input.sessionUserId ? input.pass : null;

  let operatorId: string;
  if (pass) {
    if (input.now >= pass.expiresAt) {
      return { ok: false, status: 401, expired: true, error: "This switch has expired. Please sign in again." };
    }
    if (!input.passOperatorIsAdmin) {
      return { ok: false, status: 403, error: "Not authorized" };
    }
    operatorId = pass.operatorId;
  } else {
    if (!input.sessionIsAdmin) return { ok: false, status: 403, error: "Not authorized" };
    operatorId = input.sessionUserId;
  }

  // Going in as another operator would hand over their admin powers under
  // their name, and client support never needs that.
  if (input.targetIsAdmin && input.targetUserId !== operatorId) {
    return { ok: false, status: 403, error: "You can't switch into another admin's account." };
  }
  return { ok: true, operatorId };
}

export type SwitchAccount = {
  id: string;
  label: string;
  email: string;
  isOperator: boolean;
};

export type Switcher = {
  accounts: SwitchAccount[];
  currentId: string;
  operatorId: string;
  /** The client being viewed. Null when the operator is in their own account. */
  viewing: { label: string; email: string } | null;
  expired: boolean;
};

/** Business name when the client has set one, otherwise their email. */
export function accountLabel(email: string, businessName?: string | null): string {
  return businessName?.trim() || email;
}

/** The operator's own account first, then everyone A to Z. */
export function sortAccounts(accounts: SwitchAccount[]): SwitchAccount[] {
  return [...accounts].sort((a, b) => {
    if (a.isOperator !== b.isOperator) return a.isOperator ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}
