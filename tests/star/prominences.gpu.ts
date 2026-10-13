import {
  DataUtils, HalfFloatType, Mesh, NoBlending, PerspectiveCamera, PlaneGeometry,
  Scene, ShaderChunk, ShaderMaterial, Uniform, UniformsUtils, Vector3,
  WebGLRenderer, WebGLRenderTarget
} from 'three'
import type { Actor } from '@/core/models/Actor'
import { Star } from '@/core/renderables/Star'
import { StarOuterLayer } from '@/core/renderables/utils/StarOuterLayer'
import { buildProminenceGeometry } from '@/core/renderables/utils/prominenceGeometry'
import { StarOuterLayerShaderTemplate } from '@/core/materials/shaders/lib/StarOuterLayerShaderTemplate'
import { toThreeJSUnits } from '@/core/helpers/scaling'

const actor = (activity: number): Actor => ({
  getAttribute: (_key: string, fallback?: unknown): unknown => fallback,
  physicalObject: { getAttribute: (key: string): number => key === 'radius' ? 696000 : 5778 },
  renderingObject: { getAttribute: (): object => ({ activity }) }
}) as unknown as Actor

/**
 * Реальный fragment shader: профиль краёв. Реальные ленты: непрерывность
 * activity и дробного LOD. Полный слой со сферой: фактические draw calls и
 * треугольники, включая отсутствие лент возле переключения импостора.
 * await import('/tests/star/prominences.gpu.ts').then(m => m.checkStarProminences())
 */
