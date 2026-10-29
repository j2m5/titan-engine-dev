import type { Camera, Object3D, Scene, WebGLRenderer } from 'three'

interface PendingProgram {
  program?: WebGLProgram
  vertexShader: WebGLShader
  fragmentShader: WebGLShader
  isReady(): boolean
  getUniforms(): unknown
}
/** Poll from the render loop; no async callbacks can outlive a disposed cloud owner.
 * Three r182 exposes the same completion check through compileAsync, whose timer
 * cannot be cancelled when its materials are retired during a scene change.
 */
export class CloudProgramWarmup {
  private readonly pending = new Map<PendingProgram, WebGLRenderer>()
  public compile(renderer: WebGLRenderer, scene: Object3D, camera: Camera, targetScene?: Scene): void {
    if (!renderer.extensions.has('KHR_parallel_shader_compile')) return
    const materials = renderer.compile(scene, camera, targetScene)
    for (const material of materials) {
      const properties = renderer.properties.get(material) as { currentProgram?: PendingProgram }
      const program = properties.currentProgram
      if (
        !program?.program ||
        !program.vertexShader ||
        !program.fragmentShader ||
        typeof program.isReady !== 'function' ||
        typeof program.getUniforms !== 'function'
      )
        throw new Error('Unsupported Three cloud warmup program layout')
      this.pending.set(program, renderer)
    }
  }
  public ready(): boolean {
    for (const [program, renderer] of this.pending) {
      // A replaced material can retire a program while another owner is preparing.
      if (!program.program) this.pending.delete(program)
      else if (program.isReady()) {
        const gl = renderer.getContext()
        // A cached program may link before its newly submitted shader objects
        // finish. First-use logs/deletion can otherwise still stall the GPU queue.
        const completion = 0x91b1 // KHR_parallel_shader_compile.COMPLETION_STATUS_KHR
        if (
          !gl.getShaderParameter(program.vertexShader, completion) ||
          !gl.getShaderParameter(program.fragmentShader, completion)
        )
          continue
        if (gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
          program.getUniforms()
        }
        this.pending.delete(program)
      }
    }
    return this.pending.size === 0
  }
  public clear(): void {
    this.pending.clear()
  }
}
