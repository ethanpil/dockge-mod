import { DockgeServer } from "./dockge-server";
import { log } from "./log";

log.info("server", "Welcome to dockge-mod!");
const server = new DockgeServer();
await server.serve();
