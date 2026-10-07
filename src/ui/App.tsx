import { useState } from 'react'
import { observer } from 'mobx-react-lite'
import HomePage from '@/ui/components/layout/HomePage'
import LoadingScreen from '@/ui/components/layout/LoadingScreen'
import MainAppBar from '@/ui/components/layout/MainAppBar'
import AudioPlayer from '@/ui/components/common/audio/AudioPlayer'
import TutorialContent from '@/ui/components/common/TutorialContent'
import SettingsContent from '@/ui/components/common/SettingsContent'
import ObjectList from '@/ui/components/common/ObjectList'
import NotificationMessage from '@/ui/components/common/NotificationMessage'
import CameraSpeed from '@/ui/components/common/CameraSpeed'
import ModalWindow from '@/ui/components/common/ModalWindow'
import { ITrack } from '@/ui/types'
import { engineStore } from '@/ui/mobx/EngineStore'
import { audioPlayerStore } from '@/ui/mobx/AudioPlayerStore'
import { modalWindowStore } from '@/ui/mobx/ModalWindowStore'

const App = observer(() => {
  const [currentTrackIndex, setCurrentTrackIndex] = useState(-1)
  const currentTrack: ITrack = audioPlayerStore.tracks[currentTrackIndex]

  const whenAppIsLoaded = (
    <>
      <MainAppBar />
      <ObjectList />
      <CameraSpeed />
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
        {/* Без key: пересоздание всего плеера на каждый трек сбрасывало повтор
            и громкость. Новый трек перезагружает только <audio> (key внутри) */}
        <AudioPlayer
          currentTrack={currentTrack}
          trackIndex={currentTrackIndex}
          trackCount={audioPlayerStore.tracks.length}
          onPlay={setCurrentTrackIndex}
          onNext={() => setCurrentTrackIndex((i: number) => Math.min(i + 1, audioPlayerStore.tracks.length - 1))}
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

  let screen = whenAppIsLoaded

  if (!engineStore.scenario) {
    screen = homePage
  } else if (engineStore.appLoadingStatus) {
    screen = whenAppIsNotLoaded
  }

  // Уведомления — на любом экране: ошибки загрузки видны сразу, а не копятся
  // до конца загрузки; провал сценария показывается уже на главной
  return (
    <>
      {screen}
      <NotificationMessage />
    </>
  )
})

export default App
