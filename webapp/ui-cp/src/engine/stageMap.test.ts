import { describe, it, expect } from "vitest";
import { eventToStage, isErrorEvent, stageVerb } from "./stageMap";
import { PROVIDERS } from "./providers";

describe("eventToStage", () => {
  it("extracts the stage index from a cp.stage.N event", () => {
    expect(eventToStage("cp.stage.0")).toBe(0);
    expect(eventToStage("cp.stage.4")).toBe(4);
  });

  it("returns -1 for non-stage events", () => {
    expect(eventToStage("cp.done")).toBe(-1);
    expect(eventToStage("")).toBe(-1);
  });
});

describe("isErrorEvent", () => {
  it("flags terminal error/empty events", () => {
    expect(isErrorEvent("cp.stage.2.err")).toBe(true);
    expect(isErrorEvent("cp.result.empty")).toBe(true);
    expect(isErrorEvent("cp.stage.2")).toBe(false);
  });
});

describe("stageVerb", () => {
  it("returns the provider's stage verb with an ellipsis", () => {
    expect(stageVerb(PROVIDERS.swa, 0).endsWith("…")).toBe(true);
  });

  it("falls back to a generic verb when the index is out of range", () => {
    expect(stageVerb(PROVIDERS.swa, 999)).toBe("Retrieving…");
  });
});
