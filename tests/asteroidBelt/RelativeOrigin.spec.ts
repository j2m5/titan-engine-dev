import { describe, it, expect, vi } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import type { Group, InstancedMesh } from 'three'
import '@/core/framework/TitanThree'

const fakeTexture = { name: 'ring.png' }

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: {
    getTexture: () => fakeTexture,
    getTextureOrMake: () => fakeTexture
  }
}))

vi.mock('@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback', () => ({
  readRingAlphaProfile: vi.fn(() => null),
  readRingAlphaBins: vi.fn(() => null),
  readRingBandBins: vi.fn(() => null)
}))

import { FloatingOrigin } from '@/core/renderables/DetailedRingStreamingSystem/FloatingOrigin'
import { AsteroidGenerator } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidGenerator'
import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { InstancedAsteroidShaderTemplate } from '@/core/materials/shaders/lib/InstancedAsteroidShaderTemplate'
import { billboardVertexSource } from '../helpers/billboardSource'
import { withoutComments } from '../helpers/glsl'
import { internalsOf, poolOf, generatorConfigOf } from '../helpers/ringSystemInternals'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import { Actor } from '@/core/models/Actor'
import type { IRingRenderingObject } from '@/core/models/types'
import type { UpdateContext } from '@/core/UpdateContext'

describe('FloatingOrigin', () => {
  it('квантует по сетке ячейки и сообщает сдвиг только при переезде', () => {
    const fo = new FloatingOrigin(10)

    expect(fo.update(new Vector3(3, 100, 4))).toBeNull()
    expect(fo.origin.toArray()).toEqual([0, 0, 0])

    const shift = fo.update(new Vector3(27, 5, -14))

    expect(shift?.toArray()).toEqual([30, 0, -10])
    expect(fo.origin.toArray()).toEqual([30, 0, -10])
    expect(fo.update(new Vector3(31, 0, -12))).toBeNull()
  })
})

describe('AsteroidGenerator — матрицы относительно центра сектора', () => {
  const bounds = {
    minRadius: fromAstronomicalUnits(49.99),
    maxRadius: fromAstronomicalUnits(50.01),
    minAngle: 0.5,
    maxAngle: 0.5005
  }
  const center = {
    x: Math.cos(0.50025) * fromAstronomicalUnits(50),
    z: Math.sin(0.50025) * fromAstronomicalUnits(50)
  }

  // Камень не выходит за сектор — значит относительная позиция не больше его
  // полудиагонали (≈1200 ед. против абсолютных 3.7 млн на 50 а.е.)
  const halfDiagonal: number = Math.hypot(
    (bounds.maxRadius - bounds.minRadius) * 0.5,
    ((bounds.maxAngle - bounds.minAngle) * (bounds.minRadius + bounds.maxRadius)) * 0.25
  )

  /** Шаг сетки float32 (ULP) на величине value — «цена деления» буфера инстансов */
  const ulp32 = (value: number): number => {
    const view = new DataView(new ArrayBuffer(4))
    view.setFloat32(0, value)
    view.setUint32(0, view.getUint32(0) + 1)

    return Math.abs(view.getFloat32(0) - Math.fround(value))
  }

  it('относительные позиции малы: квант хранения падает с сотен км до сотен метров', () => {
    const absolute = new AsteroidGenerator({ thickness: 1, minScale: 0.3, maxScale: 1.6 })
    const relative = new AsteroidGenerator({ thickness: 1, minScale: 0.3, maxScale: 1.6, relativeToSector: true })
    const a = absolute.generateMatrices(4242, 50, bounds)
    const r = relative.generateMatrices(4242, 50, bounds)
    // Единица сцены — 1/SpaceScale километров: почти две тысячи км, поэтому
    // «доли единицы» в float32 на 50 а.е. — это сотни километров реального мира
    const metresPerUnit: number = 1995 * 1000

    for (let i = 0; i < 50; i++) {
      const o = i * 16
      // относительная позиция — в пределах сектора (тысячи единиц сцены, не миллионы)
      expect(Math.abs(r[o + 12])).toBeLessThan(halfDiagonal)
      expect(Math.abs(r[o + 14])).toBeLessThan(halfDiagonal)
      // ВОТ РАДИ ЧЕГО ВСЁ: на 50 а.е. абсолютная координата — миллионы единиц,
      // и соседние представимые float32 разнесены на сотни километров; у
      // относительной (внутри сектора) тот же шаг — сотни метров
      expect(ulp32(a[o + 12]) * metresPerUnit).toBeGreaterThan(100e3)
      expect(ulp32(r[o + 12]) * metresPerUnit).toBeLessThan(1e3)
      // origin + local описывает ТОТ ЖЕ камень: центр вычитается и прибавляется
      // в double, расхождение не больше кванта самой абсолютной записи (она и
      // есть неточная сторона сравнения)
      const dx: number = Math.abs(center.x + r[o + 12] - a[o + 12])
      const dz: number = Math.abs(center.z + r[o + 14] - a[o + 14])
      expect(dx).toBeLessThan(ulp32(a[o + 12]))
      expect(dz).toBeLessThan(ulp32(a[o + 14]))
      // повороты и масштаб не тронуты
      for (let c = 0; c < 12; c++) expect(r[o + c]).toBe(a[o + c])
    }
  })

  it('без флага матрицы побайтно прежние', () => {
    const g1 = new AsteroidGenerator({ thickness: 1, minScale: 0.3, maxScale: 1.6 })
    const g2 = new AsteroidGenerator({ thickness: 1, minScale: 0.3, maxScale: 1.6, relativeToSector: false })

    expect(g1.generateMatrices(7, 20, bounds)).toEqual(g2.generateMatrices(7, 20, bounds))
  })
})

