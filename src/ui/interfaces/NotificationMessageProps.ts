import { OverridableStringUnion } from '@mui/types'
import { AlertColor, AlertPropsColorOverrides } from '@mui/material/Alert/Alert'

interface NotificationMessageProps {
  type: OverridableStringUnion<AlertColor, AlertPropsColorOverrides>
  message: string
}

export { NotificationMessageProps }
