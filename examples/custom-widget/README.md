# Example: Custom Widget

Build a widget that displays in the Urule Office UI.

## Widget Types

- **Native** — React component rendered directly (shared state access)
- **External** — iframe-based with postMessage bridge (sandboxed)

This example creates a native widget.

## Steps

### 1. Create the widget component

Create `apps/office-ui/src/widgets/builtin/GreetingWidget.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";

export default function GreetingWidget() {
  const [greeting, setGreeting] = useState("Hello from your custom widget!");
  const [time, setTime] = useState(new Date().toLocaleTimeString());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="p-4 rounded-xl border border-border-dark bg-card-dark">
      <h3 className="text-sm font-semibold text-text-primary mb-2">
        My Widget
      </h3>
      <p className="text-text-secondary text-sm">{greeting}</p>
      <p className="text-text-muted text-xs mt-2 font-mono">{time}</p>
      <button
        onClick={() => setGreeting("You clicked me!")}
        className="mt-3 px-3 py-1.5 text-xs rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
      >
        Click Me
      </button>
    </div>
  );
}
```

### 2. Add the widget manifest

Add to `apps/office-ui/src/widgets/manifests.ts`:

```typescript
{
  id: 'greeting-widget',
  name: 'Greeting Widget',
  version: '1.0.0',
  description: 'A simple greeting widget with a clock',
  author: 'your-name',
  mountPoints: ['sidebar', 'main-panel'],
  entryType: 'native',
  componentPath: './builtin/GreetingWidget',
  permissions: [],
  defaultConfig: {},
  icon: 'waving_hand',
  category: 'productivity',
}
```

### 3. Register the export

Add to `apps/office-ui/src/widgets/builtin/index.ts`:

```typescript
export { default as GreetingWidget } from './GreetingWidget';
```

### 4. See it in the UI

The widget will appear in the sidebar widget zone. Restart the dev server if needed:

```bash
cd apps/office-ui && npm run dev
```

## Widget SDK Reference

For iframe-based (external) widgets, use the bridge protocol:

```typescript
import { WidgetClientBridge } from '@urule/widget-sdk';

const bridge = new WidgetClientBridge();
bridge.on('host:config', (config) => {
  // Handle configuration from host
});
bridge.on('host:theme', (theme) => {
  // Adapt to dark/light theme
});
bridge.emit('widget:ready');
```

See the [Widget SDK docs](https://github.com/urule-os/widget-sdk) for the full API.
