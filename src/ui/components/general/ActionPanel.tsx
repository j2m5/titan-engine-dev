import { observer } from 'mobx-react-lite'
import { Box, Button } from '@mui/material'
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch'
import DoubleArrowIcon from '@mui/icons-material/DoubleArrow'
import DescriptionIcon from '@mui/icons-material/Description'
import { FC } from 'react'
import { TravelAnimation } from '@/core/animations/TravelAnimation'
import { IAnimation } from '@/core/animations/IAnimation'

const ActionPanel: FC<{ name: string }> = observer(({ name }) => {
  const animation: IAnimation = new TravelAnimation(name)

  return (
    <>
      <Box sx={{ width: '200px', margin: '10px auto' }}>
        <Box>
          <Button
            size="small"
            startIcon={<RocketLaunchIcon />}
            onClick={(): void => {
              animation.execute()
            }}
          >
            Move to {name}
          </Button>
        </Box>
        <Box>
          <Button size="small" startIcon={<DoubleArrowIcon />} onClick={(): void => {}}>
            Follow
          </Button>
        </Box>
        <Box>
          <Button size="small" startIcon={<DescriptionIcon />}>
            Show data
          </Button>
        </Box>
      </Box>
    </>
  )
})

export default ActionPanel
