import { describe, it, expect } from "vitest";
import { providerFromPath, pmeta, PROVIDERS } from "./providers";

describe("providerFromPath", () => {
  it("selects the provider from the page path", () => {
    expect(providerFromPath("/swa").id).toBe("swa");
    expect(providerFromPath("/swa/").id).toBe("swa");
    expect(providerFromPath("/credential-providers").id).toBe("ccp");
    expect(providerFromPath("/cp").id).toBe("cp");
    expect(providerFromPath("/anything-else").id).toBe("cp"); // default
  });

  it("picks the Conjur mode from the URL hash", () => {
    expect(providerFromPath("/secrets-manager").id).toBe("conjur-jwt");
    expect(providerFromPath("/secrets-manager", "#iam").id).toBe("conjur-iam");
  });
});

describe("pmeta", () => {
  it("returns the requested scenario meta", () => {
    const m = pmeta(PROVIDERS.swa, "trusted");
    expect(m.ok).toBe(true);
    expect(m.failStage).toBe(-1);
  });

  it("falls back to the first scenario for a key the provider lacks", () => {
    // "no-cert" is a CCP scenario key, absent on the swa provider.
    expect(pmeta(PROVIDERS.swa, "no-cert").key).toBe("trusted");
  });
});
