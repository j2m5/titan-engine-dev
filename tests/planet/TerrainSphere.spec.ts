import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { Mesh, PerspectiveCamera, Texture, Vector3, type WebGLRenderer } from 'three'
import { TerrainSphere } from '@/core/renderables/TerrainSphere'
import { config } from '@/core/framework/config'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { CLEARANCE_MARGIN_METERS, TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { TERRAIN_PATCH_SEGMENTS } from '@/core/terrain/cubeSphere'
import { TerrainPatchPool } from '@/core/terrain/TerrainPatchPool'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { UpdateContext } from '@/core/UpdateContext'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { liveAncestorKey, terrainNodeKey, type TerrainNodeAddress } from '@/core/terrain/terrainQuadtreeSelect'
import {
  addressOf,
  covered,
  fullyCovered,
  isStrictDescendant,
  patchMeshes,
  unbackedHiddenAddresses,
  visibleAddressKeys
} from '../terrain/coverageHelpers'

// Луна (actorId 19) — тело с height-ресурсом
function moon(): Actor {
  return Actor.find(19)!
}

// 64×32, не константа: у SSE-порога амплитуда должна быть пробиваема на всех
// уровнях (см. flatField в terrainQuadtreeSelect.spec) — набор растёт при
// приближении, а не остаётся минимальным на любой дистанции
function makeField(): TerrainHeightField {
  const width = 64
  const height = 32
  const data = new Uint16Array(width * height)
  for (let k = 0; k < data.length; k++) data[k] = (k * 4001) % 65535

  const map: HeightMapData = { width, height, minMeters: 0, maxMeters: 1000, data }
  return new TerrainHeightField(map, 1737.4)
}

function seedTexture(name: string): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width: 4, height: 2 }
  resourceStorage.addTexture(texture)
}

// PlanetMaterial в конструкторе ходит за плейсхолдерами (см. PlanetMaterialMaps.spec)
function seedPlaceholderKeys(): void {
  seedTexture('')
  seedTexture('default.png')
  seedTexture('night.jpg')
  seedTexture(moon().resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)
}

// заглушка рендерера: TerrainSphere читает только domElement.height (device-пиксели
// канваса — паттерн PlanetTerrain.spec/RenderableFactory.distanceLod)
function makeRenderer(height: number): WebGLRenderer {
  return { domElement: { height } } as unknown as WebGLRenderer
}

// камера над (1,0,0) на altKm — высоте НАД ПОВЕРХНОСТЬЮ (радиус поля 1737.4,
// см. makeField — не средний радиус Луны 1736, который тут не поле мерит)
function makeCtx(altKm: number): UpdateContext {
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1e9)
  camera.position.set(toThreeJSUnits(1737.4 + altKm), 0, 0)
  camera.updateMatrixWorld(true)
  return { delta: 0.016, epoch: 0, elapsed: 0, camera } as UpdateContext
}

// камера на altKm над поверхностью и повёрнутая на angle вокруг тела —
// меняется и глубина набора, и фрустум (makeCtx смотрит всегда из одной точки)
function makeCtxAt(altKm: number, angle: number): UpdateContext {
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1e9)
  const r = toThreeJSUnits(1737.4 + altKm)
  camera.position.set(r * Math.cos(angle), r * Math.sin(angle) * 0.3, r * Math.sin(angle))
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  return { delta: 0.016, epoch: 0, elapsed: 0, camera } as UpdateContext
}

/**
 * Часы бюджета построек: РОВНО одна постройка за кадр. Первое чтение кадра —
 * frameStart (0), все последующие — 7 (> бюджета 6): цикл построек ставит
 * первый патч (при built===0 проверка бюджета пропускается) и выходит на
 * втором кандидате. Счётчик сбрасывается тестом перед каждым updateObject —
 * без сброса фаза уплывает, потому что кадр съедает НЕ фиксированное число
 * тиков: один на frameStart плюс по одному на каждого НЕЖИЛОГО кандидата
 * очереди. Циклическая последовательность вида [0,0,7,7] на этом и ломается —
 * замер: 1 постройка на первом кадре, 71 на втором, дальше сходимость, то
 * есть своп наблюдался ровно на одном кадре из 120.
 */
function makeFrameClock(): { nowMs: () => number; startFrame: () => void } {
  let reads = 0
  return { nowMs: (): number => (reads++ === 0 ? 0 : 7), startFrame: (): void => void (reads = 0) }
}

