import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tag } from "./Tag";

describe("Tag", () => {
  it("renders its children", () => {
    render(<Tag tone="success">operational</Tag>);
    expect(screen.getByText("operational")).toBeTruthy();
  });

  it("fires onRemove when the remove button is clicked", () => {
    const onRemove = vi.fn();
    render(<Tag onRemove={onRemove}>closable</Tag>);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
