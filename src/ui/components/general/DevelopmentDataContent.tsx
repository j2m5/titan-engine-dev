import { observer } from 'mobx-react-lite'
import { simulationStore } from '@/core/mobX/SimulationStore'
import { Box, Divider, Typography } from '@mui/material'
import { ModelState, SimulationState } from '@/core/data/types'
import { height, width } from '@/core/constants'
import { fromKilometers, toAstronomicalUnits } from '@/core/helpers/scaling'

const DevelopmentDataContent = observer(() => {
  return <div>DevelopmentData</div>
  /*const state: SimulationState = simulationStore

  return (
    <Box width={width / 2} height={height / 2}>
      <Box>
        <Box>
          <Box color="gray">
            Camera direction - X: {state.cameraDirection.x}, Y: {state.cameraDirection.y}, Z: {state.cameraDirection.z}
          </Box>
          <Divider />
          <Box color="yellow">
            Camera target - X: {state.cameraTarget.x}, Y: {state.cameraTarget.y}, Z: {state.cameraTarget.z}
          </Box>
          <Divider />
          <Box color="green">
            Camera position
            <Typography>
              X: {state.cameraPosition.x}, Y: {state.cameraPosition.y}, Z: {state.cameraPosition.z} (units)
            </Typography>
            <Typography>
              X: {toAstronomicalUnits(state.cameraPosition.x)}, Y: {toAstronomicalUnits(state.cameraPosition.y)}, Z:{' '}
              {toAstronomicalUnits(state.cameraPosition.z)} (au)
            </Typography>
            <Typography>
              X: {fromKilometers(state.cameraPosition.x)}, Y: {fromKilometers(state.cameraPosition.y)}, Z:{' '}
              {fromKilometers(state.cameraPosition.z)} (km)
            </Typography>
          </Box>
          <Divider />
          <Box color="orange">
            Closest model to camera -{' '}
            <Typography display="inline" color="lightgreen">
              {simulationStore.closestModelToCamera?.name}
            </Typography>
          </Box>
          <Divider />
          {state.modelState.map((model: ModelState) => (
            <Box key={model.name}>
              <Box color="red">
                Model name -{' '}
                <Typography display="inline" variant="body1" color="yellow">
                  {model.name}
                </Typography>
              </Box>
              <Box color="red">
                Distance from camera
                <Typography variant="body1" color="cyan">
                  {model.distanceFromCamera} units
                </Typography>
                <Typography variant="body1" color="cyan">
                  {toAstronomicalUnits(model.distanceFromCamera)} au
                </Typography>
                <Typography variant="body1" color="cyan">
                  {fromKilometers(model.distanceFromCamera)} km
                </Typography>
              </Box>
              <Box color="red">
                Model world position
                <Box color="cyan">
                  units
                  <Typography>X: {model.position.x}</Typography>
                  <Typography>Y: {model.position.y}</Typography>
                  <Typography>Z: {model.position.z}</Typography>
                </Box>
                <Divider />
                <Box color="cyan">
                  au
                  <Typography>X: {toAstronomicalUnits(model.position.x)}</Typography>
                  <Typography>Y: {toAstronomicalUnits(model.position.y)}</Typography>
                  <Typography>Z: {toAstronomicalUnits(model.position.z)}</Typography>
                </Box>
                <Divider />
                <Box color="cyan">
                  km
                  <Typography>X: {fromKilometers(model.position.x)}</Typography>
                  <Typography>Y: {fromKilometers(model.position.y)}</Typography>
                  <Typography>Z: {fromKilometers(model.position.z)}</Typography>
                </Box>
                <Divider />
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )*/
})

export default DevelopmentDataContent
