import { STATUS_COLORS, STATUS_LABELS, type ApplicationStatus } from "@postulia/shared";
import { Badge } from "./ui";

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <Badge color={STATUS_COLORS[status]}>
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: STATUS_COLORS[status] }}
      />
      {STATUS_LABELS[status]}
    </Badge>
  );
}
