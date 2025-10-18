import { useState } from 'react'
import { observer } from 'mobx-react-lite'
import type { Theme } from '@mui/material'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import LoadingScreen from '@/ui/components/modules/LoadingScreen'
import { engineStore } from '@/ui/mobX/EngineStore'
import { audioPlayerStore } from '@/ui/mobX/AudioPlayerStore'
import MainAppBar from '@/ui/components/modules/MainAppBar'
import MainMenu from '@/ui/components/modules/MainMenu'
import NotificationMessage from '@/ui/components/general/NotificationMessage'
import ModalWindow from '@/ui/components/general/ModalWindow'
import AudioPlayer from '@/ui/components/modules/audio/AudioPlayer'
import DevelopmentDataContent from '@/ui/components/general/DevelopmentDataContent'
import TutorialContent from '@/ui/components/general/TutorialContent'
import SettingsContent from '@/ui/components/general/SettingsContent'
import { modalWindowStore } from '@/ui/mobX/ModalWindowStore'
import { ITrack } from '@/ui/components/modules/audio/interfaces/ITrack'
import HomePage from '@/ui/components/modules/HomePage'
import { notificationStore } from '@/ui/mobX/NotificationStore'

const darkTheme: Theme = createTheme({
  palette: {
    mode: 'dark'
  }
})

const App = observer(() => {
  const [currentTrackIndex, setCurrentTrackIndex] = useState(-1)
  const currentTrack: ITrack = audioPlayerStore.tracks[currentTrackIndex]

  const whenAppIsLoaded = (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <MainAppBar />
      <MainMenu />
      <NotificationMessage
        type={notificationStore.notification.type}
        message={notificationStore.notification.message}
      />
      <ModalWindow
        title="Development data"
        visible={modalWindowStore.developmentDataWindowState}
        content={<DevelopmentDataContent />}
        keepMounted={false}
        close={() => modalWindowStore.setDevelopmentDataWindowState(false)}
      />
      <ModalWindow
        title="Tutorial"
        visible={modalWindowStore.tutorialWindowState}
        content={<TutorialContent />}
        keepMounted={false}
        close={() => modalWindowStore.setTutorialWindowState(false)}
      />
      <ModalWindow
        title="Audio player"
        visible={modalWindowStore.audioPlayerWindowState}
        content={
          <AudioPlayer
            key={currentTrackIndex}
            currentTrack={currentTrack}
            trackIndex={currentTrackIndex}
            trackCount={audioPlayerStore.tracks.length}
            onPlay={setCurrentTrackIndex}
            onNext={() => setCurrentTrackIndex((i: number) => i + 1)}
            onPrev={() => setCurrentTrackIndex((i: number) => i - 1)}
          />
        }
        keepMounted={true}
        close={() => modalWindowStore.setAudioPlayerWindowState(false)}
      />
      <ModalWindow
        title="Settings"
        visible={modalWindowStore.settingsWindowState}
        content={<SettingsContent />}
        keepMounted={false}
        close={() => modalWindowStore.setSettingsWindowState(false)}
      />
    </ThemeProvider>
  )

  const homePage = <HomePage />
  const whenAppIsNotLoaded = <LoadingScreen />

  if (!engineStore.scenario) {
    return homePage
  } else {
    if (engineStore.appLoadingStatus) {
      return whenAppIsNotLoaded
    } else {
      return whenAppIsLoaded
    }
  }
})

export default App
