export interface AppConfig {
  readonly port: number;
  readonly host: string;
}

export function parseConfig(raw: string): AppConfig {
  const parsed = JSON.parse(raw) as Partial<AppConfig>;
  return {
    port: parsed.port ?? 3000,
    host: parsed.host ?? "127.0.0.1",
  };
}

export const DEFAULT_TIMEOUT_MS = 5_000;
