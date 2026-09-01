import { describe, expect, it } from 'vitest'
import { proceduralDiffuseFragment, proceduralFieldChunk } from '@/core/materials/shaders/lib/chunks/ProceduralSurface'
import { noiseFunctions } from '@/core/materials/shaders/lib/chunks/Noise'

describe('ProceduralSurface GLSL', () => {
  // snoise — общий чанк; его правка молча разведёт GPU-диффуз с CPU-высотами
  // процедурных тел — CPU-порт simplexNoise3.ts обязан меняться синхронно.
  it('пин несущих строк snoise(vec3) против тихого рассинхрона с CPU-портом', () => {
    expect(noiseFunctions).toContain('float snoise(vec3 v){')
    expect(noiseFunctions).toContain('vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);')
    expect(noiseFunctions).toContain('return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),')
    expect(noiseFunctions).toContain('vec3 mod289(vec3 x) {')
  })

  it('поле зеркалит CPU-формулу: октавный цикл, нормировка, контраст, сдвиг юниформом', () => {
    expect(proceduralFieldChunk).toContain('uFieldOffset')
    expect(proceduralFieldChunk).toContain('snoise(dir * frequency + uFieldOffset)')
    expect(proceduralFieldChunk).toContain('sign(v) * pow(abs(v), uFieldContrast)')
    expect(proceduralFieldChunk).toContain('amplitude *= uFieldGain')
    expect(proceduralFieldChunk).toContain('frequency *= uFieldLacunarity')
  })

  it('фрагмент генератора: uv → направление в конвенции dirToUv (север = верх текстуры), палитра 4 стопов', () => {
    expect(proceduralDiffuseFragment).toContain('theta = (1.0 - vUv.y) * PI')
    expect(proceduralDiffuseFragment).toContain('vec3(-sin(theta) * cos(phi), cos(theta), sin(theta) * sin(phi))')
    expect(proceduralDiffuseFragment).toContain('uPalette')
    expect(proceduralDiffuseFragment).toContain('uAlbedoNoise')
  })
})
