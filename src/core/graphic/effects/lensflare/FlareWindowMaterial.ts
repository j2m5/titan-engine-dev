import { NoBlending, ShaderMaterial, Uniform, Vector2 } from 'three'
import { SOURCE_WINDOW_CELLS } from './flareGrid'

const vertexShader: string = `
  void main() {
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

/**
 * Окно источников: для выбранной ячейки — сумма потоков выбранных ячеек в
 * квадрате ±SOURCE_WINDOW_CELLS и сумма их квадратов. По ним копии
 * раздробленного диска делят сжатый общий поток и гаснут, когда их много.
 * Зеркало — sourceWindows (flareGrid.ts).
 */
const fragmentShader: string = `
  #define SOURCE_WINDOW_CELLS ${SOURCE_WINDOW_CELLS}

  uniform sampler2D inputBuffer;
  uniform vec2 gridSize;

  void main() {
    ivec2 cell = ivec2(gl_FragCoord.xy);
    ivec2 grid = ivec2(gridSize);
    float self = texelFetch(inputBuffer, cell, 0).a;
    if (self <= 0.0) {
      gl_FragColor = vec4(0.0);
      return;
    }

    // Невыбранные ячейки хранят нули и в суммы не входят
    float flux = 0.0;
    float fluxSquared = 0.0;
    for (int dy = -SOURCE_WINDOW_CELLS; dy <= SOURCE_WINDOW_CELLS; dy++) {
      for (int dx = -SOURCE_WINDOW_CELLS; dx <= SOURCE_WINDOW_CELLS; dx++) {
        ivec2 n = cell + ivec2(dx, dy);
        if (n.x < 0 || n.y < 0 || n.x >= grid.x || n.y >= grid.y) continue;
        float f = texelFetch(inputBuffer, n, 0).a;
        flux += f;
        fluxSquared += f * f;
      }
    }

    gl_FragColor = vec4(flux, fluxSquared, 0.0, 1.0);
  }
`

/** Проход окна источников: поток окна (x) и сумма квадратов (y); невыбранная ячейка — нули */
export class FlareWindowMaterial extends ShaderMaterial {
  constructor() {
    super({
      name: 'FlareWindowMaterial',
      vertexShader,
      fragmentShader,
      uniforms: {
        inputBuffer: new Uniform(null),
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
