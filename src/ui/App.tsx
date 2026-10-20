import { observer } from 'mobx-react-lite'
import HomePage from '@/ui/components/layout/HomePage'
import LoadingScreen from '@/ui/components/layout/LoadingScreen'
import NotificationMessage from '@/ui/components/common/NotificationMessage'
import { engineStore } from '@/ui/mobx/EngineStore'

const App = observer(() => {
  const SimulationUI = engineStore.runtime?.SimulationUI

  return (
    <>
      {!engineStore.scenario ? <HomePage /> : engineStore.appLoadingStatus ? <LoadingScreen /> : null}
      {/* Keep session UI state (including the selected audio track) across menu returns. */}
      {SimulationUI && <SimulationUI />}
      <NotificationMessage />
    </>
  )
})

export default App
