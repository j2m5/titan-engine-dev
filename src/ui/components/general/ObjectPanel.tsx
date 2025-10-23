import { observer } from 'mobx-react-lite'
import { Divider, FormControl, InputLabel, Select, MenuItem, SelectChangeEvent } from '@mui/material'
import ActionPanel from '@/ui/components/general/ActionPanel'
import { Actor } from '@/core/models/Actor'
import { engineStore } from '@/ui/mobX/EngineStore'
import { useState } from 'react'

const ObjectPanel = observer(() => {
  const [selected, setSelected] = useState('')
  const [name, setName] = useState('')

  const objects: Actor[] = Actor.query()
    .where({ parentId: engineStore.scenario?.rootId })
    .get()
    .flatten()
    .filter((actor: Actor): boolean => actor.attributes.categoryId !== 4)
    .toArray()

  const handleChange = (event: SelectChangeEvent): void => {
    const selectedId = event.target.value
    const selectedObject = objects.find((actor) => actor.attributes.id === Number(selectedId))!

    if (selectedObject) {
      setSelected(selectedId)
      setName(selectedObject.attributes.name!)
    }
  }

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
    </>
  )
})

export default ObjectPanel
