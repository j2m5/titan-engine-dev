import type { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import type { RenderableObject3D } from '@/core/renderables/types'

/**
 * Дочерние материалы-подписчики `renderable` (сейчас — только `WaterMaterial`
 * на `WaterSphere`, ребёнок `TerrainSphere`). Всегда `updateMaterial()`, не
 * произвольная операция вызывающего: у подписчика нет семантики «диффуз
 * потерян → заглушка» primary-материала (ветка `isDiffuse` в
 * `ResourceObserver.evictPath`/`handleLoadFailure` читает РЕСУРС primary, не
 * подписчика) — вызов `resetMaterial()` primary на её месте нёс бы
 * заглушечный сброс воде даже когда её собственный slope-путь цел.
 * `updateMaterial()` у подписчика идемпотентен — пересинхронизируется с
 * `resourceStorage` по своему кэшированному пути, needsUpdate дёргается
 * только при фактической смене гейта (см. `WaterMaterial.updateMaterial`).
 *
 * Раньше вода узнавала о вытеснении своей карты лишь на следующем кадре
 * (`WaterSphere.onVisibleUpdate`, вызывается из update-цикла): рендер
 * ТЕКУЩЕГО кадра успевал перезалить уже диспоузнутую
 * `resourceStorage.deleteTexture` текстуру в GL без владельца в реестре —
 * утечка GL-объекта.
 *
 * Дедуп по ссылке на `primary`: живые патчи рельефа в `children` — Mesh с
 * ТЕМ ЖЕ материалом, что уже обработан вызывающим, без дедупа
 * `updateMaterial()` улетел бы на каждый живой патч. `?? []` — тестовые
 * дублёры `renderable` в `tests/services` подставляют голый `{ material }`
 * без `children`.
 *
 * Детекция подписчика — структурная (`typeof .updateMaterial === 'function'`),
 * не `instanceof AbstractShaderMaterial`: та же конвенция, что `hasRenderable`
 * в SceneManager, и она же не ломает существующие тесты вытеснения — там
 * материалы всегда лёгкие моки `{ resetMaterial, updateMaterial }`, а не
 * настоящие подклассы AbstractShaderMaterial.
 *
 * Модуль общий, а не приватный метод `ResourceObserver`: тот же фан-аут нужен
 * `RenderableFactory.swapSurface` (см. `syncRenderableMaterials`), и две копии
 * разъехались бы на первом же новом типе подписчика.
 */
export function syncSubscriberMaterials(renderable: RenderableObject3D, primary: AbstractShaderMaterial): void {
  for (const child of renderable.children ?? []) {
    const material = (child as { material?: unknown }).material as AbstractShaderMaterial | undefined

    if (material && material !== primary && typeof material.updateMaterial === 'function') material.updateMaterial()
  }
}

/**
 * Подтягивает в свежепостроенную поверхность тела уже загруженные текстуры —
 * её собственный материал и материалы подписчиков.
 *
 * Нужно потому, что конструктор `PlanetMaterial` текстуры НЕ читает: он сажает
 * в юниформы плейсхолдеры (`default.png`/`night.jpg`), а реальные карты
 * приходят только через `updateMaterial()`. Пока поверхности строились
 * однократно, до старта стриминга, этого хватало: материал догоняли события
 * `ResourceObserver` (загрузка пути, вытеснение пути, «догон» нового
 * владельца). Подмена поверхности в рантайме (`RenderableFactory.swapSurface`)
 * ни одним из них не является — владелец тот же и пути те же, — поэтому новая
 * поверхность иначе оставалась бы на плейсхолдерах, хотя диффуз, night, cloud,
 * specular и slope тела давно в `resourceStorage` (угловая отсечка стримера —
 * 4 px против 32 px у гейта карт высот).
 *
 * Структурный гард на `updateMaterial`: `material` контракта `RenderableObject3D`
 * — это `Material | Material[]`, и не всякая поверхность несёт материал
 * ресурсного конвейера.
 */
export function syncRenderableMaterials(renderable: RenderableObject3D): void {
  const primary = renderable.material as AbstractShaderMaterial | undefined

  if (!primary || typeof primary.updateMaterial !== 'function') return

  primary.updateMaterial()
  syncSubscriberMaterials(renderable, primary)
}
