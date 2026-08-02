import { useEffect, useState } from "react";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { looksLikeUrl } from "../lib/format";

export interface ClipboardHit {
  url: string;
  at: number;
}

export function useClipboard(enabled: boolean) {
  const [hit, setHit] = useState<ClipboardHit | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let lastSeen = "";

    const tick = async () => {
      try {
        const text = (await readText()).trim();
        if (text && text !== lastSeen && looksLikeUrl(text)) {
          lastSeen = text;
          if (!disposed) setHit({ url: text, at: Date.now() });
        }
      } catch {
        // clipboard unavailable — ignore
      }
    };

    const iv = setInterval(tick, 1500);
    void tick();
    return () => {
      disposed = true;
      clearInterval(iv);
    };
  }, [enabled]);

  return { hit, clear: () => setHit(null) };
}
