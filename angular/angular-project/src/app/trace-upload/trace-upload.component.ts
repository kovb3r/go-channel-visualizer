import { Component, EventEmitter, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TraceFile } from '../models/trace.model';
import { FirestoreService, TraceDoc } from '../services/firestore.service';

@Component({
  selector: 'app-trace-upload',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './trace-upload.component.html',
  styleUrls: ['./trace-upload.component.scss'],
})
export class TraceUploadComponent {
  private firestoreService = inject(FirestoreService);

  @Output() loaded = new EventEmitter<TraceFile>();

  // meglévő mezők
  fileName: string | null = null;
  fileSize: number | null = null;
  summary: { channels: number; events: number } | null = null;
  error: string | null = null;

  // cloud mentés
  saveToCloud = false;
  traceName = '';
  saveStatus: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
  saveError = '';
  private currentTrace: TraceFile | null = null;

  // cloud betöltés
  cloudTraces: TraceDoc[] = [];
  cloudLoading = false;
  cloudError = '';
  showCloudList = false;

  async onPickFileClick(input: HTMLInputElement) {
    input.click();
  }

  async onFileChange(evt: Event) {
    this.resetUi();
    const input = evt.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.fileName = file.name;
    this.fileSize = file.size;

    try {
      const text = await file.text();
      const data = this.safeParse(text);
      this.basicValidate(data);

      this.summary = {
        channels: Array.isArray(data.Channels) ? data.Channels.length : 0,
        events: Array.isArray(data.Events) ? data.Events.length : 0,
      };

      this.currentTrace = data;
      this.loaded.emit(data);
    } catch (e: any) {
      this.error = e?.message ?? 'Unknown error while processing the file.';
    } finally {
      (evt.target as HTMLInputElement).value = '';
    }
  }

  async saveCurrentTrace(): Promise<void> {
    if (!this.currentTrace) return;
    await this.saveToFirestore(this.currentTrace);
  }

  get canSave(): boolean {
    return !!this.currentTrace && this.traceName.trim().length > 0;
  }

  private async saveToFirestore(data: TraceFile): Promise<void> {
    this.saveStatus = 'saving';
    try {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const ts =
        now.getFullYear().toString() +
        pad(now.getMonth() + 1) +
        pad(now.getDate()) +
        '_' +
        pad(now.getHours()) +
        pad(now.getMinutes()) +
        pad(now.getSeconds());
      const filename = `${this.traceName.trim()}_${ts}`;
      await this.firestoreService.saveTrace(filename, data);
      this.saveStatus = 'saved';
    } catch (e: any) {
      this.saveStatus = 'error';
      this.saveError = e?.message ?? 'Failed to save to cloud.';
    }
  }

  async openCloudList(): Promise<void> {
    this.showCloudList = true;
    this.cloudLoading = true;
    this.cloudError = '';
    try {
      this.cloudTraces = await this.firestoreService.listTraces();
    } catch (e: any) {
      this.cloudError = e?.message ?? 'Failed to load cloud traces.';
    } finally {
      this.cloudLoading = false;
    }
  }

  closeCloudList(): void {
    this.showCloudList = false;
  }

  async loadCloudTrace(trace: TraceDoc): Promise<void> {
    this.showCloudList = false;
    this.resetUi();
    this.fileName = trace.filename + ' (cloud)';
    try {
      this.basicValidate(trace.content);
      this.summary = {
        channels: Array.isArray(trace.content.Channels) ? trace.content.Channels.length : 0,
        events: Array.isArray(trace.content.Events) ? trace.content.Events.length : 0,
      };
      this.loaded.emit(trace.content);
    } catch (e: any) {
      this.error = e?.message ?? 'Invalid trace data from cloud.';
    }
  }

  private safeParse(text: string): TraceFile {
    try {
      return JSON.parse(text) as TraceFile;
    } catch {
      throw new Error('The file is not valid JSON.');
    }
  }

  private basicValidate(data: TraceFile) {
    if (!data || typeof data !== 'object') {
      throw new Error('The file does not contain the expected object.');
    }
    if (!Array.isArray(data.Channels)) throw new Error('Missing Channels array.');
    if (!Array.isArray(data.Events)) throw new Error('Missing Events array.');

    for (const ch of data.Channels) {
      if (typeof ch.channelId !== 'number' || typeof ch.timestamp !== 'string') {
        throw new Error('Some Channels entries are not in the expected format.');
      }
      break;
    }
    for (const ev of data.Events) {
      if (
        typeof ev.ChannelID !== 'number' ||
        typeof ev.MessageID !== 'number' ||
        typeof ev.SenderID !== 'number' ||
        typeof ev.ReceiverID !== 'number' ||
        typeof ev.SendTime !== 'string' ||
        typeof ev.ReceiveTime !== 'string'
      ) {
        throw new Error('Some Events entries are not in the expected format.');
      }
      break;
    }
  }

  private resetUi() {
    this.error = null;
    this.summary = null;
    this.fileName = null;
    this.fileSize = null;
    this.saveStatus = 'idle';
    this.saveError = '';
    this.currentTrace = null;
  }
}
