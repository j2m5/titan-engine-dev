import { observer } from 'mobx-react-lite'
import { Box, Typography, IconButton, Tooltip } from '@mui/material'
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious'
import SkipNextIcon from '@mui/icons-material/SkipNext'
import { formatter } from '@/ui/helpers'
import { AU } from '@/core/constants'
import { cameraStore } from '@/ui/mobX/CameraStore'

const SpeedPanel = observer(() => {
  const unitType: string = cameraStore.speed >= AU ? 'au/s' : 's'

  return (
    <Box display="flex" alignItems="center" sx={{ width: '500px' }}>
      <Tooltip title="Minimum speed">
        <IconButton onClick={() => cameraStore.setSpeed(cameraStore.minSpeed)}>
          <SkipPreviousIcon />
        </IconButton>
      </Tooltip>
      <Tooltip title="Maximum speed">
        <IconButton onClick={() => cameraStore.setSpeed(cameraStore.maxSpeed)}>
          <SkipNextIcon />
        </IconButton>
      </Tooltip>
      <Typography sx={{ marginLeft: '5px' }}>
        Camera speed: {formatter().format(cameraStore.speed)} km/s
        {Number(cameraStore.speedInLSAndAU.toFixed(1)) > 0 &&
          ` (${formatter(1).format(cameraStore.speedInLSAndAU)} ${unitType})`}
      </Typography>
    </Box>
  )
})

export default SpeedPanel
