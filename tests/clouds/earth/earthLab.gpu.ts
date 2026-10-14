import { Camera, Scene, Mesh, PlaneGeometry, ShaderMaterial, WebGLRenderTarget, HalfFloatType, DataUtils, Quaternion, Vector3, type PerspectiveCamera, type WebGLRenderer } from 'three'
import { EarthCloudLab } from '@/labs/earth-clouds/EarthCloudLab'
import { loadEarthTextures } from '@/labs/earth-clouds/earthAssets'
import type { EarthGpuProbeReport } from './gpuTestHarness'

export async function checkEarthLab(): Promise<EarthGpuProbeReport> {
  const container = document.createElement('div')
  container.style.cssText = 'width:320px;height:200px;position:fixed;left:0;top:0'
  document.body.append(container)
  const errors: string[] = []
  const textures = await loadEarthTextures()
  const lab = new EarthCloudLab(container, () => {}, e => errors.push(e.message), textures, { autoStart: false })
  const report = { name: 'earth-lifecycle', checks: 0, maxError: 0, resourcesReleased: false, cloudyAlpha: { max: 0, mean: 0 }, defaultAlpha: { max: 0, mean: 0 }, liveBeforeDispose: { textures: 0, geometries: 0 }, liveAfterDispose: { textures: 0, geometries: 0 }, freshness: [] as string[] }
  const resources = [textures.surface, textures.clouds, textures.night, textures.specular, Reflect.get(lab, 'appearance').weather, Reflect.get(lab, 'appearance').color, Reflect.get(lab, 'geometry')]
  const disposals = resources.map(() => 0)
  resources.forEach((resource, i) => resource.addEventListener('dispose', () => disposals[i]++))
  const assert = (condition: boolean, label: string) => { if (!condition) throw new Error(label); report.checks++ }
  const render = () => { lab.renderFrame(1 / 60); assert(errors.length === 0, `Lab error: ${errors.join(';')}`); return lab.getStats() }
  const renderer = Reflect.get(lab, 'renderer') as WebGLRenderer
  const sample = (instance = lab, map = Reflect.get(instance, 'nearAerial').overlay.map) => {
    const renderer = Reflect.get(instance, 'renderer') as WebGLRenderer
    const target = new WebGLRenderTarget(16, 16, { type: HalfFloatType, depthBuffer: false })
    const geometry = new PlaneGeometry(2, 2)
    const material = new ShaderMaterial({ uniforms: { overlayMap: { value: map } }, vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}', fragmentShader: 'uniform sampler2D overlayMap; void main(){gl_FragColor=texture2D(overlayMap,gl_FragCoord.xy/vec2(16.,16.));}', depthTest: false, depthWrite: false })
    const scene = new Scene(); scene.add(new Mesh(geometry, material))
    const previous = renderer.getRenderTarget()
    try {
      renderer.setRenderTarget(target); renderer.render(scene, new Camera())
      const pixels = new Uint16Array(16 * 16 * 4)
      renderer.readRenderTargetPixels(target, 0, 0, 16, 16, pixels)
      return Array.from(pixels, DataUtils.fromHalfFloat)
    } finally { renderer.setRenderTarget(previous); target.dispose(); geometry.dispose(); material.dispose() }
  }
  try {
    lab.setView('orbit')
    const far = render(), stillFar = render()
    assert(far.cloudFrames === stillFar.cloudFrames && far.shadowFrames === stillFar.shadowFrames, 'Distant view ran volume')
    lab.setView('approach')
    const transition = render()
    assert(transition.cloudFrames - stillFar.cloudFrames === 1 && transition.shadowFrames - stillFar.shadowFrames === 1, 'Transition must update once')
    assert(transition.farFrames - stillFar.farFrames === 1 && transition.nearFrames - stillFar.nearFrames === 1 && transition.volumeWeight === .5 && transition.volumeState === 'ready', 'First transition not ready')
    for (const view of ['above', 'inside', 'below'] as const) {
      lab.setView(view)
      const before = lab.getStats(), after = render()
      assert(after.volumeWeight === 1 && after.farFrames === before.farFrames && after.nearFrames === before.nearFrames + 1, `${view} endpoint`)
    }
    lab.setView('above'); render()
    const defaultAlpha = sample().filter((_, i) => i % 4 === 3)
    report.defaultAlpha = { max: Math.max(...defaultAlpha), mean: defaultAlpha.reduce((a,b) => a+b,0) / defaultAlpha.length }
    const camera = Reflect.get(lab, 'camera') as PerspectiveCamera
    for (const [height, weight] of [[150000, 0], [70000, 1]]) {
      camera.position.set(0, 0, height)
      const before = lab.getStats(), after = render()
      assert(after.volumeWeight === weight, `Exact ${height}m threshold`)
      assert(weight === 0 ? after.cloudFrames === before.cloudFrames : after.farFrames === before.farFrames, 'Endpoint unnecessary work')
    }
    // Real-image cloudy patch: UV (.6875,.15625), 64px decoded coverage mean .978.
    const phi = .6875 * Math.PI * 2, theta = (1 - .15625) * Math.PI
    const direction = new Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta))
    lab.setPlanetRotation(new Quaternion().setFromUnitVectors(direction, new Vector3(0, 0, 1)))
    lab.setView('above')
    render()
    const overlay = Reflect.get(lab, 'nearAerial').overlay
    assert(overlay !== null, 'No published overlay')
    const pixels = sample()
    const alpha = pixels.filter((_, i) => i % 4 === 3)
    assert(Math.max(...alpha) > .05, `Known cloudy location invisible: max overlay alpha ${Math.max(...alpha)}`)
    report.cloudyAlpha = { max: Math.max(...alpha), mean: alpha.reduce((a,b) => a+b,0) / alpha.length }
    const cloudyRotation = new Quaternion().setFromUnitVectors(direction, new Vector3(0, 0, 1))
    const descriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
    try {
      const cases: [string, (instance: EarthCloudLab, element: HTMLElement) => void][] = [
        ['orbit-near', instance => instance.setView('above')],
        ['off-on', instance => { instance.setCloudsEnabled(false); instance.setCloudsEnabled(true) }],
        ['camera-cut', instance => instance.setView('inside')],
        ['Sun', instance => instance.setSunAngle(70)],
        ['rotation', instance => instance.setPlanetRotation(new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(), .4))],
        ['quality', instance => instance.setQuality('low')],
        ['CSS resize', (instance, element) => { element.style.width = '360px'; instance.resize() }],
        ['DPR', instance => { Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1.5 }); instance.resize() }]
      ]
      for (const [name, change] of cases) {
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 })
        container.style.width = '320px'; lab.resize()
        lab.setView('above'); lab.setQuality('medium'); lab.setSunAngle(35); lab.setPlanetRotation(cloudyRotation)
        render()
        if (name === 'orbit-near') { lab.setView('orbit'); render() }
        const referenceContainer = container.cloneNode() as HTMLElement
        document.body.append(referenceContainer)
        const referenceErrors: string[] = []
        const reference = new EarthCloudLab(referenceContainer, () => {}, e => referenceErrors.push(e.message), await loadEarthTextures(), { autoStart: false })
        try {
          reference.setView('above'); reference.setPlanetRotation(cloudyRotation)
          change(lab, container); change(reference, referenceContainer)
          // Pin all evolving noise inputs, not only the Bayer frame index.
          const referenceClouds = Reflect.get(reference, 'clouds')
          const actualClouds = Reflect.get(lab, 'clouds')
          actualClouds.shapeOffset.copy(referenceClouds.shapeOffset)
          actualClouds.shapeDetailOffset.copy(referenceClouds.shapeDetailOffset)
          actualClouds.localWeatherOffset.copy(referenceClouds.localWeatherOffset)
          for (const instance of [lab, reference]) {
            Reflect.set(Reflect.get(instance, 'clouds'), 'frame', 0)
            Reflect.set(instance, 'frames', 0)
          }
          const before = lab.getStats(); render(); reference.renderFrame(1 / 60)
          assert(referenceErrors.length === 0, `${name} reference error`)
          assert(lab.getStats().cloudFrames === before.cloudFrames + 1 && lab.getStats().shadowFrames === before.shadowFrames + 1, `${name} first update count`)
          const actual = sample(), expected = sample(reference)
          const error = Math.max(...actual.map((value,i) => Math.abs(value - expected[i])))
          report.maxError = Math.max(report.maxError, error)
          const rawActual = sample(lab, Reflect.get(Reflect.get(lab, 'clouds').cloudsPass, 'currentRenderTarget').texture)
          const rawExpected = sample(reference, Reflect.get(Reflect.get(reference, 'clouds').cloudsPass, 'currentRenderTarget').texture)
          const rawError = Math.max(...rawActual.map((v,i)=>Math.abs(v-rawExpected[i])))
          assert(error < .01, `${name} stale first frame max error ${error}; raw ${rawError}; resolved alpha ${Math.max(...actual.filter((_,i)=>i%4===3))}/${Math.max(...expected.filter((_,i)=>i%4===3))}`)
          const actualShadow = Reflect.get(lab, 'clouds').atmosphereShadow
          const expectedShadow = Reflect.get(reference, 'clouds').atmosphereShadow
          assert(Reflect.get(lab, 'materials').near.uniforms.earthShadowShadowBuffer.value === actualShadow.map, `${name} receiver stale descriptor`)
          assert(actualShadow.mapSize.equals(expectedShadow.mapSize) && actualShadow.far === expectedShadow.far, `${name} shadow layout differs`)
          assert(renderer.domElement.width === Math.floor(container.clientWidth * window.devicePixelRatio), `${name} actual drawing buffer size`)
          report.freshness.push(name)
        } finally { reference.dispose(); referenceContainer.remove() }
      }
    } finally {
      if (descriptor) Object.defineProperty(window, 'devicePixelRatio', descriptor)
      else Reflect.deleteProperty(window, 'devicePixelRatio')
    }
    lab.setCloudsEnabled(false)
    render()
    assert(Reflect.get(lab, 'nearAerial').overlay === null && Reflect.get(lab, 'materials').near.uniforms.earthShadowEnabled.value === false, 'Off retained attachments')
  } finally {
    report.liveBeforeDispose = { ...renderer.info.memory }
    lab.dispose(); lab.dispose()
    report.liveAfterDispose = { ...renderer.info.memory }
    report.resourcesReleased = disposals.every(count => count === 1)
    container.remove()
  }
  assert(report.resourcesReleased, 'Lab resource leak')
  for (const failure of ['preparation', 'shader', 'context'] as const) {
    const element = document.createElement('div'); element.style.cssText = container.style.cssText
    document.body.append(element)
    const sources = await loadEarthTextures()
    const counts = [0,0,0,0]
    ;[sources.surface,sources.clouds,sources.night,sources.specular].forEach((texture,i) => texture.addEventListener('dispose', () => counts[i]++))
    const messages: string[] = []
    const instance = new EarthCloudLab(element, () => {}, error => messages.push(error.message), sources, { autoStart: false, ...(failure === 'preparation' ? { prepareCloudMaps: () => { throw new Error('injected preparation failure') } } : {}) })
    const final = Reflect.get(Reflect.get(instance, 'composer'), 'finalComposer')
    final.passes.at(-1).renderToScreen = false
    const clouds = Reflect.get(instance, 'clouds')
    const material = failure === 'shader' ? Reflect.get(instance, 'materials').near : clouds?.cloudsPass.currentMaterial
    const original = material?.fragmentShader
    try {
      instance.setView('inside')
      if (failure === 'context') {
        const renderer = Reflect.get(instance, 'renderer') as WebGLRenderer
        renderer.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
        assert(messages.length === 1 && Reflect.get(instance, 'disposed'), 'Context loss did not stop controller/report error')
        const frames = instance.getStats().frames; instance.renderFrame(1/60)
        assert(instance.getStats().frames === frames, 'Context loss allowed further frames')
      } else {
        if (failure === 'shader') { material.fragmentShader = 'EARTH_TASK6_BAD_SHADER\n' + original; material.needsUpdate = true }
        instance.renderFrame(1/60)
        const failed = instance.getStats()
        assert(messages.length === 0 && failed.volumeState === 'unavailable' && failed.volumeWeight === 0, `${failure} not recoverable`)
        assert(failure === 'shader' ? failed.volumeMessage!.includes('EARTH_TASK6_BAD_SHADER') : failed.cloudFrames === 0 && failed.volumeMessage!.includes('injected preparation failure'), `${failure} wrong diagnostic`)
        assert(Reflect.get(instance, 'nearAerial').overlay === null && !Reflect.get(instance, 'materials').near.uniforms.earthShadowEnabled.value, `${failure} retained attachments`)
        const on = sample(instance, final.inputBuffer.texture)
        instance.setCloudsEnabled(false); instance.renderFrame(1/60)
        const off = sample(instance, final.inputBuffer.texture)
        assert(on.some((value,i) => Math.abs(value-off[i]) > .01), `${failure} far map toggle had no pixel effect`)
        instance.setSunAngle(150); instance.renderFrame(1/60)
        const night = sample(instance, final.inputBuffer.texture)
        assert(off.some((value,i) => Math.abs(value-night[i]) > .01), `${failure} Sun stopped changing pixels`)
        instance.setView('orbit'); instance.renderFrame(1/60)
        const orbit = sample(instance, final.inputBuffer.texture)
        assert(night.some((value,i) => Math.abs(value-orbit[i]) > .01), `${failure} view stopped changing pixels`)
        assert(instance.getStats().cloudFrames === failed.cloudFrames, `${failure} retried volume`)
      }
    } finally {
      if (material) { material.fragmentShader = original; material.needsUpdate = true }
      instance.dispose(); instance.dispose(); element.remove()
    }
    assert(counts.every(count => count === 1), `${failure} source disposal count ${counts}`)
  }
  return report
}
