import type { SculptureJSON } from "../engine/sculpture";
import * as local from "./localGallery";

export type WorldId = "hand" | "draw" | "mirror" | "voice";

export interface GalleryImage {
  id: string;
  world: WorldId;
  created_at: string;
  url: string;
  /** true when a 3D sculpture from Air Drawing was saved with the picture */
  has_sculpture: boolean;
  /** a short clip; the picture is its preview */
  video_url: string | null;
  /** file ending for downloads, when the URL has none (browser gallery) */
  ext?: string;
}

export interface SaveExtras {
  sculpture?: SculptureJSON | null;
  video?: string | null;
}

/**
 * Where pictures are kept:
 * - "server": the FastAPI gallery (local start with start.cmd, or development)
 * - "browser": IndexedDB in the visitor's browser (the online version has no server)
 */
export type GalleryMode = "server" | "browser";

let modePromise: Promise<GalleryMode> | null = null;

export function galleryMode(): Promise<GalleryMode> {
  modePromise ??= (async (): Promise<GalleryMode> => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      // on a static host the address falls back to the web page (HTML), not to our JSON
      if (res.ok && (res.headers.get("content-type") ?? "").includes("application/json")) {
        const body = (await res.json()) as { status?: string };
        if (body.status === "ok") return "server";
      }
    } catch {
      /* no server */
    }
    return "browser";
  })();
  return modePromise;
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
  if ((await galleryMode()) === "browser") return local.list();
  const res = await check(await fetch("/api/gallery"));
  return (await res.json()) as GalleryImage[];
}

export async function saveImage(world: WorldId, image: string, extras: SaveExtras = {}): Promise<GalleryImage> {
  if ((await galleryMode()) === "browser") return local.save(world, image, extras);
  const body: Record<string, unknown> = { world, image };
  if (extras.sculpture) body.sculpture = extras.sculpture;
  if (extras.video) body.video = extras.video;
  const res = await check(
    await fetch("/api/gallery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return (await res.json()) as GalleryImage;
}

export async function getSculpture(id: string): Promise<SculptureJSON> {
  if ((await galleryMode()) === "browser") return local.sculpture(id);
  const res = await check(await fetch(`/api/gallery/${encodeURIComponent(id)}/sculpture`));
  return (await res.json()) as SculptureJSON;
}

export async function deleteImage(id: string): Promise<void> {
  if ((await galleryMode()) === "browser") return local.remove(id);
  await check(await fetch(`/api/gallery/${encodeURIComponent(id)}`, { method: "DELETE" }));
}
