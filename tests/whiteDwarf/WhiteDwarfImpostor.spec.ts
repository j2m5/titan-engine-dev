import { describe, it, expect } from 'vitest'
import { WebGLRenderer } from 'three'
import '@/core/framework/TitanThree'
import { Actor } from '@/core/models/Actor'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { RingDustRegistry } from '@/core/services/RingDustRegistry'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { ApparentSizeLod } from '@/core/renderables/utils/ApparentSizeLod'
import { WhiteDwarf } from '@/core/renderables/WhiteDwarf/WhiteDwarf'
import { WhiteDwarfImpostor, SHARED_UNIFORMS } from '@/core/renderables/WhiteDwarf/WhiteDwarfImpostor'
import { WhiteDwarfShaderTemplate } from '@/core/renderables/WhiteDwarf/WhiteDwarfShaderTemplate'
import { WhiteDwarfImpostorShaderTemplate } from '@/core/renderables/WhiteDwarf/WhiteDwarfImpostorShaderTemplate'
import {
  WHITE_DWARF_IMPOSTOR_PIXELS,
  STAR_IMPOSTOR_PIXELS,
  distanceForApparentSize
} from '@/core/helpers/apparentSize'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { withoutComments } from '../helpers/glsl'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { Texture } from 'three'

const fakeRenderer = {
  domElement: { height: 1080 },
  getRenderTarget: () => null,
  setRenderTarget: () => {},
  render: () => {}
} as unknown as WebGLRenderer

function stubActor(): Actor {
  return {
    // Имя отдаётся явной веткой: фабрика зовёт getAttribute('name', ''), а
    // `'' ?? 'Dwarf'` вернёт пустую строку — `''` не nullish
    getAttribute: (key: string, def?: unknown): unknown =>
      key === 'categoryId' ? 9 : key === 'name' ? 'G29-38' : def,
    // Именно null, а не отсутствие поля: OrientationModel проверяет `!== null`
    rotation: null,
    renderingObject: { getAttribute: () => ({}) },
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown =>
        key === 'radius' ? 8840 : key === 'temperature' ? 11820 : def
    }
  } as unknown as Actor
}

/** Вырезает вызов функции целиком, считая глубину скобок */
function call(source: string, fn: string): string {
  const start: number = source.indexOf(`${fn}(`)

  expect(start).toBeGreaterThanOrEqual(0)

  // Закрывающая скобка ищется по глубине, а не первой встречной: иначе при -1
  // от переименования обе стороны схлопнулись бы в '' и сравнение прошло бы
  let depth = 0
  let end = -1

  for (let i = start; i < source.length; i++) {
    if (source[i] === '(') depth++
    else if (source[i] === ')') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }

  expect(end).toBeGreaterThan(start)

  return source.slice(start, end + 1).replace(/\s+/g, ' ')
}

describe('импостор белого карлика', () => {
  it('берёт формулы из общего чанка, а не из своей копии', () => {
    expect(WhiteDwarfImpostorShaderTemplate.fragmentShader).toContain('#include <whiteDwarfSurface>')
    expect(WhiteDwarfImpostorShaderTemplate.fragmentShader).not.toContain('vec3 wdLimb(')
    expect(WhiteDwarfImpostorShaderTemplate.fragmentShader).not.toContain('vec3 wdShade(')
  })

  it('зовёт ту же точку композиции с тем же списком аргументов, что и диск', () => {
    // Самый прямой контракт «одна формула на оба LOD»: разъедься аргументы —
    // на переключении появился бы шов
    expect(call(WhiteDwarfImpostorShaderTemplate.fragmentShader, 'wdShade')).toBe(
      call(WhiteDwarfShaderTemplate.fragmentShader, 'wdShade')
    )
  })

  it('несёт ровно те же юниформы, что и диск', () => {
    // Здесь наборы совпадают ПОЛНОСТЬЮ, в отличие от коричневого карлика, где
    // у диска есть свои uCameraObject и uParallax: белому карлику ни камера на
    // CPU, ни параллакс не нужны — рельефа нет
    expect(Object.keys(WhiteDwarfImpostorShaderTemplate.uniforms).sort()).toEqual(
      Object.keys(WhiteDwarfShaderTemplate.uniforms).sort()
    )
    expect([...SHARED_UNIFORMS].sort()).toEqual(Object.keys(WhiteDwarfShaderTemplate.uniforms).sort())
  })

  it('ни у тела, ни у импостора нет юниформа времени', () => {
    // Эволюционировать поверхности нечем: грануляции у карлика не бывает.
    // Появление time означает, что тело начали рисовать как маленькую звезду
    expect(Object.keys(WhiteDwarfShaderTemplate.uniforms)).not.toContain('time')
    expect(Object.keys(WhiteDwarfImpostorShaderTemplate.uniforms)).not.toContain('uTime')
  })

  it('шарит с телом САМИ объекты Uniform — скаляры включительно', () => {
    const body = new WhiteDwarf(stubActor())
    const impostor = new WhiteDwarfImpostor(body, fakeRenderer)

    // Ссылка на Uniform, а не на value: снапшот скаляра (uCoreIntensity,
    // uProximityExposure) молча разъехался бы с телом при первой live-правке —
    // яркостный шов ровно на переключении LOD
    for (const key of SHARED_UNIFORMS) {
      expect(impostor.material.uniforms[key]).toBe(body.material.uniforms[key])
    }
  })
})

