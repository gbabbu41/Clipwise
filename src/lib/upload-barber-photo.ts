/** POST a barber photo to the upload route; returns the new public URL. */
export async function uploadBarberPhoto(file: File, barberId: string, accessToken: string | null): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("barberId", barberId);
  const res = await fetch("/api/upload-barber-photo", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken ?? ""}` },
    body: form,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as { error?: string }).error ?? "Upload failed");
  }
  const { url } = await res.json() as { url: string };
  return url;
}
