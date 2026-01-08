import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

// Nyers érték típusai, amik a JSON Value mezőjében előfordulhatnak.
type RawValue = string | number | Record<string, unknown>;

// Csatorna leírás a JSON fájlból
interface Channel {
  channelId: number; // csatorna egyedi azonosítója
  timestamp: string; // létrehozás időbélyege ISO formátumban
  buffered?: boolean; // opcionális: pufferelt csatorna-e
  bufferSize?: number; // opcionális: puffer mérete, ha pufferelt
}

// Esemény objektum a JSON fájlból
interface EventItem {
  ChannelID: number;   // cél csatorna azonosítója
  MessageID: number;   // üzenet egyedi azonosítója
  SenderID: number;    // küldő goroutine/folyamat azonosítója
  ReceiverID: number;  // fogadó goroutine/folyamat azonosítója
  SendTime: string;    // küldés időbélyege
  ReceiveTime: string; // fogadás időbélyege
  Value: RawValue;     // az üzenet tartalma (tetszőleges JSON-kompatibilis érték)
}

// A teljes trace fájl szerkezete, amit az alkalmazás betölt
interface TraceFile {
  Channels: Channel[];
  Events: EventItem[];
}

@Component({
  selector: 'app-trace-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './trace-upload.component.html',
  styleUrls: ['./trace-upload.component.scss'],
})
export class TraceUploadComponent {
  @Output() loaded = new EventEmitter<TraceFile>(); // sikeres betöltés eseménye

  // UI állapotok / metaadatok
  fileName: string | null = null; // kiválasztott fájl neve
  fileSize: number | null = null; // kiválasztott fájl mérete bájtban
  summary: { channels: number; events: number } | null = null; // rövid összegzés
  error: string | null = null; // hibajelzés a felhasználónak

  // Felhasználói gombnyomás: a rejtett file input elemre kattintást indítja
  async onPickFileClick(input: HTMLInputElement) {
    input.click();
  }

  // File input változáskezelő: a fájl beolvasása és validálása
  async onFileChange(evt: Event) {
    this.resetUi(); // előző állapot törlése
    const input = evt.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return; // ha nincs fájl, kilépünk

    // Metaadatok frissítése a UI-hoz
    this.fileName = file.name;
    this.fileSize = file.size;

    try {
      const text = await file.text(); // fájl szövegként beolvasása
      const data = this.safeParse(text); // JSON parse hibakezeléssel
      this.basicValidate(data); // egyszerű szerkezetellenőrzés

      // Rövid összegzés készítése a UI-hoz
      this.summary = {
        channels: Array.isArray(data.Channels) ? data.Channels.length : 0,
        events: Array.isArray(data.Events) ? data.Events.length : 0,
      };

      this.loaded.emit(data); // sikeres betöltés: esemény küldése a szülő komponensnek
    } catch (e: any) {
      // Hibakezelés: üzenet megjelenítése a felhasználónak
      this.error = e?.message ?? 'Ismeretlen hiba a fájl feldolgozásakor.';
    } finally {
      // Ugyanazt a fájlt újra lehessen kiválasztani: input értékének törlése
      (evt.target as HTMLInputElement).value = '';
    }
  }

  // Biztonságos JSON feldolgozás: parse és egyedi hibaüzenet
  private safeParse(text: string): TraceFile {
    try {
      const obj = JSON.parse(text);
      return obj as TraceFile;
    } catch {
      // Ha nem JSON, dobunk egy hibát, amit a hívó kezel
      throw new Error('A fájl nem érvényes JSON.');
    }
  }

  // Alapvető struktúraellenőrzés a betöltött objektumon
  private basicValidate(data: TraceFile) {
    if (!data || typeof data !== 'object') {
      throw new Error('A fájl nem a várt objektumot tartalmazza.');
    }
    if (!Array.isArray(data.Channels)) {
      throw new Error('Hiányzik a Channels tömb.');
    }
    if (!Array.isArray(data.Events)) {
      throw new Error('Hiányzik az Events tömb.');
    }
    
    // Ellenőrizzük a Channels tömb első elemének szerkezetét
    for (const ch of data.Channels) {
      if (
        typeof ch.channelId !== 'number' ||
        typeof ch.timestamp !== 'string'
      ) {
        throw new Error('A Channels egyes elemei nem a várt formátumúak.');
      }
      break; // csak az első elem ellenőrzése a gyors alapellenőrzéshez
    }

    // Ellenőrizzük az Events tömb első elemének szerkezetét
    for (const ev of data.Events) {
      if (
        typeof ev.ChannelID !== 'number' ||
        typeof ev.MessageID !== 'number' ||
        typeof ev.SenderID !== 'number' ||
        typeof ev.ReceiverID !== 'number' ||
        typeof ev.SendTime !== 'string' ||
        typeof ev.ReceiveTime !== 'string'
      ) {
        throw new Error('Az Events egyes elemei nem a várt formátumúak.');
      }
      break; // csak az első elem ellenőrzése elég az alapvalidáláshoz
    }
  }

  // UI állapot visszaállítása alapértékekre
  private resetUi() {
    this.error = null;
    this.summary = null;
    this.fileName = null;
    this.fileSize = null;
  }
}