describe('шейдеры: instanceOrigin', () => {
  it('L0: позиция инстанса = origin + local, до modelViewMatrix', () => {
    const v: string = withoutComments(InstancedAsteroidShaderTemplate.vertexShader)

    expect(v).toContain('attribute vec3 instanceOrigin;')
    expect(v).toContain('vec4 worldPosition = instanceMatrix * vec4(shapedPos, 1.0);')
    expect(v).toContain('worldPosition.xyz += instanceOrigin;')
    expect(v.indexOf('worldPosition.xyz += instanceOrigin;')).toBeLessThan(v.indexOf('modelViewMatrix * worldPosition'))
    // Сид формы — от МЕСТНОЙ позиции (прежний текст мастера): она переезд
    // начала переживает, сумма с instanceOrigin — нет
    expect(v).toContain('float shapeSeed = hash13(instanceMatrix[3].xyz);')
    expect(v).toContain('float ampSeed = hash13(instanceMatrix[3].xyz * 1.37 + 11.7);')
  })

  it('L1: позиция инстанса = origin + local', () => {
    const v: string = withoutComments(billboardVertexSource())

    expect(v).toContain('attribute vec3 instanceOrigin;')
    expect(v).toContain('vec3 instancePos = instanceOrigin + vec3(')
  })

  it('сиды не зависят от instanceOrigin: переезд начала не меняет форму камней', () => {
    // instanceMatrix[3].xyz + instanceOrigin — это позиция от ПЛАВАЮЩЕГО
    // НАЧАЛА, а не от центра кольца, и rebaseOrigins меняет её на каждом
    // переезде. Сид обязан браться только из матрицы, иначе облик камня
    // «перещёлкивается» при каждом сдвиге начала.
    const l0: string = withoutComments(InstancedAsteroidShaderTemplate.vertexShader)
    for (const call of l0.match(/hash13\([^;]*\)/g) ?? []) {
      expect(call).not.toContain('instanceOrigin')
    }
    expect((l0.match(/hash13\(/g) ?? []).length).toBeGreaterThan(1)

    const l1: string = withoutComments(billboardVertexSource())
    const seedLine: string = l1.slice(l1.indexOf('vInstanceSeed ='), l1.indexOf(';', l1.indexOf('vInstanceSeed =')))
    expect(seedLine).not.toContain('instanceOrigin')
    expect(seedLine).not.toContain('instancePos')
    expect(seedLine).toContain('instanceMatrix[3][0]')
    expect(seedLine).toContain('instanceMatrix[3][2]')
  })

  it('vRingPos и направление на планету считаются от центра кольца через uOriginOffset', () => {
    const l0: string = withoutComments(InstancedAsteroidShaderTemplate.vertexShader)
    expect(l0).toContain('uniform vec3 uOriginOffset;')
    expect(l0).toContain('vRingPos = worldPosition.xyz + uOriginOffset;')
    expect(l0).toContain('vPlanetDirView = normalize((modelViewMatrix * vec4(-uOriginOffset, 1.0)).xyz - mvPosition.xyz);')

    const l1: string = withoutComments(billboardVertexSource())
    expect(l1).toContain('uniform vec3 uOriginOffset;')
    expect(l1).toContain('vRingPos = instancePos + uOriginOffset;')
    expect(l1).toContain(
      'vPlanetDirView = normalize((modelViewMatrix * vec4(-uOriginOffset, 1.0)).xyz - mvInstancePos.xyz);'
    )
  })

  it('при нулевом origin оба вершинника тождественны прежним: атрибут входит только слагаемым', () => {
    // Пин строк выше держит ФОРМУ выражений; здесь — их СЕМАНТИКА при нуле:
    // instanceOrigin нигде не участвует иначе, чем в сложении, поэтому у колец
    // (нулевой буфер) шейдер считает ровно то же, что и до атрибута instanceOrigin.
    const additive = /(\+=?\s*instanceOrigin\b)|(\binstanceOrigin\s*\+)/

    for (const source of [InstancedAsteroidShaderTemplate.vertexShader, billboardVertexSource()]) {
      const uses: string[] = withoutComments(source)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.includes('instanceOrigin'))

      expect(uses.length).toBeGreaterThan(1)
      for (const line of uses) {
        if (line === 'attribute vec3 instanceOrigin;') continue
        expect(line).toMatch(additive)
      }
    }
  })
})

