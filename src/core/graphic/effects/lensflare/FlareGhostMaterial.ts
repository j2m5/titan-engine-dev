import { AddEquation, CustomBlending, OneFactor, ShaderMaterial, Uniform, Vector2, type Texture } from 'three'
import {
  FLARE_GHOSTS,
  GHOST_CUTOFF,
  GHOST_FADE_PIXELS,
  GHOST_SQUEEZE,
  SOURCE_DIAMETER_GAIN,
  ghostEnergy,
  lumaNormalized
} from './flareGhosts'
import { glslFloat } from './glslLiteral'

const count = FLARE_GHOSTS.length
const floats = (values: readonly number[]): string => `float[${count}](${values.map(glslFloat).join(', ')})`
const colors = FLARE_GHOSTS.map((g) => lumaNormalized(g.tint).map((c) => c * ghostEnergy(g)))

const ghostTable: string = `
  #define GHOST_COUNT ${count}
  const float GHOST_M[${count}] = ${floats(FLARE_GHOSTS.map((g) => g.m))};
  const float GHOST_RADIUS[${count}] = ${floats(FLARE_GHOSTS.map((g) => g.radius))};
  // Показатель купола или ядро ореола (GHOST_HALO = 1)
  const float GHOST_SHAPE[${count}] = ${floats(FLARE_GHOSTS.map((g) => (g.profile.kind === 'dome' ? g.profile.power : g.profile.core)))};
  const float GHOST_HALO[${count}] = ${floats(FLARE_GHOSTS.map((g) => (g.profile.kind === 'halo' ? 1 : 0)))};
  const float GHOST_SPREAD[${count}] = ${floats(FLARE_GHOSTS.map((g) => g.spread))};
  // Оттенок с единичной яркостью × пик на единицу потока (с калибровкой)
  const vec3 GHOST_COLOR[${count}] = vec3[${count}](${colors.map((c) => `vec3(${c.map(glslFloat).join(', ')})`).join(', ')});
`

const vertexShader: string = `
  ${ghostTable}
  #define GHOST_SQUEEZE ${glslFloat(GHOST_SQUEEZE)}
  #define GHOST_CUTOFF ${glslFloat(GHOST_CUTOFF)}
  #define GHOST_FADE_START ${glslFloat(GHOST_FADE_PIXELS.start)}
  #define GHOST_FADE_END ${glslFloat(GHOST_FADE_PIXELS.end)}
  #define SOURCE_DIAMETER_GAIN ${glslFloat(SOURCE_DIAMETER_GAIN)}

  uniform sampler2D sourceFlux;
  uniform sampler2D sourceCentroid;
  uniform vec2 gridSize;
  uniform float aspect;
  // Радиус локального контраста в пикселях 1080p: мера размера источника
  uniform float contrastPixels;
  uniform float ghostAmount;
  uniform float intensity;
  uniform float ghostVignette;
  uniform float ghostChromatic;

  // Смещение от центра зелёного канала, доли высоты кадра
  out vec2 vOffset;
  flat out vec2 vDelta;
  flat out vec2 vRadius;
  flat out vec3 vColor;
  flat out float vShape;
  flat out float vHalo;

  // Rec. 709 — те же веса, что у lumaNormalized (flareGhosts.ts); встроенная функция есть только во фрагменте
  float flareLuma(vec3 c) {
    return dot(vec3(0.2126, 0.7152, 0.0722), c);
  }

  void main() {
    int ghost = gl_InstanceID % GHOST_COUNT;
    int cellIndex = gl_InstanceID / GHOST_COUNT;
    int cols = int(gridSize.x);
    ivec2 cell = ivec2(cellIndex % cols, cellIndex / cols);
    vec4 flux = texelFetch(sourceFlux, cell, 0);
    vec4 sourceData = texelFetch(sourceCentroid, cell, 0);
    vec2 source = sourceData.xy;

    // Виньетирование: источник у угла кадра гасит призраков; показатель 0 — единица
    float corner = 0.5 * sqrt(aspect * aspect + 1.0);
    float r = min(length(source) / corner, 1.0);
    float vignette = exp2(ghostVignette * log2(max(1.0 - r * r, 1e-6)));
    // Крупный диск отбор дробит на копии — его призраки гаснут.
    // Зеркала — sourceDiameterPixels и ghostSizeFade (flareGhosts.ts)
    float diameter = SOURCE_DIAMETER_GAIN * contrastPixels * sourceData.z / max(flux.a, 1e-30);
    float sizeFade = 1.0 - smoothstep(GHOST_FADE_START, GHOST_FADE_END, diameter);
    vec3 color = flux.rgb * GHOST_COLOR[ghost] * vignette * sizeFade;
    float peak = flareLuma(color) * ghostAmount * intensity;

    // Невыбранная ячейка или призрак тусклее отсечки — квад за пределами клипа
    if (flux.a <= 0.0 || peak < GHOST_CUTOFF) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    // Каналы на оси: красный в центре − delta, синий в центре + delta (ghostChannelCenters)
    vec2 center = GHOST_M[ghost] * source;
    vec2 delta = GHOST_M[ghost] * GHOST_SPREAD[ghost] * ghostChromatic * source;
    vec2 radius = GHOST_RADIUS[ghost] * vec2(GHOST_SQUEEZE, 1.0);
    vec2 halfSize = radius + abs(delta);
    vec2 frame = center + position.xy * halfSize;

    vOffset = position.xy * halfSize;
    vDelta = delta;
    vRadius = radius;
    vColor = color;
    vShape = GHOST_SHAPE[ghost];
    vHalo = GHOST_HALO[ghost];
    gl_Position = vec4(2.0 * frame.x / aspect, 2.0 * frame.y, 0.0, 1.0);
  }
`

