import { BlendFunction, Effect, LuminanceMaterial, LuminancePass, MipmapBlurPass, Resolution } from 'postprocessing'
import { LensFlareEffectOptions } from '@/core/graphic/postprocessing/types'
import { Uniform, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'

const fragmentShader: string = `
  uniform sampler2D map;
  uniform float ghostSize;
  uniform float ghostSpacing;
  uniform float ghostAttenuationFactor;
  uniform int ghostSamples;
  uniform vec3 ghostTint;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 texCoord = 1.0 - uv;
    vec2 ghostVec = (vec2(0.5) - texCoord) * ghostSpacing;

    vec3 result = vec3(0.0);

    for (int i = 0; i < 8; i++) {
      if (i >= ghostSamples) break;

      float t = float(i) / float(ghostSamples);
      vec2 sampleUv = fract(texCoord + ghostVec * float(i));
      float d = distance(sampleUv, vec2(0.5));
      float weight = pow(1.0 - d, ghostAttenuationFactor);

      vec3 samp = texture2D(map, sampleUv).rgb;
      samp = max(samp - ghostSize, 0.0) * ghostTint;

      result += samp * weight;
    }

    vec4 sceneColor = texture2D(inputBuffer, uv);

    outputColor = sceneColor + vec4(result, 1.0);
  }
`

class LensFlareEffect extends Effect {
  private readonly renderTarget: WebGLRenderTarget
  private readonly luminancePass: LuminancePass
  private readonly blurPass: MipmapBlurPass

  public constructor(config: LensFlareEffectOptions) {
    super('LensFlareEffect', fragmentShader, {
      blendFunction: config.blendFunction || BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['map', new Uniform(null)],
        ['ghostSize', new Uniform(0.8)],
        ['ghostSpacing', new Uniform(0.3)],
        ['ghostAttenuationFactor', new Uniform(40)],
        ['ghostSamples', new Uniform(4)],
        ['ghostTint', new Uniform(new Vector3(1, 1, 1))]
      ])
    })
    this.renderTarget = new WebGLRenderTarget(1, 1, { depthBuffer: false })
    this.renderTarget.texture.name = 'LensFlare.Target'
    this.luminancePass = new LuminancePass()
    this.luminanceMaterial.colorOutput = true
    this.luminanceMaterial.threshold = config.threshold
    this.luminanceMaterial.smoothing = 0.25

    this.blurPass = new MipmapBlurPass()
    this.blurPass.radius = 0.85
    this.blurPass.levels = 8

    this.uniforms.get('map')!.value = this.blurPass.texture

    const resolution: Resolution = new Resolution(this, config.resolution.x, config.resolution.y)
    resolution.addEventListener('change', () => this.setSize(resolution.baseWidth, resolution.baseHeight))
  }

  public get luminanceMaterial(): LuminanceMaterial {
    return this.luminancePass.fullscreenMaterial as LuminanceMaterial
  }

  public setSize(width: number, height: number): void {
    const resx: number = Math.round(width / 4)
    const resy: number = Math.round(height / 4)

    this.renderTarget.setSize(resx, resy)
    this.luminancePass.setSize(width, height)
    this.blurPass.setSize(width, height)
  }

  public update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, deltaTime: number): void {
    this.luminancePass.render(renderer, inputBuffer, null)
    // @ts-ignore
    this.blurPass.render(renderer, this.luminancePass.renderTarget, this.renderTarget)
  }

  public initialize(renderer: WebGLRenderer, alpha: boolean, frameBufferType: number): void {
    this.luminancePass.initialize(renderer, alpha, frameBufferType)
    this.blurPass.initialize(renderer, alpha, frameBufferType)
  }

  public dispose(): void {
    super.dispose()
    this.renderTarget.dispose()
    this.luminancePass.dispose()
    this.blurPass.dispose()
  }
}

export { LensFlareEffect }
