import type { SculptureJSON } from "../engine/sculpture";
import type { GalleryImage, SaveExtras, WorldId } from "./gallery";

/**
 * Gallery for the online version: everything is kept in the visitor's own browser
 * (IndexedDB). No server, so nobody can fill a shared gallery, and it costs nothing.
 */

const DB_NAME = "aether";
const STORE = "gallery";
/** Older items are removed after this many, so the browser storage does not fill up. */
const MAX_ITEMS = 60;

interface Row {
  id: string;
  world: WorldId;
  created_at: string;
  image: Blob;
  video: Blob | null;
  sculpture: SculptureJSON | null;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Browser storage is not available."));
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = work(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Browser storage failed."));
  });
}

/** Object URLs per item, made once and freed when the item is deleted. */
const urls = new Map<string, { image: string; video: string | null }>();

const EXT: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "video/mp4": ".mp4", "video/webm": ".webm" };

function toImage(row: Row): GalleryImage {
  let u = urls.get(row.id);
  if (!u) {
    u = { image: URL.createObjectURL(row.image), video: row.video ? URL.createObjectURL(row.video) : null };
    urls.set(row.id, u);
  }
  return {
    id: row.id,
    world: row.world,
    created_at: row.created_at,
    url: u.image,
    video_url: u.video,
    has_sculpture: row.sculpture !== null,
    ext: EXT[(row.video ?? row.image).type] ?? "",
  };
}

async function toBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

export async function list(): Promise<GalleryImage[]> {
  const rows = await run<Row[]>("readonly", (s) => s.getAll());
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(toImage);
}

export async function save(world: WorldId, image: string, extras: SaveExtras = {}): Promise<GalleryImage> {
  const row: Row = {
    id: crypto.randomUUID().replace(/-/g, ""),
    world,
    created_at: new Date().toISOString(),
    image: await toBlob(image),
    video: extras.video ? await toBlob(extras.video) : null,
    sculpture: extras.sculpture ?? null,
  };
  await run("readwrite", (s) => s.put(row));
  const all = await run<Row[]>("readonly", (s) => s.getAll());
  const old = all.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(MAX_ITEMS);
  for (const r of old) await remove(r.id);
  return toImage(row);
}

export async function sculpture(id: string): Promise<SculptureJSON> {
  const row = await run<Row | undefined>("readonly", (s) => s.get(id));
  if (!row?.sculpture) throw new Error("This picture has no 3D sculpture.");
  return row.sculpture;
}

export async function remove(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
  const u = urls.get(id);
  if (u) {
    URL.revokeObjectURL(u.image);
    if (u.video) URL.revokeObjectURL(u.video);
    urls.delete(id);
  }
}
