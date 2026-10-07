import { AddEquation, CustomBlending, OneFactor, ShaderMaterial, Uniform, Vector2, type Texture } from 'three'
import {
  STARBURST_ANGLES_DEG,
  STARBURST_CORE,
  STARBURST_DISPERSION,
  STARBURST_EPSILON,
  STARBURST_KAPPA,
  STARBURST_MAX_LENGTH,
  STARBURST_WIDTH
} from './flareStarburst'
import { FLUX_REFERENCE_HEIGHT } from './flareGrid'
import { glslFloat } from './glslLiteral'

const directions = STARBURST_ANGLES_DEG.map((angle) => {
  const radians = (angle * Math.PI) / 180
  return `vec2(${glslFloat(Math.cos(radians))}, ${glslFloat(Math.sin(radians))})`
})

const vertexShader: string = `
  #define STARBURST_KAPPA ${glslFloat(STARBURST_KAPPA)}
  #define STARBURST_CORE ${glslFloat(STARBURST_CORE)}
  #define STARBURST_EPSILON ${glslFloat(STARBURST_EPSILON)}
  #define STARBURST_MAX_LENGTH ${glslFloat(STARBURST_MAX_LENGTH)}
  #define DISPERSION_RED ${glslFloat(STARBURST_DISPERSION[0])}
  #define FLUX_TO_PIXELS ${glslFloat(FLUX_REFERENCE_HEIGHT * FLUX_REFERENCE_HEIGHT)}

  uniform sampler2D sourceFlux;
  uniform sampler2D sourceCentroid;
  uniform vec2 gridSize;
  uniform float aspect;
  uniform float starburstAmount;
  uniform float intensity;
  uniform float starburstMinFlux;

  out vec2 vOffset;
  flat out vec3 vI0;

  // Rec. 709 weights — используем flareLuma, встроенная функция доступна только во фрагменте
  float flareLuma(vec3 c) {
    return dot(vec3(0.2126, 0.7152, 0.0722), c);
  }

  void main() {
    int cols = int(gridSize.x);
    ivec2 cell = ivec2(gl_InstanceID % cols, gl_InstanceID / cols);
    vec4 flux = texelFetch(sourceFlux, cell, 0);
    vec2 source = texelFetch(sourceCentroid, cell, 0).xy;

    // Плавный вход по потоку: источник на пороге не мигает
    float fluxPixels = flux.a * FLUX_TO_PIXELS;
    float weight = starburstMinFlux > 0.0 ? smoothstep(starburstMinFlux, 2.0 * starburstMinFlux, fluxPixels) : 1.0;
    vec3 i0 = STARBURST_KAPPA * flux.rgb * weight;
    float i0Screen = flareLuma(i0) * starburstAmount * intensity;

    if (flux.a <= 0.0 || i0Screen * DISPERSION_RED <= STARBURST_EPSILON) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    // Красный канал — самый длинный: квад покрывает его до ε
    float reach = (STARBURST_CORE / DISPERSION_RED) * (sqrt(i0Screen * DISPERSION_RED / STARBURST_EPSILON) - 1.0);
    float halfSize = clamp(reach, STARBURST_CORE, STARBURST_MAX_LENGTH);
    vec2 frame = source + position.xy * halfSize;

    vOffset = position.xy * halfSize;
    vI0 = i0;
    gl_Position = vec4(2.0 * frame.x / aspect, 2.0 * frame.y, 0.0, 1.0);
  }
`

const fragmentShader: string = `
  #define STARBURST_CORE ${glslFloat(STARBURST_CORE)}
  #define STARBURST_WIDTH ${glslFloat(STARBURST_WIDTH)}

  const vec3 DISPERSION = vec3(${STARBURST_DISPERSION.map(glslFloat).join(', ')});
  const vec2 SPIKE_DIRECTIONS[3] = vec2[3](${directions.join(', ')});

  in vec2 vOffset;
  flat in vec3 vI0;

  void main() {
    vec3 color = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      vec2 dir = SPIKE_DIRECTIONS[i];
      float along = abs(dot(vOffset, dir));
      float across = dot(vOffset, vec2(-dir.y, dir.x)) / STARBURST_WIDTH;
      // Зеркало — spikeIntensity (flareStarburst.ts); k по каналам растягивает картину
      vec3 falloff = 1.0 + along * DISPERSION / STARBURST_CORE;
      color += vI0 * DISPERSION / (falloff * falloff) * exp(-across * across);
    }
    gl_FragColor = vec4(min(color, vec3(60000.0)), 1.0);
  }
`

/** Общие с композитом ручки: те же объекты Uniform */
export interface FlareStarburstShared {
  starburstAmount: Uniform<number>
  intensity: Uniform<number>
}

/** Спрайты лучей: инстанс на ячейку сетки, сложением; лучи закреплены в кадре */
export class FlareStarburstMaterial extends ShaderMaterial {
  constructor(shared: FlareStarburstShared, sourceFlux: Texture, sourceCentroid: Texture) {
    super({
      name: 'FlareStarburstMaterial',
      vertexShader,
      fragmentShader,
      uniforms: {
        sourceFlux: new Uniform(sourceFlux),
        sourceCentroid: new Uniform(sourceCentroid),
        gridSize: new Uniform(new Vector2(1, 1)),
        aspect: new Uniform(1),
        starburstAmount: shared.starburstAmount,
        intensity: shared.intensity,
        starburstMinFlux: new Uniform(200)
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

  get starburstMinFlux(): number {
    return this.uniforms.starburstMinFlux.value
  }

  set starburstMinFlux(value: number) {
    this.uniforms.starburstMinFlux.value = value
  }
}
