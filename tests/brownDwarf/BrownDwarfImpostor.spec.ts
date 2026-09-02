import { PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer } from 'three'
import { Actor } from '@/core/models/Actor'
import { BrownDwarfImpostor } from '@/core/renderables/BrownDwarf/BrownDwarfImpostor'
import { ApparentSizeLod } from '@/core/renderables/utils/ApparentSizeLod'
import { StarLod } from '@/core/renderables/utils/StarLod'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { OrientationModel } from '@/core/libs/OrientationModel'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { RingDustRegistry } from '@/core/services/RingDustRegistry'
import { BrownDwarf } from '@/core/renderables/BrownDwarf'
import { BrownDwarfImpostorShaderTemplate } from '@/core/renderables/BrownDwarf/BrownDwarfImpostorShaderTemplate'
import { BrownDwarfShaderTemplate } from '@/core/renderables/BrownDwarf/BrownDwarfShaderTemplate'
import { STAR_IMPOSTOR_PIXELS, starLodSwitchDistance } from '@/core/helpers/apparentSize'
import { ResourceObserver } from '@/core/services/ResourceObserver'

// Запекатель внутри тела дёргает рендерер, поэтому заглушка шире, чем нужно
// одному только LOD
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
      key === 'categoryId' ? 8 : key === 'name' ? 'Dwarf' : def,
    // Именно null, а не отсутствие поля: OrientationModel проверяет `!== null`
    rotation: null,
    renderingObject: { getAttribute: () => ({}) },
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown =>
        key === 'radius' ? 69900 : key === 'temperature' ? 1600 : def
    }
  } as unknown as Actor
}

describe('LOD по видимому размеру', () => {
  it('с размером звезды повторяет старую формулу звезды один в один', () => {
    // Обобщение не имеет права сдвинуть сведённый стык звезды
    const lod = new ApparentSizeLod(696000, fakeRenderer, STAR_IMPOSTOR_PIXELS)

    expect(lod.switchDistance(50)).toBeCloseTo(starLodSwitchDistance(696000, 50, 1080), 10)
  })

  it('StarLod сохраняет двухаргументный конструктор и то же поведение', () => {
    // Существующий тест стыка звезды строит StarLod двумя аргументами и
    // править его нельзя: он охраняет сведённый стык
    const star = new StarLod(696000, fakeRenderer)
    const generic = new ApparentSizeLod(696000, fakeRenderer, STAR_IMPOSTOR_PIXELS)

    expect(star).toBeInstanceOf(ApparentSizeLod)
    expect(star.switchDistance(50)).toBeCloseTo(generic.switchDistance(50), 10)
  })

  it('больший импостор переключается ближе', () => {
    const small = new ApparentSizeLod(69900, fakeRenderer, 12)
    const large = new ApparentSizeLod(69900, fakeRenderer, 24)

    expect(large.switchDistance(50)).toBeLessThan(small.switchDistance(50))
  })
})

describe('сборка узла карлика', () => {
  it('тело остаётся под DynamicNode, а не подменяет его собой', () => {
    // Без обёртки тело потеряло бы кеплерово обновление и регистрацию маркера,
    // а traverse по корню прошёл бы и по самому корню — то есть проверка
    // «BrownDwarf достижим» такую подмену не ловит
    const factory = new RenderableFactory(fakeRenderer, {} as unknown as ResourceObserver, new AtmosphereRegistry(), new RingDustRegistry())
    const node = factory.make(stubActor())

    expect(node).toBeInstanceOf(DynamicNode)
    expect((node as DynamicNode).renderable).toBeInstanceOf(BrownDwarf)
    expect(node.name).toBe('Dwarf')
  })
})

