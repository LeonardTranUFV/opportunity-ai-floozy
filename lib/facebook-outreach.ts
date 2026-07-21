import { chromium, type Page } from "playwright";
import path from "path";

function getAuthPath(): string {
  return path.resolve(process.cwd(), "../.auth_session");
}

async function typeLikeHuman(page: Page, text: string) {
  await page.keyboard.type(text, { delay: 35 + Math.random() * 40 });
}

export interface OutreachResult {
  success: boolean;
  error?: string;
}

/**
 * Posts a personalized comment on a Facebook post. Requires the account behind
 * .auth_session to already be a member of the post's group — if not, Facebook
 * shows a "join group" prompt instead of a comment box and this reports that
 * back as a clear error rather than a generic failure.
 */
export async function postFacebookComment(postUrl: string, message: string): Promise<OutreachResult> {
  const context = await chromium.launchPersistentContext(getAuthPath(), { headless: true });
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
    await context.close();
  }
}

/**
 * Sends a personalized Messenger DM to a post author via their profile page.
 * Does not require group membership.
 */
export async function sendFacebookMessage(profileUrl: string, message: string): Promise<OutreachResult> {
  const context = await chromium.launchPersistentContext(getAuthPath(), { headless: true });
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
    await context.close();
  }
}