const fragmentShader: string = `
  in vec2 vOffset;
  flat in vec2 vDelta;
  flat in vec2 vRadius;
  flat in vec3 vColor;
  flat in float vShape;
  flat in float vHalo;

  // Зеркало — ghostProfile (flareGhosts.ts); у обоих профилей пик 1 в центре
  float ghostProfile(float rho) {
    if (rho >= 1.0) return 0.0;
    if (vHalo > 0.5) {
      float edge = 1.0 / (1.0 + 1.0 / (vShape * vShape));
      return (1.0 / (1.0 + rho * rho / (vShape * vShape)) - edge) / (1.0 - edge);
    }
    return 1.0 - pow(rho, vShape);
  }

  void main() {
    // Каналы — один профиль со сдвигом по оси: энергия каждого сохраняется
    vec3 profile = vec3(
      ghostProfile(length((vOffset + vDelta) / vRadius)),
      ghostProfile(length(vOffset / vRadius)),
      ghostProfile(length((vOffset - vDelta) / vRadius))
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
        contrastPixels: new Uniform(1),
        ghostAmount: shared.ghostAmount,
        intensity: shared.intensity,
        ghostVignette: new Uniform(2),
        ghostChromatic: new Uniform(1)
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

  /** contrastPixels — радиус локального контраста в пикселях 1080p (contrastRadiusPixels) */
  setGrid(cols: number, rows: number, aspect: number, contrastPixels: number): void {
    ;(this.uniforms.gridSize.value as Vector2).set(cols, rows)
    this.uniforms.aspect.value = aspect
    this.uniforms.contrastPixels.value = contrastPixels
  }

  get ghostVignette(): number {
    return this.uniforms.ghostVignette.value
  }

  set ghostVignette(value: number) {
    // показатель ≥ 0; 0 — без виньетирования (отрицательный раздул бы угол до 1e6)
    this.uniforms.ghostVignette.value = Math.max(value, 0)
  }

  get ghostChromatic(): number {
    return this.uniforms.ghostChromatic.value
  }

  set ghostChromatic(value: number) {
    // множитель разноса из таблицы; при 2 красный канал f5 доходит до центра кадра
    this.uniforms.ghostChromatic.value = Math.min(Math.max(value, 0), 2)
  }
}
