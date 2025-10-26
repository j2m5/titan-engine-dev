import { Camera, EventDispatcher, Quaternion, Sphere, Spherical, Vector2, Vector3 } from 'three'

type AstroControlsEventMap = {
  change: { data: Vector3 }
}

type MoveState = {
  up: number
  down: number
  left: number
  right: number
  forward: number
  back: number
  pitchUp: number
  pitchDown: number
  yawLeft: number
  yawRight: number
  rollLeft: number
  rollRight: number
}

const EPS: number = 0.000001
const lastQuaternion: Quaternion = new Quaternion()
const lastPosition: Vector3 = new Vector3()

class AstroControls extends EventDispatcher<AstroControlsEventMap> {
  public object: Camera
  public sphere: Sphere
  public domElement: HTMLElement
  public target: Vector3
  public autoForward: boolean
  public movementSpeed: number
  public rollSpeed: number
  public enabled: boolean

  private spherical: Spherical = new Spherical()
  private tmpQuaternion: Quaternion = new Quaternion()
  private moveState: MoveState = {
    up: 0,
    down: 0,
    left: 0,
    right: 0,
    forward: 0,
    back: 0,
    pitchUp: 0,
    pitchDown: 0,
    yawLeft: 0,
    yawRight: 0,
    rollLeft: 0,
    rollRight: 0
  }
  private moveVector: Vector3 = new Vector3(0, 0, 0)
  private rotationVector: Vector3 = new Vector3(0, 0, 0)
  private isRotating: boolean = false
  private rotateStart: Vector2 = new Vector2()
  private rotateEnd: Vector2 = new Vector2()
  private rotateDelta: Vector2 = new Vector2()

  private $contextmenu = this.contextMenu.bind(this)
  private $keydown = this.keydown.bind(this)
  private $keyup = this.keyup.bind(this)
  private $mousedown = this.mousedown.bind(this)
  private $mousemove = this.mousemove.bind(this)
  private $mouseup = this.mouseup.bind(this)

  public constructor(object: Camera, sphere: Sphere, domElement: HTMLElement) {
    super()

    this.object = object
    this.sphere = sphere
    this.domElement = domElement
    this.target = new Vector3()
    this.autoForward = false
    this.movementSpeed = 1.0
    this.rollSpeed = 0.005
    this.enabled = true
    this.spherical.setFromVector3(this.object.position)

    this.domElement.addEventListener('contextmenu', this.$contextmenu)

    window.addEventListener('keydown', this.$keydown)
    window.addEventListener('keyup', this.$keyup)
    this.domElement.addEventListener('mousedown', this.$mousedown)
    this.domElement.addEventListener('mousemove', this.$mousemove)
    this.domElement.addEventListener('mouseup', this.$mouseup)

    this.updateMovementVector()
    this.updateRotationVector()
  }

  private mousedown(event: MouseEvent): void {
    if (!this.enabled) return

    if (event.button === 2) {
      this.isRotating = true
      this.rotateStart.set(event.clientX, event.clientY)
      this.spherical.setFromVector3(this.object.position.clone().sub(this.target))
    }
  }

  private mousemove(event: MouseEvent): void {
    if (!this.enabled) return

    if (this.isRotating) {
      this.rotateEnd.set(event.clientX, event.clientY)
      this.rotateDelta.subVectors(this.rotateEnd, this.rotateStart)

      this.rotateCamera(this.rotateDelta.x, this.rotateDelta.y)

      this.rotateStart.copy(this.rotateEnd)
    }
  }

  private mouseup(): void {
    if (!this.enabled) return

    this.isRotating = false
  }

  private rotateCamera(deltaX: number, deltaY: number): void {
    const rotationSpeed: number = 1.0
    const theta: number = 2 * Math.PI * (deltaX / window.innerWidth) * rotationSpeed
    const phi: number = 2 * Math.PI * (deltaY / window.innerHeight) * rotationSpeed

    this.spherical.theta -= theta
    this.spherical.phi -= phi

    this.spherical.phi = Math.max(0, Math.min(Math.PI, this.spherical.phi))

    this.spherical.makeSafe()

    const newPosition: Vector3 = new Vector3().setFromSpherical(this.spherical).add(this.target)
    this.object.position.copy(newPosition)
    this.object.lookAt(this.target)
  }

