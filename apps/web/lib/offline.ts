// Offline queue backed by IndexedDB (§10). Notes captured while offline are
// stored here and drained to POST /sync on reconnect.

const DB_NAME = "vaakflow";
const STORE = "queue";

export interface QueuedNote {
  client_id: string;
  transcript: string;
  worker_id: string;
  session_id: string;
  site_id?: string | null;
  language?: string | null;
  created_at: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "client_id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue(note: QueuedNote): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(note);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getQueue(): Promise<QueuedNote[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueuedNote[]);
    req.onerror = () => reject(req.error);
  });
}

export async function removeItems(ids: string[]): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    ids.forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function queueCount(): Promise<number> {
  return (await getQueue()).length;
}

// Best-effort Background Sync registration (progressive enhancement; Safari
// lacks it, so the app also flushes on the window 'online' event).
export async function registerBackgroundSync(): Promise<void> {
  try {
    const reg: any = await navigator.serviceWorker?.ready;
    await reg?.sync?.register("vaakflow-sync");
  } catch {
    /* ignored — fallback path handles draining */
  }
}
