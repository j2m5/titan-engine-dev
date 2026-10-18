import { useEffect, useState } from 'react'
import { observer } from 'mobx-react-lite'
import MainAppBar from '@/ui/components/layout/MainAppBar'
import AudioPlayer from '@/ui/components/common/audio/AudioPlayer'
import TutorialContent from '@/ui/components/common/TutorialContent'
import SettingsContent from '@/ui/components/common/SettingsContent'
import ObjectList from '@/ui/components/common/ObjectList'
import BodyInfoPanel from '@/ui/components/common/bodyInfo/BodyInfoPanel'
import CameraSpeed from '@/ui/components/common/CameraSpeed'
import ModalWindow from '@/ui/components/common/ModalWindow'
import { ITrack } from '@/ui/types'
import { engineStore } from '@/ui/mobx/EngineStore'
import { audioPlayerStore } from '@/ui/mobx/AudioPlayerStore'
import { modalWindowStore } from '@/ui/mobx/ModalWindowStore'

const SimulationUI = observer(() => {
  const [currentTrackIndex, setCurrentTrackIndex] = useState(-1)
  const currentTrack: ITrack = audioPlayerStore.tracks[currentTrackIndex]
  const audioWindowVisible = Boolean(engineStore.scenario)
    && !engineStore.appLoadingStatus && modalWindowStore.audioPlayerWindowState

  useEffect(() => {
    if (audioWindowVisible) void audioPlayerStore.ensureMetadata()
  }, [audioWindowVisible])

  const whenAppIsLoaded = (
    <>
      <MainAppBar />
      <ObjectList />
      <BodyInfoPanel />
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

  return engineStore.scenario && !engineStore.appLoadingStatus ? whenAppIsLoaded : null
})

export default SimulationUI
