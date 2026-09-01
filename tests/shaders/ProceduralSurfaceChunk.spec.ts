import { describe, expect, it } from 'vitest'
import { proceduralDiffuseFragment, proceduralFieldChunk } from '@/core/materials/shaders/lib/chunks/ProceduralSurface'

describe('ProceduralSurface GLSL', () => {
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
