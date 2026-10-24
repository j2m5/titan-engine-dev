import { PerspectiveCamera, Vector3 } from 'three'

export type CloudView = 'orbit' | 'approach' | 'above' | 'inside' | 'below'
export interface CloudFlightOptions {
  minAltitude?: number
  maxAltitude?: number
  minSpeed?: number
  speedScale?: number
  label?: string
}

/** World origin is the point (0, 0, R) on the planet, so near-cloud positions stay small. */
export function applyCloudView(camera: PerspectiveCamera, view: CloudView, radius: number): void {
  const height = { orbit: 9e7, approach: 580000, above: 45000, inside: 20000, below: 5000 }[view]
  const lookingDown = view === 'orbit' || view === 'approach'
  camera.position.set(0, 0, height)
  camera.up.set(0, lookingDown ? 1 : 0, lookingDown ? 0 : 1)
  if (lookingDown) camera.lookAt(0, 0, -radius)
  else camera.lookAt(100000, 0, height + (view === 'above' ? -50000 : 1000))
  camera.updateMatrixWorld()
}

export function constrainCloudCamera(camera: PerspectiveCamera, radius: number, limits: Pick<CloudFlightOptions, 'minAltitude' | 'maxAltitude'> = {}): void {
  const position = camera.position
  const distance = Math.hypot(position.x, position.y, position.z + radius)
  const minimum = limits.minAltitude ?? 500
  const limited = Math.min(radius + (limits.maxAltitude ?? 2e8), Math.max(radius + minimum, distance))
  if (limited === distance) return
  if (distance === 0) position.set(0, 0, minimum)
  else position.set(position.x, position.y, position.z + radius).multiplyScalar(limited / distance).z -= radius
}

export class CloudFlight {
  private readonly keys = new Set<string>()
  private pointer: number | null = null
  private readonly up = new Vector3()
  private readonly right = new Vector3()
  private readonly forward = new Vector3()
  private readonly direction = new Vector3()
  private readonly abort = new AbortController()

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    private readonly radius: number,
    private readonly flightOptions: CloudFlightOptions = {}
  ) {
    canvas.tabIndex = 0
    canvas.setAttribute('aria-label', flightOptions.label ?? 'Полёт над Юпитером: перетаскивание мышью, WASD и Q/E')
    const options = { signal: this.abort.signal }
    canvas.addEventListener(
      'keydown',
      (event) => {
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
          this.keys.add(event.code)
          event.preventDefault()
        }
      },
      options
    )
    window.addEventListener('keyup', (event) => this.keys.delete(event.code), options)
    canvas.addEventListener('blur', () => this.keys.clear(), options)
    window.addEventListener('blur', () => this.keys.clear(), options)
    canvas.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0 || this.pointer !== null) return
        canvas.focus()
        this.pointer = event.pointerId
        canvas.setPointerCapture(event.pointerId)
      },
      options
    )
    canvas.addEventListener(
      'pointerup',
      (event) => {
        if (this.pointer !== event.pointerId) return
        canvas.releasePointerCapture(event.pointerId)
        this.pointer = null
      },
      options
    )
    canvas.addEventListener(
      'lostpointercapture',
      () => {
        this.pointer = null
      },
      options
    )
    canvas.addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerId !== this.pointer) return
        this.updateAxes()
        camera.quaternion.premultiply(camera.quaternion.clone().setFromAxisAngle(this.up, -event.movementX * 0.003))
        camera.rotateX(-event.movementY * 0.003)
      },
      options
    )
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault()
        this.updateAxes()
        camera.position.addScaledVector(this.forward, -Math.sign(event.deltaY) * this.speed() * 0.35)
        constrainCloudCamera(camera, radius, flightOptions)
      },
      { ...options, passive: false }
    )
  }

  get altitude(): number {
    const p = this.camera.position
    return Math.hypot(p.x, p.y, p.z + this.radius) - this.radius
  }

  private speed(): number {
    return Math.max(this.flightOptions.minSpeed ?? 500, this.altitude * (this.flightOptions.speedScale ?? 0.6))
  }

  private updateAxes(): void {
    this.up.copy(this.camera.position).z += this.radius
    this.up.normalize()
    this.camera.getWorldDirection(this.forward)
    this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion)
  }

  update(delta: number): void {
    if (this.keys.size === 0) return
    this.updateAxes()
    const signed = (a: string, b: string): number => Number(this.keys.has(a)) - Number(this.keys.has(b))
    this.direction
      .copy(this.forward)
      .multiplyScalar(signed('KeyW', 'KeyS'))
      .addScaledVector(this.right, signed('KeyD', 'KeyA'))
      .addScaledVector(this.up, signed('KeyE', 'KeyQ'))
      .normalize()
    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 5 : 1
    this.camera.position.addScaledVector(this.direction, this.speed() * boost * Math.min(delta, 0.05))
    constrainCloudCamera(this.camera, this.radius, this.flightOptions)
  }

  dispose(): void {
    this.abort.abort()
    this.keys.clear()
    if (this.pointer !== null && this.canvas.hasPointerCapture(this.pointer))
      this.canvas.releasePointerCapture(this.pointer)
  }
}
