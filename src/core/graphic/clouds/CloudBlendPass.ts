import { Pass } from 'postprocessing'
import { DataTexture, ShaderMaterial, Texture, Vector4, WebGLRenderer, WebGLRenderTarget } from 'three'
import { CloudProgramWarmup } from '@/core/clouds/takram/CloudProgramWarmup'
/** Complete linear HDR endpoints, before the shared grading and tone mapping passes. */
export class CloudBlendPass extends Pass {
  private readonly warmup = new CloudProgramWarmup()
  private warmupStarted = false
  private readonly neutral = new DataTexture(new Uint8Array(4), 1, 1)
  private readonly material = new ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: { inputBuffer: { value: null }, sceneCloudNear: { value: null }, sceneCloudWeight: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:
      'uniform sampler2D inputBuffer; uniform sampler2D sceneCloudNear; uniform float sceneCloudWeight; varying vec2 vUv; void main(){vec4 nearColor=texture2D(sceneCloudNear,vUv); if(sceneCloudWeight>=1.0) gl_FragColor=nearColor; else gl_FragColor=mix(texture2D(inputBuffer,vUv),nearColor,sceneCloudWeight);}'
  })
  public constructor() {
    super('CloudBlendPass')
    this.neutral.needsUpdate = true
    this.fullscreenMaterial = this.material
    this.setNear(null, 0)
  }
  public setNear(texture: Texture | null, weight: number): void {
    this.enabled = !!texture && weight > 0
    this.material.uniforms.sceneCloudNear.value = texture ?? this.neutral
    this.material.uniforms.sceneCloudWeight.value = texture ? Math.max(0, Math.min(1, weight)) : 0
  }
  public prepare(renderer: WebGLRenderer, input: WebGLRenderTarget): boolean {
    if (!this.warmupStarted) {
      const target = renderer.getRenderTarget(),
        face = renderer.getActiveCubeFace(),
        mip = renderer.getActiveMipmapLevel()
      const viewport = renderer.getViewport(new Vector4()),
        scissor = renderer.getScissor(new Vector4()),
        test = renderer.getScissorTest()
      try {
        renderer.setRenderTarget(input)
        this.warmup.compile(renderer, this.scene, this.camera)
        this.warmupStarted = true
      } finally {
        renderer.setRenderTarget(target, face, mip)
        renderer.setViewport(viewport)
        renderer.setScissor(scissor)
        renderer.setScissorTest(test)
      }
    }
    return this.warmup.ready()
  }
  public override render(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget,
    outputBuffer: WebGLRenderTarget
  ): void {
    this.material.uniforms.inputBuffer.value = inputBuffer.texture
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer)
    renderer.render(this.scene, this.camera)
  }
  public override dispose(): void {
    this.warmup.clear()
    this.material.uniforms.sceneCloudNear.value = null
    this.material.uniforms.inputBuffer.value = null
    this.neutral.dispose()
    this.material.dispose()
  }
}
