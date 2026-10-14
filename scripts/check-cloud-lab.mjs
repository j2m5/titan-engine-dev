import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile, mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const sharp = require('sharp')

const base = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(base, 'tmpscreenshots/cloud-lab')
const profilePrefix = resolve(tmpdir(), 'titan-cloud-lab-')
const profile = await mkdtemp(profilePrefix)
const url = process.env.CLOUD_LAB_URL ?? 'http://127.0.0.1:8086/cloud-lab.html'
const chromePath =
  process.env.CHROME_BIN ??
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ].find(existsSync)
if (!chromePath) throw new Error('Set CHROME_BIN to a Chromium executable')
await mkdir(output, { recursive: true })
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--window-size=1280,800',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    'about:blank'
  ],
  { windowsHide: true, stdio: 'ignore' }
)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let socket
let closeBrowser
let startupError
chrome.on('error', (error) => {
  startupError = error
})
try {
  let targets
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError
    try {
      const port = Number((await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0])
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      break
    } catch {
      await sleep(100)
    }
  }
  if (!targets) throw new Error('Chrome debugging endpoint did not start')
  socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  let id = 0
  const pending = new Map()
  const errors = []
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id) {
      const promise = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) promise.reject(new Error(JSON.stringify(msg.error)))
      else promise.resolve(msg.result)
    } else if (msg.method === 'Log.entryAdded' && /WebGL|GL_INVALID|GL_/i.test(msg.params.entry.text)) {
      if (errors.length < 20) errors.push(msg.params.entry)
    } else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails)
    else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error')
      errors.push(msg.params.args.map((arg) => arg.value ?? arg.description))
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const next = ++id
      pending.set(next, { resolve, reject })
      socket.send(JSON.stringify({ id: next, method, params }))
    })
  closeBrowser = () => send('Browser.close')
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: 180000
    })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url })
  let state
  for (let i = 0; i < 180; i++) {
    await sleep(1000)
    state = await evaluate(
      `({state: document.querySelector('#cloud-lab')?.dataset.state, status: document.querySelector('.cloud-status')?.textContent, frames: document.querySelector('#cloud-lab')?.dataset.frames})`
    )
    if (state?.state === 'ready' || state?.state === 'error' || errors.length) break
  }
  console.log('Startup', JSON.stringify(state), 'errors', JSON.stringify(errors).slice(0, 12000))
  const screenshot = async (name) => {
    const result = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile(resolve(output, `${name}.png`), Buffer.from(result.data, 'base64'))
  }
  if (state?.state !== 'ready' || errors.length) {
    await screenshot('startup-error')
    throw new Error('Cloud scene failed to start')
  }
  const settle = () =>
    evaluate(
      `new Promise((resolve, reject) => { const start = Number(document.querySelector('#cloud-lab').dataset.frames); const began = performance.now(); const poll = () => { if (Number(document.querySelector('#cloud-lab').dataset.frames) >= start + 24) resolve(true); else if (performance.now() - began > 90000) reject(new Error('Render frames stalled')); else requestAnimationFrame(poll); }; poll(); })`
    )
  const measurements = []
  const detailState = () =>
    evaluate(
      `({opacity:Number(document.querySelector('#cloud-lab').dataset.cloudOpacity), frames:Number(document.querySelector('#cloud-lab').dataset.cloudFrames), shadows:Number(document.querySelector('#cloud-lab').dataset.shadowFrames), appearance:document.querySelector('#cloud-lab').dataset.appearanceState})`
    )
  for (const view of ['orbit', 'approach', 'above', 'inside', 'below']) {
    await evaluate(`document.querySelector('[data-view="${view}"]').click()`)
    await settle()
    await screenshot(view)
    measurements.push(
      await evaluate(
        `({view:'${view}',altitude:document.querySelector('#altitude').textContent,frame:document.querySelector('#frame-time').textContent})`
      )
    )
    console.log('Rendered', view)
    if (view === 'orbit') {
      const before = await detailState()
      await evaluate(`document.querySelector('#clouds-enabled').click()`)
      await settle()
      const after = await detailState()
      if (before.opacity !== 0 || before.frames !== 0 || before.shadows !== 0 || after.frames !== before.frames || after.shadows !== before.shadows || before.appearance !== 'ready')
        throw new Error('Distant clouds must have no opacity and perform no rendering')
      await screenshot('orbit-without-clouds')
      await evaluate(`document.querySelector('#clouds-enabled').click()`)
    }
    if (view === 'approach' && Math.abs((await detailState()).opacity - 0.5) > 0.001)
      throw new Error('Cloud detail did not reach the middle of the distance transition')
    if (view === 'above' && (await detailState()).opacity !== 1)
      throw new Error('Near cloud detail did not reach full opacity')
    if (view === 'below') {
      await evaluate(`document.querySelector('#clouds-enabled').click()`)
      await settle()
      await screenshot('below-without-clouds')
      await evaluate(`document.querySelector('#clouds-enabled').click()`)
      await settle()
      await send('Input.dispatchMouseEvent', {type:'mousePressed',x:800,y:400,button:'left',clickCount:1})
      await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:803,y:401,button:'left',buttons:1})
      await send('Input.dispatchMouseEvent', {type:'mouseReleased',x:803,y:401,button:'left',clickCount:1})
      await settle()
      await screenshot('below-small-motion')
      await settle()
      await screenshot('below-small-motion-settled')
    }
  }
  await evaluate(`document.querySelector('[data-view="orbit"]').click()`)
  await settle()
  const stoppedClouds = await detailState()
  await settle()
  const stoppedAgain = await detailState()
  if (stoppedClouds.opacity !== 0 || stoppedAgain.frames !== stoppedClouds.frames || stoppedAgain.shadows !== stoppedClouds.shadows)
    throw new Error('Cloud and shadow rendering did not stop after leaving the detail range')
  await evaluate(
    `document.querySelector('[data-view="above"]').click(); document.querySelector('#clouds-enabled').click()`
  )
  await settle()
  await screenshot('above-without-clouds')
  const comparisons = []
  for (const view of ['orbit', 'above']) {
    const [on, off] = await Promise.all(
      [view, `${view}-without-clouds`].map(async (name) => {
        return sharp(resolve(output, `${name}.png`))
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })
      })
    )
    let changed = 0
    for (let y = 0; y < on.info.height; y++)
      for (let x = 350; x < on.info.width; x++) {
        const i = (y * on.info.width + x) * 3
        const difference =
          Math.abs(on.data[i] - off.data[i]) +
          Math.abs(on.data[i + 1] - off.data[i + 1]) +
          Math.abs(on.data[i + 2] - off.data[i + 2])
        if (difference > 12) changed++
      }
    comparisons.push({ view, changedPixels: changed })
  }
  console.log('Cloud visibility', JSON.stringify(comparisons))
  const orbitPixels = await sharp(resolve(output, 'orbit-without-clouds.png'))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const brightness = (x, y) => {
    const i = (y * orbitPixels.info.width + x) * 3
    return (orbitPixels.data[i] + orbitPixels.data[i + 1] + orbitPixels.data[i + 2]) / 3
  }
  const surfaceContrast = Math.abs(brightness(900, 400) - brightness(400, 400))
  await evaluate(
    `document.querySelector('#clouds-enabled').click(); const quality = document.querySelector('#cloud-quality'); quality.value = 'low'; quality.dispatchEvent(new Event('change')); const sun = document.querySelector('#sun-angle'); sun.value = '89'; sun.dispatchEvent(new Event('input'))`
  )
  await settle()
  await screenshot('sunset-low')
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false })
  await settle()
  await screenshot('resized')
  const gpu = await evaluate(
    `(() => { const gl = document.querySelector('canvas').getContext('webgl2'); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return {renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), glError: gl.getError(), state: document.querySelector('#cloud-lab').dataset.state}; })()`
  )
  const depth = await evaluate(`import('/tests/clouds/planetDepth.gpu.ts').then(m => {
    let baselineError = null;
    try { m.checkPlanetDepth(false) } catch (error) { baselineError = error.message }
    return {baselineError, checks: m.checkPlanetDepth()};
  })`)
  const occlusion = await evaluate(`import('/tests/clouds/cloudOcclusion.gpu.ts').then(m => m.checkCloudOcclusion())`)
  const appearance = await evaluate(
    `import('/tests/clouds/cloudAppearance.gpu.ts').then(m => m.checkCloudAppearance(${process.env.CLOUD_APPEARANCE_BASELINE !== '1'}))`
  )
  console.log('Cloud appearance', JSON.stringify(appearance))
  const integration = await evaluate(`(async () => {
    const {JupiterCloudLab} = await import('/src/labs/jupiter-clouds/JupiterCloudLab.ts');
    const {prepareCloudAppearanceTextures} = await import('/src/labs/jupiter-clouds/cloudAppearanceTextures.ts');
    const {createJupiterCloudProfile} = await import('/src/labs/jupiter-clouds/jupiterCloudProfile.ts');
    const {default: imageUrl} = await import('/src/labs/jupiter-clouds/assets/jupiter.jpg?url');
    const T = await import('/node_modules/.vite/deps/three.js');
    const waitFrames = (lab, n = 8) => new Promise((resolve, reject) => {
      const start = lab.frames, began = performance.now();
      const poll = () => {
        if (lab.disposed) reject(new Error('Diagnostic lab stopped'));
        else if (lab.frames >= start + n) resolve();
        else if (performance.now() - began > 90000) reject(new Error('Diagnostic frames stalled'));
        else requestAnimationFrame(poll);
      }; poll();
    });
    const host = () => {
      const node = document.createElement('div');
      Object.assign(node.style, {position:'fixed',left:'-400px',top:'0',width:'320px',height:'200px'});
      document.body.append(node); return node;
    };
    const framePixels = (lab) => {
      lab.composer.render(1/60);
      const gl = lab.renderer.getContext();
      const bytes = new Uint8Array(320*200*4);
      gl.readPixels(0,0,320,200,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
      return bytes;
    };
    const source = await new T.TextureLoader().loadAsync(imageUrl);
    source.colorSpace = T.SRGBColorSpace;
    const began = performance.now();
    const prepared = prepareCloudAppearanceTextures(createJupiterCloudProfile().layers[0], () => source);
    const preparationMs = performance.now() - began;
    const weatherBytes = prepared.weather.image.width * prepared.weather.image.height * 4;
    const weatherSize = [prepared.weather.image.width, prepared.weather.image.height];
    prepared.dispose();
    // Read the real full-material overlay, rather than the composited tan surface.
    // Broad tolerances catch the opaque blanket without requiring screenshot equality.
    const alphaHost = host();
    Object.assign(alphaHost.style, {left:'-1400px',width:'1280px',height:'800px'});
    const alphaSource = source.clone();
    let alphaLab, alphaTarget, alphaPass, foregroundAlpha;
    try {
      alphaLab = new JupiterCloudLab(alphaHost, () => {}, error => {throw error}, alphaSource);
      alphaLab.setView('above'); await waitFrames(alphaLab, 24);
      const {ShaderPass} = await import('/node_modules/.vite/deps/postprocessing.js');
      alphaTarget = new T.WebGLRenderTarget(1280,800,{type:T.UnsignedByteType,depthBuffer:false});
      const material = new T.ShaderMaterial({
        uniforms:{map:{value:alphaLab.clouds.cloudsPass.outputBuffer}},
        vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
        fragmentShader:'uniform sampler2D map;varying vec2 vUv;void main(){float a=texture2D(map,vUv).a;gl_FragColor=vec4(a,a,a,1.);}',
        depthTest:false,depthWrite:false
      });
      alphaPass = new ShaderPass(material);
      alphaPass.render(alphaLab.renderer,null,alphaTarget);
      const bytes = new Uint8Array(1280*800*4);
      alphaLab.renderer.readRenderTargetPixels(alphaTarget,0,0,1280,800,bytes);
      alphaLab.renderer.setRenderTarget(null);
      let count=0,sum=0,squares=0,opaque=0,empty=0;
      for(let y=500;y<740;y++) for(let x=160;x<1120;x++) {
        const a=bytes[((799-y)*1280+x)*4]/255;
        count++;sum+=a;squares+=a*a;opaque+=Number(a>.99);empty+=Number(a<.01);
      }
      const mean=sum/count;
      foregroundAlpha={mean,std:Math.sqrt(Math.max(0,squares/count-mean*mean)),opaqueFraction:opaque/count,emptyFraction:empty/count};
      if(mean<.2 || mean>.95 || foregroundAlpha.std<.05 || foregroundAlpha.opaqueFraction>.1 || foregroundAlpha.emptyFraction>.5)
        throw new Error('Foreground cloud volume lost readable structure: '+JSON.stringify(foregroundAlpha));
    } finally {
      alphaPass?.dispose(); alphaTarget?.dispose(); alphaLab?.dispose();
      if(!alphaLab) alphaSource.dispose(); alphaHost.remove();
    }
    let failureLab, failureStats, failureErrors = [], sourceDisposals = 0;
    source.addEventListener('dispose', () => sourceDisposals++);
    const failureHost = host();
    let failure;
    try {
      failureLab = new JupiterCloudLab(failureHost, stats => failureStats = stats,
        error => failureErrors.push(error.message), source, {resolveCloudTexture: () => undefined});
      failureLab.setView('above');
      await waitFrames(failureLab, 16);
      const before = [failureLab.cloudFrames, failureLab.shadowFrames];
      failureLab.setCloudsEnabled(false); failureLab.setCloudsEnabled(true);
      failureLab.setPlanetRotation(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0), 0.4));
      await waitFrames(failureLab, 16);
      const pixels = framePixels(failureLab);
      const nonzeroPixels = pixels.filter((v,i) => i%4!==3 && v>0).length;
      const texturesBefore = failureLab.renderer.info.memory.textures;
      failure = {stats:failureStats, before, after:[failureLab.cloudFrames,failureLab.shadowFrames],
        nonzeroPixels, errors:failureErrors, texturesBefore};
      if (!failureStats || failureStats.appearanceState !== 'unavailable' || !failureStats.appearanceMessage ||
        failureStats.cloudOpacity !== 0 || failure.after.some((v,i) => v!==before[i]) || !nonzeroPixels || failureErrors.length)
        throw new Error('Recoverable map failure regression: '+JSON.stringify(failure));
    } finally {
      failureLab?.dispose(); failureLab?.dispose();
      if (!failureLab) source.dispose();
      if (failure) {
        failure.canvasRemoved = failureHost.querySelector('canvas') === null;
        failure.sourceDisposals = sourceDisposals;
        failure.texturesAfter = failureLab.renderer.info.memory.textures;
      }
      failureHost.remove();
    }
    if (!failure.canvasRemoved || sourceDisposals !== 1) throw new Error('Failure cleanup regression');
    // Distinct marker source and scene: the lab owns the source's lifetime.
    const width=64,height=32,data=new Uint8Array(width*height*4);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const i=(y*width+x)*4;
      const rgb=x<16?[240,40,30]:x<32?[30,220,60]:x<48?[40,60,240]:[220,190,40];
      data.set([...rgb,255],i);
    }
    const marker=new T.DataTexture(data,width,height,T.RGBAFormat);
    marker.colorSpace=T.SRGBColorSpace; marker.needsUpdate=true;
    let lab,stats,errors=[],markerDisposals=0,weatherDisposals=0,colorDisposals=0,surfaceDisposals=0;
    marker.addEventListener('dispose',()=>markerDisposals++);
    const markerHost=host(); let rotation;
    try {
      lab=new JupiterCloudLab(markerHost,s=>stats=s,e=>errors.push(e.message),marker);
      lab.appearanceTextures.weather.addEventListener('dispose',()=>weatherDisposals++);
      lab.appearanceTextures.color.addEventListener('dispose',()=>colorDisposals++);
      lab.surfaceView.addEventListener('dispose',()=>surfaceDisposals++);
      lab.setView('above'); await waitFrames(lab,16);
      const average = bytes => {
        const sum=[0,0,0]; let count=0;
        for(let y=40;y<160;y++) for(let x=60;x<260;x++) {
          const i=(y*320+x)*4;
          for(let c=0;c<3;c++) sum[c]+=bytes[i+c]; count++;
        }
        return sum.map(v=>v/count);
      };
      const unrotatedCloudColor=average(framePixels(lab));
      const before=[lab.cloudFrames,lab.shadowFrames];
      const noise=[lab.clouds.shapeTexture,lab.clouds.shapeDetailTexture,lab.clouds.stbnTexture];
      const maps=[lab.appearanceTextures.weather,lab.appearanceTextures.color];
      const seed=lab.clouds.shapeOffset.toArray(),detailSeed=lab.clouds.shapeDetailOffset.toArray();
      lab.setPlanetRotation(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),0.7));
      await waitFrames(lab,16);
      const rotatedCloudColor=average(framePixels(lab));
      const matrix=lab.clouds.cloudsPass.currentMaterial.uniforms.cloudECEFToPlanet.value;
      const expected=new T.Matrix3().setFromMatrix4(new T.Matrix4().makeRotationFromQuaternion(lab.planet.quaternion.clone().invert()));
      if(matrix.elements.some((v,i)=>Math.abs(v-expected.elements[i])>1e-10)) throw new Error('Rotation binding mismatch');
      // Visible marker geography on the original surface survives a quality round trip.
      lab.setCloudsEnabled(false); await waitFrames(lab);
      const markerPixels=framePixels(lab);
      lab.setCloudsEnabled(true);
      const qualities=[];
      for(const quality of ['medium','low','high','medium']) {
        lab.setQuality(quality); await waitFrames(lab);
        const cloud=lab.clouds;
        if(noise.some((v,i)=>v!==[cloud.shapeTexture,cloud.shapeDetailTexture,cloud.stbnTexture][i]) ||
          maps.some((v,i)=>v!==[lab.appearanceTextures.weather,lab.appearanceTextures.color][i]) ||
          JSON.stringify(seed)!==JSON.stringify(cloud.shapeOffset.toArray()) ||
          JSON.stringify(detailSeed)!==JSON.stringify(cloud.shapeDetailOffset.toArray()) ||
          cloud.cloudsPass.currentMaterial.uniforms.cloudECEFToPlanet.value!==matrix ||
          cloud.shadowPass.currentMaterial.uniforms.cloudECEFToPlanet.value!==matrix)
          throw new Error('Quality changed geography or owned resources');
        qualities.push({quality,cloudFrames:lab.cloudFrames,shadowFrames:lab.shadowFrames,frameMs:stats?.frameMs});
      }
      lab.setCloudsEnabled(false); await waitFrames(lab);
      const afterPixels=framePixels(lab);
      const markerPixelDifferences=afterPixels.reduce((n,v,i)=>n+(Math.abs(v-markerPixels[i])>2?1:0),0);
      if(markerPixelDifferences>50) throw new Error('Visible marker geography changed through quality cycle');
      rotation={before,after:[lab.cloudFrames,lab.shadowFrames],qualities,markerPixelDifferences,
        unrotatedCloudColor,rotatedCloudColor,
        texturesBefore:lab.renderer.info.memory.textures,errors};
      if(rotation.after.some((v,i)=>v<=before[i]) || errors.length) throw new Error('Complete cloud/shadow passes did not render');
    } finally {
      lab?.dispose(); lab?.dispose(); if(!lab) marker.dispose();
      if(rotation) Object.assign(rotation,{texturesAfter:lab.renderer.info.memory.textures,
        markerDisposals,weatherDisposals,colorDisposals,surfaceDisposals,canvasRemoved:!markerHost.querySelector('canvas')});
      markerHost.remove();
    }
    if(!rotation.canvasRemoved || [markerDisposals,weatherDisposals,colorDisposals,surfaceDisposals].some(v=>v!==1) ||
      rotation.texturesAfter>=rotation.texturesBefore) throw new Error('Owned texture lifecycle regression');
    return {preparationMs,weatherBytes,weatherSize,foregroundAlpha,failure,rotation};
  })()`)
  console.log('Cloud integration', JSON.stringify(integration))
  if (
    appearance.samples < 12 ||
    appearance.maxCloudUvError > 1 / 255 ||
    appearance.maxShadowUvError > 1 / 255 ||
    appearance.maxColorError > 3 / 255 ||
    appearance.maxAlphaDifference > 1 / 255 ||
    appearance.maxShadowDifference > 1 / 255 ||
    !appearance.resourcesReleased
  )
    throw new Error('Cloud appearance GPU regression')
  const disposed = await evaluate(
    `(() => { window.dispatchEvent(new PageTransitionEvent('pagehide')); return document.querySelectorAll('.cloud-viewport canvas').length === 0; })()`
  )
  const report = {
    measurements,
    comparisons,
    surfaceContrast,
    depth,
    occlusion,
    appearance,
    integration,
    stoppedClouds,
    disposed,
    gpu,
    errors
  }
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  if (errors.length || gpu.glError) throw new Error('Shader/runtime errors in cloud lab')
  if (comparisons.find((result) => result.view === 'orbit').changedPixels > 50)
    throw new Error('Distant clouds changed the textured planet appearance')
  if (comparisons.find((result) => result.view === 'above').changedPixels < 5000)
    throw new Error('Nearby clouds are missing')
  if (surfaceContrast < 12) throw new Error('Orbital surface depth/lighting is flattened')
  if (!depth.baselineError) throw new Error('Upstream depth behavior changed: review whether the adapter is needed')
  if (!disposed) throw new Error('Leaving the laboratory did not release its canvas')
} finally {
  if (closeBrowser) await Promise.race([closeBrowser().catch(() => {}), sleep(1000)])
  socket?.close()
  chrome.kill()
  // Only delete the temporary profile created by this invocation, never a user browser profile.
  if (resolve(profile).startsWith(profilePrefix) && profile !== profilePrefix) {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
  }
}
