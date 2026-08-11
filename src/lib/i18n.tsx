import { createContext, useContext, useMemo, type ReactNode } from "react";

export type Lang = "en" | "fa";

type Params = Record<string, string | number>;
type Tpl = string | ((p: Params) => string);

/**
 * Translation dictionary. Values can be plain strings with {param}
 * placeholders or functions that receive params (used for plurals).
 */
const DICT: Record<Lang, Record<string, Tpl>> = {
  en: {
    // app shell
    appName: "drift",
    tagline: "download manager",
    library: "Library",
    allDownloads: "All downloads",
    active: "Active",
    completed: "Completed",
    paused: "Paused",
    failed: "Failed",
    downloadsTitle: "Downloads",
    items: (p) => `${p.n} item${Number(p.n) === 1 ? "" : "s"}`,
    clearFinished: "Clear finished",
    searchPlaceholder: "Search…",

    // titlebar
    minimize: "Minimize",
    maximize: "Maximize",
    restore: "Restore",
    close: "Close",

    // sidebar stats
    downloading: "Downloading",
    idle: "Idle",
    activeTransfers: (p) => `${p.n} active transfer${Number(p.n) === 1 ? "" : "s"}`,
    noActiveTransfers: "No active transfers",
    total: "Total",
    peak: "Peak",
    totalTitle: "Total bytes of active downloads",
    peakTitle: "Peak speed while downloading",
    pauseAll: "Pause all",
    resumeAll: "Resume all",
    pauseAllTitle: "Pause all active downloads",
    resumeAllTitle: "Resume all paused downloads",
    concurrent: "Concurrent",
    concurrentTitle: (p) => `Max ${p.n} downloads at once`,
    toggleTheme: "Toggle theme",
    settings: "Settings",

    // new download bar
    chooseFolderTitle: "Choose download folder",
    folderPickerError: "Could not open folder picker",
    invalidUrl: "Enter a valid http(s) URL",
    alreadyExists: "This URL is already in your downloads",
    saveAs: "Save download as",
    startFailed: "Failed to start download: {err}",
    urlCopied: "URL copied to clipboard",
    download: "Download",
    urlsDetected: (p) => `${p.n} URL${Number(p.n) === 1 ? "" : "s"} detected`,
    skipUrl: "Skip this URL",
    clearBatch: "Clear batch",
    moreUrls: (p) => `+${p.n} more…`,
    downloadAll: (p) => `Download all (${p.n})`,
    adding: "Adding…",
    urlPlaceholder: "Paste a link to download… (one per line for batch)",
    limitPlaceholder: "Limit",
    limitTitle: "Optional speed limit in MB/s",
    checking: "Checking…",
    chooseFolder: "Choose a folder",
    chooseFolderFirst: "Choose a download folder first",
    change: "Change",
    cappedAt: "Capped at {v}/s",
    autoSaving: "Auto-saving to folder",
    noLimit: "No speed limit",

    // download card
    badgeQueued: "Queued",
    badgeDownloading: "Downloading",
    badgeRetrying: (p) => `Retrying… (${p.n})`,
    badgePaused: "Paused",
    badgeDone: "Done",
    badgeCancelled: "Cancelled",
    badgeFailed: "Failed",
    segmentedTitle: "Multi-connection download",
    speedLimitChip: "≤ {v}/s",
    speedLimitChipTitle: "Per-download speed limit",
    queuePosTitle: (p) => `#${p.n} in queue`,
    of: "of",
    determiningSize: "determining size…",
    downloaded: (p) => `${p.v} downloaded`,
    remaining: (p) => `${p.v} remaining`,
    left: (p) => `${p.v} left`,
    savedOf: (p) => `${p.a} of ${p.b} saved`,
    resumable: (p) => `Resumable — ${p.v} saved`,

    // card actions
    pause: "Pause",
    resume: "Resume",
    tryAgain: "Try again",
    cancel: "Cancel",
    openFile: "Open file",
    showInFolder: "Show in folder",
    copyLink: "Copy link",
    remove: "Remove",

    // context menu
    moveUp: "Move up",
    moveDown: "Move down",
    startNow: "Start now",
    setSpeedLimit: "Set speed limit…",

    // selection toolbar
    nSelected: (p) => `${p.n} selected`,
    clearSelection: "Clear selection",

    // speed limit editor
    speedLimitTitle: "Speed limit",
    speedLimitDesc: "MB/s cap for this download. 0 removes the limit.",
    unlimited: "Unlimited",
    speedLimitSaved: "Speed limit updated",

    // empty states
    emptyAllTitle: "No downloads yet",
    emptyAllSub: "Paste a link above to start your first download.",
    emptyActiveTitle: "Nothing in progress",
    emptyActiveSub: "Active and queued downloads will show up here.",
    emptyCompletedTitle: "No completed downloads",
    emptyCompletedSub: "Finished files will be listed here.",
    emptyPausedTitle: "Nothing paused",
    emptyPausedSub: "Paused downloads wait here until you resume them.",
    emptyFailedTitle: "No failed downloads",
    emptyFailedSub: "Failed or cancelled downloads show up here.",

    // notifications
    downloadingToast: "Downloading {name}",
    couldNotStart: "Could not start download: {err}",
    linkCopied: "Link copied to clipboard",
    couldNotCopy: "Could not copy link",
    couldNotOpenFile: "Could not open file",
    couldNotOpenFolder: "Could not open folder",
    waitFolder: "Opening folder — wait a moment before opening another",
    deleteConfirm: (p) => `Delete "${p.name}" from your disk?`,
    removeTitle: "Remove download",
    removedToast: "Removed {name}",
    undo: "Undo",
    clearFinishedDeleteConfirm: (p) =>
      `Remove ${p.n} finished download${Number(p.n) === 1 ? "" : "s"}? Files will be deleted from disk.`,
    clearFinishedListConfirm: (p) =>
      `Remove ${p.n} finished download${Number(p.n) === 1 ? "" : "s"} from the list?`,
    clearFinishedTitle: "Clear finished",
    clearedToast: (p) => `Cleared ${p.n} finished download${Number(p.n) === 1 ? "" : "s"}`,

    // file kinds
    kindImage: "image",
    kindVideo: "video",
    kindAudio: "audio",
    kindArchive: "archive",
    kindCode: "code",
    kindDoc: "doc",
    kindPdf: "pdf",
    kindApp: "app",
    kindSheet: "spreadsheet",
    kindSlides: "presentation",
    kindFile: "file",

    // time units
    hourUnit: "h",
    minuteUnit: "m",
    secondUnit: "s",
    perSec: "/s",

    // settings
    settingsTitle: "Settings",
    appearance: "Appearance",
    language: "Language",
    languageDesc: "Interface language",
    themeSystem: "System",
    themeDark: "Dark",
    themeLight: "Light",
    speed: "Speed",
    globalLimit: "Global speed limit",
    globalLimitDesc:
      "Total bandwidth cap across all downloads. 0 = unlimited.",
    defaultLimit: "Default per-download limit",
    defaultLimitDesc:
      "Speed cap applied to new downloads. 0 = unlimited.",
    maxConcurrent: "Max concurrent downloads",
    maxConcurrentDesc: "How many files download at the same time.",
    filesUnit: "files",
    downloadingSection: "Downloading",
    segmented: "Segmented downloads",
    segmentedDesc: (p) =>
      `Split large files into parallel connections (files > ${p.size}).`,
    autoRetry: "Auto-retry failures",
    autoRetryDesc:
      "Automatically retry transient errors with backoff.",
    maxRetries: "Max retries",
    maxRetriesDesc: "How many times to retry before giving up.",
    saving: "Saving",
    autoSave: "Save without asking",
    autoSaveDesc:
      "Skip the save dialog and write straight into your chosen folder with the server-provided filename.",
    systemSection: "System",
    closeToTray: "Close to tray",
    closeToTrayDesc:
      "Closing the window keeps downloads running in the background. Use Quit from the tray icon to exit drift.",
    cleanup: "Cleanup",
    deleteWithRemove: "Delete file when removing",
    deleteWithRemoveDesc:
      "Permanently delete the downloaded file (and partial data) when you remove an item.",
    about: "About",
    aboutSub: "Fast, modern download manager",
    allRights: "All rights reserved",
    eula: "End User License Agreement",
    licenseLoading: "Loading license…",
    licenseError: "The license text could not be loaded.",

    // updates
    updates: "Updates",
    checkForUpdates: "Check for updates",
    checkingForUpdates: "Checking for updates…",
    upToDate: "You're on the latest version",
    currentVersion: "Current version",
    updateAvailable: (p) => `Update v${p.version} is available`,
    updateNow: "Update now",
    downloadingUpdate: (p) => `Downloading update… ${p.pct}%`,
    installing: "Installing update…",
    relaunching: "Relaunching…",
    updateCheckFailed: "Could not check for updates: {err}",
    updateFailed: "Update failed: {err}",
    releaseNotes: "Release notes",
    updateToast: (p) => `Update v${p.version} is available`,

    // browser integration (native messaging host)
    browserIntegration: "Browser integration",
    extensionHost: "Extension host",
    extensionHostDesc:
      "Lets the Chrome/Firefox extension detect drift and hand downloads to it.",
    hostRegistered: "Registered",
    hostNotRegistered: "Not registered",
    chromeExtIds: "Chrome extension ID",
    chromeExtIdsDesc:
      "Paste your Chrome extension's ID (chrome://extensions → this extension) so Chrome is allowed to talk to drift. Firefox connects automatically.",
    save: "Save",

    // network
    network: "Network",
    userAgent: "User-Agent",
    userAgentDesc:
      "Sent with download requests. Some sites block drift's default agent; leave empty for the default.",
    userAgentPlaceholder: "Leave empty for the default",
    uaReset: "Reset",

    // toasts
    dismiss: "Dismiss",
  },

  fa: {
    // app shell
    appName: "دریفت",
    tagline: "مدیر دانلود",
    library: "کتابخانه",
    allDownloads: "همه دانلودها",
    active: "در حال انجام",
    completed: "تکمیل‌شده",
    paused: "متوقف",
    failed: "ناموفق",
    downloadsTitle: "دانلودها",
    items: (p) => `${p.n} مورد`,
    clearFinished: "پاک‌کردن موارد کامل",
    searchPlaceholder: "جستجو…",

    // titlebar
    minimize: "کوچک‌کردن",
    maximize: "بزرگ‌کردن",
    restore: "بازگردانی",
    close: "بستن",

    // sidebar stats
    downloading: "در حال دانلود",
    idle: "آماده",
    activeTransfers: (p) => `${p.n} انتقال فعال`,
    noActiveTransfers: "هیچ انتقال فعالی نیست",
    total: "مجموع",
    peak: "حداکثر",
    totalTitle: "حجم کل دانلودهای فعال",
    peakTitle: "بیشترین سرعت هنگام دانلود",
    pauseAll: "توقف همه",
    resumeAll: "ادامه همه",
    pauseAllTitle: "توقف همه دانلودهای فعال",
    resumeAllTitle: "ادامه همه دانلودهای متوقف",
    concurrent: "همزمان",
    concurrentTitle: (p) => `حداکثر ${p.n} دانلود همزمان`,
    toggleTheme: "تغییر تم",
    settings: "تنظیمات",

    // new download bar
    chooseFolderTitle: "انتخاب پوشه دانلود",
    folderPickerError: "باز کردن انتخاب‌گر پوشه ممکن نشد",
    invalidUrl: "یک URL معتبر (http/https) وارد کنید",
    alreadyExists: "این URL قبلاً در دانلودهای شماست",
    saveAs: "ذخیره دانلود به‌عنوان",
    startFailed: "شروع دانلود ناموفق بود: {err}",
    urlCopied: "URL در کلیپ‌بورد کپی شد",
    download: "دانلود",
    urlsDetected: (p) => `${p.n} URL شناسایی شد`,
    skipUrl: "رد شدن از این URL",
    clearBatch: "پاک‌کردن دسته",
    moreUrls: (p) => `+${p.n} مورد دیگر…`,
    downloadAll: (p) => `دانلود همه (${p.n})`,
    adding: "در حال افزودن…",
    urlPlaceholder: "لینک دانلود را اینجا جای‌گذاری کنید… (برای چند دانلود، هر خط یک لینک)",
    limitPlaceholder: "محدودیت",
    limitTitle: "محدودیت سرعت اختیاری بر حسب MB/s",
    checking: "در حال بررسی…",
    chooseFolder: "انتخاب پوشه",
    chooseFolderFirst: "ابتدا یک پوشه دانلود انتخاب کنید",
    change: "تغییر",
    cappedAt: "محدود به {v} بر ثانیه",
    autoSaving: "ذخیره خودکار در پوشه",
    noLimit: "بدون محدودیت سرعت",

    // download card
    badgeQueued: "در صف",
    badgeDownloading: "در حال دانلود",
    badgeRetrying: (p) => `تلاش دوباره… (${p.n})`,
    badgePaused: "متوقف",
    badgeDone: "انجام شد",
    badgeCancelled: "لغو شد",
    badgeFailed: "ناموفق",
    segmentedTitle: "دانلود چنداتصالی",
    speedLimitChip: "حداکثر {v}/ث",
    speedLimitChipTitle: "محدودیت سرعت این دانلود",
    of: "از",
    determiningSize: "در حال تعیین اندازه…",
    downloaded: (p) => `${p.v} دانلود شد`,
    remaining: (p) => `${p.v} مانده`,
    left: (p) => `${p.v} مانده`,
    savedOf: (p) => `${p.a} از ${p.b} ذخیره شد`,
    resumable: (p) => `قابل ادامه — ${p.v} ذخیره شد`,

    // card actions
    pause: "توقف",
    resume: "ادامه",
    tryAgain: "تلاش دوباره",
    cancel: "لغو",
    openFile: "باز کردن فایل",
    showInFolder: "نمایش در پوشه",
    copyLink: "کپی لینک",
    remove: "حذف",

    // context menu
    moveUp: "انتقال به بالا",
    moveDown: "انتقال به پایین",
    startNow: "شروع فوری",
    setSpeedLimit: "محدودیت سرعت…",

    // selection toolbar
    nSelected: (p) => `${p.n} انتخاب شده`,
    clearSelection: "پاک‌کردن انتخاب",

    // speed limit editor
    speedLimitTitle: "محدودیت سرعت",
    speedLimitDesc: "سقف سرعت این دانلود بر حسب MB/s. ۰ یعنی بدون محدودیت.",
    unlimited: "بدون محدودیت",
    speedLimitSaved: "محدودیت سرعت به‌روزرسانی شد",

    // empty states
    emptyAllTitle: "هنوز دانلودی ندارید",
    emptyAllSub: "برای اولین دانلود، یک لینک در بالا جای‌گذاری کنید.",
    emptyActiveTitle: "هیچ دانلودی در حال انجام نیست",
    emptyActiveSub: "دانلودهای فعال و در صف اینجا نمایش داده می‌شوند.",
    emptyCompletedTitle: "دانلود تکمیل‌شده‌ای نیست",
    emptyCompletedSub: "فایل‌های تکمیل‌شده اینجا فهرست می‌شوند.",
    emptyPausedTitle: "هیچ دانلودی متوقف نیست",
    emptyPausedSub: "دانلودهای متوقف تا ادامه‌دادن، اینجا می‌مانند.",
    emptyFailedTitle: "دانلود ناموفقی نیست",
    emptyFailedSub: "دانلودهای ناموفق یا لغوشده اینجا نمایش داده می‌شوند.",

    // notifications
    downloadingToast: "در حال دانلود {name}",
    couldNotStart: "شروع دانلود ممکن نشد: {err}",
    linkCopied: "لینک در کلیپ‌بورد کپی شد",
    couldNotCopy: "کپی لینک ممکن نشد",
    couldNotOpenFile: "باز کردن فایل ممکن نشد",
    couldNotOpenFolder: "باز کردن پوشه ممکن نشد",
    waitFolder: "در حال باز کردن پوشه — لطفاً کمی صبر کنید",
    deleteConfirm: (p) => `«${p.name}» از دیسک حذف شود؟`,
    removeTitle: "حذف دانلود",
    removedToast: "حذف شد: {name}",
    undo: "برگرداندن",
    clearFinishedDeleteConfirm: (p) =>
      `${p.n} دانلود کامل حذف شود؟ فایل‌ها از دیسک پاک خواهند شد.`,
    clearFinishedListConfirm: (p) => `${p.n} دانلود کامل از فهرست حذف شود؟`,
    clearFinishedTitle: "پاک‌کردن موارد کامل",
    clearedToast: (p) => `${p.n} دانلود کامل پاک شد`,

    // file kinds
    kindImage: "تصویر",
    kindVideo: "ویدیو",
    kindAudio: "صدا",
    kindArchive: "آرشیو",
    kindCode: "کد",
    kindDoc: "متن",
    kindPdf: "PDF",
    kindApp: "برنامه",
    kindSheet: "صفحه‌گسترده",
    kindSlides: "ارائه",
    kindFile: "فایل",

    // time units
    hourUnit: "ساعت",
    minuteUnit: "دقیقه",
    secondUnit: "ثانیه",
    perSec: "/ث",

    // settings
    settingsTitle: "تنظیمات",
    appearance: "ظاهر",
    language: "زبان",
    languageDesc: "زبان رابط کاربری",
    themeSystem: "سیستم",
    themeDark: "تیره",
    themeLight: "روشن",
    speed: "سرعت",
    globalLimit: "محدودیت سرعت کلی",
    globalLimitDesc: "سقف پهنای باند همه دانلودها. ۰ = نامحدود.",
    defaultLimit: "محدودیت پیش‌فرض هر دانلود",
    defaultLimitDesc: "سقف سرعت اعمال‌شده روی دانلودهای جدید. ۰ = نامحدود.",
    maxConcurrent: "حداکثر دانلود همزمان",
    maxConcurrentDesc: "چند فایل همزمان دانلود شوند.",
    filesUnit: "فایل",
    downloadingSection: "دانلود",
    segmented: "دانلود تقسیم‌شده",
    segmentedDesc: (p) =>
      `فایل‌های بزرگ به چند اتصال موازی تقسیم می‌شوند (فایل‌های بزرگ‌تر از ${p.size}).`,
    autoRetry: "تلاش دوباره خودکار",
    autoRetryDesc: "خطاهای موقتی به‌صورت خودکار با تأخیر دوباره امتحان می‌شوند.",
    maxRetries: "حداکثر تلاش‌ها",
    maxRetriesDesc: "قبل از رهاکردن، چند بار تلاش شود.",
    saving: "ذخیره‌سازی",
    autoSave: "ذخیره بدون پرسیدن",
    autoSaveDesc:
      "بدون نمایش پنجره ذخیره، مستقیم با نام فایل سرور در پوشه انتخابی شما ذخیره می‌شود.",
    systemSection: "سیستم",
    closeToTray: "بستن به سینی",
    closeToTrayDesc:
      "با بستن پنجره، دانلودها در پس‌زمینه ادامه می‌یابند. برای خروج از دریفت، از گزینه «خروج» در سینی استفاده کنید.",
    cleanup: "پاک‌سازی",
    deleteWithRemove: "حذف فایل هنگام حذف از فهرست",
    deleteWithRemoveDesc:
      "هنگام حذف یک مورد، فایل دانلودشده (و داده ناقص) به‌طور دائمی حذف شود.",
    about: "درباره",
    aboutSub: "مدیر دانلود سریع و مدرن",
    allRights: "کلیه حقوق محفوظ است",
    eula: "قرارداد مجوز کاربر نهایی",
    licenseLoading: "در حال بارگذاری مجوز…",
    licenseError: "متن مجوز قابل بارگذاری نیست.",

    // updates
    updates: "به‌روزرسانی",
    checkForUpdates: "بررسی به‌روزرسانی",
    checkingForUpdates: "در حال بررسی به‌روزرسانی…",
    upToDate: "نسخه شما به‌روز است",
    currentVersion: "نسخه فعلی",
    updateAvailable: (p) => `نسخه ${p.version} در دسترس است`,
    updateNow: "به‌روزرسانی الآن",
    downloadingUpdate: (p) => `در حال دانلود به‌روزرسانی… ${p.pct}٪`,
    installing: "در حال نصب به‌روزرسانی…",
    relaunching: "در حال راه‌اندازی مجدد…",
    updateCheckFailed: "بررسی به‌روزرسانی ممکن نشد: {err}",
    updateFailed: "به‌روزرسانی ناموفق بود: {err}",
    releaseNotes: "یادداشت‌های نسخه",
    updateToast: (p) => `نسخه ${p.version} در دسترس است`,

    // browser integration (native messaging host)
    browserIntegration: "اتصال به مرورگر",
    extensionHost: "میزبان افزونه",
    extensionHostDesc:
      "به افزونه کروم/فایرفاکس اجازه می‌دهد دریفت را شناسایی و دانلودها را به آن ارسال کند.",
    hostRegistered: "ثبت شده",
    hostNotRegistered: "ثبت نشده",
    chromeExtIds: "شناسه افزونه کروم",
    chromeExtIdsDesc:
      "شناسه افزونه کروم خود را وارد کنید (chrome://extensions → همین افزونه) تا کروم اجازه ارتباط با دریفت را داشته باشد. فایرفاکس خودکار متصل می‌شود.",
    save: "ذخیره",

    // network
    network: "شبکه",
    userAgent: "User-Agent",
    userAgentDesc:
      "همراه درخواست‌های دانلود ارسال می‌شود. برخی سایت‌ها عامل پیش‌فرض دریفت را مسدود می‌کنند؛ خالی = پیش‌فرض.",
    userAgentPlaceholder: "برای پیش‌فرض خالی بگذارید",
    uaReset: "بازنشانی",

    // toasts
    dismiss: "بستن",
  },
};

