import { BILLBOARD_VERTEX_SHADER, BillboardAsteroidMaterial } from '@/core/renderables/DetailedRingStreamingSystem/BillboardAsteroidMaterial'

/**
 * Исходник вершинника билборда для структурных проверок шейдера: материал для
 * этого создавать не нужно, текст лежит модульной константой.
 */
export const billboardVertexSource = (atlasMode = false): string => {
  if (!atlasMode) return BILLBOARD_VERTEX_SHADER
  const material = new BillboardAsteroidMaterial(undefined, false, false, true)
  const source = material.vertexShader
  material.dispose()
  return source
}
