import { Actor } from '@/core/models/Actor'

/** W26: радиус в километрах, температура в кельвинах; data — renderingObject.data */
export function stubGiantActor(data: object = {}): Actor {
  return {
    // Имя отдаётся явной веткой: `'' ?? 'x'` вернул бы пустую строку
    getAttribute: (key: string, def?: unknown): unknown =>
      key === 'categoryId' ? 10 : key === 'name' ? 'W26' : def,
    // Именно null: OrientationModel проверяет `!== null`
    rotation: null,
    renderingObject: { getAttribute: () => data },
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown =>
        key === 'radius' ? 1.06e9 : key === 'temperature' ? 3700 : def
    }
  } as unknown as Actor
}