describe('импостор коричневого карлика', () => {
  it('берёт формулы из общего чанка, а не из своей копии', () => {
    expect(BrownDwarfImpostorShaderTemplate.fragmentShader).toContain('#include <brownDwarfSurface>')
    expect(BrownDwarfImpostorShaderTemplate.fragmentShader).not.toContain('float bdTransmit(')
    expect(BrownDwarfImpostorShaderTemplate.fragmentShader).not.toContain('float bdCompose(')
  })

  it('зовёт ту же точку композиции с тем же списком аргументов, что и диск', () => {
    // Самый прямой контракт «одна формула на оба LOD»: если аргументы
    // разъедутся, на переключении появится шов
    const call = (source: string): string => {
      const start: number = source.indexOf('bdShade(')

      expect(start).toBeGreaterThanOrEqual(0)

      // Закрывающая скобка ищется по глубине, а не первой встречной: иначе
      // при -1 от переименования indexOf(')', -1) стартует с 0 и находит
      // случайную ")" раньше настоящего вызова — обе стороны схлопнутся в ''
      // и '' === '' пройдёт. Глубина же вдобавок переживёт вложенный вызов
      // в аргументах, который иначе обрезал бы совпадение раньше времени
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

    expect(call(BrownDwarfImpostorShaderTemplate.fragmentShader)).toBe(call(BrownDwarfShaderTemplate.fragmentShader))
  })

  it('считает то же поле и несёт те же ручки вида, что и диск', () => {
    // Общий источник данных и общие ручки — то, чем сведён шов на переключении.
    // Сравнивается именно ОБЩИЙ набор, а не надмножество: у диска есть
    // uCameraObject (он живёт в объектных координатах) и uParallax (сдвиг
    // верхушек облаков — на 12px он суб-текселен и импостору не нужен), у
    // импостора — uBodyRotation (он восстанавливает псевдосферу). Требовать
    // друг от друга чужие юниформы значило бы навязывать им одну реализацию
    const shared = [
      'uSeed',
      'uBandCount',
      'uTurbulence',
      'uGapThreshold',
      'uDeckSoftness',
      'uColorCloud',
      'uColorCloudHigh',
      'uColorHot',
      'uColorHotDeep',
      'uOpticalDepth',
      'uGapGlow',
      'uLimbDarkening',
      'uBreathAmplitude',
      'uStormDepth',
      'time'
    ]

    for (const key of shared) {
      expect(BrownDwarfShaderTemplate.uniforms).toHaveProperty(key)
      expect(BrownDwarfImpostorShaderTemplate.uniforms).toHaveProperty(key)
    }
  })

  it('копирует с тела весь список юниформов, а не только часть ключей', () => {
    // Список продублирован из конструктора BrownDwarfImpostor: забытый там
    // ключ оставляет юниформ дефолтным вместо значения тела, и тест обязан
    // упасть именно на этом ключе. toBe проверяет «то же значение» по-разному
    // для двух видов юниформов: у цветов — тождество объекта Color (копия по
    // ссылке, дальше живёт синхронно с телом), у скаляров — равенство числа
    // (копия по значению один раз здесь, в конструкторе; дальше не следит)
    //
    // Данные актора ниже намеренно расходятся с DEFAULTS из
    // BrownDwarfParameters по каждому скаляру: те дефолты совпадают с
    // дефолтами обоих шаблонов юниформов один в один, и на пустых данных
    // (как у stubActor()) пропуск копирования скаляра был бы не виден —
    // импостор молча остался бы на СВОЁМ дефолте, который случайно равен
    // значению тела
    const actor = {
      getAttribute: (key: string, def?: unknown): unknown =>
        key === 'categoryId' ? 8 : key === 'name' ? 'Dwarf' : def,
      rotation: null,
      renderingObject: {
        getAttribute: (): unknown => ({
          seed: 777,
          bandCount: 6,
          turbulence: 2.4,
          opticalDepth: 1.5,
          gapGlow: 2.2,
          limbDarkening: 0.35,
          gapThreshold: 0.55,
          deckSoftness: 0.12,
          breathAmplitude: 0.3,
          bandWarp: 0.28,
          zonalShear: 0.2,
          fineDetail: 0.45,
          polarChaos: 0.55,
          vortexStrength: 0.6,
          stormDepth: 0.22
        })
      },
      physicalObject: {
        getAttribute: (key: string, def?: unknown): unknown =>
          key === 'radius' ? 69900 : key === 'temperature' ? 1600 : def
      }
    } as unknown as Actor

    const copiedKeys = [
      'uSeed',
      'uBandCount',
      'uTurbulence',
      'uGapThreshold',
      'uDeckSoftness',
      'uColorCloud',
      'uColorCloudHigh',
      'uColorHot',
      'uColorHotDeep',
      'uOpticalDepth',
      'uGapGlow',
      'uLimbDarkening',
      'uBreathAmplitude',
      'uBandWarp',
      'uZonalShear',
      'uFineDetail',
      'uPolarChaos',
      'uVortexStrength',
      'uStormDepth'
    ]

    const body = new BrownDwarf(actor)
    const impostor = new BrownDwarfImpostor(body, fakeRenderer)

    for (const key of copiedKeys) {
      expect(impostor.material.uniforms[key].value).toBe(body.material.uniforms[key].value)
    }

    body.dispose()
  })

  it('поворот берётся от самого билборда, а не от камеры', () => {
    // Нормаль псевдосферы задана координатами внутри квада, то есть живёт в
    // системе билборда. Ориентация билборда идёт от lookAt на камеру и
    // совпадает с ориентацией камеры только когда тело на оси взгляда —
    // иначе панорамирование крутило бы узор, чего диск не делает
    const body = new BrownDwarf(stubActor())
    const impostor = new BrownDwarfImpostor(body, fakeRenderer)

    // Камера сбоку, но смотрит по умолчанию вдоль -Z: её собственная
    // ориентация единичная, а билборд развернётся к ней, в мировой +X
    const camera = new PerspectiveCamera()
    camera.position.set(10, 0, 0)
    camera.updateMatrixWorld(true)

    impostor.updateObject({ delta: 0, epoch: 0, elapsed: 0, camera })
    impostor.updateMatrixWorld(true)
    impostor.onBeforeRender(fakeRenderer, new Scene(), camera, impostor.geometry, impostor.material, null as never)

    const forward = new Vector3(0, 0, 1).applyMatrix3(impostor.material.uniforms.uBodyRotation.value)

    // Через матрицу камеры вышло бы (0, 0, 1) — тест различает эти два случая
    expect(forward.x).toBeCloseTo(1, 5)
    expect(forward.y).toBeCloseTo(0, 5)
    expect(forward.z).toBeCloseTo(0, 5)

    body.dispose()
  })

  it('не имеет собственного множителя яркости', () => {
    // Любой множитель поверх воссоздал бы шов на переключении
    expect(BrownDwarfImpostorShaderTemplate.uniforms).not.toHaveProperty('uImpostorBrightness')
  })
})

describe('вращение тела карлика (категория 8 в ORIENTED_CATEGORIES)', () => {
  it('DynamicNode копирует ориентацию на renderable — без записи в Set кватернион остался бы тождественным', () => {
    // period: 0 замыкает getMeridianAngleByEpoch на голый meridianAngle
    // (см. OrientationModel.getMeridianAngleByEpoch): эпоха теста не влияет
    // на результат, и незачем тащить сюда J2000
    const rotation = {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'meridianAngle' ? 90 : (def ?? 0))
    }
    const actor = {
      getAttribute: (key: string, def?: unknown): unknown =>
        key === 'categoryId' ? 8 : key === 'name' ? 'Dwarf' : def,
      rotation,
      renderingObject: { getAttribute: () => ({}) },
      physicalObject: {
        getAttribute: (key: string, def?: unknown): unknown =>
          key === 'radius' ? 69900 : key === 'temperature' ? 1600 : def
      }
    } as unknown as Actor

    const node = new DynamicNode(actor)
    const body = new BrownDwarf(actor)
    node.renderable = body

    node.updateObject({ epoch: 0, delta: 0, elapsed: 0, camera: new PerspectiveCamera() })

    // Не жёсткое число: OrientationModel — отдельно проверенный источник
    // истины (tests/OrientationModel.spec.ts), здесь проверяется только то,
    // что DynamicNode его действительно зовёт и копирует результат
    const expected = new OrientationModel(actor).getQuaternion(0)

    // Сама заглушка обязана давать НЕтождественный поворот — иначе тест
    // прошёл бы и без записи 8 в ORIENTED_CATEGORIES
    expect(expected.equals(new Quaternion())).toBe(false)
    expect(body.quaternion.equals(expected)).toBe(true)

    body.dispose()
  })

  it('uCameraObject и uBodyRotation компенсируют поворот тела на 90° вокруг Y одинаково для обоих LOD', () => {
    // Тело построено напрямую (не через DynamicNode) — та же ось и угол,
    // что в BrownDwarfBody.spec.ts, число -5 по X сверяется между файлами.
    // Матрица R(+90° вокруг Y): (x,y,z) -> (z,y,-x); обратная R⁻¹ — её
    // транспонирование: (x,y,z) -> (-z,y,x) (стандартная формула, руками).
    const body = new BrownDwarf(stubActor())
    body.position.set(10, 0, 0)
    body.rotation.set(0, Math.PI / 2, 0)
    body.updateMatrixWorld(true)

    const camera = new PerspectiveCamera()
    camera.position.set(10, 0, 5)
    camera.updateMatrixWorld(true)

    // --- Тело: uCameraObject = R⁻¹ · (cameraWorld - bodyPosition) ---
    body.onBeforeRender(fakeRenderer, new Scene(), camera, body.geometry, body.material, null as never)

    const cameraObject = body.material.uniforms.uCameraObject.value as Vector3

    expect(cameraObject.x).toBeCloseTo(-5, 5)
    expect(cameraObject.y).toBeCloseTo(0, 5)
    expect(cameraObject.z).toBeCloseTo(0, 5)

    // --- Импостор: билборд в начале координат, смотрит на ту же камеру ---
    const impostor = new BrownDwarfImpostor(body, fakeRenderer)

    impostor.updateObject({ delta: 0, epoch: 0, elapsed: 0, camera })
    impostor.updateMatrixWorld(true)
    impostor.onBeforeRender(fakeRenderer, new Scene(), camera, impostor.geometry, impostor.material, null as never)

    // lookAt обычного Object3D (не камеры) ставит локальный +Z вдоль
    // направления НА цель: билборд в (0,0,0), камера в (10,0,5) ->
    // R_billboard · (0,0,1) = normalize(10,0,5)
    const billboardZ = new Vector3(10, 0, 5).normalize()
    // Перевод в систему тела: R_body⁻¹ · billboardZ по формуле (x,y,z) -> (-z,y,x)
    const expected = new Vector3(-billboardZ.z, billboardZ.y, billboardZ.x)

    const forward = new Vector3(0, 0, 1).applyMatrix3(impostor.material.uniforms.uBodyRotation.value)

    // Без bodyRotation.invert() вышло бы R_body · billboardZ = (billboardZ.z, billboardZ.y, -billboardZ.x) —
    // отличается от expected знаком у X и Z, тест это различает
    expect(forward.x).toBeCloseTo(expected.x, 5)
    expect(forward.y).toBeCloseTo(expected.y, 5)
    expect(forward.z).toBeCloseTo(expected.z, 5)

    body.dispose()
  })
})
