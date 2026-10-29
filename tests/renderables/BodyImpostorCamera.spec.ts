import { describe, expect, it } from 'vitest'
import { Group, PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from 'three'
import '@/core/framework/TitanThree'
import type { Actor } from '@/core/models/Actor'
import { BrownDwarf } from '@/core/renderables/BrownDwarf/BrownDwarf'
import { BrownDwarfImpostor } from '@/core/renderables/BrownDwarf/BrownDwarfImpostor'
import { WhiteDwarf } from '@/core/renderables/WhiteDwarf/WhiteDwarf'
import { WhiteDwarfImpostor } from '@/core/renderables/WhiteDwarf/WhiteDwarfImpostor'
import { GiantStar } from '@/core/renderables/GiantStar/GiantStar'
import { GiantStarShell } from '@/core/renderables/GiantStar/GiantStarShell'
import { GiantStarImpostor } from '@/core/renderables/GiantStar/GiantStarImpostor'
import { disposeSceneTree } from '@/core/lifecycle/disposeSceneTree'

const actor = {
  getAttribute: (_key: string, fallback?: unknown): unknown => fallback,
  physicalObject: {
    getAttribute: (key: string, fallback?: unknown): unknown => key === 'radius' ? 1000 : key === 'temperature' ? 5000 : fallback
  }
} as unknown as Actor

describe.each(['brown', 'white', 'giant'] as const)('%s: импостор после окончательного переноса камеры', kind => {
  it.each(['follow', 'collision'] as const)('%s: скрытый уровень повёрнут к итоговой камере и сохраняет экранный размер', scenario => {
    const renderer = { domElement: { height: 1080 } } as unknown as WebGLRenderer
    const body = kind === 'brown' ? new BrownDwarf(actor) : kind === 'white' ? new WhiteDwarf(actor) : new GiantStar(actor)
    const shell = kind === 'giant' ? new GiantStarShell(body as GiantStar) : null
    if (shell) body.add(shell)
    const impostor = kind === 'brown' ? new BrownDwarfImpostor(body as BrownDwarf, renderer)
      : kind === 'white' ? new WhiteDwarfImpostor(body as WhiteDwarf, renderer)
      : new GiantStarImpostor(body as GiantStar, shell!, renderer)
    const node = new Group()
    const scene = new Scene()
    node.position.set(50000, -3000, 10000)
    node.add(body, impostor)
    scene.add(node)
    impostor.visible = false
    const camera = new PerspectiveCamera(50, 1, 0.001, 1e12)
    camera.position.copy(node.position).add(new Vector3(0, 0, 100000))

    try {
      scene.traverse(object => object.updateObject({ delta: 0, epoch: 0, elapsed: 123, camera }))
      // Те же две поздние операции, что между update и updateView в Engine.
      const offset = scenario === 'follow' ? new Vector3(100000, 0, 10000) : new Vector3(0, 10000, 10000)
      camera.position.copy(node.position).add(offset)
      camera.fov = 80
      camera.updateProjectionMatrix()
      renderer.domElement.height = 2160
      scene.traverse(object => object.updateView?.(camera))

      const normal = new Vector3(0, 0, 1).applyQuaternion(impostor.quaternion)
      expect(normal.angleTo(offset)).toBeLessThan(1e-6)
      // Проекция плоского квада: scale / (2*d*tan(fov/2)) * высота кадра.
      const pixels = impostor.scale.x * 2160 / (2 * offset.length() * Math.tan(40 * Math.PI / 180))
      const expected = kind === 'white' ? 6 : kind === 'giant' ? 12 * 1.3 : 12
      expect(pixels).toBeCloseTo(expected, 9)
      if (kind === 'brown') expect(impostor.material.uniforms.time.value).toBe(123)
    } finally {
      disposeSceneTree(scene)
    }
  })
})
