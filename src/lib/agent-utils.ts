/**
 * Translates workspace-prefixed agent IDs to short IDs used in the database.
 *
 * Examples:
 *   'workspace-engineer' → 'engineer'
 *   'workspace'          → 'main'
 *   'engineer'           → 'engineer'  (pass-through)
 */
export function toActorId(id: string): string {
  if (id === "workspace") return "main";
  if (id.startsWith("workspace-")) return id.slice("workspace-".length);
  return id;
}
