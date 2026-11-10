import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { deleteImage, listImages, type GalleryImage } from "../api/gallery";
import { Close, Download, Trash } from "../components/icons";
import { useToast } from "../components/Toast";
import { TopBar } from "../components/TopBar";
import { WORLDS } from "../worlds";

const worldName = (id: string) => WORLDS.find((w) => w.id === id)?.name ?? id;

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function Gallery() {
  const [images, setImages] = useState<GalleryImage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [open, setOpen] = useState<GalleryImage | null>(null);
  const [toast, showToast] = useToast();

  useEffect(() => {
    listImages()
      .then(setImages)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function remove(id: string) {
    try {
      await deleteImage(id);
      setImages((list) => list?.filter((i) => i.id !== id) ?? null);
      showToast("Picture deleted.");
    } catch (e) {
      showToast(`Could not delete: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setConfirming(null);
    }
  }

  return (
    <div className="page">
      <TopBar />
      <main className="section gallery">
        <h1>Gallery</h1>
        <p className="lead">Pictures you saved from the worlds. Say “save” or press S while you play.</p>

        {failed && (
          <div className="empty">
            <p>The gallery server is not running.</p>
            <p className="fineprint">Start Aether with start.cmd, or run the FastAPI backend on port 8020.</p>
          </div>
        )}
        {!failed && images === null && <p className="fineprint">Loading…</p>}
        {images?.length === 0 && (
          <div className="empty">
            <p>Nothing saved yet.</p>
            <Link className="btn primary" to="/hand">
              Make something in Hand Magic
            </Link>
          </div>
        )}

        {images && images.length > 0 && (
          <ul className="gallery-grid">
            {images.map((img) => (
              <li key={img.id} className="gallery-item">
                <button type="button" className="gallery-thumb" onClick={() => setOpen(img)}>
                  <img src={img.url} alt={`Saved from ${worldName(img.world)}`} loading="lazy" />
                </button>
                <div className="gallery-meta">
                  <div>
                    <strong>{worldName(img.world)}</strong>
                    <span>{formatDate(img.created_at)}</span>
                  </div>
                  {confirming === img.id ? (
                    <div className="confirm">
                      <span>Delete?</span>
                      <button type="button" className="btn-small danger" onClick={() => void remove(img.id)}>
                        Yes
                      </button>
                      <button type="button" className="btn-small" onClick={() => setConfirming(null)}>
                        No
                      </button>
                    </div>
                  ) : (
                    <div className="gallery-actions">
                      <a className="icon-btn" href={img.url} download={`aether-${img.world}-${img.id.slice(0, 6)}`} title="Download">
                        <Download />
                        <span className="sr-only">Download</span>
                      </a>
                      <button type="button" className="icon-btn" onClick={() => setConfirming(img.id)} title="Delete">
                        <Trash />
                        <span className="sr-only">Delete</span>
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      {open && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Picture" onClick={() => setOpen(null)}>
          <img src={open.url} alt={`Saved from ${worldName(open.world)}`} />
          <button type="button" className="icon-btn lightbox-close" onClick={() => setOpen(null)}>
            <Close />
            <span className="sr-only">Close</span>
          </button>
        </div>
      )}
      {toast}
    </div>
  );
}
