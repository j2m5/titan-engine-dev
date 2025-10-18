import { observer } from 'mobx-react-lite'
import MuiAppBar, { AppBarProps as MuiAppBarProps } from '@mui/material/AppBar'
import { Box, Toolbar, IconButton, Typography, Slider, Tooltip } from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import CodeIcon from '@mui/icons-material/Code'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import VolumeDownIcon from '@mui/icons-material/VolumeDown'
import SettingsIcon from '@mui/icons-material/Settings'
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera'
import MenuOpenIcon from '@mui/icons-material/MenuOpen'
import { menuStore } from '@/ui/mobX/MenuStore'
import { styled } from '@mui/material/styles'
import TimeSpeedCounter from '@/ui/components/general/TimeSpeedCounter'
import TimerChunk from '@/ui/components/general/TimerChunk'
import SpeedPanel from '@/ui/components/general/SpeedPanel'
import { modalWindowStore } from '@/ui/mobX/ModalWindowStore'
import { engineStore } from '@/ui/mobX/EngineStore'
import { timeStore } from '@/ui/mobX/TimeStore'

interface AppBarProps extends MuiAppBarProps {
  open?: boolean
}

const AppBar = styled(MuiAppBar, {
  shouldForwardProp: (prop) => prop !== 'open'
})<AppBarProps>(({ theme, open }) => ({
  transition: theme.transitions.create(['margin', 'width'], {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen
  }),
  ...(open && {
    width: `calc(100% - ${menuStore.menuWidth}px)`,
    marginLeft: `${menuStore.menuWidth}px`,
    transition: theme.transitions.create(['margin', 'width'], {
      easing: theme.transitions.easing.easeOut,
      duration: theme.transitions.duration.enteringScreen
    })
  })
}))

const MainAppBar = observer(() => {
  return (
    <Box display="flex">
      <AppBar position="fixed" open={menuStore.isOpen}>
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="Open menu"
            onClick={() => menuStore.openMenu()}
            edge="start"
            sx={{ mr: 2, ...(menuStore.isOpen && { display: 'none' }) }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap component="div">
            {engineStore.scenario?.name}
          </Typography>
          <Box display="flex" alignItems="center" width={50} />
          <Box display="flex" alignItems="center" sx={{ flexGrow: 1, marginTop: '3px' }}>
            <TimerChunk data={timeStore.currentDate} />
            <Box display="flex" alignItems="center" sx={{ width: 500 }}>
              <Slider
                aria-label="Time speed"
                defaultValue={1}
                value={timeStore.speedOfTime}
                valueLabelDisplay="off"
                size="small"
                marks
                step={1}
                min={0}
                max={50}
                onChange={(event, value) => timeStore.setSpeedOfTime(value)}
              />
            </Box>
            <TimerChunk data={timeStore.currentTime} />
            <TimeSpeedCounter />
            <SpeedPanel />
            <Box sx={{ flexGrow: 1 }} />
            <Box display="flex">
              <Tooltip title="Development data">
                <IconButton onClick={() => modalWindowStore.setDevelopmentDataWindowState(true)}>
                  <CodeIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Tutorial">
                <IconButton onClick={() => modalWindowStore.setTutorialWindowState(true)}>
                  <HelpOutlineIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Audio player">
                <IconButton onClick={() => modalWindowStore.setAudioPlayerWindowState(true)}>
                  <VolumeDownIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Settings">
                <IconButton onClick={() => modalWindowStore.setSettingsWindowState(true)}>
                  <SettingsIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Make screenshot">
                <IconButton>
                  <PhotoCameraIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Change scenario">
                <IconButton onClick={() => engineStore.setScenario(null)}>
                  <MenuOpenIcon />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
        </Toolbar>
      </AppBar>
    </Box>
  )
})

export default MainAppBar
