import { observer } from 'mobx-react-lite'
import { lazy, Suspense, useState } from 'react'
import TitanTopbar from '@titanui/components/TitanTopbar'
import TitanDivider from '@titanui/components/TitanDivider'
import TitanCard from '@titanui/components/TitanCard'
import TitanButton from '@titanui/components/TitanButton'
import TitanGrid from '@titanui/components/TitanGrid'
import TitanFlex from '@titanui/components/TitanFlex'
import { ScenarioConfig, Scenarios } from '@/config/scenarios'
import { engineStore } from '@/ui/mobx/EngineStore'
import { app } from '@/config/app'
import { getFullURL } from '@/core/helpers'

const DataEditorModal = lazy(() => import('@/ui/editor/DataEditorModal'))

const HomePage = observer(() => {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorRequested, setEditorRequested] = useState(false)

  return (
    <div className="home-page">
      <TitanTopbar>
        <TitanFlex align="center">
          <TitanFlex>
            <img src={getFullURL('logo_white.png')} height="60" width="60" alt="" />
          </TitanFlex>
          <TitanFlex style={{ textTransform: 'uppercase' }}>{app.name}</TitanFlex>
        </TitanFlex>

        {import.meta.env.DEV && (
          <TitanFlex align="center">
            <TitanButton onClick={() => { setEditorRequested(true); setEditorOpen(true) }}>Data Editor</TitanButton>
          </TitanFlex>
        )}
      </TitanTopbar>
      <TitanDivider offsetTop={0} />
      <TitanGrid min={272} gap={20}>
        {Scenarios.map((scenario: ScenarioConfig) => (
          <TitanCard
            key={scenario.id}
            header={scenario.name}
            content={scenario.description}
            footer={
              <TitanButton ariaLabel={`Run ${scenario.name}`} onClick={() => engineStore.setScenario(scenario)}>
                Run
              </TitanButton>
            }
            // alt пустой: название сценария уже есть в заголовке карточки
            media={<img src={getFullURL(scenario.preview)} alt="" style={{ width: '100%' }} />}
          />
        ))}
      </TitanGrid>

      {import.meta.env.DEV && editorRequested && (
        <Suspense fallback={null}>
          <DataEditorModal visible={editorOpen} onClose={() => setEditorOpen(false)} />
        </Suspense>
      )}
    </div>
  )
})

export default HomePage
