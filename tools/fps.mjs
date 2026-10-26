import { chromium } from 'playwright-core'
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
for (const u of process.argv.slice(2)) { await p.goto(u); await p.waitForTimeout(8000); console.log(u, (await p.evaluate(() => window.__fps))?.toFixed(1)) }
await b.close()
