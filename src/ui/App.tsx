import { useState } from 'react'
import { observer } from 'mobx-react-lite'
import { ITrack } from '@/ui/components/common/audio/interfaces/ITrack'
import HomePage from '@/ui/components/layout/HomePage'
import LoadingScreen from '@/ui/components/layout/LoadingScreen'
import MainAppBar from '@/ui/components/layout/MainAppBar'
import AudioPlayer from '@/ui/components/common/audio/AudioPlayer'
import TutorialContent from '@/ui/components/common/TutorialContent'
import SettingsContent from '@/ui/components/common/SettingsContent'
import ObjectList from '@/ui/components/common/ObjectList'
import NotificationMessage from '@/ui/components/common/NotificationMessage'
import ModalWindow from '@/ui/components/common/ModalWindow'
import { engineStore } from '@/ui/mobx/EngineStore'
import { audioPlayerStore } from '@/ui/mobx/AudioPlayerStore'
import { modalWindowStore } from '@/ui/mobx/ModalWindowStore'
import { notificationStore } from '@/ui/mobx/NotificationStore'

const App = observer(() => {
  const [currentTrackIndex, setCurrentTrackIndex] = useState(-1)
  const currentTrack: ITrack = audioPlayerStore.tracks[currentTrackIndex]

  const whenAppIsLoaded = (
    <>
      <MainAppBar />
      <ObjectList />
      <NotificationMessage
        type={notificationStore.notification.type}
        message={notificationStore.notification.message}
      />
      <ModalWindow
        title="Tutorial"
        visible={modalWindowStore.tutorialWindowState}
        onClose={() => modalWindowStore.setTutorialWindowState(false)}
      >
        <TutorialContent />
      </ModalWindow>
      <ModalWindow
        title="Audio player"
        visible={modalWindowStore.audioPlayerWindowState}
        keepMounted={true}
        onClose={() => modalWindowStore.setAudioPlayerWindowState(false)}
      >
        <AudioPlayer
          key={currentTrackIndex}
          currentTrack={currentTrack}
          trackIndex={currentTrackIndex}
          trackCount={audioPlayerStore.tracks.length}
          onPlay={setCurrentTrackIndex}
          onNext={() => setCurrentTrackIndex((i: number) => i + 1)}
          onPrev={() => setCurrentTrackIndex((i: number) => i - 1)}
        />
      </ModalWindow>
      <ModalWindow
        title="Settings"
        visible={modalWindowStore.settingsWindowState}
        onClose={() => modalWindowStore.setSettingsWindowState(false)}
      >
        <SettingsContent />
      </ModalWindow>
    </>
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
