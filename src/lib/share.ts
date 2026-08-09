/**
 * Share a URL via the native share sheet (mobile), falling back to copying it to
 * the clipboard (desktop). Returns what happened so the caller can show a toast.
 * Never throws — a dismissed native share sheet resolves to "shared".
 */
export async function shareLink(
  url: string,
  title: string,
  onResult?: (r: "shared" | "copied" | "failed") => void,
): Promise<"shared" | "copied" | "failed"> {
  let result: "shared" | "copied" | "failed" = "failed";
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url });
      result = "shared";
      onResult?.(result);
      return result;
    } catch {
      // User dismissed the sheet, or share is unavailable — fall through to copy.
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    result = "copied";
  } catch {
    result = "failed";
  }
  onResult?.(result);
  return result;
}
