import { Server } from "./services/server.js";
import { parseConfig } from "./utils/config.js";

const server = new Server(parseConfig("{}"));
server.start();
