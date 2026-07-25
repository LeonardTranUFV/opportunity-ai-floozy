import { NextResponse } from 'next/server';
import { chromium } from 'playwright';
import { createClient } from '@/lib/supabase/server';
import { getAuthSessionPath } from '@/lib/auth-session';

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const authPath = getAuthSessionPath(user.id);

  console.log(`🔑 Launching headed Playwright browser for Nextdoor login at session folder: ${authPath}`);

  try {
    const browser = await chromium.launchPersistentContext(authPath, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await browser.newPage();
    await page.goto('https://nextdoor.com/login/');

    // Return a promise that resolves when the browser context is closed by the user
    await new Promise<void>((resolve) => {
      browser.on('close', () => {
        console.log('🔒 Playwright browser closed by user. Nextdoor session saved.');
        resolve();
      });
    });

    return NextResponse.json({ success: true, message: 'Nextdoor browser session completed and saved successfully.' });
  } catch (error: any) {
    console.error('❌ Failed to launch Nextdoor browser session:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
