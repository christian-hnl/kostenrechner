import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/** Gespeicherte Person mit Wohnort – Basis für die automatische Routen-/Abholplanung. */
export interface PersonRecord {
  id: string;
  name: string;
  homeAddress: string;
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

export async function getPeople(): Promise<PersonRecord[]> {
  const all = await (await db()).getAll("people");
  return all.sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export async function savePerson(person: PersonRecord): Promise<void> {
  await (await db()).put("people", person);
}

export async function deletePerson(id: string): Promise<void> {
  await (await db()).delete("people", id);
}
