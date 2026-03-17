import { Component, NgZone, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { TraceUploadComponent } from './trace-upload/trace-upload.component';
import { GraphViewComponent } from './graph-view/graph-view.component';
import { TraceFile, VizLink, VizNode, VizMessage } from './models/trace.model';
import { TraceParserService } from './services/trace-parser.service';

type EventMarker = { leftPct: number; stackIndex: number };

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    TraceUploadComponent,
    GraphViewComponent,
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnDestroy {
  title = 'angular-project';

  // A kirajzoláshoz szükséges adatok (gyerek komponens bemenetei)
  allNodes: VizNode[] = [];
  allLinks: VizLink[] = [];
  allMessages: VizMessage[] = [];

  eventFilmMs: number[] = [];
  eventMarkers: EventMarker[] = [];
  sliderThumbPx = 16; // kb. a range thumb szélessége

  msgTravelFilmMs = 800;

  // lejátszó állapot
  clock = 0;
  realDuration = 0; // trace valós hossza (ms)
  filmDuration = 0; // UI / slider hossza (ms) -> alapból 30s
  clockReal = 0; // valós óra (ms) -> ezt kapja a graph-view
  playing = false;
  speed = 500;

  private rafId: number | null = null;
  private lastFrameTs: number | null = null;

  constructor(
    private parser: TraceParserService,
    private zone: NgZone,
  ) {}

  /** Feltöltött és alap-validált nyers JSON itt érkezik. */
  onTraceLoaded(raw: TraceFile) {
    try {
      // 1) idő-normalizálás
      const norm = this.parser.toNormalized(raw);
      const eventsCount = norm.events.length ?? 0;

      this.realDuration = Math.max(0, norm.t1 - norm.t0);
      this.filmDuration = this.computeFilmDuration(
        this.realDuration,
        eventsCount,
      );

      // 2) viz gráf előállítása
      const viz = this.parser.toVizGraph(norm);
      // 3) átadjuk a rajzolónak
      this.allNodes = viz.nodes;
      this.allLinks = viz.links;

      this.allMessages = this.parser.toVizMessages(norm);

      this.eventFilmMs = this.buildEventFilmMs();

      this.stopPlayback();
      this.clock = 0;
      this.syncRealClockFromFilmClock();
      this.rebuildEventMarkers();

      // fejlesztéshez:
      console.log('viz graph:', viz);
    } catch (e) {
      console.error(e);
      alert((e as any)?.message ?? 'Hiba a trace feldolgozásakor.');
    }
  }

  // slider input kezelése
  onClockInput(evt: Event) {
    const input = evt.target as HTMLInputElement;
    const v = Number(input.value);

    this.clock = Number.isFinite(v) ? v : 0;
    this.syncRealClockFromFilmClock();
  }

  /*
  // a clock alapján szűrjük, mi látszódjon
  applyClock() {
    const t = this.clock;

    // látható node-ok
    const visibleNodes = this.allNodes.filter((n) => (n.appearAt ?? 0) <= t);
    const visibleIds = new Set(visibleNodes.map((n) => n.id));

    // látható linkek: appearAt + csak akkor, ha mindkét végpont látható
    const visibleLinks = this.allLinks.filter(
      (l) =>
        (l.appearAt ?? 0) <= t &&
        visibleIds.has(l.source) &&
        visibleIds.has(l.target)
    );

    this.allNodes = visibleNodes;
    this.allLinks = visibleLinks;
  }*/

  // ===== vezérlők =====
  togglePlay(): void {
    if (this.playing) {
      this.stopPlayback();
      return;
    }
    if (this.filmDuration <= 0) return; // nincs mit lejátszani

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

  private stopPlayback(): void {
    this.playing = false;
    this.lastFrameTs = null;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  play() {
    if (this.playing || this.filmDuration <= 0) return;
    this.playing = true;
    this.lastFrameTs = null;

    // RAF loop (kívül Angularon, hogy ne darálja a CD-t minden frame)
    this.zone.runOutsideAngular(() => {
      const tick = (ts: number) => {
        if (!this.playing) return;

        if (this.lastFrameTs === null) this.lastFrameTs = ts;
        const dtSec = (ts - this.lastFrameTs) / 1000; // valós idő (sec)
        this.lastFrameTs = ts;

        const next = this.clock + dtSec * this.speed; // trace ms

        // vissza Angularba csak a state frissítéshez
        this.zone.run(() => {
          this.clock = Math.min(this.filmDuration, Math.round(next));

          // ha elértük a végét: álljunk meg (később lehet loop opció)
          if (this.clock >= this.filmDuration) {
            this.pause();
            return;
          }
        });

        this.rafId = requestAnimationFrame(tick);
      };

      this.rafId = requestAnimationFrame(tick);
    });
  }

  pause() {
    this.playing = false;
    this.lastFrameTs = null;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  restart() {
    this.stopPlayback();
    this.clock = 0;
    this.syncRealClockFromFilmClock();
  }

  step(deltaFilmMs: number) {
    this.stopPlayback();
    this.clock = Math.max(
      0,
      Math.min(this.filmDuration, this.clock + deltaFilmMs),
    );
    this.syncRealClockFromFilmClock();
  }

  setSpeed(v: number) {
    this.speed = v;
  }

  // előző eseményre ugrás
  jumpPrevEvent(): void {
    if (!this.eventFilmMs.length) return;

    const i = this.findPrevEventIndex(this.clock);
    this.clock = this.eventFilmMs[i];
    this.syncRealClockFromFilmClock();

    if (this.playing) {
      this.lastFrameTs = null; 
    }
  }

  // következő eseményre ugrás
  jumpNextEvent(): void {
    if (!this.eventFilmMs.length) return;

    const i = this.findNextEventIndex(this.clock);
    this.clock = this.eventFilmMs[i];
    this.syncRealClockFromFilmClock();

    if (this.playing) {
      this.lastFrameTs = null;
    }
  }

  ngOnDestroy(): void {
    this.pause();
  }

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

  /** filmidő hossza: alapból 30s, ha a valós trace hosszabb, akkor legyen annyi */
  private computeFilmDuration(realMs: number, eventsCount: number): number {
    const minFilm = 2_000; // 2s
    const maxFilm = 60_000; // 60s

    const k = 0.6; // valós idő arány
    const msPerEvent = 400; // tempó (kisebb = gyorsabb, nagyobb = lassabb)

    const byReal = realMs * k;
    const byEvents = eventsCount * msPerEvent;

    const base = Math.max(byReal, byEvents);
    const clamped = Math.max(minFilm, Math.min(maxFilm, Math.floor(base)));

    return clamped;
  }

  private realToFilmMsForSend(realMs: number): number {
    const travel = Math.max(1, this.msgTravelFilmMs);
    const usableFilm = Math.max(1, this.filmDuration - travel);

    if (this.realDuration <= 0) return 0;
    const ratio = usableFilm / this.realDuration;
    return realMs * ratio; // film ms
  }

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

    // stacking: ha ugyanoda esik több, tegyük egymás fölé (nem dobunk el semmit!)
    const counts = new Map<string, number>();
    this.eventMarkers = rawPercents.map((pct) => {
      const key = pct.toFixed(3); // elég finom, nem von össze “véletlenül”
      const idx = counts.get(key) ?? 0;
      counts.set(key, idx + 1);
      return { leftPct: pct, stackIndex: idx };
    });
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
    let ans = 0;

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
    let ans = arr.length - 1;

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
