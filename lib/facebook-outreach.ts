import type { Page } from "playwright";
import { formatAuthLaunchError } from "@/lib/auth-session";
import { openPlatformContext } from "@/lib/browser-context";

async function typeLikeHuman(page: Page, text: string) {
  await page.keyboard.type(text, { delay: 35 + Math.random() * 40 });
}

export interface OutreachResult {
  success: boolean;
  error?: string;
}

/**
 * Posts a personalized comment on a Facebook post, using this user's own
 * connected session. Requires that account to already be a member of the
 * post's group — if not, Facebook shows a "join group" prompt instead of a
 * comment box and this reports that back as a clear error.
 */
export async function postFacebookComment(postUrl: string, message: string, userId: string): Promise<OutreachResult> {
  // Where this customer's login lives — a stored session usable from anywhere,
  // or a Chrome profile on this machine — is openPlatformContext's problem.
  // This used to look only on local disk, so every customer who connected
  // through the hosted site had a perfectly good session that outreach could
  // not see, and got told to connect an account they had already connected.
  let opened;
  try {
    opened = await openPlatformContext(userId, "facebook");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: formatAuthLaunchError(message, "Facebook") };
  }
  if (!opened) {
    return { success: false, error: "No connected Facebook session for this account." };
  }
  const context = opened.context;

  try {
    const page = await context.newPage();
    await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000);

    const joinPrompt = await page.getByRole("button", { name: /join group/i }).count();
    if (joinPrompt > 0) {
      return { success: false, error: "You're not a member of this group yet — join it on Facebook first." };
    }

    const commentBox = page
      .locator('div[contenteditable="true"][aria-label*="omment" i], div[contenteditable="true"][aria-label*="Write a comment" i]')
      .first();

    await commentBox.waitFor({ state: "visible", timeout: 15000 });
    await commentBox.click();
    await typeLikeHuman(page, message);
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error posting comment";
    return { success: false, error: message };
  } finally {
    await opened.release();
  }
}

/**
 * Sends a personalized Messenger DM to a post author via their profile page.
 * Does not require group membership.
 *
 * ⚠️ **Deliberately not called. Read this before wiring it back up.**
 *
 * The DM route used to call this, which made the software the sender of an
 * unsolicited commercial message to a stranger. Sent from Canada that engages
 * CASL: a DM goes to an electronic address, so it needs consent, sender
 * identification and an unsubscribe route. A stranger's group post supplies
 * none of the three, and penalties reach CAD $1M for an individual. It also
 * automates a logged-in session, which Meta's platform terms prohibit.
 *
 * DMs are now prepared by the API and sent by a person, from their own
 * Messenger. Public comments still post automatically — a comment is published
 * on a post rather than sent to an address, so the anti-spam rules do not
 * attach to it.
 *
 * Kept rather than deleted because a *consented* flow — somebody who asked us
 * to follow up — would legitimately use it. That flow does not exist yet.
 */
export async function sendFacebookMessage(profileUrl: string, message: string, userId: string): Promise<OutreachResult> {
  // Where this customer's login lives — a stored session usable from anywhere,
  // or a Chrome profile on this machine — is openPlatformContext's problem.
  // This used to look only on local disk, so every customer who connected
  // through the hosted site had a perfectly good session that outreach could
  // not see, and got told to connect an account they had already connected.
  let opened;
  try {
    opened = await openPlatformContext(userId, "facebook");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: formatAuthLaunchError(message, "Facebook") };
  }
  if (!opened) {
    return { success: false, error: "No connected Facebook session for this account." };
  }
  const context = opened.context;

  try {
    const page = await context.newPage();
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000);

    const messageButton = page.getByRole("link", { name: /^message$/i }).or(page.getByRole("button", { name: /^message$/i })).first();
    await messageButton.waitFor({ state: "visible", timeout: 15000 });
    await messageButton.click();
    await page.waitForTimeout(2500);

    const chatInput = page
      .locator('div[contenteditable="true"][aria-label*="essage" i]')
      .last();

    await chatInput.waitFor({ state: "visible", timeout: 15000 });
    await chatInput.click();
    await typeLikeHuman(page, message);
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error sending message";
    return { success: false, error: message };
  } finally {
    await opened.release();
  }
}
