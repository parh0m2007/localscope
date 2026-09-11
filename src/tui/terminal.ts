import * as tty from "node:tty";

export interface Size {
  readonly rows: number;
  readonly cols: number;
}

export function terminalSize(): Size {
  return {
    rows: process.stdout.rows ?? 24,
    cols: process.stdout.columns ?? 80,
  };
}

export function onResize(handler: () => void): () => void {
  const listener = (): void => handler();
  process.stdout.on("resize", listener);
  return () => process.stdout.off("resize", listener);
}

export function isInteractive(): boolean {
  return (
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true
  );
}

export interface RawMode {
  readonly restore: () => void;
  /** Re-enter raw mode after an external program (e.g. $EDITOR) used the tty. */
  readonly reenter: () => void;
}

export function setRawMode(): RawMode | null {
  if (!(process.stdin instanceof tty.ReadStream)) return null;
  try {
    const enter = (): void => {
      process.stdin.setRawMode(true);
      process.stdin.resume();
    };
    enter();
    return {
      restore: () => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
      },
      reenter: enter,
    };
  } catch {
    return null;
  }
}

/**
 * Key decoder: translates stdin chunks into key events. Handles C0 codes,
 * escape sequences (arrows, Enter variants, backspace) and simple paste
 * (treats multi-character printable runs as typed text).
 */
export type KeyEvent =
  | { readonly kind: "printable"; readonly text: string }
  | { readonly kind: "enter" }
  | { readonly kind: "backspace" }
  | { readonly kind: "up" }
  | { readonly kind: "down" }
  | { readonly kind: "left" }
  | { readonly kind: "right" }
  | { readonly kind: "escape" }
  | { readonly kind: "interrupt" };

export function decodeKeys(data: Buffer): KeyEvent[] {
  const bytes = [...data];
  const events: KeyEvent[] = [];

  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i];

    if (byte === 0x03) {
      events.push({ kind: "interrupt" });
      i++;
      continue;
    }
    if (byte === 0x0d || byte === 0x0a) {
      events.push({ kind: "enter" });
      i++;
      continue;
    }
    if (byte === 0x7f || byte === 0x08) {
      events.push({ kind: "backspace" });
      i++;
      continue;
    }
    if (byte === 0x1b) {
      if (i + 1 < bytes.length && bytes[i + 1] === 0x5b) {
        // CSI sequence
        const final = bytes[i + 2];
        if (final === 0x41) {
          events.push({ kind: "up" });
          i += 3;
          continue;
        }
        if (final === 0x42) {
          events.push({ kind: "down" });
          i += 3;
          continue;
        }
        if (final === 0x43) {
          events.push({ kind: "right" });
          i += 3;
          continue;
        }
        if (final === 0x44) {
          events.push({ kind: "left" });
          i += 3;
          continue;
        }
        if (final === 0x48 || final === 0x46) {
          events.push({ kind: "up" }); // Home/End as jump-to-ends
          i += 3;
          continue;
        }
        // Unknown CSI: skip until a final byte in @-~ range.
        let j = i + 2;
        while (j < bytes.length && !(bytes[j] >= 0x40 && bytes[j] <= 0x7e)) j++;
        i = j + 1;
        continue;
      }
      events.push({ kind: "escape" });
      i++;
      continue;
    }

    if (byte >= 0x20 && byte < 0x7f) {
      // Collect a run of printable ASCII as one text event (fast typing,
      // paste-like bursts render as a single query update).
      let text = "";
      let j = i;
      while (j < bytes.length && bytes[j] >= 0x20 && bytes[j] < 0x7f) {
        text += String.fromCharCode(bytes[j]);
        j++;
      }
      events.push({ kind: "printable", text });
      i = j;
      continue;
    }

    // Non-ASCII or control: skip a byte (UTF-8 input is not a query use case).
    i++;
  }

  return events;
}
