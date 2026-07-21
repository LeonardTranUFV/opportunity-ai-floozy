import { NextResponse } from "next/server";
import { chromium } from "playwright";
import path from "path";

interface CheckResult {
  loggedIn: boolean;
  name: string | null;
}

async function checkFacebook(authPath: string): Promise<CheckResult> {
  const context = await chromium.launchPersistentContext(authPath, { headless: true });
  try {
    const page = await context.newPage();
    // Facebook's feed polls in the background forever, so "networkidle" never
    // resolves and used to time out — falsely reporting logged-out every time.
    await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(3000);
    const loggedOutMarker = await page.getByText("Create new account").count();
    const loggedIn = loggedOutMarker === 0;

    let name: string | null = null;
    if (loggedIn) {
      // /me redirects to the logged-in user's own profile — the page <title>
      // ("Name | Facebook") is far more stable to parse than nav DOM, which
      // Facebook restructures often. Best-effort: a failure here shouldn't
      // affect the loggedIn verdict above.
      try {
        await page.goto("https://www.facebook.com/me", { waitUntil: "domcontentloaded", timeout: 15000 });
        // Facebook is a heavy SPA — the tab starts with the generic "Facebook"
        // title and only swaps in the profile name once client JS finishes
        // rendering, well after domcontentloaded. Poll for that instead of a
        // blind fixed sleep; if it never changes, treat as extraction failure.
        await page
          .waitForFunction(() => document.title.trim().toLowerCase() !== "facebook", { timeout: 8000 })
          .catch(() => {});
        const title = await page.title();
        const cleaned = title.replace(/\s*\|\s*Facebook.*$/i, "").trim();
        name = cleaned && cleaned.toLowerCase() !== "facebook" ? cleaned : null;
      } catch {
        // leave name null
      }
    }
    return { loggedIn, name };
  } finally {
    await context.close();
  }
}

async function checkLinkedIn(authPath: string): Promise<CheckResult> {
  const context = await chromium.launchPersistentContext(authPath, { headless: true });
  try {
    const page = await context.newPage();
    await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(3000);
    const loggedIn = page.url().includes("/feed");

    let name: string | null = null;
    if (loggedIn) {
      try {
        await page.goto("https://www.linkedin.com/in/me/", { waitUntil: "domcontentloaded", timeout: 15000 });
        await page
          .waitForFunction(() => document.title.trim().toLowerCase() !== "linkedin", { timeout: 8000 })
          .catch(() => {});
        const title = await page.title();
        const cleaned = title.replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
        name = cleaned && cleaned.toLowerCase() !== "linkedin" ? cleaned : null;
      } catch {
        // leave name null
      }
    }
    return { loggedIn, name };
  } finally {
    await context.close();
  }
}

export async function GET() {
  const authPath = path.resolve(process.cwd(), "../.auth_session");

  // Sequential, not parallel — both checks share the same persistent Chromium
  // profile directory, which only one process can hold a lock on at a time.
  let facebook = false;
  let facebookName: string | null = null;
  let linkedin = false;
  let linkedinName: string | null = null;

  try {
    const result = await checkFacebook(authPath);
    facebook = result.loggedIn;
    facebookName = result.name;
  } catch (error) {
    console.error("Facebook status check failed:", error);
  }

  try {
    const result = await checkLinkedIn(authPath);
    linkedin = result.loggedIn;
    linkedinName = result.name;
  } catch (error) {
    console.error("LinkedIn status check failed:", error);
  }

  return NextResponse.json({ success: true, facebook, facebookName, linkedin, linkedinName });
}
