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
  userAgent: "",
  proxyMode: "system",
  proxyUrl: "",
  autoCategorize: false,
  categoryRules: [
    { pattern: "mp4,mkv,avi,mov,webm,flv", folder: "Videos" },
    { pattern: "mp3,wav,flac,ogg,m4a,aac", folder: "Music" },
    { pattern: "jpg,jpeg,png,gif,webp,svg,bmp,heic", folder: "Images" },
    { pattern: "zip,rar,7z,tar,gz,bz2,xz", folder: "Archives" },
    { pattern: "pdf,doc,docx,xls,xlsx,ppt,pptx,txt,epub,mobi", folder: "Documents" },
    { pattern: "exe,msi,dmg,appimage,apk", folder: "Apps" },
    { pattern: "iso,img", folder: "Disk Images" },
  ],
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
