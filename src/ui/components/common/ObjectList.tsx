import { JSX, KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { useInjection } from '@/ui/hooks/useInjection'
import { Tokens } from '@/core/providers/tokens'
import TitanList from '@titanui/components/TitanList'
import TitanListItem from '@titanui/components/TitanListItem'
import TitanFlex from '@titanui/components/TitanFlex'
import TitanIconButton from '@titanui/components/TitanIconButton'
import TitanInput from '@titanui/components/TitanInput'
import { hasOpenModal, isEditable } from '@titanui/components/modalStack'
import { CrosshairIcon, InfoIcon, PlanetIcon, RocketLaunchIcon, SunIcon } from '@phosphor-icons/react'
import { Actor } from '@/core/models/Actor'
import { CameraToObjectTransition } from '@/core/transitions/CameraToObjectTransition'
import { OBSERVED_TYPES } from '@/core/services/SceneObserver'
import { engineStore } from '@/ui/mobx/EngineStore'
import { cameraStore } from '@/ui/mobx/CameraStore'
import { bodyInfoStore } from '@/ui/mobx/BodyInfoStore'
import { filterByName } from '@/ui/components/common/objectSearch'

/**
 * Горячие клавиши поиска: «/» и Ctrl+K (⌘K). По физической клавише (code) —
 * в русской раскладке key у них «.» и «л»; key — запасной путь для раскладок,
 * где «/» стоит на другой клавише.
 */
function isSearchHotkey(event: KeyboardEvent): boolean {
  const modifier: boolean = event.ctrlKey || event.metaKey

  if (modifier && !event.altKey) return event.code === 'KeyK' || event.key.toLowerCase() === 'k'
  if (modifier || event.altKey) return false

  return event.code === 'Slash' || event.key === '/'
}

const ObjectList = observer(() => {
  const filter = (actor: Actor): boolean =>
    OBSERVED_TYPES.includes(actor.category!.attributes.alias!)

  const sceneManager = useInjection(Tokens.SceneManager)
  const scene = useInjection(Tokens.Scene)

  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // «/» и Ctrl+K ставят фокус в поиск — кроме набора в другом поле и открытого окна
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || hasOpenModal() || isEditable(event.target) || !isSearchHotkey(event)) return

      event.preventDefault()
      searchRef.current?.focus()
    }

    document.addEventListener('keydown', onKeyDown)

    return (): void => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const actors: Actor[] = Actor.query()
    .where({ parentId: engineStore.scenario?.rootId })
    .get()
    .expand()
    .filter(filter)
    .sortBy('id')
    .toArray()

  const visible: Actor[] = filterByName(actors, query, (actor: Actor): string => actor.getAttribute('name', ''))

  const icon = (actor: Actor): JSX.Element =>
    actor.category!.attributes.alias === 'planet' ? <PlanetIcon size={24} /> : <SunIcon size={24} />

  const handleMove = async (actor: Actor): Promise<void> => {
    if (!actor) return

    await CameraToObjectTransition.execute({ model: actor })
  }

  /**
   * Enter — «Лететь» к первому совпадению; поле очищается и отдаёт фокус,
   * чтобы WASD сразу снова управляли камерой. Escape — сначала очистить,
   * затем снять фокус.
   */
  const handleSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      const first: Actor | undefined = visible[0]

      if (!first) return

      event.preventDefault()
      setQuery('')
      searchRef.current?.blur()
      void handleMove(first)

      return
    }

    if (event.key !== 'Escape') return

    event.preventDefault()

    if (query) setQuery('')
    else searchRef.current?.blur()
  }

  const handleSelect = (actor: Actor): void => {
    const target = scene.getObjectByName(actor.getAttribute('name', ''))

    target?.add(sceneManager.crosshair)
  }

  const handleFollow = (actor: Actor): void => {
    const target = scene.getObjectByName(actor.getAttribute('name', ''))

    if (target) cameraStore.toggleFollow(target)
  }

  const isFollowing = (actor: Actor): boolean => {
    const target = scene.getObjectByName(actor.getAttribute('name', ''))

    return target !== undefined && cameraStore.currentTarget === target
  }

  return (
    <TitanList style={{ position: 'fixed', right: '10px', top: '80px', zIndex: 9999 }}>
      <TitanInput
        value={query}
        placeholder="Search objects…  /"
        ariaLabel="Search objects"
        inputRef={searchRef}
        style={{ margin: '4px 8px' }}
        onKeyDown={handleSearchKey}
        onChange={setQuery}
      />
      {visible.length === 0 && <TitanListItem>No matches</TitanListItem>}
      {visible.map((actor: Actor) => (
        <TitanListItem key={actor.attributes.id} icon={icon(actor)} onClick={() => handleSelect(actor)}>
          <TitanFlex align="center" justify="between" width="100%">
            <div>{actor.attributes.name!}</div>
            <div style={{ justifySelf: 'start' }}>
              <TitanIconButton
                title={bodyInfoStore.isOpen(actor) ? 'Hide info' : 'Info'}
                height="auto"
                width="auto"
                onClick={(event) => {
                  // Карточка не выбирает тело: клик не всплывает в строку (handleSelect вешает прицел)
                  event.stopPropagation()
                  bodyInfoStore.toggle(actor)
                }}
              >
                <InfoIcon size={20} weight={bodyInfoStore.isOpen(actor) ? 'fill' : 'regular'} />
              </TitanIconButton>
              <TitanIconButton
                title={isFollowing(actor) ? 'Stop following' : 'Follow'}
                height="auto"
                width="auto"
                onClick={() => handleFollow(actor)}
              >
                <CrosshairIcon size={20} weight={isFollowing(actor) ? 'fill' : 'regular'} />
              </TitanIconButton>
              <TitanIconButton title="Fly to" height="auto" width="auto" onClick={() => handleMove(actor)}>
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
