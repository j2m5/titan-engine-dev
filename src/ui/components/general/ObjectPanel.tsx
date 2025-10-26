import { observer } from 'mobx-react-lite'
import { Divider, FormControl, InputLabel, Select, MenuItem, Typography, SelectChangeEvent } from '@mui/material'
import ActionPanel from '@/ui/components/general/ActionPanel'
import { Actor } from '@/core/models/Actor'
import { engineStore } from '@/ui/mobX/EngineStore'
import { useEffect, useRef, useState } from 'react'
import DIServices from '@/core/framework/DI/DIServices'
import { SceneObserver, SceneObserverRecord } from '@/core/services/SceneObserver'
import { useInjection } from '@/ui/inversify-react'
import { fromKilometers } from '@/core/helpers/scaling'
import { formatter } from '@/ui/helpers'
import { Vector3 } from 'three'

export interface ObserverData {
  cameraPosition: Vector3
  objectPosition: Vector3
}

const ObjectPanel = observer(() => {
  const [selected, setSelected] = useState('')
  const [name, setName] = useState('')
  const [distance, setDistance] = useState<number | null>(null)
  const [objectPosition, setObjectPosition] = useState(new Vector3())
  const selectedName = useRef('')

  const sceneObserver = useInjection<SceneObserver>(DIServices.SceneObserver)

  const filter = (actor: Actor): boolean => ['planet', 'star'].includes(actor.category.attributes.alias!)

  const objects: Actor[] = Actor.query()
    .where({ parentId: engineStore.scenario?.rootId })
    .get()
    .flatten()
    .filter(filter)
    .sortBy('id')
    .toArray()

  const handleChange = (event: SelectChangeEvent): void => {
    const selectedId = event.target.value
    const selectedObject = objects.find((actor) => actor.attributes.id === Number(selectedId))

    if (selectedObject) {
      const objectName: string = selectedObject.attributes.name!

      setSelected(selectedId)
      setName(objectName)
      selectedName.current = objectName

      const response = sceneObserver.getData(objectName)

      setDistance(response?.distance ?? null)
      setObjectPosition(response?.position ?? new Vector3())
    }
  }

  useEffect((): void => {
    selectedName.current = name
  }, [name])

  useEffect(() => {
    const listener = (event: SceneObserverRecord): void => {
      if (event.name === selectedName.current) {
        setDistance(event.data.distance)
      }
    }
    sceneObserver.subscribe('distanceChange', listener)

    return () => sceneObserver.unsubscribe('distanceChange', listener)
  }, [])

  const actionPanelData: ObserverData = {
    cameraPosition: sceneObserver.cameraPosition,
    objectPosition: objectPosition
  }

  return (
    <>
      <ActionPanel actor={Actor.find(selected)} data={actionPanelData} />
      <Divider />
      <FormControl variant="standard" sx={{ width: '200px', margin: '10px auto' }}>
        <InputLabel id="name">Name</InputLabel>
        <Select label="Name" labelId="name" value={selected} onChange={handleChange}>
          <MenuItem disabled value="">
            <em>Select object</em>
          </MenuItem>
          {objects.map((actor: Actor) => (
            <MenuItem key={actor.attributes.id} value={actor.attributes.id}>
              {actor.attributes.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Divider />
      {selected && (
        <Typography variant="caption" sx={{ margin: '10px 20px 0' }}>
          Distance: {formatter().format(fromKilometers(distance ?? 0))} km
        </Typography>
      )}
    </>
  )
})

export default ObjectPanel
