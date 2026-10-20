import { Group, PerspectiveCamera, WebGLRenderer } from 'three'
import { StarOuterLayer } from '@/core/renderables/utils/StarOuterLayer'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { Actor } from '@/core/models/Actor'

function fixture(activity = 1) {
  const radiusKm = 696000
  const actor = {
    physicalObject: { getAttribute: (key: string): number => key === 'radius' ? radiusKm : 5778 },
    renderingObject: { getAttribute: (): unknown => ({ activity }) }
  } as unknown as Actor
  const renderer = { domElement: { height: 1024 } } as unknown as WebGLRenderer
  const layer = new StarOuterLayer(actor, renderer)
  const parent = new Group()
  parent.position.set(123000, -98700, 25000)
  parent.add(layer)
  const camera = new PerspectiveCamera(90)
  const viewAt = (pixels: number): void => {
    camera.position.copy(parent.position)
    camera.position.z += toThreeJSUnits(radiusKm) * renderer.domElement.height / pixels
    layer.updateView?.(camera)
  }
  const dispose = (): void => { layer.geometry.dispose(); layer.material.dispose() }
  return { layer, parent, camera, renderer, viewAt, dispose }
}

describe('протуберанцы: детализация по экранному размеру', () => {
  it('у стыка импостора не рисует ни одного треугольника и возвращается при подлёте', () => {
    const f = fixture()
    try {
      f.viewAt(13)
      expect(f.layer.geometry.drawRange.count).toBe(0)
      expect(f.layer.visible).toBe(false)
      f.viewAt(512)
      expect(f.layer.visible).toBe(true)
      expect(f.layer.geometry.drawRange.count).toBe(f.layer.geometry.index!.count)
    } finally { f.dispose() }
  })

  it('сокращает геометрию мелкой звезды, распределяя плотность плавно', () => {
    const f = fixture()
    try {
      f.viewAt(64)
      const full = f.layer.geometry.index!.count
      expect(f.layer.geometry.drawRange.count).toBeGreaterThan(0)
      expect(f.layer.geometry.drawRange.count).toBeLessThan(full / 4)
      let previous = 0
      for (const pixels of [33, 40, 64, 96, 160, 256]) {
        f.viewAt(pixels)
        const density = f.layer.material.uniforms.uVisibleRibbons.value as number
        expect(density).toBeGreaterThan(previous)
        previous = density
      }
    } finally { f.dispose() }
  })

  it('FOV и разрешение учитываются в текущем кадре без пересоздания арок', () => {
    const f = fixture()
    const geometry = f.layer.geometry
    const anchors = geometry.getAttribute('aFootA')
    const phases = geometry.getAttribute('aRibbonRandom')
    try {
      f.viewAt(64)
      const middle = geometry.drawRange.count
      f.camera.fov = 30
      f.layer.updateView?.(f.camera)
      expect(geometry.drawRange.count).toBeGreaterThan(middle)
      f.renderer.domElement.height = 128
      f.layer.updateView?.(f.camera)
      expect(geometry.drawRange.count).toBeLessThan(middle)
      expect(f.layer.geometry).toBe(geometry)
      expect(geometry.getAttribute('aFootA')).toBe(anchors)
      expect(geometry.getAttribute('aRibbonRandom')).toBe(phases)
    } finally { f.dispose() }
  })

  it('анимация продолжает идти у скрытого слоя и не прыгает при его возвращении', () => {
    const f = fixture()
    try {
      f.layer.visible = false
      f.layer.updateObject({ camera: f.camera, elapsed: 1000, epoch: 0, delta: 0 })
      f.viewAt(512)
      expect(f.layer.material.uniforms.uTime.value).toBe(9)
    } finally { f.dispose() }
  })

  it('нулевая активность остаётся без геометрии и отрисовки на любой дистанции', () => {
    const f = fixture(0)
    try {
      f.viewAt(512)
      expect(f.layer.visible).toBe(false)
      expect(f.layer.geometry.index).toBeNull()
    } finally { f.dispose() }
  })
})
