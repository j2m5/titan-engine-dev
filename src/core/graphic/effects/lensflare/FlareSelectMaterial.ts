import { NoBlending, ShaderMaterial, Uniform, Vector2, type Texture } from 'three'

const vertexShader: string = `
  void main() {
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

/**
 * Отбор источников: ячейка выбрана, если её поток > 0 и строго больше
 * соседей 3×3 (при равенстве — меньший индекс); выбранная получает поток и
 * центр всего блока. Зеркало — selectMaxima (flareGrid.ts).
 */
const fragmentShader: string = `
  uniform sampler2D inputBuffer;
  uniform sampler2D centroidBuffer;
  uniform vec2 gridSize;

  void main() {
    ivec2 cell = ivec2(gl_FragCoord.xy);
    ivec2 grid = ivec2(gridSize);
    float self = texelFetch(inputBuffer, cell, 0).a;
    int selfIndex = cell.y * grid.x + cell.x;
    bool isMax = self > 0.0;
    vec4 sumFlux = vec4(0.0);
    vec2 moment = vec2(0.0);
    float peak = 0.0;

    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        ivec2 n = cell + ivec2(dx, dy);
        if (n.x < 0 || n.y < 0 || n.x >= grid.x || n.y >= grid.y) continue;
        vec4 nf = texelFetch(inputBuffer, n, 0);
        vec4 nc = texelFetch(centroidBuffer, n, 0);
        int nIndex = n.y * grid.x + n.x;
        if ((dx != 0 || dy != 0) && (nf.a > self || (nf.a == self && nIndex < selfIndex))) isMax = false;
        sumFlux += nf;
        moment += nf.a * nc.xy;
        peak = max(peak, nc.z);
      }
    }

    if (!isMax) {
      gl_FragColor = vec4(0.0);
      return;
    }

    #ifdef OUTPUT_CENTROID
      gl_FragColor = vec4(moment / sumFlux.a, peak, 1.0);
    #else
      gl_FragColor = sumFlux;
    #endif
  }
`

/** Проход отбора: поток блока (как у сбора) или его центр и пик; невыбранная ячейка — нули */
export class FlareSelectMaterial extends ShaderMaterial {
  constructor(output: 'flux' | 'centroid', centroidBuffer: Texture) {
    super({
      name: output === 'flux' ? 'FlareSelectFluxMaterial' : 'FlareSelectCentroidMaterial',
      vertexShader,
      fragmentShader,
      defines: output === 'centroid' ? { OUTPUT_CENTROID: '1' } : {},
      uniforms: {
        inputBuffer: new Uniform(null),
        centroidBuffer: new Uniform(centroidBuffer),
        gridSize: new Uniform(new Vector2(1, 1))
      },
      blending: NoBlending,
      toneMapped: false,
      depthWrite: false,
      depthTest: false
    })
  }

  setGrid(cols: number, rows: number): void {
    ;(this.uniforms.gridSize.value as Vector2).set(cols, rows)
  }
}
