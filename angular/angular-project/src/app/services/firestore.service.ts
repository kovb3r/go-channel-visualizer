import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  where,
  serverTimestamp,
  Timestamp,
} from '@angular/fire/firestore';
import { TraceFile } from '../models/trace.model';

export interface TraceDoc {
  id: string;
  filename: string;
  createdAt: Timestamp;
  content: TraceFile;
}

@Injectable({ providedIn: 'root' })
export class FirestoreService {
  private fs = inject(Firestore);

  async saveTrace(filename: string, content: TraceFile): Promise<void> {
    // createdAt: a kliensoldali automatikus takarítás (deleteOldTraces) is ez
    // alapján dönti el, mi a 24 óránál régebbi.
    await addDoc(collection(this.fs, 'traces'), {
      filename,
      createdAt: serverTimestamp(),
      content,
    });
  }

  async listTraces(): Promise<TraceDoc[]> {
    const q = query(collection(this.fs, 'traces'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TraceDoc, 'id'>) }));
  }

  /** A megadottnál régebbi (createdAt alapján) trace-ek törlése. Hány db törlődött. */
  async deleteOldTraces(olderThanMs: number): Promise<number> {
    const cutoff = Timestamp.fromMillis(Date.now() - olderThanMs);
    const q = query(collection(this.fs, 'traces'), where('createdAt', '<', cutoff));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    return snap.size;
  }
}
