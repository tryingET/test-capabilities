/**
 * Key definitions for CDP keyboard input (CDP program S1): what `Input.dispatchKeyEvent` needs to
 * produce the key, code, keyCode and text a real keyboard would, and chords like `Shift+Tab`.
 * Pure; the actions module dispatches.
 */

import { FrameworkError } from "./runtime-contract.js";

export interface KeyDefinition {
  key: string;
  code: string;
  keyCode: number;
  /** what the key types; absent for keys that type nothing */
  text?: string;
}

/** CDP's modifier bit mask: Alt=1, Control=2, Meta=4, Shift=8 */
export const MODIFIER_BITS: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

const MODIFIER_KEYS: Record<string, KeyDefinition> = {
  Alt: { key: "Alt", code: "AltLeft", keyCode: 18 },
  Control: { key: "Control", code: "ControlLeft", keyCode: 17 },
  Meta: { key: "Meta", code: "MetaLeft", keyCode: 91 },
  Shift: { key: "Shift", code: "ShiftLeft", keyCode: 16 },
};

const NAMED_KEYS: Record<string, KeyDefinition> = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  Space: { key: " ", code: "Space", keyCode: 32, text: " " },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  End: { key: "End", code: "End", keyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
};

/** The key a single typed character is: letters and digits get their code and keyCode. */
export function characterKey(character: string): KeyDefinition {
  if (character === "\n" || character === "\r") return NAMED_KEYS.Enter as KeyDefinition;
  if (character === " ") return NAMED_KEYS.Space as KeyDefinition;
  const upper = character.toUpperCase();
  if (/^[A-Z]$/.test(upper)) {
    return { key: character, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: character };
  }
  if (/^[0-9]$/.test(character)) {
    return {
      key: character,
      code: `Digit${character}`,
      keyCode: character.charCodeAt(0),
      text: character,
    };
  }
  return { key: character, code: "", keyCode: 0, text: character };
}

export interface Chord {
  key: KeyDefinition;
  /** held first and released last, in order */
  modifiers: KeyDefinition[];
  mask: number;
}

/**
 * `Enter`, `a`, `Shift+Tab`, `Control+a`. A chord with Control or Meta types no text (it is a
 * shortcut, not input). An unknown named key is refused, never sent as something else.
 */
export function parseChord(chord: string): Chord {
  const parts = chord.split("+");
  const last = parts.pop() ?? "";
  const modifiers: KeyDefinition[] = [];
  let mask = 0;
  for (const part of parts) {
    const modifier = MODIFIER_KEYS[part];
    if (!modifier) {
      throw new FrameworkError("action_key_unknown", `'${part}' in '${chord}' is not a modifier`, {
        chord,
      });
    }
    modifiers.push(modifier);
    mask |= MODIFIER_BITS[part] ?? 0;
  }
  let key: KeyDefinition;
  if (last.length === 1) {
    key = characterKey(last);
  } else if (NAMED_KEYS[last]) {
    key = NAMED_KEYS[last] as KeyDefinition;
  } else {
    throw new FrameworkError("action_key_unknown", `'${last}' is not a key this channel knows`, {
      chord,
      known: Object.keys(NAMED_KEYS),
    });
  }
  if (mask & (MODIFIER_BITS.Control as number) || mask & (MODIFIER_BITS.Meta as number)) {
    const { text: _typed, ...silent } = key;
    key = silent;
  }
  return { key, modifiers, mask };
}
