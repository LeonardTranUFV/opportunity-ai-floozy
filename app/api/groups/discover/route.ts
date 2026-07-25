import { NextResponse } from 'next/server';
import { chromium } from 'playwright';
import { createClient } from '@/lib/supabase/server';
import { getAuthSessionPath, formatAuthLaunchError } from '@/lib/auth-session';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { industry, location } = body;

    if (!industry || !location) {
      return NextResponse.json({ error: 'Both industry and location are required.' }, { status: 400 });
    }

    const searchQuery = `${industry} ${location}`;
    console.log(`📡 Launching Live Facebook Group Search for query: "${searchQuery}"...`);

    const authPath = getAuthSessionPath(user.id, 'facebook');

    // Launch headless Playwright context utilizing saved session cookies
    const browser = await chromium.launchPersistentContext(authPath, {
      headless: true,
      channel: 'chrome',
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await browser.newPage();
    const searchUrl = `https://www.facebook.com/search/groups/?q=${encodeURIComponent(searchQuery)}`;
    
    let discoveredResults: { name: string; url: string; platform: string; description: string }[] = [];

    try {
      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(4000); // Allow search results to load and settle

      // Robust semantic class-agnostic extractor
      discoveredResults = await page.evaluate((targetLocation) => {
        const results: { name: string; url: string; platform: string; description: string }[] = [];
        
        // Facebook search result cards typically contain group links
        document.querySelectorAll('a').forEach(a => {
          const href = a.getAttribute('href') || '';
          const text = a.textContent ? a.textContent.trim() : '';

          // Validate link matches group profiles and exclude irrelevant paths
          if (href.includes('/groups/') && !href.match(/groups\/(feed|discover|search|create|joins|categories)/)) {
            try {
              const urlObj = new URL(href, window.location.origin);
              const paths = urlObj.pathname.split('/');
              const groupIndex = paths.indexOf('groups');
              
              if (groupIndex !== -1 && paths[groupIndex + 1]) {
                const groupIdentifier = paths[groupIndex + 1];
                const cleanUrl = `https://www.facebook.com/groups/${groupIdentifier}`;
                
                // Group names are long descriptive texts inside search result headers
                if (text && text.length > 5 && !results.some(r => r.url === cleanUrl)) {
                  // Crawl upwards or adjacent to find member counts or group descriptions
                  let description = `Active Facebook group matching interests in ${targetLocation}.`;
                  const parentCard = a.closest('div[role="article"], div.x1y1aw1k, div.x193iq5w');
                  
                  if (parentCard) {
                    // Gather all readable subtext from the card (like member counts or post frequency)
                    const subtexts = Array.from(parentCard.querySelectorAll('span, div'))
                      .map(el => el.textContent?.trim() || '')
                      .filter(txt => txt.length > 10 && txt !== text && !txt.includes('Joined') && !txt.includes('Join'));
                    
                    if (subtexts.length > 0) {
                      description = subtexts.slice(0, 2).join(' • ');
                    }
                  }

                  results.push({
                    name: text,
                    url: cleanUrl,
                    platform: 'facebook',
                    description: description
                  });
                }
              }
            } catch (e) {}
          }
        });

        return results;
      }, location);

      console.log(`✅ Live search complete. Scraped ${discoveredResults.length} groups matching "${searchQuery}" directly from Facebook.`);

    } catch (err: any) {
      console.error(`⚠️ Facebook Live search crawler failed: ${err.message}`);
    } finally {
      await browser.close();
    }

    // Facebook glues activity metadata onto the link text ("...Last active 3 hours ago")
    discoveredResults = discoveredResults.map(r => ({ ...r, name: cleanGroupName(r.name) }));

    // No invented fallback groups: an empty result is an honest answer the UI can explain.
    return NextResponse.json(discoveredResults);
  } catch (error: any) {
    return NextResponse.json({ error: formatAuthLaunchError(error.message, 'Facebook') }, { status: 500 });
  }
}

/**
 * Strip glued-on activity/member metadata from a scraped group name.
 */
function cleanGroupName(name: string): string {
  return name
    .replace(/Last active.*$/i, '')
    .replace(/\d+(\.\d+)?[KM]?\s*(members|posts).*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
