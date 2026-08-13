import { apiFetch } from "@/lib/api-client";

function filenameFromDisposition(header: string | null): string {
  if (!header) return "export";
  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] ?? "export";
}

/** Fetch an export route and trigger a browser file download. */
export async function downloadConsumptionExport(path: string): Promise<void> {
  const res = await apiFetch(path);
  if (!res.ok) {
    let message = `Export failed: ${res.status} ${res.statusText}`;
    try {
      const json = (await res.json()) as { error?: string };
      if (typeof json.error === "string" && json.error.trim() !== "") {
        message = json.error;
      }
    } catch {
      // Keep the status text when the body is not JSON.
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const filename = filenameFromDisposition(
    res.headers.get("Content-Disposition"),
  );
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
