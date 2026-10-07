import { observer } from 'mobx-react-lite'
import TitanTopbar from '@titanui/components/TitanTopbar'
import TitanFlex from '@titanui/components/TitanFlex'
import TitanIconButton from '@titanui/components/TitanIconButton'
import TimeSpeed from '@/ui/components/common/TimeSpeed'
import { GearIcon, ImageIcon, QuestionIcon, SignOutIcon, SpeakerSimpleHighIcon } from '@phosphor-icons/react'
import { modalWindowStore } from '@/ui/mobx/ModalWindowStore'
import { engineStore } from '@/ui/mobx/EngineStore'
import { getFullURL } from '@/core/helpers'
import { TakeScreenshot } from '@/core/commands/TakeScreenshot'

const MainAppBar = observer(() => {
  return (
    // left/right вместо width: 100% — с паддингом панель была шире экрана на 20px.
    // Три колонки: время ровно по центру при любой длине названия; название
    // сценария режется многоточием, кнопки справа не сжимаются
    <TitanTopbar
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 999999,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto minmax(max-content, 1fr)'
      }}
    >
      <TitanFlex align="center" style={{ minWidth: 0 }}>
        <TitanFlex>
          <img src={getFullURL('logo_white.png')} height="60" width="60" alt="" />
        </TitanFlex>
        <div
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap'
          }}
        >
          {engineStore.scenario?.name}
        </div>
      </TitanFlex>
      <TitanFlex>
        <TimeSpeed />
      </TitanFlex>
      <TitanFlex align="center" style={{ justifySelf: 'end' }}>
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
          <TitanIconButton onClick={() => void TakeScreenshot.execute({})}>
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
