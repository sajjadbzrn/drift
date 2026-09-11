import { describe, test, expect, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SortMenu } from "./SortMenu";

afterEach(() => {
  cleanup();
});

const OPTIONS = [
  { value: "queue", label: "Queue order" },
  { value: "date", label: "Newest" },
  { value: "size", label: "Largest" },
  { value: "speed", label: "Fastest" },
];

describe("SortMenu", () => {
  test("renders the trigger button with current value label", () => {
    render(
      <SortMenu
        value="date"
        options={OPTIONS}
        onSort={() => {}}
        ariaLabel="Sort by"
      />,
    );
    expect(screen.getByText("Newest")).toBeInTheDocument();
    expect(screen.getByText("Sort by")).toBeInTheDocument();
  });

  test("opens the dropdown on click", () => {
    render(
      <SortMenu
        value="queue"
        options={OPTIONS}
        onSort={() => {}}
        ariaLabel="Sort by"
      />,
    );
    const trigger = screen.getByRole("button", { name: /sort by/i });
    fireEvent.click(trigger);

    // All options should be visible
    expect(screen.getByRole("option", { name: /queue order/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /newest/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /largest/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /fastest/i })).toBeInTheDocument();
  });

  test("calls onSort when an option is clicked", () => {
    const sorted: string[] = [];
    render(
      <SortMenu
        value="queue"
        options={OPTIONS}
        onSort={(v) => sorted.push(v)}
        ariaLabel="Sort by"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /sort by/i }));
    fireEvent.click(screen.getByRole("option", { name: /largest/i }));

    expect(sorted).toEqual(["size"]);
  });

  test("marks the current option as selected", () => {
    render(
      <SortMenu
        value="speed"
        options={OPTIONS}
        onSort={() => {}}
        ariaLabel="Sort by"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /sort by/i }));

    const speedOption = screen.getByRole("option", { name: /fastest/i });
    expect(speedOption).toHaveAttribute("aria-selected", "true");

    const dateOption = screen.getByRole("option", { name: /newest/i });
    expect(dateOption).toHaveAttribute("aria-selected", "false");
  });

  test("closes dropdown after selecting an option", () => {
    render(
      <SortMenu
        value="queue"
        options={OPTIONS}
        onSort={() => {}}
        ariaLabel="Sort by"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /sort by/i }));
    expect(screen.getByRole("option", { name: /newest/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: /newest/i }));

    // Dropdown should be closed — options no longer in DOM
    expect(screen.queryByRole("option", { name: /newest/i })).not.toBeInTheDocument();
  });

  test("closes dropdown on Escape key", () => {
    render(
      <SortMenu
        value="queue"
        options={OPTIONS}
        onSort={() => {}}
        ariaLabel="Sort by"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /sort by/i }));
    expect(screen.getByRole("option", { name: /newest/i })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("option", { name: /newest/i })).not.toBeInTheDocument();
  });

  test("toggle button aria-expanded reflects open state", () => {
    render(
      <SortMenu
        value="queue"
        options={OPTIONS}
        onSort={() => {}}
        ariaLabel="Sort by"
      />,
    );
    const trigger = screen.getByRole("button", { name: /sort by/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
