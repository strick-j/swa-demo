// stageMap.ts -- maps synthetic pace events to stage indices, and the stage verb
// shown while running. The engine synthesizes "cp.stage.N" events that the pace
// queue releases at the chosen tempo (name kept generic across providers).
import type { Provider } from "./providers";

/** Maps a synthetic event type to its stage index (0-based). -1 if none. */
export function eventToStage(eventType: string): number {
  const m = /^cp\.stage\.(\d+)$/.exec(eventType);
  if (m && m[1] !== undefined) {
    return Number(m[1]);
  }
  return -1;
}

/** Human-readable verb for the active stage of a provider, for the run button. */
export function stageVerb(provider: Provider, stageIndex: number): string {
  const s = provider.stages[stageIndex];
  return s ? `${s.verb}…` : "Retrieving…";
}

/** True if the event type signals a terminal error state. */
export function isErrorEvent(eventType: string): boolean {
  return /\.err$|\.error$|\.empty$/.test(eventType);
}
