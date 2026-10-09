import { EventEmitter } from "node:events";

/** Process-wide event bus: ring() publishes here, the WebSocket server and doorbells subscribe. */
type Bus = EventEmitter & { __wisp?: true };
const g = globalThis as unknown as { __wispBus?: Bus };
export const bus: Bus = g.__wispBus ?? (g.__wispBus = Object.assign(new EventEmitter(), { __wisp: true as const }));
bus.setMaxListeners(0);
export type BusEvent = { kind: "post" | "action" | "bounty" | "buyback"; at: number } & Record<string, unknown>;
export function publish(ev: BusEvent) { bus.emit("event", ev); }
