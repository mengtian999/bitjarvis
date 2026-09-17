# @jarvis/plugin-components

React component primitives for Jarvis plugin WebViews/iframes.

```tsx
import {
  Button,
  CardShell,
  JarvisThemeProvider,
  SettingRow,
  Switch,
} from '@jarvis/plugin-components';
import '@jarvis/plugin-components/styles.css';

export function PluginPanel() {
  return (
    <JarvisThemeProvider mode="inherit">
      <CardShell title="Sync">
        <SettingRow
          label="Enabled"
          hint="Follows the current Jarvis theme."
          control={<Switch checked label="On" />}
        />
        <Button variant="primary">Run</Button>
      </CardShell>
    </JarvisThemeProvider>
  );
}
```

`JarvisThemeProvider` has three modes:

- `inherit`: use host CSS variables when the WebView/iframe receives them, then fall back to Jarvis defaults from `styles.css`.
- `jarvis`: set one of Jarvis's named theme token groups, such as `warm-paper` or `midnight`.
- `custom`: set only the tokens you provide. Missing tokens still fall back through host variables and SDK defaults.

Components intentionally expose stable `jarvis-plugin-*` classes so plugin authors can add small local refinements without depending on Jarvis renderer internals.
