import { WebGLRendererParameters } from 'three'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'

export type SceneParameters = {
  name: string
}

export type CameraParameters = {
  fov: number
  aspect: number
  near: number
  far: number
}

export type ClockParameters = {
  startTime: number
}

export type AstroControlsParameters = {
  rollSpeed: number
  autoForward: boolean
  /** Ниже этой доли радиуса тела правая кнопка мыши — осмотр на месте с ровным горизонтом. */
  freeLookAltitudeRatio: number
}

export interface ThreeConfig {
  scene: SceneParameters
  camera: CameraParameters
  renderer: WebGLRendererParameters
  maxPixelRatio: number
  clock: ClockParameters
  astroControls: AstroControlsParameters
  cameraPosition: [number, number, number]
}

export const three: ThreeConfig = {
  scene: {
    name: 'MainScene'
  },
  camera: {
    fov: 50,
    aspect: window.innerWidth / window.innerHeight,
    near: 0.000001,
    // Прокси NebulaVolume — куб [-2,2]: требуется дистанция + 2·size·√3 < far.
    // Crab при отъезде на 30 % занимает до 5471 а.е. по глубине в любом ракурсе.
    // Переход 5000 → 6000 а.е. увеличивает шаг лог-глубины примерно на 0,92 %.
    far: fromAstronomicalUnits(6000)
  },
  renderer: {
    logarithmicDepthBuffer: true,
    antialias: false,
    alpha: true,
    depth: true
  },
  maxPixelRatio: 2,
  clock: {
    startTime: 0
  },
  astroControls: {
    rollSpeed: 0.1,
    autoForward: false,
    freeLookAltitudeRatio: 0.02
  },
  cameraPosition: [0, 0, fromAstronomicalUnits(0.01)]
}
