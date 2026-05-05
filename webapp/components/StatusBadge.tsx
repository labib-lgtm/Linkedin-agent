import { cn } from "@/lib/utils";
import { STATUS_TONE, type Status } from "@/lib/constants";

export function StatusBadge({
  status,
  className,
}: {
  status: Status;
  className?: string;
}) {
  return (
    <span className={cn("pill", STATUS_TONE[status], className)}>{status}</span>
  );
}
