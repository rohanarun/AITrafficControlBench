import { Simulation as LegacySimulation } from "./legacy-engine.js";
import { TerminalSimulation } from "./terminal-engine.js";
export { random, sweptConflict } from "./legacy-engine.js";
export class Simulation {
  constructor(config, options = {}) {
    return config.engine === "terminal-v1"
      ? new TerminalSimulation(config, options)
      : new LegacySimulation(config, options);
  }
}
