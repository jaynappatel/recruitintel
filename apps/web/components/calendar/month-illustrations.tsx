import {
  Anchor,
  Coffee,
  Compass,
  Fish,
  Flower2,
  Leaf,
  NotebookPen,
  Snowflake,
  Sprout,
  Star,
  Sun,
  Umbrella,
} from "lucide-react";

/** One clean line-icon per month — plain, monochrome, no illustration flourish. */
const MONTH_ICONS = [
  Snowflake,
  Sprout,
  Flower2,
  Umbrella,
  Sun,
  Coffee,
  Compass,
  Fish,
  NotebookPen,
  Leaf,
  Anchor,
  Star,
] as const;

export function MonthIllustration({
  month,
  className,
}: {
  month: number;
  className?: string;
}) {
  const Icon = MONTH_ICONS[((month % 12) + 12) % 12] ?? Snowflake;
  return <Icon aria-hidden="true" className={className} strokeWidth={1.5} />;
}
