import { NextResponse } from 'next/server';
import { chromium } from 'playwright';
import path from 'path';
import { createClient } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const authPath = path.resolve(process.cwd(), '../.auth_session');

  console.log(`🔑 Launching headed Playwright browser for Facebook login at: ${authPath}`);

  try {
    // 1. Launch visible browser for user to perform manual login & 2FA
    const browser = await chromium.launchPersistentContext(authPath, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await browser.newPage();
    await page.goto('https://www.facebook.com');

    // Wait for the user to close the visible browser window
    await new Promise<void>((resolve) => {
      browser.on('close', () => {
        console.log('🔒 Headed Facebook login browser closed by user. Session context saved.');
        resolve();
      });
    });

    // 2. Launch a silent headless browser to auto-sync the client's joined groups
    console.log('📡 Launching silent background group synchroniser...');
    
    const backgroundContext = await chromium.launchPersistentContext(authPath, {
      headless: true,
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const bgPage = await backgroundContext.newPage();
    
    let syncResults = {
      found: 0,
      synced: 0,
      skipped: 0
    };

    try {
      await bgPage.goto('https://www.facebook.com/groups/', { waitUntil: 'networkidle', timeout: 20000 });
      await bgPage.waitForTimeout(3000); // Wait for sidebar to populate

      // Class-agnostic semantic URL parsing to find joined groups
      const joinedGroups = await bgPage.evaluate(() => {
        const results: { name: string; url: string }[] = [];
        
        document.querySelectorAll('a').forEach(a => {
          const href = a.getAttribute('href') || '';
          const text = a.textContent ? a.textContent.trim() : '';

          // Filter for valid groups paths and exclude general utility tabs
          if (href.includes('/groups/') && !href.match(/groups\/(feed|discover|search|create|joins|categories)/)) {
            try {
              const urlObj = new URL(href, window.location.origin);
              const paths = urlObj.pathname.split('/');
              const groupIndex = paths.indexOf('groups');
              
              if (groupIndex !== -1 && paths[groupIndex + 1]) {
                const groupIdentifier = paths[groupIndex + 1];
                const cleanUrl = `https://www.facebook.com/groups/${groupIdentifier}`;
                
                // Exclude very short text or duplicates
                if (text && text.length > 2 && !results.some(r => r.url === cleanUrl)) {
                  results.push({ name: text, url: cleanUrl });
                }
              }
            } catch (e) {}
          }
        });

        return results;
      });

      console.log(`📋 Discovered ${joinedGroups.length} joined Facebook group(s) in background.`);
      syncResults.found = joinedGroups.length;

      // 3. Batch-upsert into Supabase (default to inactive so crawler doesn't suddenly scrape everything)
      for (const grp of joinedGroups) {
        const { error: upsertError, data: upsertData } = await supabase
          .from('groups')
          .upsert(
            { user_id: user.id, platform: 'facebook', name: grp.name, url: grp.url, active: false },
            { onConflict: 'user_id,url', ignoreDuplicates: false }
          )
          .select('id');

        if (upsertError) {
          console.error(`⚠️ Failed to upsert group "${grp.name}": ${upsertError.message}`);
          syncResults.skipped++;
        } else if (upsertData && upsertData.length > 0) {
          syncResults.synced++;
        } else {
          syncResults.skipped++;
        }
      }

      console.log(`✅ Group auto-sync complete. New/Updated: ${syncResults.synced}, Skipped: ${syncResults.skipped}`);

    } catch (syncErr: any) {
      console.error(`⚠️ Silent group sync failed: ${syncErr.message}`);
    } finally {
      await backgroundContext.close();
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Facebook session connected successfully.',
      sync: syncResults
    });

  } catch (error: any) {
    console.error('❌ Failed to launch Facebook session creator:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
