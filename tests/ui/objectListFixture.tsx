import type { ReactNode } from 'react'
import { Object3D, Scene } from 'three'
import { Container } from '@/core/framework/container/Container'
import { Tokens } from '@/core/providers/tokens'
import type { SceneManager } from '@/core/services/SceneManager'
import { DiContext } from '@/ui/di-context'
import ObjectList from '@/ui/components/common/ObjectList'

export function createObjectListFixture() {
  const scene = new Scene()
  const crosshair = new Object3D()
  const services = new Container()

  services.instance(Tokens.Scene, scene)
  services.instance(Tokens.SceneManager, { crosshair } as SceneManager)

  return {
    scene,
    crosshair,
    render: (children: ReactNode = <ObjectList />) => <DiContext.Provider value={services}>{children}</DiContext.Provider>
  }
}
