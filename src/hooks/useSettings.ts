import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/ipc";
import type { AppSettings } from "../types";

const DEFAULTS: AppSettings = {
  theme: "system",
  language: "en",
  globalSpeedLimit: 0,
  defaultSpeedLimit: 0,
  maxConcurrent: 3,
  segmented: true,
  autoRetry: true,
  maxRetries: 3,
  deleteWithRemove: true,
  lastSaveDir: null,
  autoSave: false,
  closeToTray: true,
  chromeExtIds: [],
};

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSettings({ ...DEFAULTS, ...s });
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      api.setSettings(next).catch(() => {});
      return next;
    });
  }, []);

  return { settings, update, loaded };
}
