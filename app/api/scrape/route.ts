import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import path from 'path';
import db from '@/lib/db';

// Hard ceiling so a hung browser can never freeze the dashboard forever
const SCRAPE_TIMEOUT_MS = 8 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const useTestMode = body.testMode === true;
    const clearTest = body.clearTest === true;
    const timeRange = body.range === 'today' ? 'today' : '7days';

    // 1. Check if there are any active groups configured first
    const activeGroups = db.prepare('SELECT COUNT(*) as count FROM groups WHERE active = 1').get() as { count: number };

    if (activeGroups.count === 0 && !useTestMode && !clearTest) {
      return NextResponse.json({
        success: false,
        error: 'No active groups are configured.',
        details: 'You currently have 0 active groups selected in your Group Settings. Please go to Group Settings, use the AI Group Finder to join and track groups, and make sure to click the active toggle switch next to them!'
      }, { status: 400 });
    }

    // 2. Resolve path to the scraper script at the workspace root
    const scriptPath = path.resolve(process.cwd(), '../scrape-social-demands.js');

    const flag = clearTest ? ' --clear-test' : useTestMode ? ' --test' : '';
    const command = `node "${scriptPath}" --range ${timeRange}${flag}`;

    console.log(`⚡ On-Demand Scrape Triggered: ${command}`);

    const executionResult = await new Promise<{ success: boolean; stdout: string; stderr: string }>((resolve) => {
      exec(
        command,
        { cwd: path.resolve(process.cwd(), '..'), timeout: SCRAPE_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            console.error(`❌ Scraper execution error: ${error.message}`);
            resolve({ success: false, stdout, stderr: stderr || error.message });
          } else {
            resolve({ success: true, stdout, stderr });
          }
        }
      );
    });

    if (!executionResult.success) {
      return NextResponse.json({
        success: false,
        error: 'The scraping script failed during execution.',
        details: executionResult.stderr || executionResult.stdout.slice(-800)
      }, { status: 500 });
    }

    // 3. Parse the machine-readable summary the scraper prints as its last step
    let summary: { scraped?: number; inserted_posts?: number; inserted_leads?: number; cleared?: number } = {};
    const resultLine = executionResult.stdout.split('\n').reverse().find(l => l.startsWith('RESULT_JSON '));
    if (resultLine) {
      try {
        summary = JSON.parse(resultLine.replace('RESULT_JSON ', ''));
      } catch { /* fall back to raw stdout below */ }
    }

    // Surface the missing-API-key warning so the UI can tell the user why 0 leads came back
    const missingKey = executionResult.stdout.includes('GEMINI_API_KEY IS MISSING');

    return NextResponse.json({
      success: true,
      stdout: executionResult.stdout,
      summary,
      missingGeminiKey: missingKey,
      message: 'Scraper run completed successfully.'
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
