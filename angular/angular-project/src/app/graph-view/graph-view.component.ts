import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as d3 from 'd3';
import { VizLink, VizNode, VizMessage } from '../models/trace.model';

@Component({
  selector: 'app-graph-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './graph-view.component.html',
  styleUrls: ['./graph-view.component.scss'],
})
export class GraphViewComponent implements OnChanges, AfterViewInit {
  // Bemeneti adatok: csomópontok és élek a vizualizációhoz
  @Input() nodes: VizNode[] = [];
  @Input() links: VizLink[] = [];
  @Input() messages: VizMessage[] = [];
  @Input() clockReal = 0;
  @Input() clockFilm = 0;
  @Input() realDuration = 0;
  @Input() filmDuration = 0;
  @Input() msgTravelFilmMs = 800;

  // Hivatkozás az SVG elemre a sablonból
  @ViewChild('svgRef', { static: true }) svgRef!: ElementRef<SVGSVGElement>;

  // D3 kiválasztások az SVG és csoportok kezeléséhez
  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private gLinks!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private gNodes!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private gMsgs!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private msgSel!: d3.Selection<
    SVGTextElement,
    VizMessage,
    SVGGElement,
    unknown
  >;
  private gViewport!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private linkSel!: d3.Selection<SVGLineElement, SimLink, SVGGElement, unknown>;
  private nodeSel!: d3.Selection<SVGGElement, SimNode, SVGGElement, unknown>;

  // D3 force simulation példány
  private sim!: d3.Simulation<SimNode, SimLink>;

  // Canvas méretek
  private width = 1000;
  private height = 640;

  // Csatorna alapú színskála (ordinal)
  private channelColor = d3.scaleOrdinal<number, string>(d3.schemeTableau10);
  private viewReady = false; // true, ha az SVG inicializálva lett