const makeRingActor = (data: Partial<IRingRenderingObject> = {}): Actor =>
  ({
    getAttribute: () => 42,
    renderingObject: {
      getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000, alphaTest: 0.1, ...data })
    },
    resources: {
      first: () => ({ getAttribute: () => 'ring.png' })
    }
  }) as unknown as Actor

/** Один кадр системы с камерой в точке world (x, 0, 0) — смотрит на центр */
const frameAt = (system: AsteroidRingSystem, x: number): void => {
  const camera = new PerspectiveCamera(50, 1, 0.1, 5000)
  camera.position.set(x, 0, 0)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()

  system.updateObject({ delta: 0.016, epoch: 0, elapsed: 0, camera } as UpdateContext)
}

/** Все меши пула одним списком (K Geometry + K Near + billboard) */
const streamMeshes = (system: AsteroidRingSystem): InstancedMesh[] => {
  const pool = poolOf(system)

  return [...pool.geometryMeshes, ...pool.nearMeshes, pool.billboardMesh]
}

/**
 * Абсолютные центры секторов по всем слотам всех стримов:
 * originGroup.position + instanceOrigin (по X). Эта сумма — свойство САМОГО
 * сектора и обязана переживать переезд начала; слот считается живым, пока его
 * матрица не вырождена (освобождённые получают нулевой масштаб, см.
 * InstancePool.ZERO_MATRIX). Живой слот отдаёт и локальную позицию — проверка,
 * что в буфере лежат именно местные координаты.
 */
const sectorAnchors = (system: AsteroidRingSystem): ({ anchor: number; local: number } | null)[] => {
  const groupX = (internalsOf(system).originGroup as Group).position.x
  const out: ({ anchor: number; local: number } | null)[] = []

  for (const mesh of streamMeshes(system)) {
    const origins = mesh.geometry.getAttribute('instanceOrigin').array as Float32Array
    const matrices = mesh.instanceMatrix.array as Float32Array

    for (let i = 0; i < mesh.geometry.getAttribute('instanceOrigin').count; i++) {
      const m = i * 16
      const alive = i < mesh.count && matrices[m] ** 2 + matrices[m + 1] ** 2 + matrices[m + 2] ** 2 > 0
      out.push(alive ? { anchor: groupX + origins[i * 3], local: matrices[m + 12] } : null)
    }
  }

  return out
}

