import type {ReactNode} from "react";

export type IconName =
  | "settings"
  | "shield"
  | "refresh"
  | "file"
  | "edit"
  | "play"
  | "download"
  | "upload"
  | "check"
  | "chevron-up"
  | "chevron-down"
  | "arrow-left"
  | "arrow-right"
  | "sparkles"
  | "film"
  | "image"
  | "copy"
  | "volume"
  | "save"
  | "trash"
  | "nodes"
  | "layers"
  | "flow"
  | "timeline";

type IconProps = {
  name: IconName;
  size?: number;
  className?: string;
};

const paths: Record<IconName, ReactNode> = {
  settings: <><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15.1-.1.3 1.5 1.5-1.8 1.8-1.5-1.5-.3.1a7.6 7.6 0 0 1-1.2.5l-.3.1-.2 2.1h-2.6l-.2-2.1-.3-.1a7.6 7.6 0 0 1-1.2-.5l-.3-.1-1.5 1.5-1.8-1.8 1.5-1.5-.1-.3a7.6 7.6 0 0 1-.5-1.2l-.1-.3-2.1-.2v-2.6l2.1-.2.1-.3a7.6 7.6 0 0 1 .5-1.2l.1-.3-1.5-1.5 1.8-1.8 1.5 1.5.3-.1a7.6 7.6 0 0 1 1.2-.5l.3-.1.2-2.1h2.6l.2 2.1.3.1a7.6 7.6 0 0 1 1.2.5l.3.1 1.5-1.5 1.8 1.8-1.5 1.5.1.3a7.6 7.6 0 0 1 .5 1.2l.1.3 2.1.2v2.6l-2.1.2-.1.3a7.6 7.6 0 0 1-.5 1.2Z"/></>,
  shield: <><path d="M12 3.5 19 6v5.4c0 4.7-2.9 7.9-7 9.1-4.1-1.2-7-4.4-7-9.1V6l7-2.5Z"/><path d="m8.8 12.3 2.1 2.1 4.4-4.4"/></>,
  refresh: <><path d="M19 8.5A7.5 7.5 0 0 0 5.6 7L4 8.5"/><path d="M4 4.5v4h4"/><path d="M5 15.5A7.5 7.5 0 0 0 18.4 17l1.6-1.5"/><path d="M20 19.5v-4h-4"/></>,
  file: <><path d="M6 3.5h7l5 5v12H6z"/><path d="M13 3.5v5h5M9 13h6M9 16.5h6"/></>,
  edit: <><path d="m5 16.5-.8 3.3 3.3-.8L18 8.5 15.5 6 5 16.5Z"/><path d="m13.8 7.7 2.5 2.5M5 20h14"/></>,
  play: <><circle cx="12" cy="12" r="8.5"/><path d="m10 8.5 5 3.5-5 3.5v-7Z"/></>,
  download: <><path d="M12 4v10M8.5 10.5 12 14l3.5-3.5M5 18.5h14"/></>,
  upload: <><path d="M12 20V6M7.5 10.5 12 6l4.5 4.5M5 3.5h14"/></>,
  check: <path d="m5.5 12.5 4.1 4.1L18.5 7.7"/>,
  "chevron-up": <path d="m6.5 14.5 5.5-5 5.5 5"/>,
  "chevron-down": <path d="m6.5 9.5 5.5 5 5.5-5"/>,
  // 步骤审核的前后导航使用成对方向箭头，避免仅靠文字区分方向。
  "arrow-left": <><path d="M19.5 12h-14"/><path d="m10.5 6.5-5.5 5.5 5.5 5.5"/></>,
  "arrow-right": <><path d="M4.5 12h14"/><path d="m13.5 6.5 5.5 5.5-5.5 5.5"/></>,
  sparkles: <><path d="m12 3 1.1 4.1L17 8.5l-3.9 1.4L12 14l-1.1-4.1L7 8.5l3.9-1.4L12 3Z"/><path d="m18.5 14 .6 2.4 2.4.6-2.4.6-.6 2.4-.6-2.4-2.4-.6 2.4-.6.6-2.4Z"/></>,
  film: <><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 5v14M16 5v14M4 9h4M16 9h4M4 15h4M16 15h4"/></>,
  image: <><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.3"/><path d="m5.5 17 4.2-4 2.7 2.3 2.2-2.1 4 3.8"/></>,
  copy: <><rect x="8" y="8" width="10" height="11" rx="1.5"/><path d="M15 8V6.5A1.5 1.5 0 0 0 13.5 5h-7A1.5 1.5 0 0 0 5 6.5v8A1.5 1.5 0 0 0 6.5 16H8"/></>,
  volume: <><path d="M5 10h3l4-3.5v11L8 14H5z"/><path d="M15 9a4 4 0 0 1 0 6M17.5 6.8a7 7 0 0 1 0 10.4"/></>,
  save: <><path d="M5 4.5h11l3 3v12H5z"/><path d="M8 4.5v5h7v-5M8 19.5v-5h8v5"/></>,
  // 段落编辑使用独立删除图标，避免把删除操作误认为合并或拆分。
  trash: <><path d="M5 7h14M10 11v5M14 11v5"/><path d="m8 7 .7 13h6.6L16 7M9 7l1-3h4l1 3"/></>,
  nodes: <><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="m8.4 11 7.2-3M8.4 13l7.2 3"/></>,
  layers: <><path d="m12 4 8 4-8 4-8-4 8-4Z"/><path d="m4 12 8 4 8-4M4 16l8 4 8-4"/></>,
  flow: <><rect x="3.5" y="8.5" width="6" height="7" rx="1.5"/><rect x="14.5" y="8.5" width="6" height="7" rx="1.5"/><path d="M9.5 12h5M12.5 9l3 3-3 3"/></>,
  timeline: <><path d="M7 4v16"/><circle cx="7" cy="7" r="2"/><circle cx="7" cy="13" r="2"/><path d="M11 7h8M11 13h8M11 18h6"/></>,
};

export function Icon({name, size = 16, className}: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        {paths[name]}
      </g>
    </svg>
  );
}
