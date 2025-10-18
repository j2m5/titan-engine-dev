import { observer } from 'mobx-react-lite'
import { Divider, FormControl, InputLabel, Select, MenuItem, SelectChangeEvent } from '@mui/material'
import ActionPanel from '@/ui/components/general/ActionPanel'
import { simulationStore } from '@/core/mobX/SimulationStore'
import { ModelState } from '@/core/data/types'

const ObjectPanel = observer(() => {
  /*const names: string[] = simulationStore.modelState.map((item: ModelState) => item.name)

  const handleChange = (event: SelectChangeEvent): void => {
    simulationStore.updateSelectedModel(event.target.value)
    simulationStore.updateSelection(event.target.value)
  }*/

  return <div>ObjectPanel</div>

  /*return (
    <>
      <ActionPanel name={simulationStore.selectedModel} />
      <Divider />
      <FormControl variant="standard" sx={{ width: '200px', margin: '10px auto' }}>
        <InputLabel id="name">Name</InputLabel>
        <Select label="Name" labelId="name" value={simulationStore.selectedModel} onChange={handleChange}>
          <MenuItem disabled value="">
            <em>Select object</em>
          </MenuItem>
          {names.map((name: string) => (
            <MenuItem key={name} value={name}>
              {name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Divider />
    </>
  )*/
})

export default ObjectPanel
