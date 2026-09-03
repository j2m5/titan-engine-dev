import { describe, expect, it } from 'vitest'
import { terrainDetailFunctions, terrainDetailUniforms } from '@/core/materials/shaders/lib/chunks/TerrainDetail'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'

describe('TerrainDetail: зоны материала по уклону', () => {
  it('юниформы steep-набора и маски объявлены', () => {
    for (const u of ['uSteepNorMap', 'uSteepArmMap', 'uSteepDiffMap', 'uSteepGate', 'uSteepMask']) {
      expect(terrainDetailUniforms).toContain(u)
    }
  })

  it('маска: smoothstep по tan с шумовой рваной границей — breakup переиспользует готовый l.z, ни нового vnoise, ни выборок', () => {
    expect(terrainDetailFunctions).toContain('uSteepMask.z * (l.z / 8.0 - 0.5)')
    expect(terrainDetailFunctions).toContain('smoothstep(uSteepMask.x, uSteepMask.y, slopeTan +')
    // ровно 3 вызова vnoise на всю applyTerrainDetail (l.x/l.y/l.z) — маска
    // зон не добавляет четвёртый (фикс-раунд 1: дубль вычисления)
    const applyStart = terrainDetailFunctions.indexOf('void applyTerrainDetail(')
    const vnoiseCalls = (terrainDetailFunctions.slice(applyStart).match(/vnoise\(/g) ?? []).length
    expect(vnoiseCalls).toBe(3)
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

  // Фикс-раунд 2 (приёмка владельца): маска зон ветвится на ПИКСЕЛЬНОЙ
  // частоте (шумовая граница) — dFdx/dFdy, посчитанные ВНУТРИ этой ветки
  // (или внутри triplanar*Detiled, вызываемых из неё), формально UB под
  // дивергентным потоком и давали видимый артефакт (мип-волоски вдоль
  // изоконтуров m = STEEP_EPS/1-EPS).
  //
  // Фикс-раунд 3 (ре-ревью, CRITICAL): пин на позицию ОПРЕДЕЛЕНИЯ dFdx(
  // внутри triplanarUvFor вакуумный — определение функции лексически ВСЕГДА
  // раньше applyTerrainDetail независимо от того, откуда её реально зовут;
  // тест оставался зелёным даже при откате фикса (мутация — CALL SITE
  // uvBig/uvSmall перенесён внутрь if (fade1 > 0.0) — не ловилась). Пин
  // теперь на CALL SITE: индекс вызова triplanarUvFor должен быть строго
  // раньше индекса ближайшей внутренней ветки (fade1) — вот она реально
  // двигается при регрессе.
  it('регресс: triplanarUvFor зовётся ДО ветки fade1/маски — не внутри неё (ловит перенос вызова, не только определения)', () => {
    const uvBigCallIdx = terrainDetailFunctions.indexOf('TriplanarUv uvBig = triplanarUvFor(')
    const uvSmallCallIdx = terrainDetailFunctions.indexOf('TriplanarUv uvSmall = triplanarUvFor(')
    const fade1GateIdx = terrainDetailFunctions.indexOf('if (fade1 > 0.0)')

    expect(uvBigCallIdx).toBeGreaterThan(-1)
    expect(uvSmallCallIdx).toBeGreaterThan(-1)
    expect(fade1GateIdx).toBeGreaterThan(-1)
    expect(uvBigCallIdx).toBeLessThan(fade1GateIdx)
    expect(uvSmallCallIdx).toBeLessThan(fade1GateIdx)
  })

  // Дополняющий grep-пин (не самодостаточный сам по себе — см. тест выше):
  // dFdx( встречается ровно 3 раза на весь чанк, все — внутри triplanarUvFor
  // (по одному на проекцию zy/xz/xy); обёртки/sampleDetailSet/applyTerrainDetail
  // dFdx больше не считают.
  it('dFdx( встречается ровно 3 раза на весь чанк — только внутри triplanarUvFor', () => {
    const dFdxCalls = (terrainDetailFunctions.match(/dFdx\(/g) ?? []).length
    expect(dFdxCalls).toBe(3)

    const uvForStart = terrainDetailFunctions.indexOf('TriplanarUv triplanarUvFor(')
    const uvForEnd = terrainDetailFunctions.indexOf('\n  }', uvForStart)
    const uvForBody = terrainDetailFunctions.slice(uvForStart, uvForEnd)
    const dFdxInUvFor = (uvForBody.match(/dFdx\(/g) ?? []).length
    expect(dFdxInUvFor).toBe(3)
  })
})
