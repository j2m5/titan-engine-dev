/**
 * NebulaVolumeGenerator.ts
 *
 * Boot-time генератор 3D-текстуры облачной плотности для туманностей.
 * Структурный аналог AtmosphereLUTGenerator, но проще: один проход, одна
 * 3D-текстура, без многопроходного рассеяния.
 *
 * Что пишем в текстуру: СЫРОЕ облачное поле fbm(warp(p)) в диапазоне [0,1].
 * НЕ пишем: порог, архетип, edge-маску, цвет — всё это остаётся в рантайм-
 * шейдере поверх fetch. Так одна текстура максимально переиспользуема между
 * кусками композитной туманности (разнообразие — сдвигом texcoord), а
 * параметры формы/порога/цвета остаются живыми рантайм-ручками.
 *
 * Формат: HalfFloat + R-канал (только плотность). 128³ × R16F ≈ 4 МБ.
 * В WebGL2 линейная фильтрация half-float доступна по умолчанию (без
 * расширений), поэтому LinearFilter + ClampToEdge по XYZ — против воксельности
 * и заворота границ.
 *
 * CRITICAL (как в AtmosphereLUTGenerator): для RawShaderMaterial Three.js
 * загружает только те uniform, что объявлены в объекте uniforms.
 */

import {
  Camera,
  ClampToEdgeWrapping,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NoBlending,
  PlaneGeometry,
  RawShaderMaterial,
  RedFormat,
  Scene,
  Texture,
  Uniform,
  WebGL3DRenderTarget,
  type WebGLRenderer
} from 'three'
import { noiseFunctions } from '@/core/materials/shaders/lib/chunks/Noise'
import { NebulaParameters } from '@/core/renderables/Nebula/NebulaParameters'

// ════════════════════════════════════════════════════════════════════
// Shared GLSL
// ════════════════════════════════════════════════════════════════════

const FULLSCREEN_VERT = /* glsl */ `
  precision highp float;
  in vec2 position;
  void main() {
    gl_Position = vec4(position, 1.0, 1.0);
  }
`

/**
 * Фрагментный шейдер генерации. Воспроизводит ТО ЖЕ облачное поле, что в
 * рантайме (fbm + domain warp), но для воксельной координаты [-1,1]³.
 * snoise встраиваем напрямую (в boot-time RawShaderMaterial нет препроцессора
 * #include <noiseFunctions> рантайм-пайплайна).
 */
const VOLUME_FRAG = /* glsl */ `
  precision highp float;

  ${noiseFunctions}

  uniform int u_layer;
  uniform float u_depth;        // глубина текстуры (число слоёв)
  uniform vec2 u_size;          // ширина/высота слоя в текселях
  uniform float uSeed;
  uniform float uNoiseFrequency;
  uniform int uOctaves;
  uniform float uWarpStrength;

  layout(location = 0) out vec4 fragColor;

  float fbm(vec3 p) {
    vec3 sp = p + fract(uSeed * 0.1731) * 10.0;
    float sum = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 8; i++) {
      if (i >= uOctaves) break;
      sum += amp * snoise(sp * freq);
      freq *= 2.0;
      amp *= 0.5;
    }
    return sum;
  }

  float fbmWarp(vec3 p, vec3 offset) {
    float seedShift = fract(uSeed * 0.1731) * 10.0;
    return snoise(p + offset + seedShift);
  }

  vec3 warpField(vec3 p) {
    return vec3(
      fbmWarp(p, vec3( 0.0,   0.0,   0.0)),
      fbmWarp(p, vec3(31.4,  17.7,  42.1)),
      fbmWarp(p, vec3(73.2,  91.5,  12.8))
    );
  }

  void main() {
    // воксельная координата → нормированная позиция [-1,1]³
    // gl_FragCoord.xy в [0.5 .. size-0.5]; u_layer — индекс слоя
    vec3 voxel = vec3(gl_FragCoord.xy, float(u_layer) + 0.5);
    vec3 uvw = voxel / vec3(u_size, u_depth);     // [0,1]³
    vec3 p = uvw * 2.0 - 1.0;                       // [-1,1]³

    vec3 q = p * uNoiseFrequency;
    vec3 warped = q + uWarpStrength * warpField(q);

    float n = fbm(warped);          // ~[-1,1]
    float d = n * 0.5 + 0.5;        // [0,1] — СЫРОЕ облачное поле

    fragColor = vec4(d, 0.0, 0.0, 1.0);
  }
`

// ════════════════════════════════════════════════════════════════════
// Generator
// ════════════════════════════════════════════════════════════════════

function create3DRT(w: number, h: number, d: number): WebGL3DRenderTarget {
  const rt = new WebGL3DRenderTarget(w, h, d, {
    depthBuffer: false,
    type: HalfFloatType,
    format: RedFormat
  })
  rt.texture.minFilter = LinearFilter
  rt.texture.magFilter = LinearFilter
  rt.texture.wrapS = ClampToEdgeWrapping
  rt.texture.wrapT = ClampToEdgeWrapping
  rt.texture.wrapR = ClampToEdgeWrapping
  rt.texture.name = 'NebulaCloudVolume'
  return rt
}

class NebulaVolumeGenerator {
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new Camera()
  private readonly mesh: Mesh
  private readonly material: RawShaderMaterial

  public constructor(renderer: WebGLRenderer) {
    this.renderer = renderer
    this.mesh = new Mesh(new PlaneGeometry(2, 2))
    this.scene.add(this.mesh)

    this.material = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: VOLUME_FRAG,
      uniforms: {
        u_layer: new Uniform(0),
        u_depth: new Uniform(0),
        u_size: new Uniform({ x: 0, y: 0 }),
        uSeed: new Uniform(0),
        uNoiseFrequency: new Uniform(3.6),
        uOctaves: new Uniform(4),
        uWarpStrength: new Uniform(0.5)
      },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending
    })
    this.mesh.material = this.material
  }

  /**
   * Генерирует 3D-текстуру облака. Возвращает Texture (владелец — RT внутри).
   * resolution — сторона куба текстуры (например 128).
   */
  public generate(params: NebulaParameters, resolution: number): Texture {
    const renderer = this.renderer
    const savedAutoClear = renderer.autoClear
    const savedTarget = renderer.getRenderTarget()
    renderer.autoClear = false

    const rt = create3DRT(resolution, resolution, resolution)

    const u = this.material.uniforms
    u.u_depth.value = resolution
    u.u_size.value = { x: resolution, y: resolution }
    u.uSeed.value = params.seed
    u.uNoiseFrequency.value = params.noiseFrequency
    u.uOctaves.value = params.octaves
    u.uWarpStrength.value = params.warpStrength

    try {
      for (let layer = 0; layer < resolution; layer++) {
        u.u_layer.value = layer
        renderer.setRenderTarget(rt, layer)
        renderer.render(this.scene, this.camera)
      }
    } finally {
      renderer.autoClear = savedAutoClear
      renderer.setRenderTarget(savedTarget)
    }

    return rt.texture
  }

  public dispose(): void {
    this.material.dispose()
    this.mesh.geometry.dispose()
  }
}

export { NebulaVolumeGenerator }
