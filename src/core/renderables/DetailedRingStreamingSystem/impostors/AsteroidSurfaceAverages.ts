import {
  BufferGeometry, Camera, Color, DataTexture, DataUtils, Float32BufferAttribute, FloatType, GLSL3, HalfFloatType,
  Mesh, NearestFilter, NoBlending, NoColorSpace, RawShaderMaterial, RGBAFormat, Scene, SRGBColorSpace,
  Texture, UnsignedByteType, Vector2, Vector3, Vector4, WebGLRenderTarget, type WebGLRenderer
} from 'three'
import type { AsteroidSurfaceAverageValues } from './impostorTypes'
import { forgetImpostorContext, rememberImpostorContext } from './impostorContext'

interface AverageCacheEntry { version: number; colorSpace: string; decode: boolean; value: Vector3 }
interface TextureImage { width: number; height: number; data?: ArrayLike<number> }

const linear = (c: number): number => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4

/** Средние карт в линейном пространстве; исходные текстуры остаются у ResourceStorage. */
export class AsteroidSurfaceAverages {
  private cache = new Map<Texture, AverageCacheEntry>()
  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly reserveScratch: (bytes: number) => boolean = () => true,
    private readonly releaseScratch: () => void = () => {},
    private readonly releaseGpu: (action: () => void) => void = action => action()
  ) {}

  async prepare(diffuse: Texture, arm: Texture): Promise<AsteroidSurfaceAverageValues> {
    return { diffuse: this.average(diffuse, true).clone(), arm: this.average(arm, false).clone() }
  }

  clear(): void { this.cache.clear() }

  private average(texture: Texture, decode: boolean): Vector3 {
    const cached = this.cache.get(texture)
    if (cached?.version === texture.version && cached.colorSpace === texture.colorSpace && cached.decode === decode) return cached.value
    const image = texture.image as TextureImage
    if (!image || !(image.width > 0) || !(image.height > 0)) throw new Error('Карта поверхности ещё не загружена')
    let value: Vector3
    if (texture instanceof DataTexture && image.data && texture.format === RGBAFormat) {
      value = new Vector3()
      for (let i = 0; i < image.width * image.height; i++) {
        const channel = (c: number): number => {
          let n = image.data![i * 4 + c]
          if (texture.type === UnsignedByteType) n /= 255
          else if (texture.type === HalfFloatType) n = DataUtils.fromHalfFloat(n)
          if (!Number.isFinite(n)) throw new Error('Неконечный цвет карты')
          return decode && texture.colorSpace === SRGBColorSpace ? linear(n) : n
        }
        value.add(new Vector3(channel(0), channel(1), channel(2)))
      }
      value.divideScalar(image.width * image.height)
    } else value = this.readGpu(texture, image, decode)
    this.cache.set(texture, { version: texture.version, colorSpace: texture.colorSpace, decode, value })
    return value
  }

  private readGpu(texture: Texture, image: TextureImage, decode: boolean): Vector3 {
    const r = this.renderer, gl = r.getContext()
    if (gl.isContextLost()) throw new Error('Контекст WebGL потерян')
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Нет float readback для средних карт')
    const mipmaps = texture.mipmaps ?? []
    const last = mipmaps.at(-1) as TextureImage | undefined
    const useLastMip = texture.generateMipmaps || (last?.width === 1 && last.height === 1)
    const level = useLastMip ? (mipmaps.length > 0 ? mipmaps.length - 1 : Math.floor(Math.log2(Math.max(image.width, image.height)))) : 0
    const sizes: [number, number][] = []
    let w = useLastMip ? 1 : image.width, h = useLastMip ? 1 : image.height
    do { w = Math.ceil(w / 8); h = Math.ceil(h / 8); sizes.push([w, h]) } while (w > 1 || h > 1)
    const bytes = sizes.reduce((n, [x, y]) => n + x * y * 16, 9 * 4)
    if (!this.reserveScratch(bytes)) throw new Error('Бюджет средних карт исчерпан')
    const saved = {
      target: r.getRenderTarget(), layer: r.getActiveCubeFace(), mip: r.getActiveMipmapLevel(),
      viewport: r.getViewport(new Vector4()), scissor: r.getScissor(new Vector4()),
      scissorTest: r.getScissorTest(), color: r.getClearColor(new Color()), alpha: r.getClearAlpha(), autoClear: r.autoClear
    }
    const targets: WebGLRenderTarget[] = []
    const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
    const material = new RawShaderMaterial({
      glslVersion: GLSL3, depthWrite: false, depthTest: false, blending: NoBlending, toneMapped: false,
      uniforms: { source: { value: texture }, sourceSize: { value: new Vector2(useLastMip ? 1 : image.width, useLastMip ? 1 : image.height) },
        sourceMip: { value: level }, weighted: { value: false }, undoSrgb: { value: !decode && texture.colorSpace === SRGBColorSpace } },
      vertexShader: 'precision highp float; in vec3 position; void main() { gl_Position = vec4(position, 1.0); }',
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D source;
        uniform ivec2 sourceSize;
        uniform int sourceMip;
        uniform bool weighted;
        uniform bool undoSrgb;
        out vec4 result;
        void main() {
          vec3 sum = vec3(0.0); float count = 0.0;
          ivec2 first = ivec2(gl_FragCoord.xy) * 8;
          for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) {
            ivec2 p = first + ivec2(x, y);
            if (all(lessThan(p, sourceSize))) {
              vec4 value = texelFetch(source, p, sourceMip);
              if (undoSrgb) value.rgb = mix(12.92 * value.rgb, 1.055 * pow(max(value.rgb, 0.0), vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), value.rgb));
              float weight = weighted ? value.a : 1.0;
              sum += value.rgb * weight; count += weight;
            }
          }
          result = vec4(sum / max(count, 1.0), count);
        }`
    })
    const scene = new Scene(), mesh = new Mesh(geometry, material), camera = new Camera()
    mesh.frustumCulled = false
    scene.add(mesh)
    rememberImpostorContext(geometry, material)
    try {
      r.autoClear = false
      r.initTexture(texture)
      for (const [width, height] of sizes) {
        if (gl.isContextLost()) throw new Error('Контекст WebGL потерян')
        const target = new WebGLRenderTarget(width, height, { type: FloatType, format: RGBAFormat, internalFormat: 'RGBA32F',
          depthBuffer: false, stencilBuffer: false, minFilter: NearestFilter, magFilter: NearestFilter, colorSpace: NoColorSpace })
        targets.push(target)
        rememberImpostorContext(target, target.texture)
        r.setRenderTarget(target)
        r.render(scene, camera)
        material.uniforms.source.value = target.texture
        material.uniforms.sourceSize.value.set(width, height)
        material.uniforms.sourceMip.value = 0
        material.uniforms.weighted.value = true
        material.uniforms.undoSrgb.value = false
      }
      const pixel = new Float32Array(4)
      if (gl.isContextLost()) throw new Error('Контекст WebGL потерян')
      r.readRenderTargetPixels(targets[targets.length - 1], 0, 0, 1, 1, pixel)
      if (pixel[3] <= 0 || pixel.some(n => !Number.isFinite(n))) throw new Error('Не удалось прочитать среднее карты')
      return new Vector3(pixel[0], pixel[1], pixel[2])
    } finally {
      if (!gl.isContextLost()) {
        r.setViewport(saved.viewport)
        r.setScissor(saved.scissor)
        r.setRenderTarget(saved.target, saved.layer, saved.mip)
        r.setScissorTest(saved.scissorTest)
        r.setClearColor(saved.color, saved.alpha)
      }
      r.autoClear = saved.autoClear
      if (gl.isContextLost()) forgetImpostorContext(...targets, ...targets.map(target => target.texture), geometry, material)
      this.releaseGpu(() => {
        for (const target of targets) target.dispose()
        geometry.dispose()
        material.dispose()
      })
      this.releaseScratch()
    }
  }
}
