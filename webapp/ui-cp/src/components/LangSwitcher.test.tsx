import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LangSwitcher } from "./LangSwitcher";

describe("LangSwitcher", () => {
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom's location.reload is a no-op stub that warns; replace it with a spy.
    reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload },
      writable: true,
    });
    document.cookie = "lang=; path=/; max-age=0";
  });

  afterEach(() => {
    document.cookie = "lang=; path=/; max-age=0";
  });

  it("renders EN/ES/PT with the active locale marked", () => {
    render(<LangSwitcher />);
    for (const label of ["EN", "ES", "PT"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    // jsdom navigator.language defaults to en-US, so English is active.
    expect(screen.getByRole("button", { name: "EN" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "ES" }).getAttribute("aria-current")).toBeNull();
  });

  it("writes the shared cookie and reloads when switching to a new locale", () => {
    render(<LangSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "ES" }));
    expect(document.cookie).toContain("lang=es-419");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload when clicking the already-active locale", () => {
    render(<LangSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(reload).not.toHaveBeenCalled();
  });
});
