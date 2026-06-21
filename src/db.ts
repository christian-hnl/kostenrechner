import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/** Gespeicherte Person mit Wohnort – Basis für die automatische Routen-/Abholplanung. */
export interface PersonRecord {
  id: string;
  name: string;
  homeAddress: string;
  outboundDropoff?: string;
  returnDropoff?: string;
  lat?: number;
  lng?: number;
}

interface KostenDB extends DBSchema {
  people: {
    key: string;
    value: PersonRecord;
  };
}

let dbPromise: Promise<IDBPDatabase<KostenDB>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<KostenDB>("kostenrechner", 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains("people")) {
          database.createObjectStore("people", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

async function syncToServer() {
  // In development, we don't have a PHP server running via Vite, so we skip syncing.
  if (import.meta.env.DEV) return;
  try {
    const all = await (await db()).getAll("people");
    await fetch("/api.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(all),
    });
  } catch (e) {
    console.warn("Could not sync to server", e);
  }
}

export async function getPeople(): Promise<PersonRecord[]> {
  // Try fetching from server first (only in production)
  if (!import.meta.env.DEV) {
    try {
      const res = await fetch("/api.php");
      if (res.ok) {
        const text = await res.text();
        // Prevent parsing raw PHP source if the server is not configured correctly
        if (text && !text.trim().startsWith("<?php")) {
          const serverPeople: PersonRecord[] = JSON.parse(text);
          // Sync server data to local DB
          const database = await db();
          const tx = database.transaction("people", "readwrite");
          await tx.store.clear();
          for (const p of serverPeople) {
            await tx.store.put(p);
          }
          await tx.done;
        }
      }
    } catch (e) {
      console.warn("Could not fetch from server, falling back to local DB", e);
    }
  }

  const all = await (await db()).getAll("people");
  return all.sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export async function savePerson(person: PersonRecord): Promise<void> {
  await (await db()).put("people", person);
  await syncToServer();
}

export async function deletePerson(id: string): Promise<void> {
  await (await db()).delete("people", id);
  await syncToServer();
}
