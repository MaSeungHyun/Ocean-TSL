import { chromium } from 'playwright-core'
import fs from 'fs'
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] })
const p = await b.newPage()
await p.addInitScript(() => { window.__src=[]; const o=WebGL2RenderingContext.prototype.shaderSource; WebGL2RenderingContext.prototype.shaderSource=function(s,src){window.__src.push(src);return o.call(this,s,src)} })
await p.goto(process.argv[2]); await p.waitForTimeout(6000)
const src = await p.evaluate(()=>window.__src)
src.forEach((s,i)=>{ console.log(i, s.length); fs.writeFileSync(`/tmp/sh${i}.glsl`, s) })
await b.close()
