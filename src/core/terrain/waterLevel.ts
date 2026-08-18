import type { Actor } from '@/core/models/Actor'
import { readRenderingData } from '@/core/helpers/renderingData'
import type { IPlanetRenderingObject } from '@/core/models/types'

/**
 * Единый предикат валидности `waterLevelMeters` (Task 5, water-foundation).
 * `readRenderingData` отдаёт `unknown` под капотом (см. её докблок): БД не
 * различает `null`/`NaN`/строку на уровне типов, а три места чтения этой
 * ручки (коллизия, SSE-отбор через TerrainSphere, фабрика WaterSphere)
 * раньше проверяли РАЗНО — `!== undefined` в двух местах (`null`/`NaN`
 * молча проезжали дальше) и `typeof === 'number'` в третьем (без
 * `Number.isFinite`, `NaN` тоже молча проезжал). Три разных вырожденных
 * поведения на одну и ту же нечисловую запись БД: коллизия клампила бы
 * NaN-позицию камеры (`Math.max(x, NaN) === NaN`), отбор — NaN-высоту узла,
 * фабрика строила бы WaterSphere по `null` как по «оболочке R+0» (ревью
 * Task 5, фикс-раунд 1, находка №3). Здесь — одна проверка, один источник
 * правды для всех трёх.
 */
export function readWaterLevelMeters(model: Actor): number | undefined {
  const value = readRenderingData<IPlanetRenderingObject>(model)?.waterLevelMeters

  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
