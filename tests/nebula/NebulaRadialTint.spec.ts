import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import { Actors, RenderingObjects } from '@storage/database'
import { makeDefaultNebulaParams, mergeNebulaParams, type NebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { nebulaParamsFromData, type NebulaRenderingData } from '@/core/renderables/Nebula/NebulaRenderingData'
import { nebulaColorChunk } from '@/core/renderables/Nebula/material/shader/chunks/NebulaColor'
import { createNebulaUniforms } from '@/core/renderables/Nebula/material/shader/raymarch.template'

/**
 * Радиальный тон ионизации.
 *
 * Плотность отвечает «насколько густо», а цвет планетарной туманности — на
 * другой вопрос, «насколько ионизовано», и он радиальный. Подмена одного другим
 * держится, только пока величины скоррелированы, чего оболочка с узлами по
 * всему объёму не даёт.
 *
 * Чанк цвета ОБЩИЙ на все туманности, поэтому нейтральность дефолта здесь —
 * несущее свойство, а не удобство.
 */
describe('радиальный тон — нейтральность дефолта', () => {
  it('движок по умолчанию ведёт цвет одной плотностью', () => {
    // Любое ненулевое значение сдвинуло бы уже принятые сцены молча
    expect(makeDefaultNebulaParams().palette.radialMix).toBe(0)
  })

  it('юниформ материала стартует с того же нуля', () => {
    expect(createNebulaUniforms().uRadialMix.value).toBe(0)
  })

  it('шейдер целиком пропускает радиальную ветку при нуле', () => {
    // Гейт, а не умножение на ноль: при uRadialMix = 0 не выполняется ни
    // length(p), ни два mix. Замени на безусловный mix — и дефолтные сцены
    // начнут платить за выключенную возможность
    expect(nebulaColorChunk).toContain('if (uRadialMix > 0.001)')
    expect(nebulaColorChunk).toContain('mix(base, mix(uInnerColor, uOuterColor, radial), uRadialMix)')
  })

  it('радиус берётся из позиции, а не из плотности', () => {
    // Смысл всей правки: если сюда попадёт density, тон снова станет функцией
    // густоты и мы вернёмся к тому, от чего уходили
    expect(nebulaColorChunk).toContain('float radial = clamp(length(p), 0.0, 1.0)')
  })
})

describe('радиальный тон — слой данных', () => {
  it('доля клампится в [0, 1]', () => {
    // Смешивание вне отрезка экстраполирует за оба тона и уводит каналы в минус
    expect(mergeNebulaParams({ palette: { radialMix: 5 } }).palette.radialMix).toBe(1)
    expect(mergeNebulaParams({ palette: { radialMix: -2 } }).palette.radialMix).toBe(0)
  })

  it('hex-строки из данных доезжают цветами', () => {
    const params: NebulaParams = nebulaParamsFromData({
      palette: { radialMix: 0.5, innerColor: '#4fe0d8', outerColor: '#c8402a' }
    })

    expect(params.palette.innerColor.getHex()).toBe(new Color('#4fe0d8').getHex())
    expect(params.palette.outerColor.getHex()).toBe(new Color('#c8402a').getHex())
  })

  it('ноль переживает чтение — это точка отката', () => {
    expect(nebulaParamsFromData({ palette: { radialMix: 0 } }).palette.radialMix).toBe(0)
  })
})

function nebulaDataFor(name: string): NebulaRenderingData {
  const actor = Actors.find((a) => a.name === name)
  expect(actor, `актор ${name} не найден`).toBeDefined()

  return RenderingObjects.find((r) => r.actorId === actor!.id)!.data as NebulaRenderingData
}

describe('радиальный тон — поставляемые сцены', () => {
  it('Helix подписан на радиальный тон: бирюза внутри, красное на кромке', () => {
    const palette = nebulaParamsFromData(nebulaDataFor('Helix Nebula')).palette

    expect(palette.radialMix).toBeGreaterThan(0)
    // O III у звезды — синева выше красноты; H-alpha с [N II] на кромке — наоборот
    expect(palette.innerColor.b).toBeGreaterThan(palette.innerColor.r)
    expect(palette.outerColor.r).toBeGreaterThan(palette.outerColor.b)
  })

  it('Horuset не тронут — он на радиальный тон не подписывался', () => {
    // Прямая проверка того, ради чего дефолт нулевой: правка общего чанка не
    // имеет права поехать по чужим сценам
    expect(nebulaParamsFromData(nebulaDataFor('Horuset Nebula')).palette.radialMix).toBe(0)
  })
})
