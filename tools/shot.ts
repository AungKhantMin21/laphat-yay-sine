// Dev-only: screenshots the dev/preview server on phone-like viewports with system Chrome.
// Usage: node tools/shot.ts <url> <outDir> [extra query]
import { chromium, devices } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:4173/games/laphat-yay-sine/';
const out = process.argv[3] ?? '.';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const views = [
  { name: 'android-landscape', ...devices['Pixel 7 landscape'] },
  { name: 'android-portrait', ...devices['Pixel 7'] },
  { name: 'iphone-landscape', ...devices['iPhone 13 landscape'] },
  { name: 'desktop', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
];

const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const v of views) {
  const { name, ...ctxOpts } = v;
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const logs: string[] = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(Number(process.env.SHOT_WAIT ?? 1500));
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name, logs.join(' | ') || 'no console output');
  await ctx.close();
}
await browser.close();
