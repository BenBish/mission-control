import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ExportFormat } from "@/lib/consumption-export";

export function ExportMenu({
  disabled,
  onExport,
  testId,
  label = "Export",
}: {
  disabled?: boolean;
  onExport: (format: ExportFormat) => Promise<void>;
  testId?: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport(format: ExportFormat) {
    setBusy(true);
    setError(null);
    try {
      await onExport(format);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || busy}
            data-testid={testId}
            aria-label={`${label} as CSV or JSON`}
          >
            <Download className="h-3.5 w-3.5" />
            {busy ? "Exporting…" : label}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={disabled || busy}
            onSelect={() => {
              void handleExport("csv");
            }}
          >
            Download CSV
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled || busy}
            onSelect={() => {
              void handleExport("json");
            }}
          >
            Download JSON
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <p className="text-xs text-destructive max-w-[16rem] text-right">
          {error}
        </p>
      )}
    </div>
  );
}
