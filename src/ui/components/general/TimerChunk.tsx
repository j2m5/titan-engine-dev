import { observer } from 'mobx-react-lite'
import { FC } from 'react'
import { Typography } from '@mui/material'
import { TimerChunkProps } from '@/ui/interfaces/TimerChunkProps'

const TimerChunk: FC<TimerChunkProps> = observer(({ data }) => {
  return (
    <Typography noWrap sx={{ marginLeft: '10px', marginRight: '10px' }}>
      {data}
    </Typography>
  )
})

export default TimerChunk
