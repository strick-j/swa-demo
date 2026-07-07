import { describe, it, expect } from "vitest";
import { setPace, getPace } from "./paceQueue";

describe("paceQueue setPace/getPace", () => {
  it("maps named paces to millisecond weights", () => {
    setPace("off");
    expect(getPace()).toBe(0);
    setPace("fast");
    expect(getPace()).toBe(150);
    setPace("medium");
    expect(getPace()).toBe(300);
    setPace("slow");
    expect(getPace()).toBe(600);
  });

  it("accepts a numeric pace and clamps negatives to 0", () => {
    setPace(420);
    expect(getPace()).toBe(420);
    setPace(-5);
    expect(getPace()).toBe(0);
  });

  it("parses numeric strings and falls back to 0 for junk", () => {
    setPace("250");
    expect(getPace()).toBe(250);
    setPace("nope");
    expect(getPace()).toBe(0);
  });
});
