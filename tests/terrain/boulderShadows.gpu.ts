import {
  DataTexture,
  FloatType,
  Matrix4,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  Mesh,
  RedFormat,
  Scene,
  ShaderMaterial,
  Uniform,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import { boulderShadowFunctions, boulderShadowUniforms } from '@/core/materials/shaders/lib/chunks/BoulderShadow'
import { BoxGeometry, InstancedBufferAttribute, InstancedMesh, Object3D } from 'three'
import { TerrainBoulderShadows } from '@/core/terrain/TerrainBoulderShadows'
import { toThreeJSUnits } from '@/core/helpers/scaling'

/** Synthetic depths pin filtering and receiver-plane bias independently of the terrain renderer. */
export function checkBoulderShadowFiltering() {
  const renderer = new WebGLRenderer({ logarithmicDepthBuffer: true })
  renderer.setSize(9, 9)
  renderer.debug.onShaderError = (gl, _program, vertex, fragment) => {
    throw new Error(`${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)}`)
  }
  const depths = new Float32Array(16),
    texture = new DataTexture(depths, 4, 4, RedFormat, FloatType)
  texture.minFilter = texture.magFilter = NearestFilter
  texture.needsUpdate = true
  const material = new ShaderMaterial({
    uniforms: {
      uBoulderShadowMap: new Uniform(texture),
      uBoulderShadowMatrix: new Uniform(new Matrix4()),
      uBoulderShadowStrength: new Uniform(1),
      uBoulderShadowSettings: new Uniform(new Vector4(0.25, 0.001, 10, 20)),
      query: new Uniform(new Vector3(0.5, 0.5, 0.5)),
      gradient: new Uniform(new Vector3())
    },
    vertexShader: `varying vec3 vQuery; uniform vec3 query, gradient;
      void main(){vQuery=query+vec3(position.xy*0.1,dot(position.xy,gradient.xy)*0.1);gl_Position=vec4(position.xy,0.0,1.0);}`,
    fragmentShader: `varying vec3 vQuery; ${boulderShadowUniforms} ${boulderShadowFunctions}
      void main(){float s=boulderShadowVisibility(vQuery);gl_FragColor=vec4(vec3(s),1.0);}`
  })
  const scene = new Scene(),
    geometry = new PlaneGeometry(2, 2),
    camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  scene.add(new Mesh(geometry, material))
  const target = new WebGLRenderTarget(9, 9),
    pixel = new Uint8Array(4),
    cases: { name: string; actual: number; expected: number }[] = []
  const check = (name: string, expected: number) => {
    texture.needsUpdate = true
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    renderer.readRenderTargetPixels(target, 4, 4, 1, 1, pixel)
    const actual = pixel[0] / 255
    if (Math.abs(actual - expected) > 1.5 / 255) throw new Error(`${name}: ${actual} != ${expected}`)
    cases.push({ name, actual, expected })
  }
  try {
    depths.fill(0.8)
    check('lit', 1)
    depths.fill(0.3)
    check('occluded', 0)
    material.uniforms.uBoulderShadowStrength.value = 0.5
    check('strength fade', 0.5)
    material.uniforms.uBoulderShadowStrength.value = 1
    depths.fill(0.8)
    depths[5] = 0.3
    check('four-tap bilinear visibility', 0.75)
    for (const slope of [-0.6, 0.6]) {
      material.uniforms.gradient.value.set(slope, 0.2, 0)
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++)
          depths[y * 4 + x] = 0.5 + slope * ((x + 0.5) / 4 - 0.5) + 0.2 * ((y + 0.5) / 4 - 0.5)
      check(`tilted receiver ${slope}`, 1)
    }
    material.uniforms.gradient.value.set(0, 0, 0)
    depths.fill(0.3)
    material.uniforms.query.value.set(1.1, 0.5, 0.5)
    check('outside map', 1)
    material.uniforms.query.value.set(0.5, 0.5, 0.5)
    material.uniforms.uBoulderShadowStrength.value = 0
    check('disabled', 1)
    if (renderer.getContext().getError() !== 0) throw new Error('Shadow filtering GL error')
    return { checks: cases.length, cases }
  } finally {
    texture.dispose()
    material.dispose()
    geometry.dispose()
    target.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}

/** Exercise the actual linear depth pass, nested rendering, RTC receiver transform and target restoration. */
export function checkBoulderShadowDepth() {
  const cases: { name: string; actual: number }[] = [],
    metre = toThreeJSUnits(0.001)
  for (const logarithmicDepthBuffer of [false, true])
    for (const sizeScale of [1, 0.1]) {
      const unit = metre * sizeScale
      const renderer = new WebGLRenderer({ logarithmicDepthBuffer })
      renderer.setPixelRatio(2)
      renderer.setSize(11, 13)
      renderer.debug.onShaderError = (gl, _program, vertex, fragment) => {
        throw new Error(`${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)}`)
      }
      const host = new Object3D(),
        scene = new Scene(),
        anchor = new Vector3(0, 0, toThreeJSUnits(3390))
      host.position.set(103964, -2570, 1195)
      host.rotation.set(0.2, -0.4, 0.1)
      scene.add(host)
      host.updateMatrixWorld(true)
      const rock = new BoxGeometry(10 * unit, 10 * unit, 10 * unit)
      rock.setAttribute('boulderState', new InstancedBufferAttribute(new Float32Array([1, 1]), 2))
      const material = new ShaderMaterial({
        vertexShader: `varying vec3 vView; void main(){vec4 p=modelViewMatrix*vec4(position,1.0);vView=p.xyz;gl_Position=projectionMatrix*p;}`,
        fragmentShader: `varying vec3 vView; ${boulderShadowUniforms} ${boulderShadowFunctions}
        void main(){float s=boulderShadowVisibility(vView);gl_FragColor=vec4(vec3(s),1.0);}`
      })
      const caster = new InstancedMesh(rock, material, 1)
      caster.setMatrixAt(0, new Matrix4().makeTranslation(0, 0, 10 * unit))
      const ground = new PlaneGeometry(80 * unit, 80 * unit),
        receiver = new Mesh(ground, material)
      receiver.position.copy(anchor)
      host.add(receiver)
      const camera = new OrthographicCamera(-40 * unit, 40 * unit, 40 * unit, -40 * unit, 0, 1000 * unit)
      const cameraLocal = anchor.clone().add(new Vector3(0, 0, 100 * unit))
      camera.position.copy(cameraLocal).applyMatrix4(host.matrixWorld)
      camera.quaternion.copy(host.quaternion)
      camera.updateMatrixWorld(true)
      const shadows = new TerrainBoulderShadows(host, renderer, [caster], sizeScale)
      shadows.bind(material)
      const target = new WebGLRenderTarget(65, 65),
        pixel = new Uint8Array(4)
      const draw = (sun: Vector3) => {
        shadows.update(cameraLocal, sun, anchor)
        renderer.setRenderTarget(target)
        renderer.render(scene, camera)
        if (renderer.getRenderTarget() !== target) throw new Error('Nested shadow target leaked')
      }
      const check = (name: string, x: number, expected: number) => {
        renderer.readRenderTargetPixels(target, x, 32, 1, 1, pixel)
        const actual = pixel[0] / 255
        if (Math.abs(actual - expected) > 2 / 255)
          throw new Error(`${name} log=${logarithmicDepthBuffer}: ${actual} != ${expected}`)
        cases.push({ name: `${name} log=${logarithmicDepthBuffer} scale=${sizeScale}`, actual })
      }
      try {
        draw(new Vector3(0, 0, 1))
        check('overhead occlusion', 32, 0)
        check('unoccluded ground', 50, 1)
        draw(new Vector3(1, 0, 1).normalize())
        check('oblique occlusion', 24, 0)
        check('sunward ground', 48, 1)
        receiver.position.z += 15 * unit
        draw(new Vector3(0, 0, 1))
        check('lit caster top has no self shadow', 32, 1)
        receiver.position.copy(anchor)
        rock.getAttribute('boulderState').setX(0, 0)
        rock.getAttribute('boulderState').needsUpdate = true
        draw(new Vector3(0, 0, 1))
        check('invisible caster clears old depth', 32, 1)
        // The caller's active area can differ from both target defaults and the logical canvas.
        renderer.setRenderTarget(target)
        renderer.setViewport(3, 4, 19, 21)
        renderer.setScissor(4, 5, 11, 12)
        renderer.setScissorTest(true)
        const gl = renderer.getContext(),
          viewport = renderer.getCurrentViewport(new Vector4()),
          logical = renderer.getViewport(new Vector4()),
          scissor = Array.from(gl.getParameter(gl.SCISSOR_BOX) as Int32Array)
        shadows.update(cameraLocal, new Vector3(0, 0, 1), anchor)
        renderer.render(scene, camera)
        if (
          !renderer.getCurrentViewport(new Vector4()).equals(viewport) ||
          !renderer.getViewport(new Vector4()).equals(logical) ||
          JSON.stringify(Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array)) !==
            JSON.stringify(viewport.toArray()) ||
          JSON.stringify(Array.from(gl.getParameter(gl.SCISSOR_BOX) as Int32Array)) !== JSON.stringify(scissor) ||
          !gl.isEnabled(gl.SCISSOR_TEST)
        )
          throw new Error('Nested pass lost the enclosing custom viewport/scissor')
        cases.push({ name: `custom render area log=${logarithmicDepthBuffer}`, actual: 1 })
        if (renderer.getContext().getError() !== 0) throw new Error('Depth shadow GL error')
      } finally {
        shadows.dispose()
        material.dispose()
        rock.dispose()
        ground.dispose()
        target.dispose()
        renderer.dispose()
        renderer.forceContextLoss()
      }
    }
  return { checks: cases.length, cases }
}
