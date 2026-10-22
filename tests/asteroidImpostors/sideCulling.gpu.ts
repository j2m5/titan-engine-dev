import {
  Camera, DataArrayTexture, DepthTexture, Euler, FloatType, InstancedBufferAttribute, InstancedMesh,
  Matrix4, Mesh, NoBlending, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Quaternion,
  ShaderMaterial, Vector3, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { BillboardAsteroidMaterial } from '@/core/renderables/DetailedRingStreamingSystem/BillboardAsteroidMaterial'
import { createImpostorLayout } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorLayout'
import { unculledVertexReference } from './unculledVertexReference'

interface ViewCase {
  name: string
  position: [number, number, number]
  scale?: [number, number, number]
  rotation?: [number, number, number]
  camera?: Camera
  world?: [number, number, number]
  origin?: [number, number, number]
  fade?: number
  ready?: number
  detailEnd?: number
  spin?: number
  reject?: boolean
  visible?: boolean
}

/** Catch fullscreen work from side-on, offscreen quads and false rejection of
 * atlas coverage. The reference keeps the original vertex main; fragments and
 * depth use the real production program, with controlled full-tile atlas data. */
export function checkImpostorSideCulling() {
  const size = 96, layout = createImpostorLayout(8, 1)
  const data = (texel: number[]) => {
    const pixels = new Float32Array(layout.pageSize ** 2 * 4)
    for (let i = 0; i < pixels.length; i += 4) pixels.set(texel, i)
    const texture = new DataArrayTexture(pixels, layout.pageSize, layout.pageSize, 1)
    texture.type = FloatType; texture.needsUpdate = true
    return texture
  }
  // Full coverage deliberately includes capture-plane corners beyond radius h.
  const normalDepth = data([.5, .5, 1, .5]), surfaceCoverage = data([.25, .1, 0, 1])
  const renderer = new WebGLRenderer({ logarithmicDepthBuffer: true })
  renderer.setSize(size, size)
  const target = new WebGLRenderTarget(size, size, { type: FloatType })
  target.depthTexture = new DepthTexture(size, size)
  const depthTarget = new WebGLRenderTarget(size, size, { type: FloatType, depthBuffer: false })
  const depthMaterial = new ShaderMaterial({
    uniforms: { map: { value: target.depthTexture } }, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUV; void main(){vUV=uv; gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: 'uniform sampler2D map; varying vec2 vUV; void main(){gl_FragColor=vec4(texture2D(map,vUV).rrr,1.0);}'
  })
  const blit = new Mesh(new PlaneGeometry(2, 2), depthMaterial), blitCamera = new OrthographicCamera()
  const meshes = [0, 1].map(mode => {
    const material = new BillboardAsteroidMaterial(undefined, true, true, true)
    material.setImpostorSnapshot({ generation: 1, state: 'ready', reason: null, revisions: [],
      slotLayers: new Int32Array([0]), halfExtents: new Float32Array([1]),
      atlas: { normalDepth, surfaceCoverage, layout, layerCount: 1, dispose() {} } })
    if (!mode) material.vertexShader = unculledVertexReference(material.vertexShader)
    material.uniforms.uLightPosition.value.set(3, 5, 10)
    material.uniforms.uPlanetshineStrength.value = 0
    material.uniforms.uSurfaceAmbient.value = .3
    const geometry = new PlaneGeometry(2.5, 2.5)
    for (const [name, values, itemSize] of [
      ['instanceOrigin', [0, 0, 0], 3], ['instanceFade', [1], 1], ['instanceMaxDistance', [1000], 1],
      ['instanceArchetype', [0], 1], ['instanceDetailEnd', [1], 1]
    ] as const) geometry.setAttribute(name, new InstancedBufferAttribute(new Float32Array(values), itemSize))
    const mesh = new InstancedMesh(geometry, material, 1)
    mesh.frustumCulled = false
    return mesh
  })
  const flatMaterials = meshes.map(mesh => {
    const material = new ShaderMaterial({ vertexShader: mesh.material.vertexShader, fragmentShader: 'void main(){gl_FragColor=vec4(1.0);}',
      uniforms: mesh.material.uniforms, defines: mesh.material.defines, blending: NoBlending, depthTest: false, depthWrite: false })
    return material
  })
  const perspective = new PerspectiveCamera(60, 1, .001, 1000)
  const offset = new PerspectiveCamera(60, 1, .001, 1000)
  offset.setViewOffset(192, 128, 55, 23, 96, 96)
  const ortho = new OrthographicCamera(-2, 3, 2.5, -1.5, .001, 1000)
  const fixtures: ViewCase[] = [
    { name: 'center', position: [0, 0, -5], visible: true },
    ...[[10, 0, -.01], [-10, 0, -.01], [0, 10, -.01], [0, -10, -.01]].map((position, i) =>
      ({ name: `side-on outside ${i}`, position: position as ViewCase['position'], scale: [.05, .04, .06] as ViewCase['scale'], reject: true })),
    ...[[3.1, 0, -5], [-3.1, 0, -5], [0, 3.1, -5], [0, -3.1, -5]].map((position, i) =>
      ({ name: `edge overlap ${i}`, position: position as ViewCase['position'], visible: true })),
    { name: 'off-axis projection', position: [0, 0, -5], camera: offset, visible: true },
    { name: 'off-axis narrow right edge', position: [2.4, 0, -5], scale: [.05, .05, .05], camera: offset, visible: true },
    { name: 'off-axis narrow bottom edge', position: [0, -2.4, -5], scale: [.05, .05, .05], camera: offset, visible: true },
    { name: 'orthographic edge', position: [3.2, 0, -5], camera: ortho, visible: true },
    { name: 'nonuniform spinning shape', position: [2.8, 0, -5], scale: [.6, 1.4, .8], rotation: [.3, .7, .4], spin: 2.7, visible: true },
    { name: 'reflected scale', position: [-2.8, 0, -5], scale: [-.8, 1.2, .6], rotation: [.4, -.2, .6], visible: true },
    { name: 'large world coordinates', position: [0, 0, -5], world: [1e8, -2e8, 3e8], visible: true },
    { name: 'floating origin', position: [-100, -20, 35], origin: [100, 20, -40], visible: true },
    { name: 'positive crossfade', position: [0, 0, -5], fade: .4, visible: true },
    { name: 'negative crossfade', position: [0, 0, -5], fade: -.4, visible: true },
    { name: 'zero fade', position: [0, 0, -5], fade: 0 },
    { name: 'atlas not ready', position: [0, 0, -5], ready: 0, visible: true },
    { name: 'legacy detail-end', position: [0, 0, -5], detailEnd: 0, visible: true },
    { name: 'near clipping unchanged', position: [0, 0, -.0005] },
    { name: 'far clipping unchanged', position: [0, 0, -1100] },
    // Hand-checked first-plane intersections at the rightmost pixel column:
    // these samples lie beyond the physical-radius AABB, inside capture tiles.
    { name: 'capture square corner beyond sphere', position: [4.469101615137754, .4375759591348469, -5],
      rotation: [2.1606317508965733, 2.927667987747118, 4.799811640847475], visible: true },
    { name: 'second capture square corner', position: [4.469101615137754, .36847608583047986, -5],
      rotation: [3.6618274826556445, .1530742559861392, 5.24845219777897], visible: true }
  ]
  const read = (output: WebGLRenderTarget) => {
    const pixels = new Float32Array(size * size * 4)
    renderer.readRenderTargetPixels(output, 0, 0, size, size, pixels)
    if (pixels.some(value => !Number.isFinite(value))) throw new Error('Nonfinite impostor pixels')
    return pixels
  }
  const render = (index: number, camera: Camera, flat = false) => {
    const mesh = meshes[index], material = mesh.material
    if (flat) mesh.material = flatMaterials[index] as BillboardAsteroidMaterial
    try {
      renderer.setRenderTarget(target); renderer.setClearColor(0, 0); renderer.clear(); renderer.render(mesh, camera)
      const color = read(target)
      renderer.setRenderTarget(depthTarget); renderer.render(blit, blitCamera)
      return { color, depth: read(depthTarget), covered: color.filter((value, i) => i % 4 === 3 && value > 0).length }
    } finally { mesh.material = material }
  }
  const results = []
  try {
    for (const fixture of fixtures) {
      const camera = fixture.camera ?? perspective
      camera.position.set(...(fixture.world ?? [0, 0, 0])); camera.updateMatrixWorld(true)
      for (const mesh of meshes) {
        mesh.position.set(...(fixture.world ?? [0, 0, 0]))
        mesh.setMatrixAt(0, new Matrix4().compose(new Vector3(...fixture.position),
          new Quaternion().setFromEuler(new Euler(...(fixture.rotation ?? [0, 0, 0]))), new Vector3(...(fixture.scale ?? [1, 1, 1]))))
        mesh.instanceMatrix.needsUpdate = true
        for (const [name, values] of Object.entries({ instanceOrigin: fixture.origin ?? [0, 0, 0], instanceFade: [fixture.fade ?? 1], instanceDetailEnd: [fixture.detailEnd ?? 1] })) {
          const attribute = mesh.geometry.getAttribute(name)
          attribute.array.set(values); attribute.needsUpdate = true
        }
        mesh.material.uniforms.uImpostorReady.value = fixture.ready ?? 1
        mesh.material.uniforms.uOriginOffset.value.set(...(fixture.origin ?? [0, 0, 0]))
        mesh.material.uniforms.uSpinPeriod.value = fixture.spin === undefined ? 0 : 10
        mesh.material.uniforms.uSpinTime.value = fixture.spin ?? 0
      }
      const reference = render(0, camera), actual = render(1, camera)
      let different = 0
      for (let i = 0; i < reference.color.length; i++) {
        if (reference.color[i] !== actual.color[i] || reference.depth[i] !== actual.depth[i]) different++
      }
      if (different) throw new Error(`${fixture.name}: ${different} color/depth components differ`)
      if (fixture.visible && !reference.covered) throw new Error(`${fixture.name}: empty reference coverage`)
      let referenceRaster: number | undefined, actualRaster: number | undefined
      if (fixture.reject) {
        referenceRaster = render(0, camera, true).covered; actualRaster = render(1, camera, true).covered
        if (!referenceRaster) throw new Error(`${fixture.name}: original quad no longer reproduces raster work`)
        if (actualRaster) throw new Error(`${fixture.name}: offscreen atlas still rasterizes ${actualRaster} pixels`)
      }
      results.push({ name: fixture.name, covered: reference.covered, different, referenceRaster, actualRaster })
    }
    if (renderer.getContext().getError()) throw new Error('Impostor culling WebGL error')
    return { resolution: size, results }
  } finally {
    renderer.setRenderTarget(null)
    for (const mesh of meshes) { mesh.dispose(); mesh.geometry.dispose(); mesh.material.dispose() }
    for (const material of flatMaterials) material.dispose()
    normalDepth.dispose(); surfaceCoverage.dispose(); blit.geometry.dispose(); depthMaterial.dispose()
    target.dispose(); depthTarget.dispose(); renderer.dispose(); renderer.forceContextLoss()
  }
}
