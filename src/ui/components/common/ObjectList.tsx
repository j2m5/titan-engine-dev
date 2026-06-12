import { JSX } from 'react'
import { observer } from 'mobx-react-lite'
import { useInjection } from '@/ui/inversify-react'
import { SceneManager } from '@/core/services/SceneManager'
import TitanList from '@/ui/TitanUI/components/TitanList'
import TitanListItem from '@/ui/TitanUI/components/TitanListItem'
import TitanFlex from '@/ui/TitanUI/components/TitanFlex'
import TitanIconButton from '@/ui/TitanUI/components/TitanIconButton'
import { PlanetIcon, RocketLaunchIcon, SunIcon } from '@phosphor-icons/react'
import { Actor } from '@/core/models/Actor'
import { CameraToObjectTransition } from '@/core/transitions/CameraToObjectTransition'
import { engineStore } from '@/ui/mobx/EngineStore'
import { threeJS } from '@/core/graphic/ThreeJS'

const ObjectList = observer(() => {
  const filter = (actor: Actor): boolean => ['planet', 'star', 'blackHole'].includes(actor.category!.attributes.alias!)

  const sceneManager = useInjection<SceneManager>('SceneManager')

  const actors: Actor[] = Actor.query()
    .where({ parentId: engineStore.scenario?.rootId })
    .get()
    .expand()
    .filter(filter)
    .sortBy('id')
    .toArray()

  const icon = (actor: Actor): JSX.Element =>
    actor.category!.attributes.alias === 'planet' ? <PlanetIcon size={24} /> : <SunIcon size={24} />

  const handleMove = async (actor: Actor): Promise<void> => {
    if (!actor) return

    await CameraToObjectTransition.execute({ model: actor })
  }

  const handleSelect = (actor: Actor): void => {
    const target = threeJS.scene.getObjectByName(actor.getAttribute('name'))

    target?.add(sceneManager.crosshair)
  }

  return (
    <TitanList style={{ position: 'fixed', right: '10px', top: '80px', zIndex: 9999 }}>
      {actors.map((actor: Actor) => (
        <TitanListItem key={actor.attributes.id} icon={icon(actor)} onClick={() => handleSelect(actor)}>
          <TitanFlex align="center" justify="between" width="100%">
            <div>{actor.attributes.name!}</div>
            <div style={{ justifySelf: 'start' }}>
              <TitanIconButton height="auto" width="auto" onClick={() => handleMove(actor)}>
                <RocketLaunchIcon size={20} />
              </TitanIconButton>
            </div>
          </TitanFlex>
        </TitanListItem>
      ))}
    </TitanList>
  )
})

export default ObjectList
