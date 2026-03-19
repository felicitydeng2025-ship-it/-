import { openDB, IDBPDatabase } from 'idb';
import { Material } from '../types';

const DB_NAME = 'shadowtalk_db';
const STORE_NAME = 'materials';

let dbPromise: Promise<IDBPDatabase>;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

export async function saveMaterial(material: Material) {
  const db = await getDB();
  await db.put(STORE_NAME, material);
}

export async function getAllMaterials(): Promise<Material[]> {
  const db = await getDB();
  return db.getAll(STORE_NAME);
}

export async function deleteMaterial(id: string) {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}
