import { observer } from 'mobx-react-lite'
import TitanTopbar from '@titanui/components/TitanTopbar'
import TitanDivider from '@titanui/components/TitanDivider'
import TitanCard from '@titanui/components/TitanCard'
import TitanButton from '@titanui/components/TitanButton'
import TitanGrid from '@titanui/components/TitanGrid'
import TitanFlex from '@titanui/components/TitanFlex'
import { ScenarioConfig, Scenarios } from '@/config/scenarios'
import { engineStore } from '@/ui/mobx/EngineStore'
import { config } from '@/core/framework/config'
import { getFullURL } from '@/core/helpers'

const HomePage = observer(() => {
  return (
    <div className="loading-screen">
      <TitanTopbar>
        <TitanFlex align="center">
          <TitanFlex>
            <img src={getFullURL('logo_white.png')} height="60" width="60" alt="" />
          </TitanFlex>
          <TitanFlex style={{ textTransform: 'uppercase' }}>{config('name')}</TitanFlex>
        </TitanFlex>
      </TitanTopbar>
      <TitanDivider offsetTop={0} />
      <TitanGrid min={272} gap={20}>
        {Scenarios.map((scenario: ScenarioConfig) => (
          <TitanCard
            key={scenario.id}
            header={scenario.name}
            content={scenario.description}
            footer={<TitanButton onClick={() => engineStore.setScenario(scenario)}>Run</TitanButton>}
            media={<img src={getFullURL(scenario.preview)} alt={scenario.name} style={{ width: '100%' }} />}
          />
        ))}
      </TitanGrid>
    </div>
  )
})

export default HomePage