function fmt(tpl: Tpl, params?: Params): string {
  if (typeof tpl === "function") return tpl(params ?? {});
  return tpl.replace(/\{(\w+)\}/g, (_, k) =>
    params && k in params ? String(params[k]) : `{${k}}`,
  );
}

export function makeT(lang: Lang) {
  const dict = DICT[lang];
  const fallback = DICT.en;
  return (key: string, params?: Params): string => {
    const tpl = dict[key] ?? fallback[key];
    return fmt(tpl ?? key, params);
  };
}

export type T = ReturnType<typeof makeT>;

// ---------------------------------------------------------------- numbers

let activeLang: Lang = "en";

export function setActiveLang(l: Lang) {
  activeLang = l;
}

export function getActiveLang(): Lang {
  return activeLang;
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Convert ASCII digits (and optionally ".") in a number string to Persian. */
export function localize(s: string, decimal = true): string {
  if (activeLang !== "fa") return s;
  let out = s.replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
  if (decimal) out = out.replace(/\./g, "٫");
  return out;
}

/** Format a raw number (percent, count, …) in the active locale. */
export function num(n: number | string): string {
  return localize(String(n));
}

// ---------------------------------------------------------------- context

const I18nCtx = createContext<T>(() => "");

export function I18nProvider({
  lang,
  children,
}: {
  lang: Lang;
  children: ReactNode;
}) {
  const t = useMemo(() => makeT(lang), [lang]);
  return <I18nCtx.Provider value={t}>{children}</I18nCtx.Provider>;
}

export function useI18n(): T {
  return useContext(I18nCtx);
}
