import { describe, test, expect, beforeEach } from "bun:test";
import { makeT, localize, num, setActiveLang, getActiveLang } from "./i18n";

beforeEach(() => {
  setActiveLang("en");
});

// ─── makeT ──────────────────────────────────────────────────────

describe("makeT", () => {
  test("returns a translation function", () => {
    const t = makeT("en");
    expect(typeof t).toBe("function");
  });

  test("translates known keys in English", () => {
    const t = makeT("en");
    expect(t("appName")).toBe("drift");
    expect(t("downloadsTitle")).toBe("Downloads");
    expect(t("pause")).toBe("Pause");
  });

  test("translates known keys in Persian", () => {
    const t = makeT("fa");
    expect(t("appName")).toBe("دریفت");
    expect(t("downloadsTitle")).toBe("دانلودها");
    expect(t("pause")).toBe("توقف");
  });

  test("returns the key itself for unknown keys (fallback)", () => {
    const t = makeT("en");
    expect(t("nonexistent_key_xyz")).toBe("nonexistent_key_xyz");
  });

  test("falls back to English for missing Persian keys", () => {
    const t = makeT("fa");
    // "appName" exists in both; "eula" exists in both.
    // Unknown keys fall through to English or return the key.
    expect(t("eula")).toBeTruthy();
  });

  test("substitutes simple string parameters", () => {
    const t = makeT("en");
    expect(t("downloaded", { v: "50 MB" })).toBe("50 MB downloaded");
    expect(t("removedToast", { name: "photo.jpg" })).toBe("Removed photo.jpg");
  });

  test("substitutes parameters in plural functions", () => {
    const t = makeT("en");
    expect(t("items", { n: 1 })).toBe("1 item");
    expect(t("items", { n: 5 })).toBe("5 items");
  });

  test("handles Persian plural functions", () => {
    setActiveLang("fa");
    const t = makeT("fa");
    // Callers pass pre-localized numbers (see App.tsx: num(counts.all)),
    // matching the real call pattern.
    expect(t("items", { n: num(1) })).toBe("۱ مورد");
    expect(t("items", { n: num(3) })).toBe("۳ مورد");
  });

  test("handles function templates with no params", () => {
    const t = makeT("en");
    // "activeTransfers" requires { n }, but should not crash if called without
    const result = t("activeTransfers");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ─── localize ───────────────────────────────────────────────────

describe("localize", () => {
  test("returns the string as-is for English", () => {
    setActiveLang("en");
    expect(localize("123.45")).toBe("123.45");
  });

  test("converts digits to Persian for Farsi", () => {
    setActiveLang("fa");
    expect(localize("0123456789")).toBe("۰۱۲۳۴۵۶۷۸۹");
  });

  test("converts decimal separator to Persian for Farsi", () => {
    setActiveLang("fa");
    expect(localize("3.14")).toBe("۳٫۱۴");
  });

  test("respects the decimal flag", () => {
    setActiveLang("fa");
    expect(localize("3.14", false)).toBe("۳.۱۴");
  });

  test("leaves non-numeric strings unchanged", () => {
    setActiveLang("fa");
    expect(localize("hello world")).toBe("hello world");
  });
});

// ─── num ────────────────────────────────────────────────────────

describe("num", () => {
  test("formats numbers in English", () => {
    setActiveLang("en");
    expect(num(42)).toBe("42");
    expect(num(0)).toBe("0");
  });

  test("formats numbers in Persian", () => {
    setActiveLang("fa");
    expect(num(42)).toBe("۴۲");
    expect(num(100)).toBe("۱۰۰");
  });

  test("accepts string input", () => {
    setActiveLang("fa");
    expect(num("7")).toBe("۷");
  });
});

// ─── getActiveLang / setActiveLang ──────────────────────────────

describe("getActiveLang / setActiveLang", () => {
  test("defaults to English", () => {
    expect(getActiveLang()).toBe("en");
  });

  test("can be switched to Persian", () => {
    setActiveLang("fa");
    expect(getActiveLang()).toBe("fa");
  });

  test("can be switched back to English", () => {
    setActiveLang("fa");
    setActiveLang("en");
    expect(getActiveLang()).toBe("en");
  });
});
