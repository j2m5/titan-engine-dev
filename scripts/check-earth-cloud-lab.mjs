import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withCloudProbeBrowser } from './lib/cloud-probe-browser.mjs'

const probes = { maps: ['earthCloudTextures', 'checkEarthCloudTextures', 'earth-cloud-maps'], surface: ['earthSurface', 'checkEarthSurface', 'earth-surface'], composition: ['earthComposition', 'checkEarthComposition', 'earth-composition'], lifecycle: ['earthLab', 'checkEarthLab', 'earth-lifecycle'] }
const args = process.argv.slice(2)
if (args.length > 1 || args.some(arg => !/^--probe=(maps|surface|composition|lifecycle|all)$/.test(arg))) throw new Error('Supported probes: maps, surface, composition, lifecycle, all')
const probe = args[0]?.split('=')[1] ?? 'all'
const pageUrl = process.env.EARTH_CLOUD_LAB_URL ?? 'http://127.0.0.1:8086/earth-cloud-lab.html'
const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), '../tmpscreenshots/earth-cloud-lab')
await mkdir(outputDir, { recursive: true })
const report = await withCloudProbeBrowser(
  {
    url: new URL('/tests/clouds/earth/probe.html', pageUrl).href,
    outputDir
  },
  async ({ evaluate, webglErrors }) => {
    const results = {}
    for (const name of probe === 'all' ? Object.keys(probes) : [probe]) {
      const [file, method, expected] = probes[name]
      const result = await evaluate(`import('/tests/clouds/earth/${file}.gpu.ts').then(m => m.${method}())`)
      if (result.name !== expected || result.checks < 1 || !result.resourcesReleased) throw new Error(`Incomplete ${name} probe: ${JSON.stringify(result)}`)
      results[name] = result
    }
    return { probes: results, webglErrors }
  }
)
if (!args.length) report.page = await withCloudProbeBrowser({ url: pageUrl, outputDir }, async ({ evaluate, screenshot, requests, send }) => {
  const fresh = expression => evaluate(`(async()=>{const root=document.querySelector('#earth-cloud-lab'), before=Number(root.dataset.frames);${expression};for(let i=0;i<500;i++){await new Promise(requestAnimationFrame);if(Number(root.dataset.frames)>before+1)return {...root.dataset}}throw Error('No fresh page frame')})()`)
  const views = {}
  for (const view of ['orbit', 'approach', 'above', 'inside', 'below']) {
    views[view] = await fresh(`document.querySelector('[data-view="${view}"]').click()`)
    await screenshot(`medium-${view}`)
  }
  for (const quality of ['low','high']) for (const view of ['above','inside']) {
    await fresh(`const q=document.querySelector('#quality');q.value='${quality}';q.dispatchEvent(new Event('change'));document.querySelector('[data-view="${view}"]').click()`)
    await screenshot(`${quality}-${view}`)
  }
  for (const [name, angle] of [['daylight',35],['terminator',90],['night',180]]) {
    await fresh(`const q=document.querySelector('#quality');q.value='medium';q.dispatchEvent(new Event('change'));const s=document.querySelector('#sun-angle');s.value='${angle}';s.dispatchEvent(new Event('input'));document.querySelector('[data-view="above"]').click()`)
    await screenshot(name)
  }
  await fresh("document.querySelector('[data-view=orbit]').click();const s=document.querySelector('#sun-angle');s.value=35;s.dispatchEvent(new Event('input'))")
  const capture = () => send('Page.captureScreenshot', { format: 'png', clip: { x: 400, y: 0, width: 880, height: 800, scale: 1 } })
  const before = await evaluate("({...document.querySelector('#earth-cloud-lab').dataset})")
  const onImage = await capture()
  const off = await fresh("const c=document.querySelector('#clouds-enabled');c.checked=false;c.dispatchEvent(new Event('change'))")
  const offImage = await capture()
  if (onImage.data === offImage.data || off.cloudFrames !== before.cloudFrames || off.shadowFrames !== before.shadowFrames) throw new Error('Far toggle failed image/work check')
  await fresh("const c=document.querySelector('#clouds-enabled');c.checked=true;c.dispatchEvent(new Event('change'))")
  const performance = {}
  for (const view of ['orbit','approach','above']) {
    await fresh(`document.querySelector('[data-view="${view}"]').click()`)
    performance[view] = await evaluate(`(async()=>{const root=document.querySelector('#earth-cloud-lab');let last;for(let i=0;i<31;i++)last=await new Promise(requestAnimationFrame);const before={...root.dataset};const samples=[];for(let i=0;i<120;i++){const now=await new Promise(requestAnimationFrame);samples.push(now-last);last=now}const sorted=[...samples].sort((a,b)=>a-b);return {median:sorted[59],p95:sorted[113],samples,before,after:{...root.dataset},quality:document.querySelector('#quality').value,width:innerWidth,height:innerHeight,dpr:devicePixelRatio}})()`)
  }
  const images = requests.filter(url => /earth(?:_clouds|_night|_specular)?[^/]*\.jpg/.test(url))
  if (new Set(images).size !== 4 || requests.some(url => /^https?:/.test(url) && new URL(url).origin !== new URL(pageUrl).origin)) throw new Error(`Nonlocal/missing Earth assets ${JSON.stringify(requests)}`)
  return { views, performance, images, farToggle: true }
})
await writeFile(resolve(outputDir, `${probe}-report.json`), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
