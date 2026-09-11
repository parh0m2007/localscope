const enabled = !process.env.NO_COLOR;

export const bold = (text: string): string =>
  enabled ? `\x1b[1m${text}\x1b[22m` : text;

export const dim = (text: string): string =>
  enabled ? `\x1b[2m${text}\x1b[22m` : text;

export const inverse = (text: string): string =>
  enabled ? `\x1b[7m${text}\x1b[27m` : text;

export const underline = (text: string): string =>
  enabled ? `\x1b[4m${text}\x1b[24m` : text;

export const enterAltScreen = "\x1b[?1049h\x1b[?25l";
export const exitAltScreen = "\x1b[?25h\x1b[?1049l";
export const homeClear = "\x1b[H\x1b[J";
