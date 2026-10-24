import { Camera, Mesh, NoBlending, PlaneGeometry, Scene, ShaderMaterial, WebGLRenderer, WebGLRenderTarget } from 'three'

export type EarthGpuProbeReport = { name: string; checks: number; maxError: number; resourcesReleased: boolean }

export function extractShaderFunction(source: string, name: string): string {
  const start = source.search(new RegExp(`(?:vec[234]|float|WeatherSample) ${name}\\(`))
  if (start < 0) throw new Error(`Missing shader function ${name}`)
  let end = source.indexOf('{', start),
    depth = 1
  while (depth && ++end < source.length) {
    if (source[end] === '{') depth++
    if (source[end] === '}') depth--
  }
  if (depth) throw new Error(`Unterminated shader function ${name}`)
  return source.slice(start, end + 1)
}

export function createGpuReadback() {
  const renderer = new WebGLRenderer()
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    throw new Error(
      `Earth probe shader failed: ${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)}`
    )
  }
  const geometry = new PlaneGeometry(2, 2),
    target = new WebGLRenderTarget(1, 1, { depthBuffer: false })
  const material = new ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}'
  })
  const scene = new Scene()
  scene.add(new Mesh(geometry, material))
  let disposed = false
  return {
    renderer,
    run(body: string, declarations: string, uniforms: ShaderMaterial['uniforms'], width = 1, height = 1): number[] {
      // Three caches the program's uniform list; retain existing uniform objects.
      for (const [name, uniform] of Object.entries(uniforms)) {
        if (material.uniforms[name]) material.uniforms[name].value = uniform.value
        else material.uniforms[name] = { value: uniform.value }
      }
      material.fragmentShader = `${declarations}\nvoid main(){${body}}`
      material.needsUpdate = true
      target.setSize(width, height)
      renderer.setRenderTarget(target)
      renderer.render(scene, new Camera())
      const bytes = new Uint8Array(width * height * 4)
      renderer.readRenderTargetPixels(target, 0, 0, width, height, bytes)
      const error = renderer.getContext().getError()
      if (error) throw new Error(`Earth probe GL error ${error}`)
      return Array.from(bytes, (x) => x / 255)
    },
    dispose(): boolean {
      if (disposed) return renderer.info.memory.textures === 0 && renderer.info.memory.geometries === 0
      disposed = true
      target.dispose()
      geometry.dispose()
      material.dispose()
      renderer.setRenderTarget(null)
      const released = renderer.info.memory.textures === 0 && renderer.info.memory.geometries === 0
      renderer.dispose()
      renderer.forceContextLoss()
      return released
    }
  }
}
