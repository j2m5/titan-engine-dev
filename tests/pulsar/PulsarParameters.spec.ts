import { describe, it, expect } from 'vitest'
import { Color } from 'three'
import { pulsarParameters } from '@/core/renderables/Pulsar/PulsarParameters'
import { Actor } from '@/core/models/Actor'
import type { IPulsarRenderingObject } from '@/core/models/types'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'

const actorOf = (data: IPulsarRenderingObject | null): Actor =>
  ({
    renderingObject: data ? { getAttribute: (): unknown => data } : null,
    physicalObject: {
      getAttribute: (k: string, f: unknown = 0): unknown => (k === 'radius' ? 10 : k === 'temperature' ? 1e6 : f)
    },
    getAttribute: (k: string, f: unknown = ''): unknown => (k === 'name' ? 'PSR' : f)
  }) as unknown as Actor

describe('pulsarParameters: дефолты и клампы', () => {
  it('без строки rendering — дефолты спеки', () => {
    const p = pulsarParameters(actorOf(null))

    expect(p.exposureBias).toBe(1)
    expect(p.beamPeriodSeconds).toBe(4)
    expect(p.beamTiltRad).toBeCloseTo((30 * Math.PI) / 180, 9)
    expect(p.beamHalfAngleRad).toBeCloseTo((6 * Math.PI) / 180, 9)
    expect(p.beamLengthUnits).toBeCloseTo(fromAstronomicalUnits(500), 6)
    expect(p.beamColor.getHex()).toBe(0xbcd4ff)
    expect(p.beamIntensity).toBe(6)
    expect(p.beamPhaseRad).toBe(0)
  })

  it('клампы: период ≥ 0.05, полуугол [0.5°, 45°], наклон [0°, 90°], длина > 0, яркость ≥ 0', () => {
    const p = pulsarParameters(
      actorOf({ beamPeriodSeconds: 0, beamHalfAngleDeg: 90, beamTiltDeg: -10, beamLengthAu: -1, beamIntensity: -3 })
    )

    expect(p.beamPeriodSeconds).toBe(0.05)
    expect(p.beamHalfAngleRad).toBeCloseTo((45 * Math.PI) / 180, 9)
    expect(p.beamTiltRad).toBe(0)
    expect(p.beamLengthUnits).toBeGreaterThan(0)
    expect(p.beamIntensity).toBe(0)
  })

  it('цвет принимает hex-строку и число', () => {
    expect(pulsarParameters(actorOf({ beamColor: '#ff8000' })).beamColor.getHex()).toBe(0xff8000)
    expect(pulsarParameters(actorOf({ beamColor: 0x00ff00 })).beamColor.equals(new Color(0x00ff00))).toBe(true)
  })
})
