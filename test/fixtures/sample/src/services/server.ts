import { parseConfig, DEFAULT_TIMEOUT_MS } from "../utils/config.js";

export class Server {
  constructor(private readonly config: ReturnType<typeof parseConfig>) {}

  start(): number {
    return this.config.port + DEFAULT_TIMEOUT_MS;
  }
}

export { parseConfig };
