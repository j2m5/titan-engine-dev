import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { Mesh, PerspectiveCamera, Texture, Vector3, type WebGLRenderer } from 'three'
import { PATCH_BUILDS_PER_FRAME, TerrainSphere } from '@/core/renderables/TerrainSphere'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { CLEARANCE_MARGIN_METERS, TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { TERRAIN_PATCH_SEGMENTS } from '@/core/terrain/cubeSphere'
import { TerrainPatchPool } from '@/core/terrain/TerrainPatchPool'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { UpdateContext } from '@/core/UpdateContext'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import type { TerrainNodeAddress } from '@/core/terrain/terrainQuadtreeSelect'

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

// покрытие: сумма 4^{-(level-1)} по ВИДИМЫМ мешам — перекрытие родитель+дети
// допустимо (инвариант «без дыр» требует только ≥ полного покрытия сферы = 24)
function visibleLeavesCoverage(sphere: TerrainSphere): number {
  let sum = 0
  for (const child of sphere.children) {
    if (!(child instanceof Mesh) || !child.visible) continue
    const address = child.userData.terrainAddress as TerrainNodeAddress | undefined
    if (!address) continue
    sum += 4 ** -(address.level - 1)
  }
  return sum
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
      const cover = visibleLeavesCoverage(sphere)
      expect(cover).toBeGreaterThanOrEqual(24 - 1e-9)
      counts.push(sphere.children.filter((c) => c instanceof Mesh && c.visible).length)
    }
    expect(counts.at(-1)!).toBeGreaterThan(24)
    expect(counts.at(-1)).toEqual(counts.at(-10))
  })

  it('удаление камеры мержит обратно к 24', () => {
    const sphere = new TerrainSphere(moon(), makeField(), makeRenderer(1080))
    for (let f = 0; f < 120; f++) sphere.updateObject(makeCtx(2))
    for (let f = 0; f < 200; f++) sphere.updateObject(makeCtx(500000))
    expect(sphere.children.filter((c) => c instanceof Mesh).length).toBe(24)
  })

  it('невидимый (LOD → FakePlanet) — заморожен', () => {
    const sphere = new TerrainSphere(moon(), makeField(), makeRenderer(1080))
    const before = sphere.children.length
    sphere.visible = false
    sphere.updateObject(makeCtx(2))
    expect(sphere.children.length).toBe(before)
  })

  it('бюджет построек соблюдается: за один кадр добавляется ≤ PATCH_BUILDS_PER_FRAME мешей', () => {
    const sphere = new TerrainSphere(moon(), makeField(), makeRenderer(1080))
    const before = sphere.children.length
    sphere.updateObject(makeCtx(2))
    expect(sphere.children.length - before).toBeLessThanOrEqual(PATCH_BUILDS_PER_FRAME)
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

    // 130 км, а не 75: с пер-узловой ε (числитель SSE — шероховатость МЕСТА,
    // а не p99 тела) полоса, где удвоение высоты вьюпорта переводит узел
    // через порог, сдвинулась. Высота подобрана сканом — на ней 1080p даёт
    // 48 листьев, 2160p — 60.
    const FRAMES = 60
    for (let f = 0; f < FRAMES; f++) {
      sphereLow.updateObject(makeCtx(130))
      sphereHigh.updateObject(makeCtx(130))
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
