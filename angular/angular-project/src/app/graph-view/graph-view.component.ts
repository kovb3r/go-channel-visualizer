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
import { VizLink, VizNode } from '../models/trace.model';

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

  // Hivatkozás az SVG elemre a sablonból
  @ViewChild('svgRef', { static: true }) svgRef!: ElementRef<SVGSVGElement>;

  // D3 kiválasztások az SVG és csoportok kezeléséhez
  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private gLinks!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private gNodes!: d3.Selection<SVGGElement, unknown, null, undefined>;

  // D3 force simulation példány
  private sim!: d3.Simulation<SimNode, SimLink>;

  // Canvas méretek
  private width = 1000;
  private height = 640;

  // Csatorna alapú színskála (ordinal)
  private channelColor = d3.scaleOrdinal<number, string>(d3.schemeTableau10);
  private viewReady = false; // true, ha az SVG inicializálva lett

  // Komponens inicializálás után: SVG létrehozása és első rajzolás
  ngAfterViewInit(): void {
    this.initSvg();
    this.viewReady = true;
    if (this.nodes?.length || this.links?.length) this.draw();
  }

  // Input változások figyelése: ha a nézet kész, újrarajzolunk
  ngOnChanges(ch: SimpleChanges): void {
    if (!this.viewReady) return;
    if (ch['nodes'] || ch['links']) this.draw();
  }

  // SVG és alapg csoportok létrehozása / törlése
  private initSvg() {
    this.svg = d3
      .select(this.svgRef.nativeElement)
      .attr('viewBox', `0 0 ${this.width} ${this.height}`)
      .style('background', '#0b1220');

    // Tisztítás és két csoport létrehozása: élek és csomópontok
    this.svg.selectAll('*').remove();
    this.gLinks = this.svg.append('g').attr('class', 'links');
    this.gNodes = this.svg.append('g').attr('class', 'nodes');
  }

  // Fő rajzoló függvény: létrehozza / frissíti a szimulációt, éleket, node-okat
  private draw() {
    // Ha nincs adat, töröljük a tartalmat és létrehozzuk az üres csoportokat
    if (!this.nodes?.length && !this.links?.length) {
      this.svg?.selectAll('*').remove();
      this.gLinks = this.svg.append('g').attr('class', 'links');
      this.gNodes = this.svg.append('g').attr('class', 'nodes');
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
      .force('charge', d3.forceManyBody<SimNode>().strength(-250))
      .force('collision', d3.forceCollide<SimNode>().radius(28))
      .force('x', d3.forceX<SimNode>(this.width / 2).strength(0.05))
      .force('y', d3.forceY<SimNode>(this.height / 2).strength(0.05))
      .force('link', linkForce)
      .alpha(1)
      .alphaDecay(0.05)
      .on('tick', () => this.onTick(simNodes, simLinks));

    // 4) Link SVG elemek: adat kötés, kilépők eltávolítása, enter rész létrehozása
    const linkSel = this.gLinks
      .selectAll<SVGLineElement, SimLink>('line')
      .data(simLinks, (d: any) => d.id);

    linkSel.exit().remove();

    linkSel
      .enter()
      .append('line')
      .attr('stroke-width', 2)
      .attr('stroke', (d) => this.channelColor(d.ch) as string) // csatorna szerinti szín
      .attr('opacity', 0.7);

    // Node-ok SVG elemei: group (g) tartalmaz circle + text
    const nodeSel = this.gNodes
      .selectAll<SVGGElement, SimNode>('g.node')
      .data(simNodes, (d: any) => d.id);

    nodeSel.exit().remove();

    const enter = nodeSel.enter().append('g').attr('class', 'node');
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
  }

  // Tick callback: pozíciók lekorlátozása és SVG frissítése minden lépésben
  private onTick(nodes: SimNode[], links: SimLink[]) {
    const margin = 30;

    // A pozíciókat a határok közé szorítjuk (ne menjenek ki az ablakból)
    nodes.forEach((d) => {
      d.x = Math.max(
        margin,
        Math.min(this.width - margin, d.x ?? this.width / 2)
      );
      d.y = Math.max(
        margin,
        Math.min(this.height - margin, d.y ?? this.height / 2)
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
  }
}

/** —— Lokális típusok a D3 szimulációhoz —— */
type SimNode = d3.SimulationNodeDatum & {
  id: number;
  label: string;
  fx?: number | null; // rögzített X (drag vagy fixálás esetén)
  fy?: number | null; // rögzített Y
};

type SimLink = d3.SimulationLinkDatum<SimNode> & {
  id: string;
  ch: number;
  // a forcelink előtt stringként van (id-ként), utána D3 átalakítja SimNode objektummá
  source: string | SimNode;
  target: string | SimNode;
};