export interface Actor {
  id: string;
  type: string;
  displayName?: string;
  emoji?: string;
}

export function parseActors(json: string | null): Actor[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return Object.values(parsed);
    return [];
  } catch {
    return [];
  }
}
