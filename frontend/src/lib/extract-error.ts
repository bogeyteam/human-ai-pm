export function extractError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const e = err as { message?: string; details?: string; hint?: string; error_description?: string };
    return e.message || e.error_description || e.details || e.hint || JSON.stringify(err);
  }
  if (typeof err === "string") return err;
  return "Unknown error";
}
