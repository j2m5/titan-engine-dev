import { describe, expect, it } from 'vitest'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { WaterShaderTemplate } from '@/core/materials/shaders/lib/WaterShaderTemplate'
import { RingShaderTemplate } from '@/core/materials/shaders/lib/RingShaderTemplate'

// modelMatrix тел и колец — чистый поворот + трансляция (object.scale не
// используется), поэтому обратная для направлений = транспонированная 3×3.
// inverse() 4×4 на каждой вершине — лишняя работа.
const LOCAL_LIGHT = 'vec3 localLightDirection = transpose(mat3(modelMatrix)) * worldLightDirection;'

describe('вершинники без inverse(modelMatrix)', () => {
  it.each([
    ['палуба', PlanetShaderTemplate.vertexShader],
    ['вода', WaterShaderTemplate.vertexShader],
    ['кольцо', RingShaderTemplate.vertexShader]
  ])('%s: inverse() не вызывается', (_name, vertex) => {
    expect(vertex).not.toContain('inverse(')
  })

  it('палуба и вода считают локальное направление света одной строкой', () => {
    expect(PlanetShaderTemplate.vertexShader).toContain(LOCAL_LIGHT)
    expect(WaterShaderTemplate.vertexShader).toContain(LOCAL_LIGHT)
  })

  it('кольцо переводит камеру в локальные оси через транспонирование после вычитания трансляции', () => {
    expect(RingShaderTemplate.vertexShader).toContain('mat3 worldToLocal = transpose(mat3(modelMatrix));')
    expect(RingShaderTemplate.vertexShader).toContain(
      'vLocalCameraPosition = worldToLocal * (cameraPosition - modelMatrix[3].xyz);'
    )
  })
})
