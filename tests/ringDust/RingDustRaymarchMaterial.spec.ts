import { AdditiveBlending, BackSide, ShaderChunk } from 'three'
import { RingDustRaymarchMaterial } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustRaymarchMaterial'
import { sceneDepthFunctions } from '@/core/materials/shaders/lib/chunks/SceneDepth'

describe('RingDustRaymarchMaterial', () => {
  const make = () => new RingDustRaymarchMaterial()

  it('настроен как аддитивное backface-гало: depthTest OFF, depthWrite OFF', () => {
    const m = make()
    expect(m.side).toBe(BackSide)
    expect(m.transparent).toBe(true)
    // Аппаратный тест глубины бинарен и не умеет «часть луча до камня»: с ним
    // гало либо целиком срезалось планетой и камнями, либо целиком просвечивало
    // сквозь них. Перекрытие теперь считает сам марш по текстуре глубины сцены
    // (обрыв луча на tScene), поэтому тест и запись глубины выключены.
    // Аддитивный блендинг делает порядок прозрачных неважным
    expect(m.depthWrite).toBe(false)
    expect(m.depthTest).toBe(false)
    expect(m.blending).toBe(AdditiveBlending)
  })

  it('несёт полный uniform-набор модели пыли + марш и диагностику', () => {
    const u = make().uniforms
    for (const name of [
      'uDustColor', 'uDustDensity', 'uDustScaleHeight', 'uDustRingInner', 'uDustRingOuter',
      'uDustCamRingPos', 'uDustLightDirRing', 'uDustAnglePower', 'uDustNearFade',
      'uDustPlanetRadius', 'uDustMaxSteps', 'uDustDebugMode'
    ]) {
      expect(u[name], name).toBeDefined()
    }
    expect(u.uDustMaxSteps.value).toBe(16)
    expect(u.uDustDebugMode.value).toBe(0)
  })

  it('фрагментный шейдер маршит по интервалам с джиттером, ранним выходом и гейтом', () => {
    const fs = make().fragmentShader
    // марш по аналитическим интервалам, а не по всему прокси
    expect(fs).toContain('ringDustCircleInterval')
    expect(fs).toContain('ringDustDensityAt')
    // IGN-джиттер против бандинга
    expect(fs).toContain('52.9829189')
    // early-exit по насыщению
    expect(fs).toContain('0.995')
    // гейт по углу и рамп
    expect(fs).toContain('ringDustAngleGate')
    expect(fs).toContain('ringDustNearRamp')
    // тень планеты пошагово (затемняет цвет, не alpha)
    expect(fs).toContain('ringDustPlanetShadow')
    expect(fs).toContain('litTau')
    // диагностические режимы
    expect(fs).toContain('uDustDebugMode')
  })

  it('НЕ использует замкнутую форму tau в объёме (марш — точка расширения под шум)', () => {
    expect(make().fragmentShader).not.toContain('ringDustTauRay')
  })

  it('несёт юниформы глубины сцены для обрыва марша', () => {
    const u = make().uniforms
    expect(u.uSceneDepth).toBeDefined()
    expect(u.uSceneDepth.value).toBeNull()
    expect(u.uResolution).toBeDefined()
    expect(u.uResolution.value.x).toBe(1)
    expect(u.uResolution.value.y).toBe(1)
    expect(u.uLogFarFactor).toBeDefined()
    expect(u.uLogFarFactor.value).toBe(1)
    // Обрезка выключена, пока пасс её не включит: рендер вне пасса идёт без глубины сцены
    expect(u.uSceneDepthEnabled.value).toBe(0)
  })

  it('декод глубины сцены — общий чанк SceneDepth, а не своя копия', () => {
    const fs = make().fragmentShader
    expect(fs).toContain(sceneDepthFunctions)
    expect(fs).toContain('float tScene = sceneDepthRayT(mat3(modelViewMatrix) * rayDir)')
  })

  it('обрывает пыльные интервалы на глубине сцены, а не пишет глубину сам', () => {
    const fs = make().fragmentShader
    // Глубина сцены читается по экранной координате из копии depth-текстуры
    expect(fs).toContain('texture2D(uSceneDepth, gl_FragCoord.xy / uResolution)')
    // Декод лог-глубины three: w = 2^(z·log2(far+1)) − 1 — вдоль оси камеры
    expect(fs).toContain('exp2(z * uLogFarFactor) - 1.0')
    // Перевод в параметр луча в ring-local: w / (−z направления луча во view),
    // без нормировки — масштаб modelViewMatrix учитывается сам
    expect(fs).toContain('mat3(modelViewMatrix) * rayDir')
    // Оба интервала режутся по tScene ДО вычисления длин: пыль за камнем и за
    // планетой в τ не попадает, а луч, упёршийся в поверхность до входа в слой,
    // схлопывается и уходит в discard
    expect(fs).toContain('segA.y = min(segA.y, tScene)')
    expect(fs).toContain('segB.y = min(segB.y, tScene)')
    expect(fs.indexOf('min(segA.y, tScene)')).toBeLessThan(fs.indexOf('float lenA = '))
    // Небо (z = 1) не режет ничего
    expect(fs).toContain('z < 1.0 - 1e-6')
    // Своей глубины материал не пишет: ни чанком three, ни вручную
    expect(fs).not.toContain(ShaderChunk.logdepthbuf_fragment)
    expect(fs).not.toContain('gl_FragDepth')
  })
})
