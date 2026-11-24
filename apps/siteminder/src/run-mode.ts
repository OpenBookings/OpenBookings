import type { RunMode } from "./env";
import { type TickDeps, tick } from "./tick";

/**
 * The scheduled driver of `tick`. Always-on: every `pollSeconds`, never starting a tick while the previous one
 * still runs. Scale-to-zero: nothing here; an outside scheduler calls `POST /tick`. In both modes every stored
 * SiteMinder message also kicks a tick of its own (soap/handler.ts). Returns a function that stops the interval.
 */
export function startRunMode(deps: TickDeps, mode: RunMode, pollSeconds: number): () => void {
  if (mode === "scale-to-zero") return () => {};

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tick(deps);
    } catch (e) {
      console.error("[siteminder] scheduled tick failed", { error: e instanceof Error ? e.message : String(e) });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void run(), pollSeconds * 1000);
  return () => clearInterval(timer);
}