describe('TerrainSphere: динамическое квадродерево патчей', { timeout: 30000 }, () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('конструктор строит минимальный набор уровня 1 (24 меша)', () => {
    const sphere = new TerrainSphere(moon(), makeField(), makeRenderer(1080))
    expect(sphere.children.filter((c) => c instanceof Mesh)).toHaveLength(24)
  })

  it('контракты снапшота и стриминга: model/type/clickable на группе, .material — PlanetMaterial', () => {
    const actor = moon()
    const sphere = new TerrainSphere(actor, makeField(), makeRenderer(1080))

    expect(sphere.model).toBe(actor)
    expect(sphere.userData.type).toBe('planet')
    expect(sphere.userData.clickable).toBe(true)
    expect(sphere.material.constructor.name).toBe('PlanetMaterial')

    const patch = sphere.children[0] as Mesh
    expect(patch.material).toBe(sphere.material)
    expect(patch.userData.clickable).toBe(true)
  })

  it('за серию кадров у поверхности набор растёт и сходится; покрытие без дыр на каждом кадре', () => {
    const sphere = new TerrainSphere(moon(), makeField(), makeRenderer(1080))
    const ctx = makeCtx(2)
    const counts: number[] = []
    for (let f = 0; f < 120; f++) {
      sphere.updateObject(ctx)
      expect(fullyCovered(sphere)).toBe(true)
      counts.push(sphere.children.filter((c) => c instanceof Mesh && c.visible).length)
    }
    expect(counts.at(-1)!).toBeGreaterThan(24)
    expect(counts.at(-1)).toEqual(counts.at(-10))
  })

  // Часы бюджета — инъекция (не performance.now()): своп откладывает показ
  // только при постройке по одной за кадр, на реальных часах стенд успевает
  // построить всю замену в первом же кадре и скрытых узлов в снимке не
  // остаётся. См. makeFrameClock — там же, почему счётчик сбрасывается на кадр.
  it('атомарный своп: дети скрыты, пока жив родитель; в кадр его ухода видимы ВСЕ они; скрытый узел всегда перекрыт видимым', () => {
    const clock = makeFrameClock()
    const sphere = new TerrainSphere(moon(), makeField(), makeRenderer(1080), undefined, undefined, clock.nowMs)
    const ctx = makeCtx(2)

    // снимок кадра: адрес и видимость каждого живого патча
    const snapshot = (): Map<number, { address: TerrainNodeAddress; visible: boolean }> => {
      const map = new Map<number, { address: TerrainNodeAddress; visible: boolean }>()
      for (const mesh of patchMeshes(sphere)) {
        const address = addressOf(mesh)
        map.set(terrainNodeKey(address), { address, visible: mesh.visible })
      }
      return map
    }

    let sawHidden = false
    let sawHiddenUnderVisibleAncestor = false // именно отложенный показ, а не «скрытый где-то сбоку»
    let splitSwapsSeen = 0 // кадры, где родитель ушёл, а вся его замена стала видимой
    let previous = snapshot()

    for (let f = 0; f < 120; f++) {
      clock.startFrame()
      sphere.updateObject(ctx)

      const current = snapshot()
      const visibleKeys = visibleAddressKeys(sphere)

      for (const mesh of patchMeshes(sphere)) {
        if (mesh.visible) continue
        sawHidden = true
        if (liveAncestorKey(addressOf(mesh), (k) => visibleKeys.has(k)) !== -1) sawHiddenUnderVisibleAncestor = true
      }

      // скрытый узел обязан быть перекрыт: видимый предок ИЛИ полностью видимые потомки
      expect(unbackedHiddenAddresses(sphere)).toEqual([])
      expect(fullyCovered(sphere)).toBe(true)

      // атомарность дробления: родитель, который был ВИДИМ и имел скрытого
      // живого потомка на начале кадра, к концу кадра либо ещё жив, либо ушёл —
      // и тогда его площадь целиком закрыта видимыми ПОТОМКАМИ (не предком)
      for (const [key, before] of previous) {
        if (current.has(key) || !before.visible) continue
        const hadHiddenChild = [...previous.values()].some(
          (other) => !other.visible && isStrictDescendant(other.address, before.address)
        )
        if (!hadHiddenChild) continue

        const { face, level, i, j } = before.address
        for (let a = 0; a < 2; a++) {
          for (let b = 0; b < 2; b++) {
            expect(covered(visibleKeys, face, level + 1, 2 * i + a, 2 * j + b)).toBe(true)
          }
        }
        splitSwapsSeen++
      }

      previous = current
    }

    expect(sawHidden).toBe(true) // при одной постройке за кадр своп действительно откладывает показ
    expect(sawHiddenUnderVisibleAncestor).toBe(true) // и откладывает именно под ещё живым родителем
    expect(splitSwapsSeen).toBeGreaterThan(0) // кадр атомарной подмены наблюдался
  })

  // Качающаяся камера — единственный режим, где показ замены СПУСКОМ отличим
  // от страховочного прохода: глубокий узел, построенный под прежнюю глубину и
  // так и не показанный, остаётся живым внутри желаемого листа, и страховка на
  // нём спотыкается о свой же гейт hasLiveDescendant (лист пропускается как
  // «перекрытый изнутри», хотя перекрывающий сам скрыт). Замер: без строки
  // forEachWantedDescendant этот тест даёт дыры, ровный спуск/подъём — нет.
  it('своп при качающейся камере: ни одного скрытого патча без видимого перекрытия за 600 кадров', () => {
    const clock = makeFrameClock()
    const sphere = new TerrainSphere(moon(), makeField(), makeRenderer(1080), undefined, undefined, clock.nowMs)

    for (let f = 0; f < 600; f++) {
      // высота гуляет на порядки — желаемая глубина то растёт, то падает,
      // и построенные под прежнюю глубину узлы не успевают быть показанными
      const altKm = 2 + 400000 * (0.5 + 0.5 * Math.sin(f / 37))
      clock.startFrame()
      sphere.updateObject(makeCtxAt(altKm, f / 11))
      expect(unbackedHiddenAddresses(sphere)).toEqual([])
      expect(fullyCovered(sphere)).toBe(true)
    }
  })

  // Мерж под теми же часами (одна постройка за кадр) и с ПОКАДРОВЫМ покрытием:
  // схлопывание — вторая ветка coverageReady (показ живого предка), и до этого
  // теста она проверялась только по итоговому счётчику, без инварианта дыр.
  it('удаление камеры мержит обратно к 24; покрытие без дыр на каждом кадре спуска и подъёма', () => {
    const clock = makeFrameClock()
    const sphere = new TerrainSphere(moon(), makeField(), makeRenderer(1080), undefined, undefined, clock.nowMs)

    for (let f = 0; f < 120; f++) {
      clock.startFrame()
      sphere.updateObject(makeCtx(2))
      expect(unbackedHiddenAddresses(sphere)).toEqual([])
      expect(fullyCovered(sphere)).toBe(true)
    }
    for (let f = 0; f < 200; f++) {
      clock.startFrame()
      sphere.updateObject(makeCtx(500000))
      expect(unbackedHiddenAddresses(sphere)).toEqual([])
      expect(fullyCovered(sphere)).toBe(true)
    }

    expect(sphere.children.filter((c) => c instanceof Mesh).length).toBe(24)
  })

  it('невидимый (LOD → FakePlanet) — заморожен', () => {
    const sphere = new TerrainSphere(moon(), makeField(), makeRenderer(1080))
    const before = sphere.children.length
    sphere.visible = false
    sphere.updateObject(makeCtx(2))
    expect(sphere.children.length).toBe(before)
  })

  // бюджет теперь временной (terrain.lod.patchBuildBudgetMs), не счётчик —
  // прогоняем детерминированные часы через конструктор (Task 6, TerrainPatchGroup.nowMs)
  it('бюджет построек соблюдается: часы сразу выходят за бюджет после первой постройки — за кадр добавляется ровно 1 меш', () => {
    const budgetMs = config('terrain.lod.patchBuildBudgetMs')
    let call = 0
    const nowMs = (): number => (call++ === 0 ? 0 : budgetMs + 1)

    const sphere = new TerrainSphere(moon(), makeField(), makeRenderer(1080), undefined, undefined, nowMs)
    const before = sphere.children.length
    sphere.updateObject(makeCtx(2))
    expect(sphere.children.length - before).toBe(1)
  })

  // screenHeight обязан быть device-пикселями канваса (renderer.domElement.height),
  // не CSS-пикселями окна: sse = geometricError·screenHeight/(2·tan(fovY/2)·dist) —
  // при вдвое большем screenHeight тот же узел пересекает splitPixels раньше,
  // набор глубже/крупнее. HiDPI (dpr=2) даёт domElement.height = innerHeight·dpr —
  // подмена на window.innerHeight занижала бы SSE вдвое на таких экранах.
  // 75 км, не 2 — на 2 км SSE обеих высот пробивает потолок TERRAIN_QUADTREE_MAX_LEVEL
  // одинаково (набор совпал бы, разница SSE замаскирована потолком); 75 км —
  // середина окна 73–78 км, где 1080 и 2160 расходятся (60 vs 72 меша), ниже
  // потолка — измерено сканированием шагом 0.25 км, запас от обеих границ ≥2 км.
  it('screenHeight — device-пиксели канваса: больший domElement.height даёт более глубокий набор при той же камере', () => {
    const field = makeField()
    const sphereLow = new TerrainSphere(moon(), field, makeRenderer(1080))
    const sphereHigh = new TerrainSphere(moon(), field, makeRenderer(2160))

    // 150 км, а не 130: центр сферы узла теперь
    // считается по КАРТЕ (mapHeightMeters), не по канону высоты с полосой —
    // окно, где удвоение высоты вьюпорта переводит узел через порог,
    // сдвинулось вместе с этим фиксом. Высота подобрана пересканом (окно
    // 136–186 км устойчиво, запас ≥14 км от обеих границ) — на ней 1080p
    // даёт 60 листьев, 2160p — 66.
    const FRAMES = 60
    for (let f = 0; f < FRAMES; f++) {
      sphereLow.updateObject(makeCtx(150))
      sphereHigh.updateObject(makeCtx(150))
    }

    const countLow = sphereLow.children.filter((c) => c instanceof Mesh).length
    const countHigh = sphereHigh.children.filter((c) => c instanceof Mesh).length
    expect(countHigh).toBeGreaterThan(countLow)
  })

  // юбка закрывает недобор ГРУБОГО соседа: фрустум-гейт допускает перепад до
  // двух уровней (сосед вне фрустума не сплитится), поэтому глубина юбки
  // патча уровня L берётся по ε(max(MIN_LEVEL, L−2)), а не по ε своего же
  // уровня — своя ε на порядок мельче недобора соседа и щели на Δ2-стыках
  // не закрывает (см. геометрию замера в брифе ревью)
  it('юбка патча уровня L глубиной ε(L−2) — по недобору грубого соседа, не своей ε', () => {
    const field = makeField()
    const sphere = new TerrainSphere(moon(), field, makeRenderer(1080))
    for (let f = 0; f < 200; f++) sphere.updateObject(makeCtx(2))

    const patch = sphere.children.find(
      (c) => c instanceof Mesh && (c.userData.terrainAddress as TerrainNodeAddress | undefined)?.level === 4
    ) as Mesh | undefined
    expect(patch).toBeDefined()

    const gridVertexCount = (TERRAIN_PATCH_SEGMENTS + 1) ** 2
    const pos = patch!.geometry.getAttribute('position')
    const edge = new Vector3(pos.getX(0), pos.getY(0), pos.getZ(0)).add(patch!.position)
    const skirt = new Vector3(pos.getX(gridVertexCount), pos.getY(gridVertexCount), pos.getZ(gridVertexCount)).add(
      patch!.position
    )
    const actualDepthUnits = edge.length() - skirt.length()

    // ожидание — ε(4−2)=ε(2), НЕ ε(4) (своя ε мельче на два порядка в этом поле)
    const expectedDepthUnits = toThreeJSUnits((field.geometricErrorMeters(2) + CLEARANCE_MARGIN_METERS) / 1000)
    expect(actualDepthUnits).toBeCloseTo(expectedDepthUnits, 6)
  })

  // Приёмочная волна 4, №3 (высотный fade облаков): onVisibleUpdate обязан
  // освежать uCloudOpacity КАЖДЫЙ активный кадр (тот же паттерн, что
  // WaterSphere.onVisibleUpdate/uTime) — дистанция камера-тело меняется
  // ежекадрово, а не только при (пере)конструировании материала.
  it('onVisibleUpdate зовёт sharedMaterial.updateCloudOpacity с мировыми позициями камеры и себя, каждый активный кадр', () => {
    const sphere = new TerrainSphere(moon(), makeField(), makeRenderer(1080))
    const spy = vi.spyOn(PlanetMaterial.prototype, 'updateCloudOpacity')

    sphere.updateObject(makeCtx(2))

    // Скретч-вектора переиспользуются между кадрами (см. cloudCameraWorldScratch
    // докблок в TerrainSphere) — снимок ПОСЛЕ первого вызова, ДО второго,
    // иначе spy.mock.calls[0] прочитал бы уже перезаписанное значение.
    expect(spy).toHaveBeenCalledTimes(1)
    const [cameraWorld, selfWorld] = spy.mock.calls[0]
    expect(cameraWorld).toBeInstanceOf(Vector3)
    expect(selfWorld).toBeInstanceOf(Vector3)
    expect(cameraWorld.x).toBeCloseTo(toThreeJSUnits(1737.4 + 2), 6) // makeCtx(2) — камера на (радиус+2км, 0, 0)

    sphere.updateObject(makeCtx(3))
    expect(spy).toHaveBeenCalledTimes(2)

    spy.mockRestore()
  })

  it('невидимый (LOD → FakePlanet) — updateCloudOpacity НЕ зовётся (заморожено вместе с деревом)', () => {
    const sphere = new TerrainSphere(moon(), makeField(), makeRenderer(1080))
    const spy = vi.spyOn(PlanetMaterial.prototype, 'updateCloudOpacity')

    sphere.visible = false
    sphere.updateObject(makeCtx(2))

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('dispose зовёт pool.dispose — освобождение владения пула не пропущено', () => {
    const sphere = new TerrainSphere(moon(), makeField(), makeRenderer(1080))
    const disposeSpy = vi.spyOn(TerrainPatchPool.prototype, 'dispose')

    sphere.dispose()

    expect(disposeSpy).toHaveBeenCalledTimes(1)
    disposeSpy.mockRestore()
  })
})
