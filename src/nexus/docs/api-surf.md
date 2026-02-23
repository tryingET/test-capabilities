# SurfClient API

> Browser automation via surf-cli.

---

## Constructor

```typescript
const surf = new SurfClient(options?: {
  socketPath?: string;      // Default: '/tmp/surf.sock'
  autoScreenshot?: boolean; // Default: true
  screenshotResize?: number;// Default: 1200
  networkCapture?: boolean; // Default: true
});
```

---

## Navigation

### `goto(url)`

```typescript
await surf.goto('https://myapp.com');
```

### `back()` / `forward()`

```typescript
await surf.back();
await surf.forward();
```

### `reload(hard?)`

```typescript
await surf.reload();
await surf.reload(true); // Hard reload
```

---

## Reading Pages

### `read(options?)`

Get accessibility tree with element refs.

```typescript
const snapshot = await surf.read({
  depth: 3,    // Limit tree depth
  compact: true, // Remove empty elements
});

// snapshot.url, snapshot.title, snapshot.elements[]
// elements[i] = { ref: 'e5', role: 'button', name: 'Submit', text: 'Click me' }
```

### `pageText()`

Get raw text content.

```typescript
const text = await surf.pageText();
```

### `pageState()`

Get page state.

```typescript
const state = await surf.pageState();
// { modals: [], loading: false, scrollPosition: { x: 0, y: 500 } }
```

---

## Interaction

### `click(ref | selector | x, y)`

```typescript
await surf.click('e5');              // By ref
await surf.click('#login-btn');      // By selector
await surf.click(100, 200);          // By coordinates
```

### `type(text, options?)`

```typescript
await surf.type('hello');
await surf.type('hello', { ref: 'e12' });
await surf.type('hello', { selector: 'input[name=email]' });
await surf.type('hello', { submit: true }); // Press Enter after
```

### `press(key)`

```typescript
await surf.press('Enter');
await surf.press('Escape');
await surf.press('Tab');
```

### `scroll(direction, pixels?)`

```typescript
await surf.scroll('down');
await surf.scroll('down', 500);
await surf.scroll('up');
```

### `select(ref, value, options?)`

```typescript
await surf.select('e5', 'US');
await surf.select('e5', 'United States', { byLabel: true });
await surf.select('e5', 0, { byIndex: true });
```

---

## Semantic Locators

Preferred over CSS selectors.

### `locateByRole(role, options?)`

```typescript
await surf.locateByRole('button', { name: 'Submit' });
await surf.locateByRole('button', { name: 'Submit', action: 'click' });
await surf.locateByRole('textbox', { action: 'fill', value: 'hello' });
await surf.locateByRole('link', { all: true }); // List all
```

### `locateByText(text, options?)`

```typescript
await surf.locateByText('Sign In', { action: 'click' });
await surf.locateByText('Accept', { exact: true });
```

### `locateByLabel(label, options?)`

```typescript
await surf.locateByLabel('Email', { action: 'fill', value: 'test@example.com' });
```

---

## Screenshots

### `screenshot(options?)`

```typescript
await surf.screenshot();
await surf.screenshot({ output: '/tmp/shot.png' });
await surf.screenshot({ full: true });         // Full resolution
await surf.screenshot({ annotate: true });     // With element labels
await surf.screenshot({ fullpage: true });     // Entire page
```

---

## Tabs

### `listTabs()`

```typescript
const tabs = await surf.listTabs();
// [{ id: 123, title: 'Page', url: 'https://...' }]
```

### `newTab(url)`

```typescript
const { tabId, windowId } = await surf.newTab('https://example.com');
```

### `switchTab(id)`

```typescript
await surf.switchTab(123);
await surf.switchTab('dashboard'); // By name
```

### `closeTab(id)`

```typescript
await surf.closeTab(123);
```

---

## Windows

### `newWindow(url)`

```typescript
const { windowId, tabId } = await surf.newWindow('https://example.com');
```

### `listWindows()`

```typescript
const windows = await surf.listWindows();
```

### `closeWindow(id)`

```typescript
await surf.closeWindow(123456);
```

---

## Network

### `getNetwork(options?)`

```typescript
const requests = await surf.getNetwork({
  origin: 'api.github.com',
  method: 'POST',
  type: 'json',
  status: '4xx,5xx',
  since: '5m',
});
// [{ id: 'r_001', method: 'GET', url: '...', status: 200, duration: 45 }]
```

### `getNetworkRequest(id)`

```typescript
const request = await surf.getNetworkRequest('r_001');
```

### `getNetworkBody(id)`

```typescript
const body = await surf.getNetworkBody('r_001');
```

### `clearNetwork()`

```typescript
await surf.clearNetwork();
```

---

## AI Queries (No API Keys!)

Uses your browser login.

### `queryChatGPT(prompt, options?)`

```typescript
const response = await surf.queryChatGPT('Analyze UX issues', {
  withPage: true,
  model: 'gpt-4o',
});
```

### `queryGemini(prompt, options?)`

```typescript
const response = await surf.queryGemini('Summarize', {
  withPage: true,
  model: 'gemini-2.5-flash',
  generateImage: '/tmp/output.png',
});
```

### `queryPerplexity(prompt, options?)`

```typescript
const response = await surf.queryPerplexity('Best practices?', {
  withPage: true,
  mode: 'research',
});
```

### `queryGrok(prompt, options?)`

```typescript
const response = await surf.queryGrok('AI trends', {
  withPage: true,
  deepSearch: true,
  model: 'thinking',
});
```

---

## Workflows

### `workflow(steps)`

```typescript
await surf.workflow([
  'go "https://example.com"',
  'click e5',
  'screenshot',
]);
```

### `workflowFromFile(file, args?)`

```typescript
await surf.workflowFromFile('./flows/login.json', {
  email: 'test@example.com',
  password: 'secret',
});
```

---

## Waiting

### `wait(duration)` or `wait(options)`

```typescript
await surf.wait(2000);
await surf.wait({ element: '.loaded' });
await surf.wait({ network: true });
await surf.wait({ url: '/dashboard' });
```

---

## JavaScript Execution

### `evaluate<T>(code)`

```typescript
const title = await surf.evaluate<string>('return document.title');
const count = await surf.evaluate<number>(
  'return document.querySelectorAll(".item").length'
);
```

---

## Device Emulation

### `emulateDevice(device)`

```typescript
await surf.emulateDevice('iPhone 14');
await surf.emulateDevice('Pixel 7');
await surf.emulateDevice('reset');
```

### `emulateViewport(width, height, scale?)`

```typescript
await surf.emulateViewport(375, 812);
await surf.emulateViewport(1920, 1080, 2);
```

---

## Iframes

### `listFrames()`

```typescript
const frames = await surf.listFrames();
```

### `switchFrame(options)`

```typescript
await surf.switchFrame({ index: 0 });
await surf.switchFrame({ name: 'payment' });
await surf.switchFrame({ selector: '#checkout-frame' });
```

### `switchToMain()`

```typescript
await surf.switchToMain();
```

---

## Console & Cookies

### `getConsole()`

```typescript
const logs = await surf.getConsole();
// [{ type: 'error', message: '...' }]
```

### `getCookies()`

```typescript
const cookies = await surf.getCookies();
// [{ name: 'session', value: '...', domain: '...' }]
```
