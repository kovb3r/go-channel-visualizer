import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { TraceUploadComponent } from './trace-upload/trace-upload.component';
import { GraphViewComponent } from './graph-view/graph-view.component';
import { TraceFile, VizLink, VizNode } from './models/trace.model';
import { TraceParserService } from './services/trace-parser.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, TraceUploadComponent, GraphViewComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  title = 'angular-project';

  // A kirajzoláshoz szükséges adatok (gyerek komponens bemenetei)
  nodes: VizNode[] = [];
  links: VizLink[] = [];

  constructor(private parser: TraceParserService) {}

  /** Feltöltött és alap-validált nyers JSON itt érkezik. */
  onTraceLoaded(raw: TraceFile) {
    try {
      // 1) idő-normalizálás
      const norm = this.parser.toNormalized(raw);
      // 2) viz gráf előállítása
      const viz = this.parser.toVizGraph(norm);
      // 3) átadjuk a rajzolónak
      this.nodes = viz.nodes;
      this.links = viz.links;
      // fejlesztéshez:
      console.log('viz graph:', viz);
    } catch (e) {
      console.error(e);
      alert((e as any)?.message ?? 'Hiba a trace feldolgozásakor.');
    }
  }
}
