import { AddEquation, CustomBlending, OneFactor, ShaderMaterial, Uniform, Vector2, type Texture } from 'three'
import {
  DISC_EDGE,
  DISC_RIM_GAIN,
  DISC_RIM_WIDTH,
  FLARE_GHOSTS,
  GHOST_CUTOFF,
  GHOST_SQUEEZE,
  RING_WIDTH,
  ghostEnergy,
  lumaNormalized,
  profileExtent,
  profilePeak
} from './flareGhosts'
import { glslFloat } from './glslLiteral'

const count = FLARE_GHOSTS.length
const floats = (values: readonly number[]): string => `float[${count}](${values.map(glslFloat).join(', ')})`
const colors = FLARE_GHOSTS.map((g) => lumaNormalized(g.tint).map((c) => c * ghostEnergy(g)))

const ghostTable: string = `
  #define GHOST_COUNT ${count}
  const float GHOST_M[${count}] = ${floats(FLARE_GHOSTS.map((g) => g.m))};
  const float GHOST_RADIUS[${count}] = ${floats(FLARE_GHOSTS.map((g) => g.radius))};
  const float GHOST_RING[${count}] = ${floats(FLARE_GHOSTS.map((g) => (g.profile === 'ring' ? 1 : 0)))};
  const float GHOST_PEAK[${count}] = ${floats(FLARE_GHOSTS.map((g) => profilePeak(g.profile)))};
  const float GHOST_EXTENT[${count}] = ${floats(FLARE_GHOSTS.map((g) => profileExtent(g.profile)))};
  // Оттенок с единичной яркостью × энергия (доля потока / площадь профиля, с калибровкой)
  const vec3 GHOST_COLOR[${count}] = vec3[${count}](${colors.map((c) => `vec3(${c.map(glslFloat).join(', ')})`).join(', ')});
`

const vertexShader: string = `
  #include <common>
  ${ghostTable}
  #define GHOST_SQUEEZE ${glslFloat(GHOST_SQUEEZE)}
  #define GHOST_CUTOFF ${glslFloat(GHOST_CUTOFF)}

  uniform sampler2D sourceFlux;
  uniform sampler2D sourceCentroid;
  uniform vec2 gridSize;
  uniform float aspect;
  uniform float ghostAmount;
  uniform float intensity;
  uniform float ghostVignette;
  uniform float ghostChromatic;

  out vec2 vLocal;
  flat out vec3 vColor;
  flat out float vRing;

  void main() {
    int ghost = gl_InstanceID % GHOST_COUNT;
    int cellIndex = gl_InstanceID / GHOST_COUNT;
    int cols = int(gridSize.x);
    ivec2 cell = ivec2(cellIndex % cols, cellIndex / cols);
    vec4 flux = texelFetch(sourceFlux, cell, 0);
    vec2 source = texelFetch(sourceCentroid, cell, 0).xy;

    // Виньетирование: источник у угла кадра гасит призраков; показатель 0 — единица
    float corner = 0.5 * sqrt(aspect * aspect + 1.0);
    float r = min(length(source) / corner, 1.0);
    float vignette = exp2(ghostVignette * log2(max(1.0 - r * r, 1e-6)));
    vec3 color = flux.rgb * GHOST_COLOR[ghost] * vignette;
    float peak = luminance(color) * GHOST_PEAK[ghost] * ghostAmount * intensity;

    // Невыбранная ячейка или призрак тусклее отсечки — квад за пределами клипа
    if (flux.a <= 0.0 || peak < GHOST_CUTOFF) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    float reach = GHOST_EXTENT[ghost] * (1.0 + ghostChromatic);
    vec2 halfSize = GHOST_RADIUS[ghost] * vec2(GHOST_SQUEEZE, 1.0) * reach;
    vec2 center = GHOST_M[ghost] * source;
    vec2 frame = center + position.xy * halfSize;

    // Нормированные координаты овала: ρ = 1 — его край
    vLocal = position.xy * reach;
    vColor = color;
    vRing = GHOST_RING[ghost];
    gl_Position = vec4(2.0 * frame.x / aspect, 2.0 * frame.y, 0.0, 1.0);
  }
`

const fragmentShader: string = `
  #define DISC_EDGE ${glslFloat(DISC_EDGE)}
  #define DISC_RIM_GAIN ${glslFloat(DISC_RIM_GAIN)}
  #define DISC_RIM_WIDTH ${glslFloat(DISC_RIM_WIDTH)}
  #define RING_WIDTH ${glslFloat(RING_WIDTH)}

  uniform float ghostChromatic;

  in vec2 vLocal;
  flat in vec3 vColor;
  flat in float vRing;

  // Зеркало — ghostProfile (flareGhosts.ts)
  float ghostProfile(float rho) {
    if (vRing > 0.5) {
      float d = (rho - 1.0) / RING_WIDTH;
      return exp(-d * d);
    }
    float rim = (rho - (1.0 - DISC_EDGE)) / DISC_RIM_WIDTH;
    return (1.0 - smoothstep(1.0 - DISC_EDGE, 1.0, rho)) * (1.0 + DISC_RIM_GAIN * exp(-rim * rim));
  }

  void main() {
    float rho = length(vLocal);
    // Каёмка: радиус по каналам R·(1 ± χ) — красный снаружи, синий внутри
    vec3 profile = vec3(
      ghostProfile(rho / (1.0 + ghostChromatic)),
      ghostProfile(rho),
      ghostProfile(rho / (1.0 - ghostChromatic))
    );
    gl_FragColor = vec4(min(vColor * profile, vec3(60000.0)), 1.0);
  }
`

/** Общие с композитом ручки: те же объекты Uniform, значения синхронны по построению */
export interface FlareGhostShared {
  ghostAmount: Uniform<number>
  intensity: Uniform<number>
}

/** Спрайты призраков: инстанс на пару «ячейка сетки × призрак таблицы», сложением */
export class FlareGhostMaterial extends ShaderMaterial {
  constructor(shared: FlareGhostShared, sourceFlux: Texture, sourceCentroid: Texture) {
    super({
      name: 'FlareGhostMaterial',
      vertexShader,
      fragmentShader,
      uniforms: {
        sourceFlux: new Uniform(sourceFlux),
        sourceCentroid: new Uniform(sourceCentroid),
        gridSize: new Uniform(new Vector2(1, 1)),
        aspect: new Uniform(1),
        ghostAmount: shared.ghostAmount,
        intensity: shared.intensity,
        ghostVignette: new Uniform(2),
        ghostChromatic: new Uniform(0.04)
      },
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    })
  }

  setGrid(cols: number, rows: number, aspect: number): void {
    ;(this.uniforms.gridSize.value as Vector2).set(cols, rows)
    this.uniforms.aspect.value = aspect
  }

  get ghostVignette(): number {
    return this.uniforms.ghostVignette.value
  }

  set ghostVignette(value: number) {
    this.uniforms.ghostVignette.value = value
  }

  get ghostChromatic(): number {
    return this.uniforms.ghostChromatic.value
  }

  set ghostChromatic(value: number) {
    this.uniforms.ghostChromatic.value = value
  }
}
