import { describe, expect, it } from 'vitest'
import { terrainDetailFunctions, terrainDetailUniforms } from '@/core/materials/shaders/lib/chunks/TerrainDetail'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'

describe('TerrainDetail: зоны материала по уклону', () => {
  it('юниформы steep-набора и маски объявлены', () => {
    for (const u of ['uSteepNorMap', 'uSteepArmMap', 'uSteepDiffMap', 'uSteepGate', 'uSteepMask']) {
      expect(terrainDetailUniforms).toContain(u)
    }
  })

  it('маска: smoothstep по tan с шумовой рваной границей (существующий vnoise, ноль новых текстурных выборок)', () => {
    expect(terrainDetailFunctions).toContain('uSteepMask.z * (vnoise(')
    expect(terrainDetailFunctions).toContain('smoothstep(uSteepMask.x, uSteepMask.y, slopeTan +')
  })

  it('множитель uSteepGate живёт в самой маске (рулинг), не отдельным if', () => {
    expect(terrainDetailFunctions).toContain('float m = uSteepGate * smoothstep(')
  })

  it('ветвление по краям маски: вне полосы читается ровно один набор (STEEP_EPS)', () => {
    expect(terrainDetailFunctions).toContain('STEEP_EPS')
    expect(terrainDetailFunctions).toContain('m < STEEP_EPS')
    expect(terrainDetailFunctions).toContain('m > 1.0 - STEEP_EPS')
  })

  it('чтение тройки не копипастится по веткам — общий helper sampleDetailSet, параметризованный сэмплерами набора', () => {
    expect(terrainDetailFunctions).toContain('void sampleDetailSet(')
    // родной и steep наборы читаются ЧЕРЕЗ helper, не напрямую triplanar*Detiled —
    // иначе три выборки (nor/arm/diff) копировались бы в каждую из трёх веток маски
    expect(terrainDetailFunctions).toContain('sampleDetailSet(uDetailNorMap, uDetailArmMap, uDetailDiffMap')
    expect(terrainDetailFunctions).toContain('sampleDetailSet(uSteepNorMap, uSteepArmMap, uSteepDiffMap')
    // сам helper — единственное место, где triplanarNormal/Arm/AlbedoDetiled вызываются
    // применительно к обоим наборам (параметризован, не дублирован под каждый набор)
    const helperStart = terrainDetailFunctions.indexOf('void sampleDetailSet(')
    const applyStart = terrainDetailFunctions.indexOf('void applyTerrainDetail(')
    const helperBody = terrainDetailFunctions.slice(helperStart, applyStart)
    expect(helperBody).toContain('triplanarNormalDetiled(nor')
    expect(helperBody).toContain('triplanarArmDetiled(arm')
    expect(helperBody).toContain('triplanarAlbedoDetiled(diff')
  })

  it('бленд полосы перехода: нормали — whiteout последовательными весами (1-m)/m, ARM/диффуз — mix(a, b, m)', () => {
    expect(terrainDetailFunctions).toContain('fade1 * (1.0 - m) * (nNative - nLocal)')
    expect(terrainDetailFunctions).toContain('fade1 * m * (nSteep - nLocal)')
    expect(terrainDetailFunctions).toContain('mix(aoNative, aoSteep, m)')
    expect(terrainDetailFunctions).toContain('mix(tintNative, tintSteep, m)')
  })

  it('шаблон декодирует tan уклона из основного slope-декода (не macroSlope) и передаёт его в applyTerrainDetail', () => {
    const frag: string = PlanetShaderTemplate.fragmentShader
    expect(frag).toContain('float terrainSlopeTan = 0.0;')
    expect(frag).toContain('(uSlopeRange / 127.0)')
    expect(frag).toContain('terrainSlopeTan = length(terrainSlopeVec);')
    expect(frag).toContain(
      'applyTerrainDetail(nLocal, albedoMul, dirLocal, vDetailPos, vDetailPos2, length(vViewPosition), terrainSlopeTan);'
    )

    // terrainSlopeTan объявлен ДО #ifdef USE_SLOPE — имя в скоупе вызова
    // применения детали даже когда тело не несёт slope-карты
    const declIdx = frag.indexOf('float terrainSlopeTan = 0.0;')
    const slopeGateIdx = frag.indexOf('#ifdef USE_SLOPE', declIdx)
    const callIdx = frag.indexOf('applyTerrainDetail(nLocal, albedoMul, dirLocal, vDetailPos')
    expect(declIdx).toBeGreaterThan(-1)
    expect(slopeGateIdx).toBeGreaterThan(declIdx)
    expect(callIdx).toBeGreaterThan(slopeGateIdx)
  })
})