  // Zoom viselkedés definiálása
  private zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.2, 8]) // min/max nagyítás
    .translateExtent([
      [0, 0],
      [this.width, this.height],
    ])
    .on('zoom', (event) => {
      // az aktuális transzformációt a viewport <g>-re tesszük
      this.gViewport.attr('transform', event.transform.toString());
    });

  // Komponens inicializálás után: SVG létrehozása és első rajzolás
  ngAfterViewInit(): void {
    this.initSvg();
    this.viewReady = true;
    if (this.nodes?.length || this.links?.length) this.draw();
  }

  // Input változások figyelése: ha a nézet kész, újrarajzolunk
  ngOnChanges(ch: SimpleChanges): void {
    if (!this.viewReady) return;
    if (ch['nodes'] || ch['links'] || ch['messages']) {
      this.draw();
    } else if (
      ch['clockReal'] ||
      ch['clockFilm'] ||
      ch['realDuration'] ||
      ch['filmDuration']
    ) {
      this.applyVisibility();
      this.updateMessagePositions();
    }
  }

  // SVG és alapg csoportok létrehozása / törlése
  private initSvg() {
    this.svg = d3
      .select(this.svgRef.nativeElement)
      .attr('viewBox', `0 0 ${this.width} ${this.height}`)
      .call(this.zoom as any)
      .style('background', '#0b1220')
      .style('overflow', 'hidden');

    //tisztítás
    this.svg.selectAll('*').remove();

    const defs = this.svg.append('defs');
    defs
      .append('clipPath')
      .attr('id', 'clip-viewport')
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', this.width)
      .attr('height', this.height);

    // Viewport csoport a zoom/pan kezeléséhez
    this.gViewport = this.svg
      .append('g')
      .attr('class', 'viewport')
      .attr('clip-path', 'url(#clip-viewport)');

    // két csoport létrehozása: élek és csomópontok
    this.gLinks = this.gViewport.append('g').attr('class', 'links');
    this.gNodes = this.gViewport.append('g').attr('class', 'nodes');
    this.gMsgs = this.gViewport.append('g').attr('class', 'messages');
  }

  // Fő rajzoló függvény: létrehozza / frissíti a szimulációt, éleket, node-okat
  private draw() {
    // Ha nincs adat, töröljük a tartalmat és létrehozzuk az üres csoportokat
    if (!this.nodes?.length && !this.links?.length) {
      this.gViewport.selectAll('*').remove();
      this.gLinks = this.gViewport.append('g').attr('class', 'links');
      this.gNodes = this.gViewport.append('g').attr('class', 'nodes');
      return;
    }

    // Színek domainjának beállítása a csatorna azonosítók alapján
    this.channelColor.domain(Array.from(new Set(this.links.map((l) => l.ch))));

    // Munka másolat a D3 szimulációhoz: node-ok kezdeti pozícióval
    const simNodes: SimNode[] = this.nodes.map((n) => ({
      ...n,
      x: this.width / 2,
      y: this.height / 2,
    }));

    // a forceLink id accessor stringet vár, ezért a source/target stringgé konvertáljuk.
    const simLinks: SimLink[] = this.links.map((l) => ({
      id: l.id,
      ch: l.ch,
      buffered: l.buffered,
      bufferSize: l.bufferSize,
      appearAt: l.appearAt ?? 0,
      source: String(l.source),
      target: String(l.target),
    }));

    // Szimuláció konfigurálása: leállítjuk az előzőt, majd új példány
    this.sim?.stop();

    // távolság és erősség beállítása, az id accessor stringet használja
    const linkForce = d3
      .forceLink<SimNode, SimLink>(simLinks)
      .id((d) => String(d.id)) // node azonosító: string formátumban
      .distance(140)
      .strength(0.3);

    // Szimuláció összeállítása több erővel (center, charge, collision, x/y, link)
    this.sim = d3
      .forceSimulation<SimNode>(simNodes)
      .force('center', d3.forceCenter(this.width / 2, this.height / 2))
      .force(
        'charge',
        d3.forceManyBody<SimNode>().strength(-600).distanceMax(1000),
      )
      .force('collision', d3.forceCollide<SimNode>().radius(30))
      .force('x', d3.forceX<SimNode>(this.width / 2).strength(0.05))
      .force('y', d3.forceY<SimNode>(this.height / 2).strength(0.05))
      .force('link', linkForce)
      .alpha(1)
      .alphaDecay(0.05)
      .on('tick', () => this.onTick(simNodes, simLinks));

    // 4) Link SVG elemek: adat kötés, kilépők eltávolítása, enter rész létrehozása
    this.linkSel = this.gLinks
      .selectAll<SVGLineElement, SimLink>('line')
      .data(simLinks, (d: any) => d.id);

    this.linkSel.exit().remove();

    const linkEnter = this.linkSel
      .enter()
      .append('line')
      .attr('stroke-width', 2)
      .attr('stroke', (d) => this.channelColor(d.ch) as string) // csatorna szerinti szín
      .attr('opacity', 0.7)
      .attr('stroke-dasharray', (d: any) => (d.buffered ? '6,4' : null)); // szaggatott, ha buffered

    this.linkSel = linkEnter.merge(this.linkSel as any);

    // Node-ok SVG elemei: group (g) tartalmaz circle + text
    this.nodeSel = this.gNodes
      .selectAll<SVGGElement, SimNode>('g.node')
      .data(simNodes, (d: any) => d.id);

    this.nodeSel.exit().remove();

    const enter = this.nodeSel.enter().append('g').attr('class', 'node');
    enter
      .append('circle')
      .attr('r', 20)
      .attr('fill', '#e5e7eb') // világos kitöltés
      .attr('stroke', '#94a3b8'); // körvonal
    enter
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('y', 5)
      .attr('font-size', 12)
      .attr('fill', '#0b0f19')
      .text((d) => d.label); // címke: pl. g1, g2

    this.nodeSel = enter.merge(this.nodeSel as any);

    // Drag viselkedés: start/drag/end események kezelése
    const dragBehavior = d3
      .drag<SVGGElement, SimNode>()
      .on('start', (event, d) => {
        if (!event.active) this.sim.alphaTarget(0.3).restart(); // szimuláció "felélesztése"
        d.fx = d.x; // rögzítjük az aktuális pozíciót
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x; // követi az egér pozícióját
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) this.sim.alphaTarget(0); // visszaállítjuk az alphaTarget-et
        d.fx = null; // elengedjük, a force mozgatja tovább
        d.fy = null;
      });

    // Drag-et mind az enter, mind az update szelekcióra alkalmazzuk
    this.gNodes.selectAll<SVGGElement, SimNode>('g.node').call(dragBehavior);

    // üzenetek (messages) kirajzolása
    this.msgSel = this.gMsgs
      .selectAll<SVGTextElement, VizMessage>('text.msg')
      .data(this.messages ?? [], (d: any) => d.id);

    this.msgSel.exit().remove();

    const msgEnter = this.msgSel
      .enter()
      .append('text')
      .attr('class', 'msg')
      .attr('text-anchor', 'middle')
      .attr('font-size', 11)
      .attr('fill', '#fbbf24')
      .attr('opacity', 0.95);

    this.msgSel = msgEnter.merge(this.msgSel as any);

    // szöveg beállítása (egyszerű rövidítés)
    this.msgSel.text((d) => this.formatMsgValue(d.value));

    // induló láthatóság + pozíció
    this.updateMessagePositions();
    this.applyVisibility();
  }

  private applyVisibility() {

    const nowReal = this.clockReal ?? 0;
    const nowFilm = this.clockFilm ?? 0;

    // 1) node láthatóság
    const visibleNodeIds = new Set<number>();

    this.nodeSel.style('display', (d) => {
      const show = (d.appearAt ?? 0) <= nowReal;
      if (show) visibleNodeIds.add(d.id);
      return show ? null : 'none';
    });

    // 2) link láthatóság: idő + mindkét végpont látszik
    this.linkSel.style('display', (d) => {
      const timeOk = (d.appearAt ?? 0) <= nowReal;

      // linkForce tick után source/target SimNode lesz,
      // de a draw pillanatában még string is lehet.
      const sId =
        typeof d.source === 'string'
          ? Number(d.source)
          : (d.source as SimNode).id;
      const tId =
        typeof d.target === 'string'
          ? Number(d.target)
          : (d.target as SimNode).id;

      const endsOk = visibleNodeIds.has(sId) && visibleNodeIds.has(tId);
      return timeOk && endsOk ? null : 'none';
    });

    // 3) üzenetek: sendAt <= now <= sendAt + MSG_TRAVEL_MS
    if (this.msgSel) {
      const travel = Math.max(1, this.msgTravelFilmMs ?? 800);
      this.msgSel.style('display', (m) => {
        const sendFilm = this.realToFilmMs(m.sendAt ?? 0);
        return sendFilm <= nowFilm && nowFilm <= sendFilm + travel
          ? null
          : 'none';
      });
    }
  }

  // Tick callback: pozíciók lekorlátozása és SVG frissítése minden lépésben
  private onTick(nodes: SimNode[], links: SimLink[]) {
    const margin = 30;

    // A pozíciókat a határok közé szorítjuk (ne menjenek ki az ablakból)
    nodes.forEach((d) => {
      d.x = Math.max(
        margin,
        Math.min(this.width - margin, d.x ?? this.width / 2),
      );
      d.y = Math.max(
        margin,
        Math.min(this.height - margin, d.y ?? this.height / 2),
      );
    });

    // Linkek vonal koordinátáinak frissítése (forcelink átalakítja source/target-et SimNode-é)
    this.gLinks
      .selectAll<SVGLineElement, SimLink>('line')
      .attr('x1', (d) => (d.source as SimNode).x!)
      .attr('y1', (d) => (d.source as SimNode).y!)
      .attr('x2', (d) => (d.target as SimNode).x!)
      .attr('y2', (d) => (d.target as SimNode).y!);

    // Node csoportok eltolása az aktuális pozícióra
    this.gNodes
      .selectAll<SVGGElement, SimNode>('g.node')
      .attr('transform', (d) => `translate(${d.x},${d.y})`);

    this.updateMessagePositions();
  }

  private formatMsgValue(v: any): string {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'string') return v.length > 30 ? v.slice(0, 30) + '…' : v;
    if (typeof v === 'number') return String(v);
    try {
      const s = JSON.stringify(v);
      return s.length > 30 ? s.slice(0, 30) + '…' : s;
    } catch {
      return '[obj]';
    }
  }

  //üzenetek pozíciója
  private updateMessagePositions(): void {
    if (!this.msgSel) return;

    const nowFilm = this.clockFilm ?? 0;
    const travel = Math.max(1, this.msgTravelFilmMs ?? 800);

    const NODE_R = 20;
    const PAD = 10; // körön kívülre toljuk

    // node id -> aktuális node pozíciók
    const nodeById = new Map<number, SimNode>();
    this.nodeSel.each((d) => nodeById.set(d.id, d));

    const OFFSET = 10;

    this.msgSel
      .attr('x', (m) => {
        const a = nodeById.get(m.from);
        const b = nodeById.get(m.to);
        if (!a || !b) return 0;

        const ax = a.x ?? 0,
          ay = a.y ?? 0;
        const bx = b.x ?? 0,
          by = b.y ?? 0;

        const dx = bx - ax;
        const dy = by - ay;
        const dist = Math.hypot(dx, dy) || 1;

        const ux = dx / dist;
        const uy = dy / dist;

        // normál vektor (lane eltoláshoz)
        const nx = -uy;
        const ny = ux;

        // start/end a körökön kívül
        const startX = ax + ux * (NODE_R + PAD);
        const startY = ay + uy * (NODE_R + PAD);
        const endX = bx - ux * (NODE_R + PAD);
        const endY = by - uy * (NODE_R + PAD);

        const sendFilm = this.realToFilmMs(m.sendAt ?? 0);
        const t = (nowFilm - sendFilm) / travel;
        const p = Math.max(0, Math.min(1, t));

        return startX + (endX - startX) * p + nx * OFFSET;
      })
      .attr('y', (m) => {
        const a = nodeById.get(m.from);
        const b = nodeById.get(m.to);
        if (!a || !b) return 0;

        const ax = a.x ?? 0,
          ay = a.y ?? 0;
        const bx = b.x ?? 0,
          by = b.y ?? 0;

        const dx = bx - ax;
        const dy = by - ay;
        const dist = Math.hypot(dx, dy) || 1;

        const ux = dx / dist;
        const uy = dy / dist;

        const nx = -uy;
        const ny = ux;

        const startX = ax + ux * (NODE_R + PAD);
        const startY = ay + uy * (NODE_R + PAD);
        const endX = bx - ux * (NODE_R + PAD);
        const endY = by - uy * (NODE_R + PAD);

        const sendFilm = this.realToFilmMs(m.sendAt ?? 0);
        const t = (nowFilm - sendFilm) / travel;
        const p = Math.max(0, Math.min(1, t));


        return startY + (endY - startY) * p + ny * OFFSET;
      });
  }

  private realToFilmMs(realMs: number): number {
    const travel = Math.max(1, this.msgTravelFilmMs ?? 800);

    const usableFilm = Math.max(1, (this.filmDuration ?? 0) - travel);

    if (this.realDuration <= 0 || usableFilm <= 0) return realMs;
    const ratio = usableFilm / this.realDuration;
    return realMs * ratio;
  }
}

//Lokális típusok a D3 szimulációhoz
type SimNode = d3.SimulationNodeDatum & {
  id: number;
  label: string;
  appearAt?: number;
  fx?: number | null; // rögzített X (drag vagy fixálás esetén)
  fy?: number | null; // rögzített Y
};

type SimLink = d3.SimulationLinkDatum<SimNode> & {
  id: string;
  ch: number;
  buffered?: boolean;
  bufferSize?: number;
  appearAt?: number;
  // a forcelink előtt stringként van (id-ként), utána D3 átalakítja SimNode objektummá
  source: string | SimNode;
  target: string | SimNode;
};