describe('пояс: относительные координаты включены', () => {
  it('меши уезжают под группу начала, а origin + local держит абсолютную позицию через переезд', () => {
    const system = new AsteroidRingSystem(makeRingActor(), { relativeOrigin: true })
    system.updateMatrixWorld(true)

    const originGroup = internalsOf(system).originGroup
    const floatingOrigin = internalsOf(system).floatingOrigin
    expect(originGroup).not.toBeNull()
    expect(floatingOrigin).not.toBeNull()

    const pool = poolOf(system)
    for (const mesh of [...pool.geometryMeshes, ...pool.nearMeshes, pool.billboardMesh]) {
      expect(mesh.parent).toBe(originGroup)
    }

    frameAt(system, 52)
    expect(pool.getActiveCount().total).toBeGreaterThan(0)
    // Начало переехало к камере, группа встала на него, и оба материала
    // получили его смещение — иначе vRingPos съехал бы с центра кольца
    expect((floatingOrigin as FloatingOrigin).origin.x).not.toBe(0)
    expect((originGroup as Group).position.x).toBe((floatingOrigin as FloatingOrigin).origin.x)
    expect(pool.geometryMaterial.uniforms.uOriginOffset.value).toEqual((floatingOrigin as FloatingOrigin).origin)
    expect(pool.billboardMaterial.uniforms.uOriginOffset.value).toEqual((floatingOrigin as FloatingOrigin).origin)

    // Хранимые позиции — местные: не радиус кольца (десятки единиц), а пределы
    // своего сектора (ячейка ≈ 1 единица)
    const before = sectorAnchors(system)
    let checked = 0
    for (const slot of before) {
      if (!slot) continue
      expect(Math.abs(slot.local)).toBeLessThan(2)
      checked++
    }
    expect(checked).toBeGreaterThan(0)

    // Переезд начала: камера уходит за границу ячейки (ячейка 2000 км ≈ 1 ед.)
    frameAt(system, 53.3)
    expect((originGroup as Group).position.x).not.toBe(52)
    expect((originGroup as Group).position.x).toBe((floatingOrigin as FloatingOrigin).origin.x)

    expect(pool.geometryMaterial.uniforms.uOriginOffset.value).toEqual((floatingOrigin as FloatingOrigin).origin)
    expect(pool.billboardMaterial.uniforms.uOriginOffset.value).toEqual((floatingOrigin as FloatingOrigin).origin)

    const after = sectorAnchors(system)
    let survived = 0
    for (let i = 0; i < Math.min(before.length, after.length); i++) {
      const was = before[i]
      const now = after[i]
      if (!was || !now) continue
      // Тот же камень — тот же абсолютный центр сектора: rebaseOrigins переписал
      // смещение ровно на сдвиг начала (иначе сектор уехал бы вместе с группой)
      expect(now.anchor).toBeCloseTo(was.anchor, 4)
      survived++
    }
    expect(survived).toBeGreaterThan(0)
  })
})

describe('кольца: относительные координаты выключены', () => {
  it('камни живые, но instanceOrigin у всех стримов нулевой, а группы начала нет', () => {
    const system = new AsteroidRingSystem(makeRingActor())
    system.updateMatrixWorld(true)

    // Камера в теле кольца (внутренний радиус 70 000 км ≈ 35 ед., внешний ≈ 70),
    // смотрит на центр — секторы вокруг неё попадают и в range, и в frustum
    const camera = new PerspectiveCamera(50, 1, 0.1, 5000)
    camera.position.set(52, 0, 0)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert()

    system.updateObject({ delta: 0.016, epoch: 0, elapsed: 0, camera } as UpdateContext)

    const pool = poolOf(system)
    // Пин не должен быть пустым: нулевой атрибут у пустого пула ничего не значит
    expect(pool.getActiveCount().total).toBeGreaterThan(0)

    for (const mesh of [...pool.geometryMeshes, ...pool.nearMeshes, pool.billboardMesh]) {
      const origins = mesh.geometry.getAttribute('instanceOrigin')
      expect(origins).toBeDefined()
      expect((origins.array as Float32Array).some((value) => value !== 0)).toBe(false)
      // Меши — прямые дети системы, без промежуточной группы начала
      expect(mesh.parent).toBe(system)
    }

    // Смещение начала кольцам не пишется — выражения vRingPos и направления на
    // планету при нуле буквально прежние
    expect(pool.geometryMaterial.uniforms.uOriginOffset.value.toArray()).toEqual([0, 0, 0])
    expect(pool.billboardMaterial.uniforms.uOriginOffset.value.toArray()).toEqual([0, 0, 0])

    expect(internalsOf(system).originGroup).toBeNull()
    expect(internalsOf(system).floatingOrigin).toBeNull()
    expect(generatorConfigOf(internalsOf(system).generator).relativeToSector).toBe(false)
  })
})