export function checkStarProminences(): { results: Record<string, number | string>[] } {
  const renderer = new WebGLRenderer({ logarithmicDepthBuffer: true })
  renderer.setClearColor(0, 0)
  renderer.setSize(256, 256)
  const scene = new Scene()
  const camera = new PerspectiveCamera(50, 1, 0.000001, 1e9)
  const radius = toThreeJSUnits(696000)
  camera.position.z = 3 * radius
  const target = new WebGLRenderTarget(256, 256, {
    type: HalfFloatType, samples: Math.min(8, renderer.capabilities.maxSamples)
  })
  const results: Record<string, number | string>[] = []
  const shaderErrors: string[] = []
  renderer.debug.onShaderError = (gl, program, vertex, fragment): void => {
    shaderErrors.push(gl.getProgramInfoLog(program) ?? '', gl.getShaderInfoLog(vertex) ?? '', gl.getShaderInfoLog(fragment) ?? '')
  }
  const require = (condition: boolean, message: string): void => {
    if (!condition) throw new Error(`Prominences: ${message}`)
  }
  const capture = (): { energy: number; alpha: number; triangles: number; calls: number } => {
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const { triangles, calls } = renderer.info.render
    renderer.setRenderTarget(null)
    const half = new Uint16Array(256 * 256 * 4)
    renderer.readRenderTargetPixels(target, 0, 0, 256, 256, half)
    const glError = renderer.getContext().getError()
    require(!glError && !shaderErrors.length, `WebGL ${glError}: ${shaderErrors.join('\n')}`)
    let energy = 0, alpha = 0
    for (let i = 0; i < half.length; i++) {
      const value = DataUtils.fromHalfFloat(half[i])
      require(Number.isFinite(value) && value >= 0, `invalid HDR value ${value}`)
      if (i % 4 === 3) alpha += value
      else energy += value
    }
    return { energy, alpha, triangles, calls }
  }
  // Две симметричные ленты без взаимного перекрытия: независимый эталон
  // линейного гашения. Production vertex/fragment shaders и материал.
  const makePair = (activity: number): StarOuterLayer => {
    const layer = new StarOuterLayer(actor(activity), renderer)
    layer.geometry.dispose()
    layer.geometry = buildProminenceGeometry({ ribbonCount: 2 })
    const a = layer.geometry.getAttribute('aFootA')
    const b = layer.geometry.getAttribute('aFootB')
    const random = layer.geometry.getAttribute('aRibbonRandom')
    for (let i = 0; i < a.count; i++) {
      const first = i < a.count / 2
      const footA = new Vector3(first ? -0.5 : 0.1, 0, 1).normalize()
      const footB = new Vector3(first ? -0.1 : 0.5, 0, 1).normalize()
      a.setXYZ(i, footA.x, footA.y, footA.z)
      b.setXYZ(i, footB.x, footB.y, footB.z)
      random.setXYZ(i, 0.5, 0.5, 0.5)
    }
    layer.material.uniforms.uNoiseAmplitude.value = 0
    layer.material.uniforms.uWidthFraction.value = 0.015
    layer.material.uniforms.uVisibleRibbons.value = 2
    return layer
  }
  const release = (mesh: StarOuterLayer | Star): void => {
    mesh.removeFromParent()
    mesh.geometry.dispose()
    mesh.material.dispose()
  }

  try {
    const profile = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({
      uniforms: { ...UniformsUtils.clone(StarOuterLayerShaderTemplate.uniforms), uProbeSide: new Uniform(0) },
      vertexShader: `
        ${ShaderChunk['common']}
        ${ShaderChunk['logdepthbuf_pars_vertex']}
        varying float vSide;
        varying float vOpacity;
        varying vec3 vColor;
        uniform float uProbeSide;
        void main() {
          vSide = uProbeSide; vOpacity = 1.0; vColor = vec3(1.0);
          gl_Position = vec4(position.xy, 0.0, 1.0);
          ${ShaderChunk['logdepthbuf_vertex']}
        }`,
      fragmentShader: StarOuterLayerShaderTemplate.fragmentShader,
      blending: NoBlending, depthTest: false, depthWrite: false
    }))
    scene.add(profile)
    try {
      // (1-smoothstep(0,1,|side|))²: ручные значения независимо от GPU-кода.
      for (const [side, expected] of [[-1, 0], [-0.75, 0.0244140625], [-0.5, 0.25], [-0.25, 0.7119140625],
        [0, 1], [0.25, 0.7119140625], [0.5, 0.25], [0.75, 0.0244140625], [1, 0]]) {
        profile.material.uniforms.uProbeSide.value = side
        const frame = capture()
        const measured = frame.energy / (256 * 256 * 3)
        require(Math.abs(measured - expected) < 0.001, `edge profile ${side}: ${measured} != ${expected}`)
        require(Math.abs(frame.alpha / (256 * 256) - expected * 0.65) < 0.001, `premultiplied alpha at ${side}`)
        results.push({ kind: 'edge', side, measured })
      }
    } finally { scene.remove(profile); profile.geometry.dispose(); profile.material.dispose() }

    let fullEnergy = 0
    for (const activity of [1, 0.5, 0.1, 0.001]) {
      const layer = makePair(activity)
      scene.add(layer)
      try {
        const { energy } = capture()
        require(energy > 0, 'empty activity fixture')
        if (activity === 1) fullEnergy = energy
        const ratio = energy / fullEnergy
        require(Math.abs(ratio - activity) < 0.003, `activity ${activity}: energy ratio ${ratio}`)
        results.push({ kind: 'activity', activity, ratio })
      } finally { release(layer) }
    }

    const pair = makePair(1)
    scene.add(pair)
    try {
      pair.material.uniforms.uVisibleRibbons.value = 1
      const one = capture().energy
      require(one > 0, 'empty fade fixture')
      for (const count of [0, 0.25, 0.5, 0.9999, 1, 1.0001, 1.5, 2]) {
        pair.material.uniforms.uVisibleRibbons.value = count
        pair.geometry.setDrawRange(0, Math.ceil(count) * pair.geometry.index!.count / 2)
        const { energy } = capture()
        const ratio = energy / one
        require(Math.abs(ratio - count) < 0.004, `fractional ribbon ${count}: ${ratio}`)
        results.push({ kind: 'fade', count, ratio })
      }
    } finally { release(pair) }

    const disk = new Star(actor(1)), layer = new StarOuterLayer(actor(1), renderer)
    disk.add(layer)
    scene.add(disk)
    try {
      for (const pixels of [12, 13, 24, 32, 33, 48, 64, 128, 256, 512]) {
        camera.position.z = radius * 256 / (pixels * Math.tan(25 * Math.PI / 180))
        const ctx = { camera, elapsed: 123, delta: 0, epoch: 0 }
        disk.updateObject(ctx)
        layer.updateObject(ctx)
        layer.updateView(camera)
        const withLayer = capture()
        layer.visible = false
        const bodyOnly = capture()
        const triangles = withLayer.triangles - bodyOnly.triangles
        const calls = withLayer.calls - bodyOnly.calls
        if (pixels <= 32) require(triangles === 0 && calls === 0, `distant layer rendered at ${pixels}px`)
        else require(triangles > 0 && calls === 1, `missing layer at ${pixels}px`)
        if (pixels === 64) require(triangles < layer.geometry.index!.count / 12, 'small star still renders dense ribbons')
        if (pixels >= 256) require(triangles === layer.geometry.index!.count / 3, 'close layer lost ribbons')
        results.push({ kind: 'lod', pixels, triangles, calls })
      }
    } finally { release(layer); release(disk) }
    return { results }
  } finally {
    target.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
