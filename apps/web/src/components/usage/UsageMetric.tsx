import { cn } from "../../lib/utils";

export function figureClass(loading: boolean) {
  return cn("transition-opacity", loading && "opacity-40 delay-150");
}

export function Metric({
  label,
  value,
  loading,
}: {
  readonly label: string;
  readonly value: string;
  readonly loading: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn("text-base font-medium text-foreground tabular-nums", figureClass(loading))}
      >
        {value}
      </span>
    </div>
  );
}
