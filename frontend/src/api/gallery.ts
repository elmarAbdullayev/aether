export type WorldId = "hand" | "draw" | "mirror" | "voice";

export interface GalleryImage {
  id: string;
  world: WorldId;
  created_at: string;
  url: string;
}

async function check(res: Response): Promise<Response> {
  if (!res.ok) {
    let detail = `Server answered ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* no JSON body */
    }
    throw new Error(detail);
  }
  return res;
}

export async function listImages(): Promise<GalleryImage[]> {
  const res = await check(await fetch("/api/gallery"));
  return (await res.json()) as GalleryImage[];
}

export async function saveImage(world: WorldId, image: string): Promise<GalleryImage> {
  const res = await check(
    await fetch("/api/gallery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ world, image }),
    }),
  );
  return (await res.json()) as GalleryImage;
}

export async function deleteImage(id: string): Promise<void> {
  await check(await fetch(`/api/gallery/${encodeURIComponent(id)}`, { method: "DELETE" }));
}
