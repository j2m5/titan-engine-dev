import { observer } from 'mobx-react-lite'
import { Divider, FormControl, InputLabel, Select, MenuItem, Typography, SelectChangeEvent } from '@mui/material'
import ActionPanel from '@/ui/components/general/ActionPanel'
import { Actor } from '@/core/models/Actor'
import { engineStore } from '@/ui/mobX/EngineStore'
import { useEffect, useRef, useState } from 'react'
import DIServices from '@/core/framework/DI/DIServices'
import { CameraObserver, DistanceRecord } from '@/core/services/CameraObserver'
import { useInjection } from '@/ui/inversify-react'
import { fromKilometers } from '@/core/helpers/scaling'
import { formatter } from '@/ui/helpers'

const ObjectPanel = observer(() => {
  const [selected, setSelected] = useState('')
  const [name, setName] = useState('')
  const [distance, setDistance] = useState<number | null>(null)
  const selectedName = useRef('')

  const cameraObserver = useInjection<CameraObserver>(DIServices.CameraObserver)

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
    const selectedObject = objects.find((actor) => actor.attributes.id === Number(selectedId))!

    if (selectedObject) {
      const objectName: string = selectedObject.attributes.name!

      setSelected(selectedId)
      setName(objectName)
      selectedName.current = objectName

      const response = cameraObserver.getDistance(objectName)

      setDistance(response ?? null)
    }
  }

  useEffect((): void => {
    selectedName.current = name
  }, [name])

  useEffect(() => {
    const listener = (event: DistanceRecord): void => {
      if (event.name === selectedName.current) {
        setDistance(event.distance)
      }
    }
    cameraObserver.subscribe('distanceChange', listener)

    return () => cameraObserver.unsubscribe('distanceChange', listener)
  }, [])

  return (
    <>
      <ActionPanel name={name} />
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