describe('точность вершин тела', () => {
  it('gl_Position идёт через modelViewMatrix, а не через modelMatrix', () => {
    // modelViewMatrix три считает на CPU в double, и абсолютный мировой сдвиг
    // тела сокращается с позицией камеры ДО спуска во float32. Перемножь их в
    // шейдере — вершины квантуются шагом ULP мировой позиции: у Sirius B это
    // 994 000 юнитов от барицентра при радиусе 2.93, то есть 49 ступеней на
    // радиус и видимая гранёность шара. Тело в начале координат дефекта не
    // показывает, поэтому глазом он ловится только на одном из двух карликов
    const source = withoutComments(WhiteDwarfShaderTemplate.vertexShader)

    expect(source).toContain('modelViewMatrix * vec4(position, 1.0)')
    expect(source).toContain('gl_Position = projectionMatrix * mvPosition;')
    // мировых координат в вершинном шейдере не остаётся вовсе
    expect(source).not.toContain('modelMatrix')
  })

  it('фрагмент не работает в мировых координатах', () => {
    // cameraPosition минус мировая позиция — та же потеря точности, только во
    // фрагменте. В видовом пространстве камера в начале координат
    const source = withoutComments(WhiteDwarfShaderTemplate.fragmentShader)

    expect(source).not.toContain('cameraPosition')
    expect(source).toContain('normalize(-vViewPosition)')
  })

  it('оба уровня LOD строят gl_Position одним и тем же способом', () => {
    // Разойдись они — на переключении поехала бы не только яркость, но и
    // положение силуэта на экране
    const source = withoutComments(WhiteDwarfImpostorShaderTemplate.vertexShader)

    expect(source).toContain('modelViewMatrix')
    expect(source).not.toContain('modelMatrix')
  })
})

describe('LOD белого карлика', () => {
  it('порог переключения считается той же константой, что и размер билборда', () => {
    // Разъедься эти два числа — диск скакнёт в размере ровно в момент
    // переключения уровня
    const lod = new ApparentSizeLod(8840, fakeRenderer, WHITE_DWARF_IMPOSTOR_PIXELS)

    expect(lod.switchDistance(50)).toBeCloseTo(
      distanceForApparentSize(toThreeJSUnits(2 * 8840), WHITE_DWARF_IMPOSTOR_PIXELS, 50, 1080),
      10
    )
  })

  it('импостор карлика мельче звёздного', () => {
    // Импостор — ПОЛ видимого размера, поэтому два тела за своими дистанциями
    // переключения выходят на экран одинаковыми. У пары Сириуса это стирало
    // разницу радиусов в 204 раза, и карлик читался не мельче главной звезды.
    // Равенство здесь означает возврат инверсии
    expect(WHITE_DWARF_IMPOSTOR_PIXELS).toBeLessThan(STAR_IMPOSTOR_PIXELS)
  })

  it('у Sirius A и Sirius B дистанции переключения расходятся в 204 раза', () => {
    // Обе далеко внутри орбиты пары (19.8 а.е.), поэтому в штатном кадре оба
    // тела — билборды, и весь их относительный размер задают константы порогов
    const sirusA = new ApparentSizeLod(1192248, fakeRenderer, STAR_IMPOSTOR_PIXELS)
    const siriusB = new ApparentSizeLod(5850, fakeRenderer, WHITE_DWARF_IMPOSTOR_PIXELS)

    expect(sirusA.switchDistance(50) / siriusB.switchDistance(50)).toBeCloseTo((1192248 / 5850) * 0.5, 6)
  })
})

describe('сборка узла белого карлика', () => {
  beforeEach(() => {
    const map = new Texture()
    map.name = 'sun.png'
    resourceStorage.addTexture(map)
  })

  afterEach(() => {
    resourceStorage.deleteTexture('sun.png')
  })

  it('тело остаётся под DynamicNode, а не подменяет его собой', () => {
    const factory = new RenderableFactory(fakeRenderer, {} as unknown as ResourceObserver, new AtmosphereRegistry(), new RingDustRegistry())
    const node = factory.make(stubActor())

    expect(node).toBeInstanceOf(DynamicNode)
    expect((node as DynamicNode).renderable).toBeInstanceOf(WhiteDwarf)
    expect(node.name).toBe('G29-38')
  })

  it('оба уровня LOD собраны и помечены типом для навигации', () => {
    const factory = new RenderableFactory(fakeRenderer, {} as unknown as ResourceObserver, new AtmosphereRegistry(), new RingDustRegistry())
    const node = factory.make(stubActor())

    let body: WhiteDwarf | undefined
    let impostor: WhiteDwarfImpostor | undefined

    node.traverse((child) => {
      if (child instanceof WhiteDwarf) body = child
      if (child instanceof WhiteDwarfImpostor) impostor = child
    })

    expect(body).toBeDefined()
    expect(impostor).toBeDefined()
    // По userData.type наблюдатель набирает объекты — без него кнопка
    // «лететь к» мертва (см. докблок OBSERVED_TYPES)
    expect(body!.userData.type).toBe('whiteDwarf')
  })
})
