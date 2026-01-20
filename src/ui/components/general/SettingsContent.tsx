import { observer } from 'mobx-react-lite'
import { Box, Typography, Divider, TextField, FormGroup, FormControlLabel, Checkbox } from '@mui/material'
import { modalWindowStore } from '@/ui/mobX/ModalWindowStore'
import { useDebounce } from 'src/ui/hooks'
import { objectStore } from '@/core/mobX/ObjectStore'

const SettingsContent = observer(() => {
  /*const [flightAnimationTime, setFlightAnimationTime] = useDebounce(
    modalWindowStore.flightAnimationTime.toString(),
    3000,
    modalWindowStore.setFlightAnimationTime.bind(modalWindowStore)
  )

  const handleLabelsVisibility = (value: boolean): void => {
    objectStore.setShowLabels(value)
  }

  const handleOrbitsVisibility = (value: boolean): void => {
    objectStore.setShowOrbits(value)
  }

  return (
    <Box>
      <Box>
        <Typography variant="h5">Controls</Typography>
      </Box>
      <Box sx={{ margin: '5px 0' }} />
      <Box>
        <Typography variant="h6">Flight animation time</Typography>
        <Typography variant="caption">
          Time (in seconds) during which the camera will fly to the target object
        </Typography>
        <Box>
          <TextField
            label="Time"
            variant="standard"
            value={flightAnimationTime}
            onChange={(event) => setFlightAnimationTime(event.target.value)}
          />
        </Box>
      </Box>
      <Divider sx={{ margin: '5px 0' }} />
      <Box>
        <Typography variant="h5">Visibility</Typography>
        <Box>
          <FormGroup>
            <FormControlLabel
              control={<Checkbox />}
              label="Labels"
              checked={objectStore.showLabels}
              onChange={(event, checked) => handleLabelsVisibility(checked)}
            />
            <FormControlLabel
              control={<Checkbox />}
              label="Orbits"
              checked={objectStore.showOrbits}
              onChange={(event, checked) => handleOrbitsVisibility(checked)}
            />
          </FormGroup>
        </Box>
      </Box>
    </Box>
  )*/
  return <Box />
})

export default SettingsContent
