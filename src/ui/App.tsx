import { useState } from 'react'
import { observer } from 'mobx-react-lite'
import LoadingScreen from '@/ui/components/modules/LoadingScreen'
import { engineStore } from '@/ui/mobX/EngineStore'
import { audioPlayerStore } from '@/ui/mobX/AudioPlayerStore'
import MainAppBar from '@/ui/components/modules/MainAppBar'
import NotificationMessage from '@/ui/components/general/NotificationMessage'
import ModalWindow from '@/ui/components/general/ModalWindow'
import AudioPlayer from '@/ui/components/modules/audio/AudioPlayer'
import TutorialContent from '@/ui/components/general/TutorialContent'
import SettingsContent from '@/ui/components/general/SettingsContent'
import { modalWindowStore } from '@/ui/mobX/ModalWindowStore'
import { ITrack } from '@/ui/components/modules/audio/interfaces/ITrack'
import HomePage from '@/ui/components/modules/HomePage'
import { notificationStore } from '@/ui/mobX/NotificationStore'
import ObjectList from '@/ui/components/general/ObjectList'

const App = observer(() => {
  const [currentTrackIndex, setCurrentTrackIndex] = useState(-1)
  const currentTrack: ITrack = audioPlayerStore.tracks[currentTrackIndex]

  const whenAppIsLoaded = (
    <>
      <MainAppBar />
      <ObjectList />
      {/*<MainMenu />*/}
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

/*

<AudioPlayer
            key={currentTrackIndex}
            currentTrack={currentTrack}
            trackIndex={currentTrackIndex}
            trackCount={audioPlayerStore.tracks.length}
            onPlay={setCurrentTrackIndex}
            onNext={() => setCurrentTrackIndex((i: number) => i + 1)}
            onPrev={() => setCurrentTrackIndex((i: number) => i - 1)}
          />

 */
