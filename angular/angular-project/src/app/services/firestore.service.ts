import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  setDoc,
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

export interface CleanupSettings {
  cronExpression: string;
  lastCleanupRun: Timestamp | null;
}

@Injectable({ providedIn: 'root' })
export class FirestoreService {
  private fs = inject(Firestore);

  async saveTrace(filename: string, content: TraceFile): Promise<void> {
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

  async deleteOldTraces(olderThanMs: number): Promise<void> {
    const cutoff = Timestamp.fromDate(new Date(Date.now() - olderThanMs));
    const q = query(collection(this.fs, 'traces'), where('createdAt', '<', cutoff));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  }

  async getCleanupSettings(): Promise<CleanupSettings | null> {
    const snap = await getDoc(doc(this.fs, 'config', 'cleanupSettings'));
    return snap.exists() ? (snap.data() as CleanupSettings) : null;
  }

  async updateCleanupSettings(patch: Partial<CleanupSettings>): Promise<void> {
    await setDoc(doc(this.fs, 'config', 'cleanupSettings'), patch, { merge: true });
  }

  async markCleanupRun(): Promise<void> {
    await setDoc(
      doc(this.fs, 'config', 'cleanupSettings'),
      { lastCleanupRun: serverTimestamp() },
      { merge: true },
    );
  }
}
