import { describe, test, expect, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ToastStack, pushToast, dismissToast } from "./Toasts";
import { I18nProvider } from "../lib/i18n";
import type { Toast } from "../types";
import type { Dispatch, SetStateAction } from "react";

function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider lang="en">{children}</I18nProvider>;
}

// Helper to render ToastStack with state management
function ToastHarness({
  initialToasts,
  onDismiss,
}: {
  initialToasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <Wrapper>
      <ToastStack toasts={initialToasts} onDismiss={onDismiss} />
    </Wrapper>
  );
}

afterEach(() => {
  cleanup();
});

describe("ToastStack", () => {
  test("renders empty when no toasts", () => {
    const { container } = render(
      <ToastHarness initialToasts={[]} onDismiss={() => {}} />,
    );
    expect(container.querySelector(".toasts")).toBeInTheDocument();
    expect(container.querySelectorAll(".toast").length).toBe(0);
  });

  test("renders a single toast", () => {
    const toasts: Toast[] = [
      { id: 1, msg: "Download started", kind: "info" },
    ];
    render(<ToastHarness initialToasts={toasts} onDismiss={() => {}} />);
    expect(screen.getByText("Download started")).toBeInTheDocument();
  });

  test("renders multiple toasts", () => {
    const toasts: Toast[] = [
      { id: 1, msg: "First toast", kind: "info" },
      { id: 2, msg: "Second toast", kind: "success" },
      { id: 3, msg: "Third toast", kind: "error" },
    ];
    render(<ToastHarness initialToasts={toasts} onDismiss={() => {}} />);
    expect(screen.getByText("First toast")).toBeInTheDocument();
    expect(screen.getByText("Second toast")).toBeInTheDocument();
    expect(screen.getByText("Third toast")).toBeInTheDocument();
  });

  test("applies kind-based CSS class", () => {
    const toasts: Toast[] = [
      { id: 1, msg: "Success!", kind: "success" },
    ];
    const { container } = render(
      <ToastHarness initialToasts={toasts} onDismiss={() => {}} />,
    );
    const toast = container.querySelector(".toast");
    expect(toast).toHaveClass("toast-success");
  });

  test("calls onDismiss when close button is clicked", () => {
    const dismissed: number[] = [];
    const toasts: Toast[] = [
      { id: 1, msg: "Dismiss me", kind: "info" },
    ];
    render(
      <ToastHarness
        initialToasts={toasts}
        onDismiss={(id) => dismissed.push(id)}
      />,
    );
    const closeBtn = screen.getByRole("button", { name: /dismiss/i });
    fireEvent.click(closeBtn);
    expect(dismissed).toEqual([1]);
  });

  test("renders action button when toast has an action", () => {
    const toasts: Toast[] = [
      {
        id: 1,
        msg: "Update available",
        kind: "info",
        action: { label: "Update now", onClick: () => {} },
      },
    ];
    render(<ToastHarness initialToasts={toasts} onDismiss={() => {}} />);
    expect(screen.getByText("Update now")).toBeInTheDocument();
  });

  test("action button calls its onClick and dismisses", () => {
    let actionClicked = false;
    const dismissed: number[] = [];
    const toasts: Toast[] = [
      {
        id: 1,
        msg: "Update available",
        kind: "info",
        action: {
          label: "Update now",
          onClick: () => {
            actionClicked = true;
          },
        },
      },
    ];
    render(
      <ToastHarness
        initialToasts={toasts}
        onDismiss={(id) => dismissed.push(id)}
      />,
    );
    fireEvent.click(screen.getByText("Update now"));
    expect(actionClicked).toBe(true);
    expect(dismissed).toEqual([1]);
  });
});

// ─── pushToast ──────────────────────────────────────────────────

describe("pushToast", () => {
  test("adds a toast with auto-incrementing id", () => {
    let toasts: Toast[] = [];
    const setter: Dispatch<SetStateAction<Toast[]>> = (fn) => {
      toasts = typeof fn === "function" ? fn(toasts) : fn;
    };

    pushToast(setter, "Hello", "info");
    expect(toasts.length).toBe(1);
    expect(toasts[0].msg).toBe("Hello");
    expect(toasts[0].kind).toBe("info");
    expect(typeof toasts[0].id).toBe("number");
  });

  test("appends to existing toasts", () => {
    let toasts: Toast[] = [];
    const setter: Dispatch<SetStateAction<Toast[]>> = (fn) => {
      toasts = typeof fn === "function" ? fn(toasts) : fn;
    };

    pushToast(setter, "First", "info");
    pushToast(setter, "Second", "success");
    expect(toasts.length).toBe(2);
    expect(toasts[0].msg).toBe("First");
    expect(toasts[1].msg).toBe("Second");
  });

  test("caps at 5 toasts (keeps last 5)", () => {
    let toasts: Toast[] = [];
    const setter: Dispatch<SetStateAction<Toast[]>> = (fn) => {
      toasts = typeof fn === "function" ? fn(toasts) : fn;
    };

    for (let i = 0; i < 8; i++) {
      pushToast(setter, `Toast ${i}`, "info");
    }
    expect(toasts.length).toBe(5);
    expect(toasts[0].msg).toBe("Toast 3");
    expect(toasts[4].msg).toBe("Toast 7");
  });
});

// ─── dismissToast ───────────────────────────────────────────────

describe("dismissToast", () => {
  test("removes a toast by id", () => {
    let toasts: Toast[] = [
      { id: 1, msg: "Keep", kind: "info" },
      { id: 2, msg: "Remove", kind: "error" },
      { id: 3, msg: "Also keep", kind: "success" },
    ];
    const setter: Dispatch<SetStateAction<Toast[]>> = (fn) => {
      toasts = typeof fn === "function" ? fn(toasts) : fn;
    };

    dismissToast(setter, 2);
    expect(toasts.length).toBe(2);
    expect(toasts.find((t) => t.id === 2)).toBeUndefined();
  });

  test("is a no-op for non-existent id", () => {
    let toasts: Toast[] = [
      { id: 1, msg: "Keep", kind: "info" },
    ];
    const setter: Dispatch<SetStateAction<Toast[]>> = (fn) => {
      toasts = typeof fn === "function" ? fn(toasts) : fn;
    };

    dismissToast(setter, 999);
    expect(toasts.length).toBe(1);
  });
});
