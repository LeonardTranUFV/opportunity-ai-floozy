import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { formatAuthLaunchError } from '@/lib/auth-session';
import { openPlatformContext } from '@/lib/browser-context';
import { errorMessage } from '@/lib/errors';
import { spendCredits, CREDIT_COSTS, InsufficientCreditsError } from '@/lib/credits';
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

  // No hosted gate any more. It was here because this route launched Chrome
  // locally; it now goes through openPlatformContext, which can rent one.
  const rl = await rateLimit(`group-discover:${user.id}`, LIMITS.browser.limit, LIMITS.browser.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "searches");

    const body = await request.json();
    const { industry, location } = body;
    // URLs the user has already been shown — "See more" sends these back so a
    // second search scrolls deeper and returns genuinely new groups rather
    // than repeating page one.
    const exclude: string[] = Array.isArray(body.exclude) ? body.exclude : [];

    // "Track" on an AI suggestion sends the suggested group name verbatim.
    // That phrase already names its own suburb ("Burnaby Community Notice
    // Board"), so appending the location the way the industry+location form
    // does would search "Burnaby Community Notice Board Vancouver" and match
    // nothing. An exact query skips the concatenation.
    const exactQuery = typeof body.query === 'string' ? body.query.trim() : '';

    if (!exactQuery && (!industry || !location)) {
      return NextResponse.json({ error: 'Both industry and location are required.' }, { status: 400 });
    }

    const searchQuery = exactQuery || `${industry} ${location}`;
    console.log(`📡 Launching Live Facebook Group Search for query: "${searchQuery}"...`);

    /**
     * Opened through the shared seam rather than by launching Chrome here.
     *
     * This route reached straight for a local persistent-context profile
     * directory, which is why it refused outright on the hosted deployment:
     * no Chrome, no profile. openPlatformContext knows all three places a
     * session can live — including a cloud browser — so group search now works
     * wherever the customer connected from.
     *
     * Null means genuinely nothing to open: no stored session and no local
     * profile. That is a different answer from "the search found nothing", and
     * the customer is told which.
     */
    const opened = await openPlatformContext(user.id, 'facebook');
    if (!opened) {
      return NextResponse.json(
        { error: 'Connect Facebook first — group search signs in as you.' },
        { status: 409 }
      );
    }

    const browser = opened.context;
    const page = await browser.newPage();
    const searchUrl = `https://www.facebook.com/search/groups/?q=${encodeURIComponent(searchQuery)}`;

    let discoveredResults: { name: string; url: string; platform: string; description: string; joined: boolean; visibility: 'public' | 'private' | null }[] = [];
    let failure: string | null = null;

    try {
      // NOT 'networkidle': Facebook holds long-poll/websocket connections open
      // forever, so it never reaches network idle and goto always threw a
      // timeout here — which was caught below and silently reported to the
      // user as "no groups found" even though search worked fine. Wait for the
      // result links themselves instead; that's the actual signal we need.
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      if (/\/login|\/checkpoint/.test(page.url())) {
        throw new Error('SESSION_EXPIRED');
      }

      try {
        await page.waitForSelector('a[href*="/groups/"]', { timeout: 15000 });
        await page.waitForTimeout(2500); // let the rest of the result list paint

        // Facebook lazy-loads results, so page one is all you get without
        // scrolling. Scroll further on "See more" runs to reach new groups.
        const rounds = exclude.length > 0 ? 6 : 2;
        for (let i = 0; i < rounds; i++) {
          await page.mouse.wheel(0, 2200);
          await page.waitForTimeout(1200);
        }
      } catch {
        // No group links ever appeared — a genuinely empty result set, not a
        // failure. Fall through and return [] so the UI says "no matches".
      }

      // Robust semantic class-agnostic extractor
      discoveredResults = await page.evaluate((targetLocation) => {
        const results: { name: string; url: string; platform: string; description: string; joined: boolean; visibility: 'public' | 'private' | null }[] = [];
        
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

                  // Two different facts, previously conflated.
                  //
                  // `joined` is the viewer's own relationship to the group — a
                  // "Joined" pill when you're a member, a "Join group" button
                  // when you aren't.
                  //
                  // `visibility` is what actually decides whether we can read
                  // the group's posts. A **public** group serves its posts to
                  // anyone, member or not; only a **private** group requires
                  // membership. This was originally read the other way round —
                  // the code assumed not-joined meant no posts — and it isn't
                  // true: thirteen unjoined public groups added on 2026-08-09
                  // returned 4-14 posts each on the very next scrape.
                  let joined = false;
                  let visibility: 'public' | 'private' | null = null;

                  if (parentCard) {
                    const cardLabels = Array.from(parentCard.querySelectorAll('span, div, a[role="button"], div[role="button"]'))
                      .map(el => el.textContent?.trim() || '');
                    joined = cardLabels.some(txt => /^joined$/i.test(txt) || /^visit group$/i.test(txt));

                    // Facebook prints "Public"/"Private" in the card's metadata
                    // row, next to the member count.
                    const meta = cardLabels.find(txt => /\b(public|private)\s*(group)?\s*·/i.test(txt))
                      ?? cardLabels.find(txt => /^\s*(public|private)\s*(group)?\s*$/i.test(txt));
                    if (meta) visibility = /\bprivate\b/i.test(meta) ? 'private' : 'public';

                    // Gather all readable subtext from the card (like member counts or post frequency)
                    const subtexts = cardLabels
                      .filter(txt => txt.length > 10 && txt !== text && !txt.includes('Joined') && !txt.includes('Join'));

                    if (subtexts.length > 0) {
                      description = subtexts.slice(0, 2).join(' • ');
                    }
                  }

                  results.push({
                    name: text,
                    url: cleanUrl,
                    platform: 'facebook',
                    description: description,
                    joined,
                    visibility
                  });
                }
              }
            } catch {
              /* one malformed entry shouldn't abandon the rest of the list */
            }
          }
        });

        return results;
      }, location || searchQuery);

      console.log(`✅ Live search complete. Scraped ${discoveredResults.length} groups matching "${searchQuery}" directly from Facebook.`);

    } catch (err) {
      const message = errorMessage(err);
      console.error(`⚠️ Facebook Live search crawler failed: ${message}`);
      failure =
        message === 'SESSION_EXPIRED'
          ? 'Your Facebook session has expired. Reconnect it under Connect Accounts, then try again.'
          : `Facebook search failed: ${message}`;
    } finally {
      // release(), not close(). The seam owns how the browser was opened: for
      // a rented one this also writes refreshed cookies back and ends the paid
      // session, neither of which closing a context would do.
      await opened.release();
    }

    // Surface real failures instead of returning [] — an empty array renders as
    // "no groups found for that search", which blamed the user's search terms
    // for what was actually a crawler/session problem.
    if (failure) {
      return NextResponse.json({ error: failure }, { status: 502 });
    }

    // Facebook glues activity metadata onto the link text ("...Last active 3 hours ago")
    discoveredResults = discoveredResults.map(r => ({ ...r, name: cleanGroupName(r.name) }));

    if (exclude.length > 0) {
      const seen = new Set(exclude);
      discoveredResults = discoveredResults.filter(r => !seen.has(r.url));
    }

    // Charged only once a real search completed — a crawler failure above
    // returns early, so a broken search never costs the customer credits.
    try {
      await spendCredits(supabase, user.id, CREDIT_COSTS.discoverGroups, 'discover_groups', {
        industry: industry ?? null,
        location: location ?? null,
        query: exactQuery || null,
        returned: discoveredResults.length,
        loadMore: exclude.length > 0,
      });
    } catch (creditError) {
      if (creditError instanceof InsufficientCreditsError) {
        return NextResponse.json({ error: creditError.message }, { status: 402 });
      }
      throw creditError;
    }

    // No invented fallback groups: an empty result is an honest answer the UI can explain.
    return NextResponse.json(discoveredResults);
  } catch (error) {
    return NextResponse.json({ error: formatAuthLaunchError(errorMessage(error), 'Facebook') }, { status: 500 });
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
