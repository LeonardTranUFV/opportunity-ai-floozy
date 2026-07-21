import { NextResponse } from "next/server";
import { chromium } from "playwright";
import path from "path";

async function checkFacebook(authPath: string): Promise<boolean> {
  const context = await chromium.launchPersistentContext(authPath, { headless: true });
  try {
    const page = await context.newPage();
    // Facebook's feed polls in the background forever, so "networkidle" never
    // resolves and used to time out — falsely reporting logged-out every time.
    await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(3000);
    const loggedOutMarker = await page.getByText("Create new account").count();
    return loggedOutMarker === 0;
  } finally {
    await context.close();
  }
}

async function checkLinkedIn(authPath: string): Promise<boolean> {
  const context = await chromium.launchPersistentContext(authPath, { headless: true });
  try {
    const page = await context.newPage();
    await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(3000);
    return page.url().includes("/feed");
  } finally {
    await context.close();
  }
}

export async function GET() {
  const authPath = path.resolve(process.cwd(), "../.auth_session");

  // Sequential, not parallel — both checks share the same persistent Chromium
  // profile directory, which only one process can hold a lock on at a time.
  let facebook = false;
  let linkedin = false;

  try {
    facebook = await checkFacebook(authPath);
  } catch (error) {
    console.error("Facebook status check failed:", error);
  }

  try {
    linkedin = await checkLinkedIn(authPath);
  } catch (error) {
    console.error("LinkedIn status check failed:", error);
  }

  return NextResponse.json({ success: true, facebook, linkedin });
}