  private keydown(event: KeyboardEvent): void {
    if (event.altKey || !this.enabled) {
      return
    }

    switch (event.code) {
      case 'KeyW':
        this.moveState.forward = 1
        break
      case 'KeyS':
        this.moveState.back = 1
        break

      case 'KeyA':
        this.moveState.left = 1
        break
      case 'KeyD':
        this.moveState.right = 1
        break

      case 'KeyR':
        this.moveState.up = 1
        break
      case 'KeyF':
        this.moveState.down = 1
        break

      case 'ArrowUp':
        this.moveState.pitchUp = 1
        break
      case 'ArrowDown':
        this.moveState.pitchDown = 1
        break

      case 'ArrowLeft':
        this.moveState.yawLeft = 1
        break
      case 'ArrowRight':
        this.moveState.yawRight = 1
        break

      case 'KeyQ':
        this.moveState.rollLeft = 1
        break
      case 'KeyE':
        this.moveState.rollRight = 1
        break
    }

    this.updateMovementVector()
    this.updateRotationVector()
  }

  private keyup(event: KeyboardEvent): void {
    if (!this.enabled) return

    switch (event.code) {
      case 'KeyW':
        this.moveState.forward = 0
        break
      case 'KeyS':
        this.moveState.back = 0
        break

      case 'KeyA':
        this.moveState.left = 0
        break
      case 'KeyD':
        this.moveState.right = 0
        break

      case 'KeyR':
        this.moveState.up = 0
        break
      case 'KeyF':
        this.moveState.down = 0
        break

      case 'ArrowUp':
        this.moveState.pitchUp = 0
        break
      case 'ArrowDown':
        this.moveState.pitchDown = 0
        break

      case 'ArrowLeft':
        this.moveState.yawLeft = 0
        break
      case 'ArrowRight':
        this.moveState.yawRight = 0
        break

      case 'KeyQ':
        this.moveState.rollLeft = 0
        break
      case 'KeyE':
        this.moveState.rollRight = 0
        break
    }

    this.updateMovementVector()
    this.updateRotationVector()
  }

  private updateMovementVector(): void {
    const forward: 0 | 1 = this.moveState.forward || (this.autoForward && !this.moveState.back) ? 1 : 0

    this.moveVector.x = -this.moveState.left + this.moveState.right
    this.moveVector.y = -this.moveState.down + this.moveState.up
    this.moveVector.z = -forward + this.moveState.back
  }

  private updateRotationVector(): void {
    this.rotationVector.x = -this.moveState.pitchDown + this.moveState.pitchUp
    this.rotationVector.y = -this.moveState.yawRight + this.moveState.yawLeft
    this.rotationVector.z = -this.moveState.rollRight + this.moveState.rollLeft
  }

  private contextMenu(event: Event): void {
    if (!this.enabled) return

    event.preventDefault()
  }

  public update(delta: number): void {
    if (!this.enabled) return

    this.sphere.center.copy(this.object.position.clone())

    const moveMult: number = delta * this.movementSpeed
    const rotMult: number = delta * this.rollSpeed

    this.object.translateX(this.moveVector.x * moveMult)
    this.object.translateY(this.moveVector.y * moveMult)
    this.object.translateZ(this.moveVector.z * moveMult)

    this.tmpQuaternion
      .set(this.rotationVector.x * rotMult, this.rotationVector.y * rotMult, this.rotationVector.z * rotMult, 1)
      .normalize()
    this.object.quaternion.multiply(this.tmpQuaternion)

    if (
      lastPosition.distanceToSquared(this.object.position) > EPS ||
      8 * (1 - lastQuaternion.dot(this.object.quaternion)) > EPS
    ) {
      this.dispatchEvent({ type: 'change', data: lastPosition })
      lastQuaternion.copy(this.object.quaternion)
      lastPosition.copy(this.object.position)
    }
  }

  public dispose(): void {
    this.domElement.removeEventListener('contextmenu', this.$contextmenu)

    window.removeEventListener('keydown', this.$keydown)
    window.removeEventListener('keyup', this.$keyup)
    this.domElement.removeEventListener('mousedown', this.$mousedown)
    this.domElement.removeEventListener('mousemove', this.$mousemove)
    this.domElement.removeEventListener('mouseup', this.$mouseup)
  }
}

export { AstroControls }
