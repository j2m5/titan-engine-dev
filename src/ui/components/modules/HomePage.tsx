import { observer } from 'mobx-react-lite'
import { ScenarioConfig, Scenarios } from '@/config/scenarios'
import { engineStore } from '@/ui/mobX/EngineStore'
import { getFullURL } from '@/core/helpers/finder'
import TitanTopbar from '@/ui/TitanUI/components/TitanTopbar'
import TitanDivider from '@/ui/TitanUI/components/TitanDivider'
import TitanCard from '@/ui/TitanUI/components/TitanCard'
import TitanButton from '@/ui/TitanUI/components/TitanButton'
import TitanGrid from '@/ui/TitanUI/components/TitanGrid'
import TitanFlex from '@/ui/TitanUI/components/TitanFlex'

const HomePage = observer(() => {
  return (
    <div className="loading-screen">
      <TitanTopbar>
        <TitanFlex align="center">
          <TitanFlex>
            <img src={getFullURL('logo_white.png')} height="60" width="60" alt="" />
          </TitanFlex>
          <TitanFlex>Titan Engine</TitanFlex>
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
