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
}

export interface ThreeConfig {
  scene: SceneParameters
  camera: CameraParameters
  renderer: WebGLRendererParameters
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
    far: fromAstronomicalUnits(2000)
  },
  renderer: {
    logarithmicDepthBuffer: true,
    antialias: false,
    alpha: true
  },
  clock: {
    startTime: 0
  },
  astroControls: {
    rollSpeed: 0.1,
    autoForward: false
  },
  cameraPosition: [0, 0, fromAstronomicalUnits(0.01)]
}
