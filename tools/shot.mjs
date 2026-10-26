import { chromium } from 'playwright-core'
const [url, prefix, extra=''] = process.argv.slice(2)
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
p.on('console', m => { if (m.type()==='error'||m.type()==='warning') console.log('[c]', m.text().slice(0,300)) })
p.on('pageerror', e => console.log('[err]', e.message))
for (const cam of ['low','high']) {
  await p.goto(`${url}?cam=${cam}&dpr=1${extra}`)
  await p.waitForTimeout(9000)
  const fps = await p.evaluate(() => window.__fps)
  await p.screenshot({ path: `/workspace/ocean/screens/${prefix}-${cam}.png` })
  console.log(cam, 'fps', fps)
}
await b.close()
