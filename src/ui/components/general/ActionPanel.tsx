import { observer } from 'mobx-react-lite'
import { Box, Button } from '@mui/material'
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch'
import DoubleArrowIcon from '@mui/icons-material/DoubleArrow'
import DescriptionIcon from '@mui/icons-material/Description'
import { FC } from 'react'
import { Actor } from '@/core/models/Actor'
import { CameraToObjectTransition } from '@/core/transitions/CameraToObjectTransition'

const ActionPanel: FC<{ actor: Actor | null }> = observer(({ actor }) => {
  const name: string = actor && actor.attributes.name ? actor.attributes.name : ''

  const handleMove = async (): Promise<void> => {
    if (!actor) return

    await CameraToObjectTransition.execute({ model: actor })
  }

  return (
    <>
      <Box sx={{ width: '200px', margin: '10px auto' }}>
        <Box>
          <Button size="small" startIcon={<RocketLaunchIcon />} onClick={handleMove}>
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
