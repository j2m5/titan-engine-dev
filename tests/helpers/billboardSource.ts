import { BILLBOARD_VERTEX_SHADER } from '@/core/renderables/DetailedRingStreamingSystem/BillboardAsteroidMaterial'

/**
 * Исходник вершинника билборда для структурных проверок шейдера: материал для
 * этого создавать не нужно, текст лежит модульной константой.
 */
export const billboardVertexSource = (): string => BILLBOARD_VERTEX_SHADER
