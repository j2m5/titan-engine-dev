import { Group, PerspectiveCamera, Quaternion, Scene, Vector2, Vector3, WebGLRenderer } from 'three'
import { Nebula } from '@/core/renderables/Nebula'
import { NebulaImpostor } from '@/core/renderables/Nebula/volume/NebulaImpostor'
import { NebulaImpostorMaterial } from '@/core/renderables/Nebula/material/NebulaImpostorMaterial'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import { three } from '@/config/three'

const fakeRenderer = {
  getSize: (v: Vector2) => v.set(1920, 1080),
  getRenderTarget: () => null,
  setRenderTarget: () => {},
  getClearAlpha: () => 1,
  setClearAlpha: () => {},
  clear: () => {},
  render: () => {}
} as unknown as WebGLRenderer

/** Камера далеко от туманности (size 500) и смотрит на неё — LOD целиком импостор */
function farCamera(roll: number = 0): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, 16 / 9, 1e-6, 1e12)

  camera.position.set(3e6, 4e6, 5e6)
  camera.lookAt(0, 0, 0)
  // крен Q/E — поворот вокруг оси взгляда; camera.up он не трогает
  camera.rotateZ(roll)
  camera.updateMatrixWorld()

  return camera
}

function impostorOf(nebula: Nebula): NebulaImpostor {
  return nebula.children.find((c) => c instanceof NebulaImpostor) as NebulaImpostor
}

function bakedImpostor(camera: PerspectiveCamera): NebulaImpostor {
  const nebula = new Nebula(fakeRenderer, { size: 500 })

  nebula.updateObject({ delta: 0, epoch: 0, elapsed: 0, camera })

  const impostor = impostorOf(nebula)

  expect(impostor.visible).toBe(true)

  return impostor
}

describe('Импостор туманности: ориентация квада — от камеры запекания', () => {
  it('квад повёрнут как камера, смотрящая на центр с мировым up — узор запекания ложится без поворота', () => {
    const camera = farCamera()
    const impostor = bakedImpostor(camera)
    const expected = new PerspectiveCamera()

    expected.position.copy(camera.position)
    expected.lookAt(0, 0, 0)

    expect(impostor.quaternion.angleTo(expected.quaternion)).toBeLessThan(1e-6)
  })

  it('крен камеры (Q/E) не крутит изображение: ни при запекании, ни в кадре', () => {
    const level = bakedImpostor(farCamera()).quaternion.clone()
    const rolledCamera = farCamera(0.7)
    const impostor = bakedImpostor(rolledCamera)

    expect(impostor.quaternion.angleTo(level)).toBeLessThan(1e-6)

    // кадр с накренённой камерой ориентацию не трогает
    const before = impostor.quaternion.clone()

    impostor.onBeforeRender(fakeRenderer, new Scene(), rolledCamera, impostor.geometry, impostor.material, new Group())

    expect(impostor.quaternion.angleTo(before)).toBe(0)
  })

  it('setOrientation копирует ориентацию, а не держит ссылку', () => {
    const impostor = new NebulaImpostor()
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.3)

    impostor.setOrientation(q)
    q.identity()

    expect(impostor.quaternion.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.3))).toBeLessThan(1e-6)
  })
})

describe('Импостор туманности: лог-глубина за far', () => {
  // Проекция с near 1e-6 сама за far не клипит ((f+n)/(f−n) во float32 ровно 1):
  // реймарч виден на любой дистанции (Helix: камера по умолчанию в 127 000 а.е.
  // при far 5000 а.е.). Лог-глубина вершинника за far даёт z/w > 1 и срезала бы
  // весь квад — кламп кладёт его на дальнюю плоскость
  it('z/w зажат сверху единицей', () => {
    const vertex = new NebulaImpostorMaterial(null).vertexShader

    expect(vertex).toMatch(
      /gl_Position\.z = min\(log2\(max\(1e-6, 1\.0 \+ gl_Position\.w\)\) \* uLogDepthBufFC - 1\.0, 1\.0\) \* gl_Position\.w;/
    )
  })

  it('без клампа квад туманности Helix со стартовой позиции камеры был бы за дальней плоскостью', () => {
    const far = three.camera.far
    const w = fromAstronomicalUnits(127000)
    const logZ = Math.log2(1 + w) * (2 / Math.log2(far + 1)) - 1

    expect(logZ).toBeGreaterThan(1)
    expect(Math.min(logZ, 1)).toBe(1)
  })
})
