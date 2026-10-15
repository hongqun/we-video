import {
  ArrowLeftRight,
  Check,
  Clock3,
  GitBranch,
  Layers3,
  ListChecks,
  MessageCircle,
  Network,
  Quote,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export type RemotionIconName =
  | "check"
  | "compare"
  | "layers"
  | "list"
  | "message"
  | "network"
  | "quote"
  | "timeline"
  | "branch"
  | "workflow";

const ICONS: Record<RemotionIconName, LucideIcon> = {
  check: Check,
  compare: ArrowLeftRight,
  layers: Layers3,
  list: ListChecks,
  message: MessageCircle,
  network: Network,
  quote: Quote,
  timeline: Clock3,
  branch: GitBranch,
  workflow: Workflow,
};

export const RemotionIcon: React.FC<{
  name: RemotionIconName;
  size?: number;
  strokeWidth?: number;
}> = ({name, size = 28, strokeWidth = 2.2}) => {
  const Icon = ICONS[name];
  return <Icon aria-hidden="true" absoluteStrokeWidth color="currentColor" size={size} strokeWidth={strokeWidth} />;
};

export const REMOTION_ICON_NAMES = Object.freeze(Object.keys(ICONS) as RemotionIconName[]);
