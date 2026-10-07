import { NoBlending, ShaderMaterial, Uniform, Vector2 } from 'three'
import { MAX_CELL_TEXELS } from './flareGrid'

const vertexShader: string = `
  void main() {
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

/**
 * Сбор сетки источников: фрагмент — ячейка, суммирует тексели буфера
 * локального контраста. Зеркало — gatherGrid (flareGrid.ts).
 */
const fragmentShader: string = `
  #include <common>

  #define MAX_CELL_TEXELS ${MAX_CELL_TEXELS}

  uniform sampler2D inputBuffer;
  // Размер буфера локального контраста в текселях и сетки в ячейках
  uniform vec2 sourceSize;
  uniform vec2 gridSize;
  // Площадь текселя в долях высоты кадра²: (1/H)²
  uniform float areaPerTexel;

  void main() {
    ivec2 cell = ivec2(gl_FragCoord.xy);
    vec2 cellTexels = sourceSize / gridSize;
    ivec2 lo = ivec2(floor(vec2(cell) * cellTexels));
    ivec2 hi = min(ivec2(floor(vec2(cell + 1) * cellTexels)), ivec2(sourceSize));
    float aspect = sourceSize.x / sourceSize.y;

    vec3 flux = vec3(0.0);
    float fluxLum = 0.0;
    vec2 moment = vec2(0.0);
    float peak = 0.0;

    for (int j = 0; j < MAX_CELL_TEXELS; j++) {
      int y = lo.y + j;
      if (y >= hi.y) break;
      for (int i = 0; i < MAX_CELL_TEXELS; i++) {
        int x = lo.x + i;
        if (x >= hi.x) break;
        vec3 c = texelFetch(inputBuffer, ivec2(x, y), 0).rgb;
        float l = luminance(c);
        vec2 uv = (vec2(x, y) + 0.5) / sourceSize;
        flux += c;
        fluxLum += l;
        moment += l * vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
        peak = max(peak, l);
      }
    }

    #ifdef OUTPUT_CENTROID
      gl_FragColor = vec4(fluxLum > 0.0 ? moment / fluxLum : vec2(0.0), peak, 1.0);
    #else
      gl_FragColor = vec4(flux * areaPerTexel, fluxLum * areaPerTexel);
    #endif
  }
`

/** Проход сбора: поток (rgb по каналам, a по яркости) или центр яркости (xy) и пик (z) */
export class FlareGridMaterial extends ShaderMaterial {
  constructor(output: 'flux' | 'centroid') {
    super({
      name: output === 'flux' ? 'FlareGridFluxMaterial' : 'FlareGridCentroidMaterial',
      vertexShader,
      fragmentShader,
      defines: output === 'centroid' ? { OUTPUT_CENTROID: '1' } : {},
      uniforms: {
        inputBuffer: new Uniform(null),
        sourceSize: new Uniform(new Vector2(1, 1)),
        gridSize: new Uniform(new Vector2(1, 1)),
        areaPerTexel: new Uniform(1)
      },
      blending: NoBlending,
      toneMapped: false,
      depthWrite: false,
      depthTest: false
    })
  }

  setSize(sourceWidth: number, sourceHeight: number, cols: number, rows: number): void {
    ;(this.uniforms.sourceSize.value as Vector2).set(sourceWidth, sourceHeight)
    ;(this.uniforms.gridSize.value as Vector2).set(cols, rows)
    this.uniforms.areaPerTexel.value = 1 / Math.max(sourceHeight * sourceHeight, 1)
  }
}
