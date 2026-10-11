import {
  BasicDepthPacking,
  HalfFloatType,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderer
} from 'three'
import { DepthCopyPass, EffectComposer, RenderPass, ShaderPass } from 'postprocessing'
import type { Actor } from '@/core/models/Actor'
import { BlackHole } from '@/core/renderables/BlackHole/BlackHole'
import { BlackHolePass } from '@/core/graphic/passes/BlackHolePass'
import { LensRegistry } from '@/core/services/LensRegistry'
import type { ResourceObserver } from '@/core/services/ResourceObserver'

/** GPU-регрессия: запуск из браузера через Vite, инструкция — в хендоффе линзы. */
export function checkBlackHoleInsideDepth(multisampling: number = 0): {
  multisampling: number
  directPixels: number
  strayDirectPixels: number
  lensedPixels: number
  foregroundPixels: number
  outwardDepth: number
  offAxisPixels: number
} {
  const width = 640, height = 360
  const renderer = new WebGLRenderer({ logarithmicDepthBuffer: true, preserveDrawingBuffer: true })
  renderer.setSize(width, height)
  const actor = {
    physicalObject: {
      getAttribute: (key: string, fallback?: unknown): unknown => key === 'mass' ? 8.54e36 : fallback
    },
    renderingObject: null,
    getAttribute: (_key: string, fallback?: unknown): unknown => fallback
  } as unknown as Actor
  const registry = new LensRegistry()
  const hole = new BlackHole(actor, { sceneBackground: null } as unknown as ResourceObserver, registry)
  const rs = hole.parameters.rsVisualUnits
  const scene = new Scene()
  const camera = new PerspectiveCamera(50, width / height, 0.001, 1e10)
  camera.position.set(0, 0, 18 * rs)
  camera.lookAt(new Vector3())
  const planet = new Mesh(new SphereGeometry(0.45 * rs, 32, 16), new MeshBasicMaterial({ color: 0xff2020 }))
  planet.position.set(3.5 * rs, 0, -3 * rs)
  scene.add(hole, planet)
  const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling })
  composer.addPass(new RenderPass(scene, camera))
  const lens = new BlackHolePass(camera, registry)
  composer.addPass(lens)
  // Небо чёрное независимо от текущей экспозиции и загруженных тайлов.
  for (const material of [hole.material, lens.skyLayer.material]) {
    if (material.uniforms.uGaiaExposure) material.uniforms.uGaiaExposure = { value: 0 }
  }
  const outputDepth = new DepthCopyPass({ depthPacking: BasicDepthPacking })
  composer.addPass(outputDepth)
  const display = new ShaderMaterial({
    uniforms: { inputBuffer: { value: null }, depthBuffer: { value: outputDepth.texture }, showDepth: { value: false } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: 'uniform sampler2D inputBuffer; uniform sampler2D depthBuffer; uniform bool showDepth; varying vec2 vUv; void main(){gl_FragColor=showDepth?vec4(vec3(texture2D(depthBuffer,vUv).r),1.):texture2D(inputBuffer,vUv);}',
    depthTest: false,
    depthWrite: false
  })
  composer.addPass(new ShaderPass(display))
  composer.setSize(width, height)
  const gl = renderer.getContext()
  const render = (visible: boolean, depthTest: boolean): Uint8Array => {
    hole.visible = visible
    hole.material.depthTest = depthTest
    scene.updateMatrixWorld(true)
    camera.updateMatrixWorld(true)
    composer.render(0)
    const pixels = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Ошибка WebGL в пробе глубины линзы')
    return pixels
  }
  const red = (image: Uint8Array, i: number): boolean => image[i] > 64 && image[i] > image[i + 1] * 2
  try {
    const direct = render(false, true)
    const lensed = render(true, true)
    // Для заднего тела полная перерисовка — эталон отсутствия прямой копии.
    const unoccluded = render(true, false)
    let directPixels = 0, strayDirectPixels = 0, lensedPixels = 0
    for (let i = 0; i < direct.length; i += 4) {
      if (red(direct, i)) {
        directPixels++
        if (!red(unoccluded, i) && red(lensed, i)) strayDirectPixels++
      }
      if (red(lensed, i)) lensedPixels++
    }
    if (directPixels < 100 || lensedPixels < 100) throw new Error('Пропало тестовое тело или его лензированный образ')
    if (strayDirectPixels !== 0) throw new Error(`Остаток прямого изображения: ${strayDirectPixels} пикселей`)

    planet.position.z = 8 * rs
    const foreground = render(false, true)
    const foregroundLensed = render(true, true)
    let foregroundPixels = 0
    for (let i = 0; i < foreground.length; i += 4) {
      if (red(foreground, i)) {
        foregroundPixels++
        if (!red(foregroundLensed, i)) throw new Error('Линза закрыла тело перед плоскостью сближения')
      }
    }
    if (foregroundPixels < 100) throw new Error('Переднее тело не попало в кадр')
    camera.lookAt(0, 0, 100 * rs)
    planet.position.set(0, 0, 22 * rs)
    display.uniforms.showDepth.value = true
    const depthWithoutLens = render(false, true)
    const depthWithLens = render(true, true)
    const center = ((height / 2) * width + width / 2) * 4
    const outwardDepth = depthWithLens[center]
    if (depthWithoutLens[center] < 10 || Math.abs(outwardDepth - depthWithoutLens[center]) > 1) {
      throw new Error(`Потеря глубины поверхности при взгляде от дыры: ${depthWithoutLens[center]} → ${outwardDepth}`)
    }
    display.uniforms.showDepth.value = false
    camera.position.set(7.9704 * rs, 0, 0.688 * rs)
    camera.lookAt(8 * rs, 0, 0)
    camera.fov = 20
    camera.updateProjectionMatrix()
    planet.position.set(8 * rs, 0, 0)
    planet.scale.setScalar(0.005 / 0.45)
    const offAxis = render(true, true)
    let offAxisPixels = 0
    for (let i = 0; i < offAxis.length; i += 4) if (red(offAxis, i)) offAxisPixels++
    if (offAxisPixels < 10) throw new Error('Исчез лензированный образ при косом взгляде внутри сферы')
    return { multisampling, directPixels, strayDirectPixels, lensedPixels, foregroundPixels, outwardDepth, offAxisPixels }
  } finally {
    composer.dispose()
    hole.dispose()
    hole.material.dispose()
    hole.geometry.dispose()
    planet.material.dispose()
    planet.geometry.dispose()
    display.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
