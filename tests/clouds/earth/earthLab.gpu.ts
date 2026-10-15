import {
  Camera,
  Scene,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  WebGLRenderTarget,
  HalfFloatType,
  DataUtils,
  Quaternion,
  Vector3,
  type PerspectiveCamera,
  type WebGLRenderer
} from 'three'
import { EarthCloudLab } from '@/labs/earth-clouds/EarthCloudLab'
import { loadEarthTextures } from '@/labs/earth-clouds/earthAssets'
import type { EarthGpuProbeReport } from './gpuTestHarness'

export async function checkEarthLab(): Promise<EarthGpuProbeReport> {
  const container = document.createElement('div')
  container.style.cssText = 'width:320px;height:200px;position:fixed;left:0;top:0'
  document.body.append(container)
  const errors: string[] = []
  const acquisition: (() => void)[] = []
  let cleanupStarted = false
  try {
    const textures = await loadEarthTextures()
    acquisition.push(() => textures.dispose())
    const originals = [textures.surface, textures.clouds, textures.night, textures.specular]
    const sourceState = originals.map((texture) => ({
      colorSpace: texture.colorSpace,
      flipY: texture.flipY,
      wrapS: texture.wrapS,
      wrapT: texture.wrapT,
      image: texture.image
    }))
    acquisition.length = 0 // Constructor takes texture ownership, including failure.
    const lab = new EarthCloudLab(
      container,
      () => {},
      (e) => errors.push(e.message),
      textures,
      { autoStart: false }
    )
    acquisition.push(() => lab.dispose())
    const report = {
      name: 'earth-lifecycle',
      checks: 0,
      maxError: 0,
      resourcesReleased: false,
      cloudyAlpha: { max: 0, mean: 0 },
      defaultAlpha: { max: 0, mean: 0 },
      liveBeforeDispose: { textures: 0, geometries: 0 },
      liveAfterDispose: { textures: 0, geometries: 0 },
      freshness: [] as string[],
      firstFrames: [] as {
        name: string
        resolved: number
        raw: number
        shadowResolved: number
        shadowRaw: number
        actualShadowMax: number
        freshShadowMax: number
      }[]
    }
    const resources = [
      textures.surface,
      textures.clouds,
      textures.night,
      textures.specular,
      Reflect.get(lab, 'appearance').weather,
      Reflect.get(lab, 'appearance').color,
      Reflect.get(lab, 'geometry')
    ].filter((resource) => resource !== null)
    const originalResourceCount = resources.length
    const disposals = resources.map(() => 0)
    resources.forEach((resource, i) => resource.addEventListener('dispose', () => disposals[i]++))
    const assert = (condition: boolean, label: string) => {
      if (!condition) throw new Error(label)
      report.checks++
    }
    const render = () => {
      lab.renderFrame(1 / 60)
      assert(errors.length === 0, `Lab error: ${errors.join(';')}`)
      return lab.getStats()
    }
    const renderer = Reflect.get(lab, 'renderer') as WebGLRenderer
    const assertWhiteScattering = () => {
      const clouds = Reflect.get(lab, 'clouds')
      const uniforms = clouds.cloudsPass.currentMaterial.uniforms
      assert(uniforms.cloudUseColorMap.value === false, 'Default Earth still uses color map')
      assert(uniforms.cloudConstantColor.value.equals(new Vector3(1, 1, 1)), 'Default Earth is not neutral white')
      assert(uniforms.cloudColorStrength.value === 1, 'Default Earth color strength')
      assert(clouds.powderScale === 0, 'Earth powder darkening enabled')
    }
    assertWhiteScattering()
    for (const quality of ['low', 'high', 'medium'] as const) {
      lab.setQuality(quality)
      assertWhiteScattering()
    }
    const deletedHandles = new Map<object, number>()
    const restoreDeletes: (() => void)[] = []
    const targetLabels: string[] = []
    const sample = (
      instance = lab,
      map = Reflect.get(instance, 'nearAerial').overlay.map,
      kind = '2D',
      slice = 0.5
    ) => {
      const renderer = Reflect.get(instance, 'renderer') as WebGLRenderer
      const target = new WebGLRenderTarget(16, 16, { type: HalfFloatType, depthBuffer: false })
      const geometry = new PlaneGeometry(2, 2)
      const material = new ShaderMaterial({
        uniforms: { overlayMap: { value: map } },
        vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}',
        fragmentShader:
          kind === '2D'
            ? 'uniform sampler2D overlayMap; void main(){gl_FragColor=texture2D(overlayMap,gl_FragCoord.xy/vec2(16.,16.));}'
            : 'precision highp sampler' +
              kind +
              '; uniform sampler' +
              kind +
              ' overlayMap; void main(){gl_FragColor=texture(overlayMap,vec3(gl_FragCoord.xy/vec2(16.,16.),' +
              (kind === '3D' ? String(slice) : '0.') +
              '));}',
        depthTest: false,
        depthWrite: false
      })
      const scene = new Scene()
      scene.add(new Mesh(geometry, material))
      const previous = renderer.getRenderTarget()
      try {
        renderer.setRenderTarget(target)
        renderer.render(scene, new Camera())
        const pixels = new Uint16Array(16 * 16 * 4)
        renderer.readRenderTargetPixels(target, 0, 0, 16, 16, pixels)
        return Array.from(pixels, DataUtils.fromHalfFloat)
      } finally {
        renderer.setRenderTarget(previous)
        target.dispose()
        geometry.dispose()
        material.dispose()
      }
    }
    try {
      lab.setView('orbit')
      const far = render(),
        stillFar = render()
      assert(
        far.cloudFrames === stillFar.cloudFrames && far.shadowFrames === stillFar.shadowFrames,
        'Distant view ran volume'
      )
      lab.setView('approach')
      const transition = render()
      assert(
        transition.cloudFrames - stillFar.cloudFrames === 1 && transition.shadowFrames - stillFar.shadowFrames === 1,
        'Transition must update once'
      )
      assert(
        transition.farFrames - stillFar.farFrames === 1 &&
          transition.nearFrames - stillFar.nearFrames === 1 &&
          transition.volumeWeight === 0.5 &&
          transition.volumeState === 'ready',
        'First transition not ready'
      )
      for (const view of ['above', 'inside', 'below'] as const) {
        lab.setView(view)
        const before = lab.getStats(),
          after = render()
        assert(
          after.volumeWeight === 1 &&
            after.farFrames === before.farFrames &&
            after.nearFrames === before.nearFrames + 1,
          `${view} endpoint`
        )
      }
      lab.setView('above')
      render()
      const defaultAlpha = sample().filter((_, i) => i % 4 === 3)
      report.defaultAlpha = {
        max: Math.max(...defaultAlpha),
        mean: defaultAlpha.reduce((a, b) => a + b, 0) / defaultAlpha.length
      }
      const noiseStats = []
      for (const key of ['shapeTexture', 'shapeDetailTexture'])
        for (const slice of [0.1, 0.5, 0.9]) {
          const map = Reflect.get(lab, 'clouds').cloudsPass.currentMaterial.uniforms[key].value
          const values = sample(lab, map, '3D', slice).filter((_, i) => i % 4 === 0)
          const mean = values.reduce((sum, value) => sum + value, 0) / values.length
          const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
          const min = Math.min(...values),
            max = Math.max(...values)
          assert(
            deviation > 0.005 && max - min > 0.02,
            `${key} slice ${slice} is constant/uninitialized: ${min}/${max}/${deviation}`
          )
          noiseStats.push({ key, slice, min, max, mean, deviation })
        }
      Object.assign(report, { noiseStats })
      const camera = Reflect.get(lab, 'camera') as PerspectiveCamera
      for (const [height, weight] of [
        [150000, 0],
        [70000, 1]
      ]) {
        camera.position.set(0, 0, height)
        const before = lab.getStats(),
          after = render()
        assert(after.volumeWeight === weight, `Exact ${height}m threshold`)
        assert(
          weight === 0 ? after.cloudFrames === before.cloudFrames : after.farFrames === before.farFrames,
          'Endpoint unnecessary work'
        )
      }
      // Real-image cloudy patch: UV (.6875,.15625), 64px decoded coverage mean .978.
      const phi = 0.6875 * Math.PI * 2,
        theta = (1 - 0.15625) * Math.PI
      const direction = new Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta))
      lab.setPlanetRotation(new Quaternion().setFromUnitVectors(direction, new Vector3(0, 0, 1)))
      lab.setView('above')
      render()
      const overlay = Reflect.get(lab, 'nearAerial').overlay
      assert(overlay !== null, 'No published overlay')
      const pixels = sample()
      const alpha = pixels.filter((_, i) => i % 4 === 3)
      assert(Math.max(...alpha) > 0.05, `Known cloudy location invisible: max overlay alpha ${Math.max(...alpha)}`)
      report.cloudyAlpha = { max: Math.max(...alpha), mean: alpha.reduce((a, b) => a + b, 0) / alpha.length }
      const cloudyRotation = new Quaternion().setFromUnitVectors(direction, new Vector3(0, 0, 1))
      const descriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
      try {
        const cases: [string, (instance: EarthCloudLab, element: HTMLElement) => void][] = [
          ['orbit-near', (instance) => instance.setView('above')],
          [
            'off-on',
            (instance) => {
              instance.setCloudsEnabled(false)
              instance.setCloudsEnabled(true)
            }
          ],
          [
            'off-on-between-frames',
            (instance) => {
              instance.setCloudsEnabled(false)
              instance.setCloudsEnabled(true)
            }
          ],
          ['camera-cut', (instance) => instance.setView('inside')],
          ['Sun', (instance) => instance.setSunAngle(70)],
          [
            'rotation',
            (instance) =>
              instance.setPlanetRotation(new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.4))
          ],
          ['quality', (instance) => instance.setQuality('low')],
          [
            'CSS resize',
            (instance, element) => {
              element.style.width = '360px'
              instance.resize()
            }
          ],
          [
            'DPR',
            (instance) => {
              Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1.5 })
              instance.resize()
            }
          ]
        ]
        for (const [name, change] of cases) {
          Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 })
          container.style.width = '320px'
          lab.resize()
          lab.setView('above')
          lab.setQuality('medium')
          lab.setSunAngle(35)
          lab.setPlanetRotation(cloudyRotation)
          render()
          if (name === 'orbit-near') {
            lab.setView('orbit')
            render()
            assert(
              Reflect.get(lab, 'nearAerial').overlay === null &&
                !Reflect.get(lab, 'materials').near.uniforms.earthShadowEnabled.value,
              'Orbit retained old attachments'
            )
          }
          if (name === 'off-on') {
            lab.setCloudsEnabled(false)
            render()
            assert(Reflect.get(lab, 'nearAerial').overlay === null, 'Off frame retained overlay')
          }
          const referenceContainer = container.cloneNode() as HTMLElement
          document.body.append(referenceContainer)
          const referenceErrors: string[] = []
          let reference: EarthCloudLab | undefined
          try {
            reference = new EarthCloudLab(
              referenceContainer,
              () => {},
              (e) => referenceErrors.push(e.message),
              await loadEarthTextures(),
              { autoStart: false }
            )
            reference.setView('above')
            reference.setPlanetRotation(cloudyRotation)
            change(lab, container)
            change(reference, referenceContainer)
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
            const before = lab.getStats()
            render()
            reference.renderFrame(1 / 60)
            assert(referenceErrors.length === 0, `${name} reference error`)
            assert(
              lab.getStats().cloudFrames === before.cloudFrames + 1 &&
                lab.getStats().shadowFrames === before.shadowFrames + 1,
              `${name} first update count`
            )
            const actual = sample(),
              expected = sample(reference)
            const error = Math.max(...actual.map((value, i) => Math.abs(value - expected[i])))
            report.maxError = Math.max(report.maxError, error)
            const rawActual = sample(
              lab,
              Reflect.get(Reflect.get(lab, 'clouds').cloudsPass, 'currentRenderTarget').texture
            )
            const rawExpected = sample(
              reference,
              Reflect.get(Reflect.get(reference, 'clouds').cloudsPass, 'currentRenderTarget').texture
            )
            const rawError = Math.max(...rawActual.map((v, i) => Math.abs(v - rawExpected[i])))
            const shadowRawA = sample(lab, actualClouds.shadowPass.currentRenderTarget.texture, '2DArray'),
              shadowRawB = sample(reference, referenceClouds.shadowPass.currentRenderTarget.texture, '2DArray')
            const shadowRawError = Math.max(...shadowRawA.map((v, i) => Math.abs(v - shadowRawB[i])))
            const publishedShadowA = sample(lab, actualClouds.atmosphereShadow.map, '2DArray')
            const publishedShadowB = sample(reference, referenceClouds.atmosphereShadow.map, '2DArray')
            const publishedShadowError = Math.max(...publishedShadowA.map((v, i) => Math.abs(v - publishedShadowB[i])))
            assert(
              Number.isFinite(shadowRawError) && shadowRawError < 0.01,
              `${name} raw shadow differs: ${shadowRawError}`
            )
            assert(Math.max(...shadowRawA) > 0 && Math.max(...shadowRawB) > 0, `${name} cloudy raw shadow is empty`)
            assert(
              Number.isFinite(publishedShadowError) && publishedShadowError < 0.01 && Math.max(...publishedShadowB) > 0,
              `${name} published shadow differs/empty: ${publishedShadowError}`
            )
            report.firstFrames.push({
              shadowResolved: publishedShadowError,
              name,
              resolved: error,
              raw: rawError,
              shadowRaw: shadowRawError,
              actualShadowMax: Math.max(...shadowRawA),
              freshShadowMax: Math.max(...shadowRawB)
            })
            assert(
              error < 0.01,
              `${name} stale first frame: resolved=${error}, raw=${rawError}, shadow=${shadowRawError}; shadow maxima=${Math.max(...shadowRawA)}/${Math.max(...shadowRawB)}`
            )
            const actualShadow = Reflect.get(lab, 'clouds').atmosphereShadow
            const expectedShadow = Reflect.get(reference, 'clouds').atmosphereShadow
            assert(
              Reflect.get(lab, 'materials').near.uniforms.earthShadowShadowBuffer.value === actualShadow.map,
              `${name} receiver stale descriptor`
            )
            assert(
              actualShadow.mapSize.equals(expectedShadow.mapSize) && actualShadow.far === expectedShadow.far,
              `${name} shadow layout differs`
            )
            assert(
              renderer.domElement.width === Math.floor(container.clientWidth * window.devicePixelRatio),
              `${name} actual drawing buffer size`
            )
            report.freshness.push(name)
          } finally {
            reference?.dispose()
            referenceContainer.remove()
          }
        }
      } finally {
        if (descriptor) Object.defineProperty(window, 'devicePixelRatio', descriptor)
        else Reflect.deleteProperty(window, 'devicePixelRatio')
      }
      lab.setCloudsEnabled(false)
      render()
      assert(
        Reflect.get(lab, 'nearAerial').overlay === null &&
          Reflect.get(lab, 'materials').near.uniforms.earthShadowEnabled.value === false,
        'Off retained attachments'
      )
      originals.forEach((texture, i) =>
        assert(
          texture.colorSpace === sourceState[i].colorSpace &&
            texture.flipY === sourceState[i].flipY &&
            texture.wrapS === sourceState[i].wrapS &&
            texture.wrapT === sourceState[i].wrapT &&
            texture.image === sourceState[i].image,
          'Borrowed source mutated'
        )
      )
      const ownedTargets = new Set<WebGLRenderTarget>()
      const clouds = Reflect.get(lab, 'clouds')
      for (const pass of [clouds.cloudsPass, clouds.shadowPass])
        for (const key of ['currentRenderTarget', 'resolveRenderTarget', 'historyRenderTarget'])
          if (Reflect.get(pass, key)) ownedTargets.add(Reflect.get(pass, key))
      for (const key of ['farComposer', 'nearComposer', 'finalComposer']) {
        const composer = Reflect.get(Reflect.get(lab, 'composer'), key)
        ownedTargets.add(composer.inputBuffer)
        ownedTargets.add(composer.outputBuffer)
      }
      for (const target of ownedTargets) {
        targetLabels.push(target.texture.name)
        resources.push(target)
        disposals.push(0)
        const index = disposals.length - 1
        target.addEventListener('dispose', () => disposals[index]++)
      }
      const gl = renderer.getContext()
      for (const method of ['deleteTexture', 'deleteFramebuffer', 'deleteRenderbuffer'] as const) {
        const original = gl[method]
        Reflect.set(gl, method, function (resource: object | null) {
          if (resource) deletedHandles.set(resource, (deletedHandles.get(resource) ?? 0) + 1)
          return Reflect.apply(original, gl, [resource])
        })
        restoreDeletes.push(() => Reflect.set(gl, method, original))
      }
    } finally {
      cleanupStarted = true
      report.liveBeforeDispose = { ...renderer.info.memory }
      lab.dispose()
      const released = Array.from(deletedHandles.values()).reduce((a, b) => a + b, 0)
      lab.dispose()
      assert(
        released === Array.from(deletedHandles.values()).reduce((a, b) => a + b, 0),
        'Repeated lab disposal released resources again'
      )
      report.liveAfterDispose = { ...renderer.info.memory }
      // postprocessing calls inputBuffer.dispose once more while detaching its
      // depth texture after deallocation. Count actual WebGL handle deletions.
      report.resourcesReleased =
        disposals.slice(0, originalResourceCount).every((count) => count === 1) &&
        disposals.slice(originalResourceCount).every((count) => count >= 1) &&
        Array.from(deletedHandles.values()).every((count) => count === 1) &&
        deletedHandles.size > 0 &&
        renderer.info.memory.textures === 0
      Object.assign(report, {
        targetDisposals: targetLabels.map((name, i) => ({ name, events: disposals[i + originalResourceCount] })),
        deletedGpuHandles: deletedHandles.size
      })
      restoreDeletes.forEach((restore) => restore())
      container.remove()
    }
    assert(
      report.resourcesReleased,
      `Lab disposal counts ${JSON.stringify(resources.map((resource, i) => [resource.texture?.name ?? resource.name ?? resource.type, disposals[i]]))}`
    )
    // Disable exactly the local target preparation; a brand-new real pass must now
    // reveal Takram's empty first-draw shadow attachments, without a reference warm-up.
    const mutationContainer = document.createElement('div')
    mutationContainer.style.cssText = 'width:320px;height:200px;position:fixed'
    document.body.append(mutationContainer)
    let acquiredMutation: EarthCloudLab | undefined
    try {
      const mutationErrors: string[] = []
      const mutation = new EarthCloudLab(
        mutationContainer,
        () => {},
        (error) => mutationErrors.push(error.message),
        await loadEarthTextures(),
        { autoStart: false }
      )
      acquiredMutation = mutation
      const mutationRenderer = Reflect.get(mutation, 'renderer') as WebGLRenderer
      const initTarget = mutationRenderer.initRenderTarget
      try {
        mutation.setPlanetRotation(cloudyRotationForProbe())
        mutation.setView('above')
        mutationRenderer.initRenderTarget = () => {}
        mutation.renderFrame(1 / 60)
        const shadow = sample(
          mutation,
          Reflect.get(mutation, 'clouds').shadowPass.currentRenderTarget.texture,
          '2DArray'
        )
        assert(
          mutationErrors.length === 0 && shadow.every((value) => value === 0),
          'First-frame target initialization negative control escaped'
        )
      } finally {
        mutationRenderer.initRenderTarget = initTarget
        mutation.dispose()
        mutationContainer.remove()
      }
    } finally {
      acquiredMutation?.dispose()
      mutationContainer.remove()
    }
    for (const failure of ['preparation', 'shader', 'context'] as const) {
      const element = document.createElement('div')
      element.style.cssText = container.style.cssText
      document.body.append(element)
      let acquiredInstance: EarthCloudLab | undefined
      try {
        const sources = await loadEarthTextures()
        const counts = [0, 0, 0, 0]
        ;[sources.surface, sources.clouds, sources.night, sources.specular].forEach((texture, i) =>
          texture.addEventListener('dispose', () => counts[i]++)
        )
        const messages: string[] = []
        const instance = new EarthCloudLab(
          element,
          () => {},
          (error) => messages.push(error.message),
          sources,
          {
            autoStart: failure === 'context',
            ...(failure === 'preparation'
              ? {
                  prepareCloudMaps: () => {
                    throw new Error('injected preparation failure')
                  }
                }
              : {})
          }
        )
        acquiredInstance = instance
        const final = Reflect.get(Reflect.get(instance, 'composer'), 'finalComposer')
        final.passes.at(-1).renderToScreen = false
        const clouds = Reflect.get(instance, 'clouds')
        const material =
          failure === 'shader' ? Reflect.get(instance, 'materials').near : clouds?.cloudsPass.currentMaterial
        const original = material?.fragmentShader
        try {
          instance.setView('inside')
          if (failure === 'context') {
            const renderer = Reflect.get(instance, 'renderer') as WebGLRenderer
            const pending = Reflect.get(instance, 'frameRequest') as number
            const cancelled: number[] = []
            const cancel = window.cancelAnimationFrame
            try {
              window.cancelAnimationFrame = (handle) => {
                cancelled.push(handle)
                cancel.call(window, handle)
              }
              renderer.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
              assert(pending > 0 && cancelled.includes(pending), 'Context loss did not cancel the real pending RAF')
            } finally {
              window.cancelAnimationFrame = cancel
            }
            assert(
              messages.length === 1 && Reflect.get(instance, 'disposed'),
              'Context loss did not stop controller/report error'
            )
            const frames = instance.getStats().frames
            instance.renderFrame(1 / 60)
            await new Promise(requestAnimationFrame)
            assert(instance.getStats().frames === frames, 'Context loss allowed further frames')
          } else {
            if (failure === 'shader') {
              material.fragmentShader = 'EARTH_TASK6_BAD_SHADER\n' + original
              material.needsUpdate = true
            }
            instance.renderFrame(1 / 60)
            const failed = instance.getStats()
            assert(
              messages.length === 0 && failed.volumeState === 'unavailable' && failed.volumeWeight === 0,
              `${failure} not recoverable`
            )
            assert(
              failure === 'shader'
                ? failed.volumeMessage!.includes('EARTH_TASK6_BAD_SHADER')
                : failed.cloudFrames === 0 && failed.volumeMessage!.includes('injected preparation failure'),
              `${failure} wrong diagnostic`
            )
            assert(
              Reflect.get(instance, 'nearAerial').overlay === null &&
                !Reflect.get(instance, 'materials').near.uniforms.earthShadowEnabled.value,
              `${failure} retained attachments`
            )
            const on = sample(instance, final.inputBuffer.texture)
            instance.setCloudsEnabled(false)
            instance.renderFrame(1 / 60)
            const off = sample(instance, final.inputBuffer.texture)
            assert(
              on.some((value, i) => Math.abs(value - off[i]) > 0.01),
              `${failure} far map toggle had no pixel effect`
            )
            instance.setSunAngle(150)
            instance.renderFrame(1 / 60)
            const night = sample(instance, final.inputBuffer.texture)
            assert(
              off.some((value, i) => Math.abs(value - night[i]) > 0.01),
              `${failure} Sun stopped changing pixels`
            )
            instance.setSunAngle(35)
            instance.renderFrame(1 / 60)
            const illuminated = sample(instance, final.inputBuffer.texture)
            instance.setView('orbit')
            instance.renderFrame(1 / 60)
            const orbit = sample(instance, final.inputBuffer.texture)
            assert(
              illuminated.some((value, i) => Math.abs(value - orbit[i]) > 0.01),
              `${failure} view stopped changing pixels`
            )
            assert(instance.getStats().cloudFrames === failed.cloudFrames, `${failure} retried volume`)
          }
        } finally {
          if (material) {
            material.fragmentShader = original
            material.needsUpdate = true
          }
          instance.dispose()
          instance.dispose()
          element.remove()
        }
        assert(
          counts.every((count) => count === 1),
          `${failure} source disposal count ${counts}`
        )
        assert(Reflect.get(instance, 'renderer').info.memory.textures === 0, `${failure} retained live textures`)
      } finally {
        acquiredInstance?.dispose()
        element.remove()
      }
    }
    return report
  } finally {
    try {
      if (!cleanupStarted) for (const release of acquisition.reverse()) release()
    } finally {
      container.remove()
    }
  }
}

function cloudyRotationForProbe() {
  const phi = 0.6875 * Math.PI * 2,
    theta = (1 - 0.15625) * Math.PI
  return new Quaternion().setFromUnitVectors(
    new Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)),
    new Vector3(0, 0, 1)
  )
}
