---
summary: "API reference for SurfClient browser automation integration."
read_when:
  - "You are automating browser interactions through surf-cli"
  - "You need method-level details for SurfClient and flow APIs"
type: "reference"
---

# SurfClient API

> Browser automation via surf-cli.

`SurfClient` is a **library API**. The current CLI wrapper supports `test-capabilities surf explore`, while richer browser behavior is exposed programmatically through this surface.

---

## Constructor

```typescript
const surf = new SurfClient({
  socketPath: '/tmp/surf.sock',
  autoScreenshot: true,
  screenshotResize: 1200,
  networkCapture: true,
});
```

---

## Navigation

### `goto(url)`

```typescript
await surf.goto('https://myapp.com');
```

If navigation succeeds but the follow-up auto-screenshot fails, the action still succeeds and the screenshot failure is surfaced in the returned `error` field.

### `back()` / `forward()`

```typescript
await surf.back();
await surf.forward();
```

### `reload(hard?)`

```typescript
await surf.reload();
await surf.reload(true);
```

---

## Reading pages

### `read(options?)`

```typescript
const snapshot = await surf.read({
  depth: 3,
  compact: true,
});

// snapshot.url
// snapshot.title
// snapshot.elements
```

### `pageText()`

```typescript
const text = await surf.pageText();
```

### `pageState()`

```typescript
const state = await surf.pageState();
// { modals: [], loading: false, scrollPosition: { x: 0, y: 500 } }
```

---

## Interaction

### `click(ref | selector | x, y)`

```typescript
await surf.click('e5');
await surf.click('#login-btn');
await surf.click(100, 200);
```

### `type(text, options?)`

```typescript
await surf.type('hello');
await surf.type('hello', { ref: 'e12' });
await surf.type('hello', { selector: 'input[name=email]' });
await surf.type('hello', { submit: true });
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
await surf.select('e5', '0', { byIndex: true });
```

---

## Semantic locators

Preferred over CSS selectors.

### `locateByRole(role, options?)`

```typescript
await surf.locateByRole('button', { name: 'Submit' });
await surf.locateByRole('button', { name: 'Submit', action: 'click' });
await surf.locateByRole('textbox', { action: 'fill', value: 'hello' });
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
await surf.screenshot({ full: true });
await surf.screenshot({ annotate: true });
await surf.screenshot({ fullpage: true });
```

---

## Tabs

### `listTabs()`

```typescript
const tabs = await surf.listTabs();
```

The parser tolerates common bordered table output from `surf tab.list` and extracts numeric tab ids, titles, and URLs from each row.

### `newTab(url)`

```typescript
const { tabId, windowId } = await surf.newTab('https://example.com');
```

### `switchTab(id)`

```typescript
await surf.switchTab(123);
await surf.switchTab('dashboard');
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

## AI queries (no API keys)

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

This is a **library-level passthrough** to surf's file-driven workflow support.
Unlike the shipped TEST-CAPABILITIES operation kernel, the workflow file shape is not yet a core-owned, schema-validated contract in this repo.

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

## JavaScript execution

### `evaluate<T>(code)`

```typescript
const title = await surf.evaluate<string>('JSON.stringify(document.title)');
const count = await surf.evaluate<number>('JSON.stringify(document.querySelectorAll(".item").length)');
```

---

## Device emulation

### `emulateDevice(device)`

```typescript
await surf.emulateDevice('iPhone 14');
await surf.resetDevice();
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

## Console and cookies

### `getConsole()`

```typescript
const logs = await surf.getConsole();
```

### `getCookies()`

```typescript
const cookies = await surf.getCookies();
```
