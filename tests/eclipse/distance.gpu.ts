import {
  Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector3, Vector4,
  WebGLRenderer, WebGLRenderTarget
} from 'three'
import { eclipseFunctions } from '@/core/materials/shaders/lib/chunks/Eclipse'

/** A body behind the light source cannot cast a shadow or add atmospheric glow. */
export function checkEclipseDistance() {
  const renderer = new WebGLRenderer()
  renderer.setSize(1, 1)
  const occluder = new Vector4(200, 0, 0, 40)
  const material = new ShaderMaterial({
    depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: {
      occluders: { value: [occluder, new Vector4(), new Vector4(), new Vector4()] },
      umbra: { value: [new Vector4(1, 0.1, 0, 0.2), new Vector4(), new Vector4(), new Vector4()] },
      star: { value: new Vector3(100, 0, 0) }
    },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform vec4 occluders[4]; uniform vec4 umbra[4]; uniform vec3 star;
      ${eclipseFunctions}
      void main() { gl_FragColor = vec4(eclipseLightAt(vec3(0.0), 1, occluders, star, 10.0, umbra), 1.0); }`
  })
  const geometry = new PlaneGeometry(2, 2), scene = new Scene()
  scene.add(new Mesh(geometry, material))
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const target = new WebGLRenderTarget(1, 1, { depthBuffer: false })
  const render = () => {
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const pixel = new Uint8Array(4)
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel)
    return Array.from(pixel.slice(0, 3))
  }
  try {
    const behindStar = render()
    occluder.set(50, 0, 0, 10)
    const foreground = render()
    occluder.set(-50, 0, 0, 10)
    const behindReceiver = render()
    const results = { behindStar, foreground, behindReceiver }
    if (behindStar.some(v => v !== 255) || behindReceiver.some(v => v !== 255) ||
      Math.abs(foreground[0] - 51) > 1 || Math.abs(foreground[1] - 5) > 1 || foreground[2] !== 0) {
      throw Object.assign(new Error(`Incorrect eclipse depth order: ${JSON.stringify(results)}`), { results })
    }
    return results
  } finally {
    target.dispose()
    geometry.dispose()
    material.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
