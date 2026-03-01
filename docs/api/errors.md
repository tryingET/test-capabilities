# Error Handling

> Common errors and how to recover.

---

## Return Codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success | All tests passed, health >= 70 |
| 1 | Test failures | Review findings, fix issues |
| 2 | Configuration error | Check test-capabilities.yaml syntax |
| 3 | Connection error | Verify target is accessible |
| 4 | Timeout | Increase timeout or simplify |

---

## Common Errors

### ECONNREFUSED

```
Error: connect ECONNREFUSED 127.0.0.1:443
```

**Cause**: Target URL not reachable.

**Fix**:
1. Verify URL is correct
2. Check if server is running
3. Check firewall/network

---

### ETIMEDOUT

```
Error: Timeout waiting for element
```

**Cause**: Operation took too long.

**Fix**:
1. Increase timeout: `--timeout 120000`
2. Check for slow endpoints
3. Verify element exists

---

### Selector Not Found

```
Error: Element not found: #old-button
```

**Cause**: Element selector is stale.

**Fix**:
1. Enable self-healing: `--self-heal`
2. Use semantic locators
3. Update selector manually

```typescript
// Instead of:
await surf.click('#old-button');

// Use:
await surf.locateByRole('button', { name: 'Submit', action: 'click' });
```

---

### Extension Not Found

```
Error: Surf extension not found
```

**Cause**: Surf-CLI not installed or extension not loaded.

**Fix**:
1. `npm install -g surf-cli`
2. Load extension in Chrome: `chrome://extensions`
3. Run `surf install <extension-id>`
4. Restart Chrome

---

### Chrome Not Found

```
Error: Chrome browser not found
```

**Cause**: Chrome/Chromium not installed.

**Fix**:
1. Install Chrome or Chromium
2. Set `CHROME_PATH` environment variable

---

### Out of Memory

```
Error: JavaScript heap out of memory
```

**Cause**: Quantum branches too high.

**Fix**:
1. Reduce branches: `--branches 100`
2. Increase Node memory: `NODE_OPTIONS="--max-old-space-size=4096"`
3. Run in smaller batches

---

## Error Handling Patterns

### Retry Pattern

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delay = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Max retries exceeded');
}

// Usage
const result = await withRetry(() => surf.click('e5'));
```

### Fallback Pattern

```typescript
async function robustClick(surf: SurfClient, selector: string) {
  try {
    // Try direct click
    await surf.click(selector);
    return { success: true, method: 'direct' };
  } catch {
    try {
      // Fallback to semantic locator
      await surf.locateByText(selector, { action: 'click' });
      return { success: true, method: 'semantic' };
    } catch {
      // Fallback to healing
      const healed = await healer.heal({
        originalSelector: selector,
        action: 'click',
      });
      if (healed.success) {
        await surf.click(healed.newSelector!);
        return { success: true, method: 'healed', newSelector: healed.newSelector };
      }
      return { success: false };
    }
  }
}
```

### Graceful Degradation

```typescript
async function runTests(config: NexusConfig) {
  try {
    // Try full autonomous
    return await runFullAutonomous(config);
  } catch (error) {
    console.warn('Autonomous failed, trying standard...');
    
    try {
      // Fall back to standard
      return await runStandard(config);
    } catch (error) {
      console.warn('Standard failed, trying quick...');
      
      // Last resort: quick check
      return await runQuickCheck(config.targets.web);
    }
  }
}
```

---

## CLI Error Handling

```bash
# Fail fast on first error
test-capabilities test --fail-fast

# Continue on errors
test-capabilities test --no-fail-fast

# Set thresholds
test-capabilities test --fail-threshold critical  # Only fail on critical
test-capabilities test --fail-threshold high      # Fail on high+
test-capabilities test --fail-threshold medium    # Fail on medium+
```

---

## Debugging

### Verbose Output

```bash
test-capabilities test --verbose --target https://myapp.com
```

### Debug Mode

```bash
DEBUG=test-capabilities:* test-capabilities test --target https://myapp.com
```

### Save Debug Info

```typescript
const result = await test-capabilities.run();

if (!result.passed) {
  // Save detailed debug info
  await fs.writeFile(
    'debug-findings.json',
    JSON.stringify(result.findings, null, 2)
  );
  
  // Save screenshots
  for (const f of result.findings) {
    if (f.screenshot) {
      await fs.writeFile(`debug-${f.id}.png`, f.screenshot);
    }
  }
}
```

---

## Reporting Errors

When reporting issues, include:

1. TEST-CAPABILITIES version: `test-capabilities --version`
2. Node version: `node --version`
3. Config file (redact secrets)
4. Full error message
5. Debug output (`--verbose`)

```bash
# Gather debug info
test-capabilities --version > debug-info.txt
node --version >> debug-info.txt
test-capabilities test --verbose --target https://myapp.com 2>&1 | tee -a debug-info.txt
```
