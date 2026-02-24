/**
 * MatrixCell Component
 * Renders a single cell in the permissions matrix.
 * Shows a green checkmark for granted access, or a muted dash for no access.
 */

import { Check, Minus } from "lucide-react";

interface MatrixCellProps {
  hasAccess: boolean;
  agentName: string;
  skillName: string;
}

export function MatrixCell({ hasAccess, agentName, skillName }: MatrixCellProps) {
  const label = hasAccess
    ? `${agentName} has access to ${skillName}`
    : `${agentName} does not have access to ${skillName}`;

  return (
    <td
      className="border-b border-r px-3 py-2 text-center hover:bg-accent/50"
      title={hasAccess ? `${agentName} → ${skillName}: Granted` : "No access"}
      aria-label={label}
    >
      {hasAccess ? (
        <Check className="mx-auto h-4 w-4 text-emerald-600" />
      ) : (
        <Minus className="mx-auto h-3 w-3 text-muted-foreground/30" />
      )}
    </td>
  );
}
