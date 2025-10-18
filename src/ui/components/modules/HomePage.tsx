import { observer } from 'mobx-react-lite'
import { AppBar, Box, Theme, Toolbar, Typography } from '@mui/material'
import { createTheme, ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { ScenarioConfig, Scenarios } from '@/config/scenarios'
import StarSystemCard from '@/ui/components/general/StarSystemCard'

const darkTheme: Theme = createTheme({
  palette: {
    mode: 'dark'
  }
})

const HomePage = observer(() => {
  return (
    <div className="loading-screen">
      <ThemeProvider theme={darkTheme}>
        <CssBaseline />
        <Box sx={{ flexGrow: 1 }}>
          <AppBar position="static">
            <Toolbar>
              <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
                Titan Engine
              </Typography>
            </Toolbar>
          </AppBar>
        </Box>
        <Box
          display="grid"
          sx={{
            justifyContent: 'space-evenly',
            gridTemplateColumns: 'repeat(auto-fill, 250px)',
            gridGap: '2rem',
            margin: '10px 0',
            padding: '0 10px'
          }}
        >
          {Scenarios.map((scenario: ScenarioConfig) => (
            <StarSystemCard data={scenario} key={scenario.id} />
          ))}
        </Box>
      </ThemeProvider>
    </div>
  )
})

export default HomePage
