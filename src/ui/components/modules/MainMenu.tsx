import { observer } from 'mobx-react-lite'
import { styled, useTheme } from '@mui/material/styles'
import { Drawer, Divider, IconButton, Theme } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { menuStore } from '@/ui/mobX/MenuStore'
import ObjectPanel from '@/ui/components/general/ObjectPanel'
//import ObjectStatePanel from '@/ui/components/general/ObjectStatePanel'
//import { appStore } from '@/ui/store/AppStore'

const DrawerHeader = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  padding: theme.spacing(0, 1),
  ...theme.mixins.toolbar,
  justifyContent: 'flex-end'
}))

const MainMenu = observer(() => {
  const theme: Theme = useTheme()

  return (
    <Drawer
      sx={{
        width: menuStore.menuWidth,
        '& .MuiDrawer-paper': {
          width: menuStore.menuWidth,
          boxSizing: 'border-box'
        }
      }}
      variant="persistent"
      anchor="left"
      open={menuStore.isOpen}
    >
      <DrawerHeader>
        <IconButton onClick={() => menuStore.closeMenu()}>
          {theme.direction === 'ltr' ? <ChevronLeftIcon /> : <ChevronRightIcon />}
        </IconButton>
      </DrawerHeader>
      <Divider />
      <ObjectPanel />
      {/*{appStore.selectedObject && <ObjectStatePanel />}*/}
    </Drawer>
  )
})

export default MainMenu
