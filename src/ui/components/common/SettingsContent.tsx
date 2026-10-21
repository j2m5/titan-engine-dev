import { observer } from 'mobx-react-lite'
import TitanFlex from '@titanui/components/TitanFlex'
import TitanLabel from '@titanui/components/TitanLabel'
import TitanDivider from '@titanui/components/TitanDivider'
import TitanToggle from '@titanui/components/TitanToggle'
import TitanSelect from '@titanui/components/TitanSelect'
import type { CloudQuality } from '@/core/clouds/SceneCloudConfig'
import { settingsStore } from '@/ui/mobx/SettingsStore'
import { toggleSettings, cloudQualitySetting } from '@/ui/components/common/settings/settingsSchema'

const SettingsContent = observer(() => {
  const groups: string[] = [...new Set(toggleSettings.map((setting) => setting.group))]

  return (
    <TitanFlex style={{ flexDirection: 'column', gap: 16, minWidth: 320 }}>
      {groups.map((group) => (
        <div key={group}>
          <TitanLabel>{group}</TitanLabel>
          <TitanDivider offsetTop={6} offsetBottom={10} />
          <TitanFlex style={{ flexDirection: 'column', gap: 10 }}>
            {toggleSettings
              .filter((setting) => setting.group === group)
              .map((setting) => (
                <TitanToggle
                  key={setting.key}
                  checked={settingsStore[setting.key]}
                  label={setting.label}
                  onChange={() => settingsStore.toggle(setting.key)}
                />
              ))}
            {group === cloudQualitySetting.group && (
              <TitanSelect
                label={cloudQualitySetting.label}
                value={settingsStore.cloudQuality}
                options={cloudQualitySetting.options}
                onChange={(value) => settingsStore.setCloudQuality(value as CloudQuality)}
              />
            )}
          </TitanFlex>
        </div>
      ))}
    </TitanFlex>
  )
})

export default SettingsContent
