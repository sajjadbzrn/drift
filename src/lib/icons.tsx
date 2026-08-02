import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

function base(props: P): P {
  return {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    ...props,
  };
}

export const ArrowDownIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 4v13" />
    <path d="m6 11 6 6 6-6" />
  </svg>
);

export const GridIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </svg>
);

export const ActivityIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 12h4l2.5-7 5 14L17 12h4" />
  </svg>
);

export const CheckCircleIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.5 2.5 2.5 4.5-5.5" />
  </svg>
);

export const PauseIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="7" y="5" width="3.5" height="14" rx="1" />
    <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
  </svg>
);

export const PlayIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m8 5.5 10 6.5-10 6.5z" />
  </svg>
);

export const XIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const RefreshIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 3v4h-4" />
  </svg>
);

export const TrashIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6.5 7 7.2 19a2 2 0 0 0 2 1.8h5.6a2 2 0 0 0 2-1.8L17.5 7" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const FolderIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17z" />
  </svg>
);

export const FileIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z" />
    <path d="M14 3.5V8h4.5" />
  </svg>
);

export const FileTextIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z" />
    <path d="M14 3.5V8h4.5" />
    <path d="M9 12.5h6M9 16h4" />
  </svg>
);

export const CodeIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m9 8-4.5 4L9 16" />
    <path d="m15 8 4.5 4L15 16" />
  </svg>
);

export const ImageIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m5 18 5-5 3.5 3.5L16 14l3 3.5" />
  </svg>
);

export const VideoIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="6" width="13" height="12" rx="2" />
    <path d="m16.5 10.5 4-2v7l-4-2" />
  </svg>
);

export const MusicIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 18V6l10-2v11.5" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="16.5" cy="15.5" r="2.5" />
  </svg>
);

export const ArchiveIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8h16v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" />
    <path d="M3 4.5h18v3.5H3z" />
    <path d="M10 12h4" />
  </svg>
);

export const AppIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3 20 7v10l-8 4-8-4V7z" />
    <path d="m4 7 8 4 8-4" />
    <path d="M12 11v10" />
  </svg>
);

export const CopyIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
  </svg>
);

export const LinkIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1.4 1.4" />
    <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1.4-1.4" />
  </svg>
);

export const SettingsIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.01a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
  </svg>
);

export const SunIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" />
  </svg>
);

export const MoonIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z" />
  </svg>
);

export const SearchIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const ClipboardIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="4.5" width="14" height="16" rx="2" />
    <path d="M9 4.5V3.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
    <path d="M9.5 12.5h5M9.5 16h3.5" />
  </svg>
);

export const BoltIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M13 2.5 4.5 13.5H11L9.5 21.5 19 10h-6.5z" />
  </svg>
);

export const ExternalIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M14 4h6v6" />
    <path d="M20 4 10.5 13.5" />
    <path d="M19 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5H10" />
  </svg>
);

export const SparklesIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3.5 13.8 8.2 18.5 10 13.8 11.8 12 16.5 10.2 11.8 5.5 10 10.2 8.2z" />
    <path d="M19 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" />
    <path d="M5.5 3l.6 1.4L7.5 5l-1.4.6L5.5 7l-.6-1.4L3.5 5l1.4-.6z" />
  </svg>
);

export const InboxIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 13.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-5.5" />
    <path d="M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20" />
    <path d="M4 13.5 5.5 5.5A1.5 1.5 0 0 1 7 4.5h10a1.5 1.5 0 0 1 1.5 1l1.5 8" />
  </svg>
);

export const ChevronUpIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 14 6-6 6 6" />
  </svg>
);

export const ChevronDownIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 10 6 6 6-6" />
  </svg>
);

export const ChevronsUpIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m7 11 5-5 5 5" />
    <path d="m7 19 5-5 5 5" />
  </svg>
);

export const PauseAllIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="5" width="3.5" height="14" rx="1" />
    <rect x="10.5" y="5" width="3.5" height="14" rx="1" />
    <path d="M19 6v12" />
  </svg>
);

export const PlayAllIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 5.5 8 6.5-8 6.5z" />
    <path d="M18 6v12" />
  </svg>
);
