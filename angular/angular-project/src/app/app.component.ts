import { Component, NgZone, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Cron } from 'croner';
import { TraceUploadComponent } from './trace-upload/trace-upload.component';
import { GraphViewComponent } from './graph-view/graph-view.component';
import { TraceFile, VizLink, VizNode, VizMessage } from './models/trace.model';
import { TraceParserService } from './services/trace-parser.service';
import { FirestoreService } from './services/firestore.service';

type EventMarker = { leftPct: number };

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    TraceUploadComponent,
    GraphViewComponent,
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit, OnDestroy {
  // A kirajzoláshoz szükséges adatok (gyerek komponens bemenetei)
  allNodes: VizNode[] = [];
  allLinks: VizLink[] = [];
  allMessages: VizMessage[] = [];

  eventFilmMs: number[] = []; // küldési időpontok film ms-ben, a Prev/Next ugráshoz
  eventMarkers: EventMarker[] = []; // sárga pöttyök helye a csúszkán (%)
  sliderThumbPx = 16; // kb. a range thumb szélessége

  msgTravelFilmMs = 800; // egy üzenet ennyi film ms alatt ér át a másik csúcsba

  showArrived = false;

  // lejátszó állapot
  clock = 0;
  realDuration = 0; // trace valós hossza (ms)
  filmDuration = 0; // UI / slider aktív hossza (ms); trace betöltésekor = filmSettingMs
  clockReal = 0; // valós óra (ms) -> ezt kapja a graph-view
  playing = false;
  speed = 1000; // film ms / sec, azaz 1000 = 1x, 2000 = 2x, 500 = 0.5x, stb.
  speedSlider = 50; // 0..100; közép = 1x

  // log skála, 1x középen: 0.25x - 0.5x - 1x - 2x - 4x
  private readonly MIN_SPEED_FACTOR = 0.25; // bal szélen 0.25x
  private readonly MAX_SPEED_FACTOR = 4; // jobb szélen 4x

  // állítható film hossz (ms); trace betöltésekor ez lesz a filmDuration
  filmSettingMs = 20_000;
  private readonly MIN_FILM_MS = 3_000; // a msgTravel 800ms-nál nagyobb kell legyen
  private readonly MAX_FILM_MS = 120_000;

  private rafId: number | null = null;
  private lastFrameTs: number | null = null;

  private firestoreService = inject(FirestoreService);

  // automatikus törlés cronnal; csak addig fut, amíg az app nyitva van
  private readonly autoDeleteHours = 24;
  private cleanupCron?: Cron;
  private readonly CLEANUP_MAX_AGE_MS = this.autoDeleteHours * 60 * 60 * 1000;

  // Téma (light / dark)
  theme: 'dark' | 'light' = 'dark';

  constructor(
    private parser: TraceParserService,
    private zone: NgZone,
  ) {
    this.initTheme();
  }

  // mentett téma betöltése, alapértelmezés a sötét
  private initTheme(): void {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('cv-theme');
    } catch {}
    this.theme = saved === 'light' ? 'light' : 'dark';
    this.applyTheme();
  }

  toggleTheme(): void {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem('cv-theme', this.theme);
    } catch {}
    this.applyTheme();
  }

  // a data-theme attribútum vezérli a light paletta CSS változóit
  private applyTheme(): void {
    const root = document.documentElement;
    if (this.theme === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
  }

  ngOnInit(): void {
    // takarítás betöltéskor, majd óránként
    void this.runCleanup();
    this.zone.runOutsideAngular(() => {
      this.cleanupCron = new Cron('0 * * * *', () => void this.runCleanup());
    });
  }

  // a 24 óránál régebbi trace-ek törlése a felhőből
  private async runCleanup(): Promise<void> {
    try {
      const removed = await this.firestoreService.deleteOldTraces(this.CLEANUP_MAX_AGE_MS);
      if (removed > 0) console.info(`Cleanup: ${removed} old trace(s) removed from cloud.`);
    } catch (e) {
      console.warn('Trace cleanup failed:', e);
    }
  }

  /** Feltöltött és alap-validált nyers JSON itt érkezik. */
  onTraceLoaded(raw: TraceFile) {
    try {
      // 1) idő-normalizálás
      const norm = this.parser.toNormalized(raw);

      this.realDuration = Math.max(0, norm.t1 - norm.t0);
      this.filmDuration = this.computeFilmDuration();

      // 2) viz gráf előállítása
      const viz = this.parser.toVizGraph(norm);
      // 3) átadjuk a rajzolónak
      this.allNodes = viz.nodes;
      this.allLinks = viz.links;

      this.allMessages = this.parser.toVizMessages(norm);

      this.eventFilmMs = this.buildEventFilmMs();

      this.stopPlayback();
      this.setSpeed(1000); // reset speed
      this.clock = 0;
      this.syncRealClockFromFilmClock();
      this.rebuildEventMarkers();
    } catch (e) {
      console.error(e);
      alert((e as any)?.message ?? 'Failed to process the trace.');
    }
  }

  // slider input kezelése
  onClockInput(evt: Event) {
    const input = evt.target as HTMLInputElement;
    const v = Number(input.value);

    this.clock = Number.isFinite(v) ? v : 0;
    this.syncRealClockFromFilmClock();
  }

  // checkbox change handler
  onShowArrivedChange(evt: Event) {
    const input = evt.target as HTMLInputElement;
    this.showArrived = input.checked;
  }

  // ===== vezérlők =====

  // lejátszás indítása / szüneteltetése
  togglePlay(): void {
    if (this.playing) {
      this.stopPlayback();
      return;
    }
    if (this.filmDuration <= 0) return; // nincs mit lejátszani

    // Ha a lejátszás a végén áll, a Play induljon elölről (ne kelljen a ⟲).
    if (this.clock >= this.filmDuration) {
      this.clock = 0;
      this.syncRealClockFromFilmClock();
    }

    this.playing = true;
    this.lastFrameTs = null;
    this.rafId = requestAnimationFrame((t) => this.onFrame(t));
  }

  private onFrame(ts: number): void {
    if (!this.playing) return;

    if (this.lastFrameTs === null) this.lastFrameTs = ts;
    const dtMs = ts - this.lastFrameTs;
    this.lastFrameTs = ts;

    // speed = film ms / sec  -> dtMs (wall ms) alatt ennyit lépünk film időben:
    const filmAdvance = dtMs * (this.speed / 1000);

    this.clock = Math.min(this.filmDuration, this.clock + filmAdvance);
    this.syncRealClockFromFilmClock();

    if (this.clock >= this.filmDuration) {
      this.stopPlayback(); // vége
      return;
    }

    this.rafId = requestAnimationFrame((t) => this.onFrame(t));
  }

  // lejátszás leállítása és a futó animációs keret eldobása
  private stopPlayback(): void {
    this.playing = false;
    this.lastFrameTs = null;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // vissza a film elejére, megállítva
  restart() {
    this.stopPlayback();
    this.clock = 0;
    this.syncRealClockFromFilmClock();
  }

  // sebesség csúszka mozgatása
  onSpeedInput(evt: Event) {
    const input = evt.target as HTMLInputElement;
    const sliderValue = Number(input.value);

    if (!Number.isFinite(sliderValue)) return;

    this.speedSlider = Math.max(0, Math.min(100, Math.round(sliderValue)));
    const factor = this.sliderToFactor(this.speedSlider);
    this.speed = Math.round(factor * 1000);
  }

  // csúszka pozíció (0..100) -> sebesség szorzó, logaritmikusan
  private sliderToFactor(slider: number): number {
    const s = Math.max(0, Math.min(100, slider));

    // 0..50 => MIN_SPEED_FACTOR .. 1x
    if (s <= 50) {
      const t = s / 50;
      return this.MIN_SPEED_FACTOR * Math.pow(1 / this.MIN_SPEED_FACTOR, t);
    }

    // 50..100 => 1x .. MAX_SPEED_FACTOR
    const t = (s - 50) / 50;
    return Math.pow(this.MAX_SPEED_FACTOR, t);
  }

  // sliderToFactor inverze: szorzó -> csúszka pozíció
  private factorToSlider(factor: number): number {
    const f = Math.max(
      this.MIN_SPEED_FACTOR,
      Math.min(this.MAX_SPEED_FACTOR, factor),
    );

    // MIN_SPEED_FACTOR .. 1x
    if (f <= 1) {
      const t =
        Math.log(f / this.MIN_SPEED_FACTOR) /
        Math.log(1 / this.MIN_SPEED_FACTOR);
      return Math.round(t * 50);
    }

    // 1x .. MAX_SPEED_FACTOR
    const t = Math.log(f) / Math.log(this.MAX_SPEED_FACTOR);
    return Math.round(50 + t * 50);
  }

  // sebesség beállítása film ms/sec értékkel (1000 = 1x), a csúszkát is igazítja
  setSpeed(v: number) {
    const factor = Math.max(
      this.MIN_SPEED_FACTOR,
      Math.min(this.MAX_SPEED_FACTOR, v / 1000),
    );

    this.speed = Math.round(factor * 1000);
    this.speedSlider = this.factorToSlider(factor);
  }

  // előző eseményre ugrás
  jumpPrevEvent(): void {
    if (!this.eventFilmMs.length) return;

    const i = this.findPrevEventIndex(this.clock);

    this.clock = i === -1 ? 0 : this.eventFilmMs[i];
    this.syncRealClockFromFilmClock();

    if (this.playing) {
      this.lastFrameTs = null;
    }
  }

  // következő eseményre ugrás
  jumpNextEvent(): void {
    if (!this.eventFilmMs.length) return;

    const i = this.findNextEventIndex(this.clock);

    this.clock = i === -1 ? this.filmDuration : this.eventFilmMs[i];
    this.syncRealClockFromFilmClock();

    if (this.playing) {
      this.lastFrameTs = null;
    }
  }

  ngOnDestroy(): void {
    this.stopPlayback();
    this.cleanupCron?.stop();
  }

  // egy esemény-jelölő bal pozíciója CSS calc-ként
  markerLeft(pct: number): string {
    const thumb = this.sliderThumbPx; // px
    // (100% - thumb) sávon mozog a thumb közepe, ezért így pozicionálunk
    return `calc(${thumb / 2}px + (100% - ${thumb}px) * ${pct / 100})`;
  }

  /** filmidő -> valós idő (ms) lineáris skálázással */
  private filmToReal(filmMs: number): number {
    if (this.filmDuration <= 0 || this.realDuration <= 0) return 0;
    const ratio = this.realDuration / this.filmDuration;
    return filmMs * ratio;
  }

  /** frissíti a clockReal-t a jelenlegi film clock alapján */
  private syncRealClockFromFilmClock(): void {
    this.clockReal = Math.max(
      0,
      Math.min(this.realDuration, this.filmToReal(this.clock)),
    );
  }

  /** A film hossza a felhasználó által állított érték (alapból 20s). */
  private computeFilmDuration(): number {
    return this.filmSettingMs;
  }

  /** A lejátszási (film) hossz módosítása ms-ban, élő trace-nél átskálázva. */
  onFilmLengthInput(evt: Event): void {
    const input = evt.target as HTMLInputElement;
    const raw = Number(input.value);

    // Üres / érvénytelen bevitelnél visszaállítjuk a jelenlegi értéket
    if (!input.value.trim() || !Number.isFinite(raw)) {
      input.value = String(this.filmSettingMs);
      return;
    }

    const nextMs = Math.round(
      Math.max(this.MIN_FILM_MS, Math.min(this.MAX_FILM_MS, raw)),
    );
    input.value = String(nextMs); // a klampolt érték visszaírása a mezőbe
    const prev = this.filmDuration;
    this.filmSettingMs = nextMs;

    // Ha van betöltött trace, tartsuk meg a playhead relatív pozícióját és
    // építsük újra a filmidő-függő származtatott értékeket.
    if (prev > 0) {
      const frac = this.clock / prev;
      this.filmDuration = nextMs;
      this.clock = Math.round(frac * nextMs);
      this.eventFilmMs = this.buildEventFilmMs();
      this.rebuildEventMarkers();
      this.syncRealClockFromFilmClock();
    }
  }

  // valós ms -> film ms a küldésekhez; a travel-lel csökkentett sávra skáláz,
  // hogy az utolsó üzenet még a film vége előtt beérjen
  private realToFilmMsForSend(realMs: number): number {
    const travel = Math.max(1, this.msgTravelFilmMs);
    const usableFilm = Math.max(1, this.filmDuration - travel - 1);

    if (this.realDuration <= 0) return 0;
    const ratio = usableFilm / this.realDuration;
    return realMs * ratio; // film ms
  }

  // sárga pöttyök újraszámolása a csúszkára (minden üzenet küldési pillanata)
  private rebuildEventMarkers(): void {
    if (this.filmDuration <= 0 || this.realDuration <= 0) {
      this.eventMarkers = [];
      return;
    }

    // MINDEN üzenet sendAt pillanatát jelöljük
    const rawPercents = (this.allMessages ?? []).map((m) => {
      const sendReal = m.sendAt ?? 0; // valós ms (t0-hoz képest)
      const sendFilm = this.realToFilmMsForSend(sendReal); // film ms (usableFilm skála)
      const pct = (sendFilm / this.filmDuration) * 100; // 0..100
      return Math.max(0, Math.min(100, pct));
    });

    this.eventMarkers = rawPercents.map((pct) => ({ leftPct: pct }));
  }

  // sendAt-ok (real ms) -> film ms, kerekítve, duplikátum nélkül, rendezve
  private buildEventFilmMs(): number[] {
    if (!this.allMessages?.length) return [];
    if (this.realDuration <= 0 || this.filmDuration <= 0) return [];

    const travel = Math.max(1, this.msgTravelFilmMs ?? 800);
    const usableFilm = Math.max(1, this.filmDuration - travel);
    const ratio = usableFilm / this.realDuration;

    const times = this.allMessages.map((m) => {
      const sendReal = m.sendAt ?? 0; // valós ms (t0-hoz képest)
      const sendFilm = sendReal * ratio; // film ms
      return Math.max(0, Math.min(usableFilm, Math.ceil(sendFilm))); // EGÉSZ ms!
    });

    // duplikátumok kiszedése + rendezés
    return Array.from(new Set(times)).sort((a, b) => a - b);
  }

  // legnagyobb index, ahol eventFilmMs[idx] < currentClock (szigorúan előző)
  private findPrevEventIndex(currentClock: number): number {
    const arr = this.eventFilmMs;
    let lo = 0,
      hi = arr.length - 1;
    let ans = -1;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < currentClock) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return ans;
  }

  // legkisebb index, ahol eventFilmMs[idx] > currentClock (szigorúan következő)
  private findNextEventIndex(currentClock: number): number {
    const arr = this.eventFilmMs;
    let lo = 0,
      hi = arr.length - 1;
    let ans = -1;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] > currentClock) {
        ans = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    return ans;
  }
}
