import { Color } from 'three'
import { Actor } from '@/core/models/Actor'
import { readRenderingData } from '@/core/helpers/renderingData'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import type { IPulsarRenderingObject } from '@/core/models/types'

const DEG = Math.PI / 180

/** Ручки пульсара после дефолтов и клампов — радианы и единицы сцены */
export interface PulsarParameters {
  exposureBias: number
  beamPeriodSeconds: number
  beamTiltRad: number
  beamHalfAngleRad: number
  beamLengthUnits: number
  beamColor: Color
  beamIntensity: number
  beamPhaseRad: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export function pulsarParameters(actor: Actor): PulsarParameters {
  const data: IPulsarRenderingObject = readRenderingData<IPulsarRenderingObject>(actor) ?? {}

  return {
    exposureBias: Math.max(data.exposureBias ?? 1, 0),
    // Период короче 0.05 с при 60 к/с — стробоскоп, а не маяк
    beamPeriodSeconds: Math.max(data.beamPeriodSeconds ?? 4, 0.05),
    beamTiltRad: clamp(data.beamTiltDeg ?? 30, 0, 90) * DEG,
    beamHalfAngleRad: clamp(data.beamHalfAngleDeg ?? 6, 0.5, 45) * DEG,
    beamLengthUnits: fromAstronomicalUnits(Math.max(data.beamLengthAu ?? 500, 1e-3)),
    beamColor: new Color(data.beamColor ?? 0xbcd4ff),
    beamIntensity: Math.max(data.beamIntensity ?? 6, 0),
    beamPhaseRad: (data.beamPhaseDeg ?? 0) * DEG
  }
}
