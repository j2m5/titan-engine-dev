import { observer } from 'mobx-react-lite'
import TitanTopbar from '@/ui/TitanUI/components/TitanTopbar'
import TitanFlex from '@/ui/TitanUI/components/TitanFlex'
import TitanIconButton from '@/ui/TitanUI/components/TitanIconButton'
import TimeSpeed from '@/ui/components/common/TimeSpeed'
import { GearIcon, ImageIcon, QuestionIcon, SignOutIcon, SpeakerSimpleHighIcon } from '@phosphor-icons/react'
import { modalWindowStore } from '@/ui/mobx/ModalWindowStore'
import { engineStore } from '@/ui/mobx/EngineStore'
import { getFullURL } from '@/core/helpers'

const MainAppBar = observer(() => {
  return (
    <TitanTopbar style={{ position: 'fixed', top: 0, zIndex: 999999, width: '100%' }}>
      <TitanFlex align="center">
        <TitanFlex>
          <img src={getFullURL('logo_white.png')} height="60" width="60" alt="" />
        </TitanFlex>
        <TitanFlex style={{ textTransform: 'uppercase' }}>{engineStore.scenario?.name}</TitanFlex>
      </TitanFlex>
      <TitanFlex>
        <TimeSpeed />
      </TitanFlex>
      <TitanFlex align="center" style={{ marginRight: '15px' }}>
        <TitanFlex>
          <TitanIconButton onClick={() => modalWindowStore.setTutorialWindowState(true)}>
            <QuestionIcon size={24} />
          </TitanIconButton>
        </TitanFlex>
        <TitanFlex>
          <TitanIconButton onClick={() => modalWindowStore.setAudioPlayerWindowState(true)}>
            <SpeakerSimpleHighIcon size={24} />
          </TitanIconButton>
        </TitanFlex>
        <TitanFlex>
          <TitanIconButton onClick={() => modalWindowStore.setSettingsWindowState(true)}>
            <GearIcon size={24} />
          </TitanIconButton>
        </TitanFlex>
        <TitanFlex>
          <TitanIconButton>
            <ImageIcon size={24} />
          </TitanIconButton>
        </TitanFlex>
        <TitanFlex>
          <TitanIconButton onClick={() => engineStore.setScenario(null)}>
            <SignOutIcon size={24} />
          </TitanIconButton>
        </TitanFlex>
      </TitanFlex>
    </TitanTopbar>
  )
})

export default MainAppBar
