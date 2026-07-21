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

  it("opens a globe menu listing the three locales with the active one checked", () => {
    render(<LangSwitcher />);
    // The menu is collapsed until the globe trigger is clicked.
    expect(screen.queryByRole("menuitemradio", { name: /English/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    for (const name of [/English/, /Español/, /Português/]) {
      expect(screen.getByRole("menuitemradio", { name })).toBeTruthy();
    }
    // jsdom navigator.language defaults to en-US, so English is active.
    expect(screen.getByRole("menuitemradio", { name: /English/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: /Español/ }).getAttribute("aria-checked")).toBe("false");
  });

  it("writes the shared cookie and reloads when switching to a new locale", () => {
    render(<LangSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Español/ }));
    expect(document.cookie).toContain("lang=es-419");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload when choosing the already-active locale", () => {
    render(<LangSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /English/ }));
    expect(reload).not.toHaveBeenCalled();
  });
});
