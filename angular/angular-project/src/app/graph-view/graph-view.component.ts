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

type ArrivedGroup = { to: number; lines: string[] };

@Component({
  selector: 'app-graph-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './graph-view.component.html',
  styleUrls: ['./graph-view.component.scss'],
})
export class GraphViewComponent implements OnChanges, AfterViewInit {
  @Input() nodes: VizNode[] = [];
  @Input() links: VizLink[] = [];
  @Input() messages: VizMessage[] = [];
  @Input() clockReal = 0;
  @Input() clockFilm = 0;
  @Input() realDuration = 0;
  @Input() filmDuration = 0;
  @Input() msgTravelFilmMs = 800;
  @Input() showArrived = false;

  @ViewChild('svgRef', { static: true }) svgRef!: ElementRef<SVGSVGElement>;

  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private gLinks!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private gNodes!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private gMsgs!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private msgSel!: d3.Selection<SVGTextElement, VizMessage, SVGGElement, unknown>;
  private gViewport!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private linkSel!: d3.Selection<SVGPathElement, SimLink, SVGGElement, unknown>;
  private nodeSel!: d3.Selection<SVGGElement, SimNode, SVGGElement, unknown>;

  private sim!: d3.Simulation<SimNode, SimLink>;

  private gArrived!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private arrivedSel!: d3.Selection<SVGGElement, ArrivedGroup, SVGGElement, unknown>;

  private width = 1000;
  private height = 640;

  private channelColor = d3.scaleOrdinal<number, string>(d3.schemeTableau10);
  private viewReady = false;

  // linkId -> görbületi eltolás pixelben (0 = egyenes, ±N = görbe)
  private linkBend = new Map<string, number>();

  private zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.2, 8])
    .translateExtent([
      [0, 0],
      [this.width, this.height],
    ])
    .on('zoom', (event) => {
      this.gViewport.attr('transform', event.transform.toString());
    });

  ngAfterViewInit(): void {
    this.initSvg();
    this.viewReady = true;
    if (this.nodes?.length || this.links?.length) this.draw();
  }

  ngOnChanges(ch: SimpleChanges): void {
    if (!this.viewReady) return;
    if (ch['nodes'] || ch['links'] || ch['messages']) {
      this.draw();
    } else if (
      ch['clockReal'] ||
      ch['clockFilm'] ||
      ch['realDuration'] ||
      ch['filmDuration'] ||
      ch['showArrived']
    ) {
      this.applyVisibility();
      this.updateMessagePositions();
      this.updateArrivedLists();
    }
  }

  private initSvg() {
    this.svg = d3
      .select(this.svgRef.nativeElement)
      .attr('viewBox', `0 0 ${this.width} ${this.height}`)
      .call(this.zoom as any)
      .style('background', '#0b1220')
      .style('overflow', 'hidden');

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

    this.gViewport = this.svg
      .append('g')
      .attr('class', 'viewport')
      .attr('clip-path', 'url(#clip-viewport)');

    this.gLinks = this.gViewport.append('g').attr('class', 'links');
    this.gNodes = this.gViewport.append('g').attr('class', 'nodes');
    this.gMsgs = this.gViewport.append('g').attr('class', 'messages');
    this.gArrived = this.gViewport.append('g').attr('class', 'arrived');
  }

  private draw() {
    if (!this.nodes?.length && !this.links?.length) {
      this.gViewport.selectAll('*').remove();
      this.gLinks = this.gViewport.append('g').attr('class', 'links');
      this.gNodes = this.gViewport.append('g').attr('class', 'nodes');
      return;
    }

    this.channelColor.domain(Array.from(new Set(this.links.map((l) => l.ch))));

    const simNodes: SimNode[] = this.nodes.map((n) => ({
      ...n,
      x: this.width / 2,
      y: this.height / 2,
    }));

    const simLinks: SimLink[] = this.links.map((l) => ({
      id: l.id,
      ch: l.ch,
      buffered: l.buffered,
      bufferSize: l.bufferSize,
      appearAt: l.appearAt ?? 0,
      source: String(l.source),
      target: String(l.target),
    }));

    // Párhuzamos élek görbületi eltolásainak kiszámítása
    this.computeBendOffsets(simLinks);

    this.sim?.stop();

    const linkForce = d3
      .forceLink<SimNode, SimLink>(simLinks)
      .id((d) => String(d.id))
      .distance(140)
      .strength(0.3);

    this.sim = d3
      .forceSimulation<SimNode>(simNodes)
      .force('center', d3.forceCenter(this.width / 2, this.height / 2))
      .force('charge', d3.forceManyBody<SimNode>().strength(-600).distanceMax(1000))
      .force('collision', d3.forceCollide<SimNode>().radius(30))
      .force('x', d3.forceX<SimNode>(this.width / 2).strength(0.05))
      .force('y', d3.forceY<SimNode>(this.height / 2).strength(0.05))
      .force('link', linkForce)
      .alpha(1)
      .alphaDecay(0.05)
      .on('tick', () => this.onTick(simNodes, simLinks));

    // Élek: <path> elemek (nem <line>), hogy görbíthetők legyenek
    this.linkSel = this.gLinks
      .selectAll<SVGPathElement, SimLink>('path.link')
      .data(simLinks, (d: any) => d.id);

    this.linkSel.exit().remove();

    const linkEnter = this.linkSel
      .enter()
      .append('path')
      .attr('class', 'link')
      .attr('fill', 'none')
      .attr('stroke-width', 2)
      .attr('stroke', (d) => this.channelColor(d.ch) as string)
      .attr('opacity', 0.7)
      .attr('stroke-dasharray', (d: any) => (d.buffered ? '6,4' : null));

    this.linkSel = linkEnter.merge(this.linkSel as any);

    this.nodeSel = this.gNodes
      .selectAll<SVGGElement, SimNode>('g.node')
      .data(simNodes, (d: any) => d.id);

    this.nodeSel.exit().remove();

    const enter = this.nodeSel.enter().append('g').attr('class', 'node');
    enter
      .append('circle')
      .attr('r', 20)
      .attr('fill', '#e5e7eb')
      .attr('stroke', '#94a3b8');
    enter
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('y', 5)
      .attr('font-size', 12)
      .attr('fill', '#0b0f19')
      .text((d) => d.label);

    this.nodeSel = enter.merge(this.nodeSel as any);

    const dragBehavior = d3
      .drag<SVGGElement, SimNode>()
      .on('start', (event, d) => {
        if (!event.active) this.sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) this.sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    this.gNodes.selectAll<SVGGElement, SimNode>('g.node').call(dragBehavior);

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
    this.msgSel.text((d) => this.formatMsgValue(d.value));

    this.updateMessagePositions();
    this.applyVisibility();
    this.updateArrivedLists();
  }

  // Párhuzamos élek szimmetrikus görbületi eltolásai:
  // azonos csúcspár → linkek ID szerint rendezve, egyenletesen szétosztva 0 körül.
  private computeBendOffsets(links: SimLink[]): void {
    const CURVE_GAP = 60;
    const pairGroups = new Map<string, SimLink[]>();

    for (const l of links) {
      // source/target ezen a ponton még string (node ID)
      const pairKey = `${l.source}-${l.target}`;
      const group = pairGroups.get(pairKey) ?? [];
      group.push(l);
      pairGroups.set(pairKey, group);
    }

    this.linkBend.clear();
    for (const group of pairGroups.values()) {
      group.sort((a, b) => a.id.localeCompare(b.id)); // stabil sorrend
      const n = group.length;
      group.forEach((l, i) => {
        // n=1 → 0 (egyenes), n=2 → -30/+30, n=3 → -60/0/+60, stb.
        this.linkBend.set(l.id, n === 1 ? 0 : (i - (n - 1) / 2) * CURVE_GAP);
      });
    }
  }

  // SVG path string egy (esetleg görbe) élhez
  private linkPath(sx: number, sy: number, ex: number, ey: number, bend: number): string {
    if (bend === 0) return `M ${sx} ${sy} L ${ex} ${ey}`;
    const [cpx, cpy] = this.controlPoint(sx, sy, ex, ey, bend);
    return `M ${sx} ${sy} Q ${cpx} ${cpy} ${ex} ${ey}`;
  }

  // Kvadratikus Bézier vezérlőpont: a félúton merőlegesen eltolva
  private controlPoint(
    sx: number, sy: number,
    ex: number, ey: number,
    bend: number
  ): [number, number] {
    const mx = (sx + ex) / 2;
    const my = (sy + ey) / 2;
    const dx = ex - sx;
    const dy = ey - sy;
    const dist = Math.hypot(dx, dy) || 1;
    // egységnormál (90°-kal CCW elforgatva)
    const nx = -dy / dist;
    const ny = dx / dist;
    return [mx + nx * bend, my + ny * bend];
  }

  // Pont a kvadratikus Bézier-görbén t ∈ [0,1] paraméternél
  private quadBezierPoint(
    sx: number, sy: number,
    ex: number, ey: number,
    bend: number, t: number
  ): { x: number; y: number } {
    const [cpx, cpy] = this.controlPoint(sx, sy, ex, ey, bend);
    const mt = 1 - t;
    return {
      x: mt * mt * sx + 2 * t * mt * cpx + t * t * ex,
      y: mt * mt * sy + 2 * t * mt * cpy + t * t * ey,
    };
  }

  private applyVisibility() {
    const nowFilm = this.clockFilm ?? 0;

    const visibleNodeIds = new Set<number>();

    this.nodeSel.style('display', (d) => {
      const appearFilm = this.realToFilmMs(d.appearAt ?? 0);
      const show = appearFilm <= nowFilm;
      if (show) visibleNodeIds.add(d.id);
      return show ? null : 'none';
    });

    this.linkSel.style('display', (d) => {
      const appearFilm = this.realToFilmMs(d.appearAt ?? 0);
      const sId = typeof d.source === 'string' ? Number(d.source) : (d.source as SimNode).id;
      const tId = typeof d.target === 'string' ? Number(d.target) : (d.target as SimNode).id;
      const endsOk = visibleNodeIds.has(sId) && visibleNodeIds.has(tId);
      return appearFilm <= nowFilm && endsOk ? null : 'none';
    });

    if (this.msgSel) {
      const travel = Math.max(1, this.msgTravelFilmMs ?? 800);
      this.msgSel.style('display', (m) => {
        const sendFilm = this.realToFilmMs(m.sendAt ?? 0);
        const timeOk = sendFilm <= nowFilm && nowFilm <= sendFilm + travel;
        const endsOk = visibleNodeIds.has(m.from) && visibleNodeIds.has(m.to);
        return timeOk && endsOk ? null : 'none';
      });
    }
  }

  private onTick(nodes: SimNode[], _links: SimLink[]) {
    const margin = 30;

    nodes.forEach((d) => {
      d.x = Math.max(margin, Math.min(this.width - margin, d.x ?? this.width / 2));
      d.y = Math.max(margin, Math.min(this.height - margin, d.y ?? this.height / 2));
    });

    // Path d attribútum frissítése minden tick-ben
    this.gLinks
      .selectAll<SVGPathElement, SimLink>('path.link')
      .attr('d', (d) => {
        const s = d.source as SimNode;
        const e = d.target as SimNode;
        const bend = this.linkBend.get(d.id) ?? 0;
        return this.linkPath(s.x!, s.y!, e.x!, e.y!, bend);
      });

    this.gNodes
      .selectAll<SVGGElement, SimNode>('g.node')
      .attr('transform', (d) => `translate(${d.x},${d.y})`);

    this.updateMessagePositions();
    this.updateArrivedPositionsOnly();
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

  private updateArrivedLists(): void {
    if (!this.gArrived) return;

    if (!this.showArrived) {
      this.gArrived.selectAll('*').remove();
      return;
    }

    const nowFilm = this.clockFilm ?? 0;
    const travel = Math.max(1, this.msgTravelFilmMs ?? 800);

    const nodeById = new Map<number, SimNode>();
    this.nodeSel?.each((d) => nodeById.set(d.id, d));

    const byTo = new Map<number, string[]>();

    for (const m of this.messages ?? []) {
      const sendFilm = this.realToFilmMs(m.sendAt ?? 0);
      const arriveFilm = sendFilm + travel;

      if (nowFilm >= arriveFilm) {
        const arr = byTo.get(m.to) ?? [];
        arr.push(this.formatMsgValue(m.value));
        byTo.set(m.to, arr);
      }
    }

    const data: ArrivedGroup[] = Array.from(byTo.entries())
      .filter(([to]) => nodeById.has(to))
      .map(([to, lines]) => ({ to, lines }));

    const sel = this.gArrived
      .selectAll<SVGGElement, ArrivedGroup>('g.arrived-group')
      .data(data, (d: any) => d.to);

    sel.exit().remove();

    const enter = sel.enter().append('g').attr('class', 'arrived-group');

    enter
      .append('text')
      .attr('class', 'arrived-text')
      .attr('text-anchor', 'middle')
      .attr('font-size', 10)
      .attr('fill', '#d97706')
      .attr('opacity', 0.95);

    this.arrivedSel = enter.merge(sel as any);

    const LINE_H = 12;
    const TOP_PAD = 28;

    this.arrivedSel.each((d, i, nodes) => {
      const g = d3.select(nodes[i]);
      const n = nodeById.get(d.to);
      if (!n) return;

      g.attr('transform', `translate(${n.x ?? 0},${(n.y ?? 0) - TOP_PAD})`);

      const text = g.select<SVGTextElement>('text.arrived-text');
      text.selectAll('tspan').remove();

      d.lines.forEach((line, idx) => {
        text
          .append('tspan')
          .attr('x', 0)
          .attr('dy', idx === 0 ? 0 : LINE_H)
          .text(line);
      });
    });
  }

  private updateArrivedPositionsOnly(): void {
    if (!this.showArrived) return;
    if (!this.arrivedSel) return;

    const nodeById = new Map<number, SimNode>();
    this.nodeSel.each((d) => nodeById.set(d.id, d));

    const TOP_PAD = 28;

    this.arrivedSel.each((d, i, nodes) => {
      const g = d3.select(nodes[i]);
      const n = nodeById.get(d.to);
      if (!n) return;
      g.attr('transform', `translate(${n.x ?? 0},${(n.y ?? 0) - TOP_PAD})`);
    });
  }

  // Üzenetek pozíciói: a saját csatornájuk élének Bézier-görbéjén haladnak
  private updateMessagePositions(): void {
    if (!this.msgSel) return;

    const nowFilm = this.clockFilm ?? 0;
    const travel = Math.max(1, this.msgTravelFilmMs ?? 800);

    const NODE_R = 20;
    const PAD = 10;

    const nodeById = new Map<number, SimNode>();
    this.nodeSel.each((d) => nodeById.set(d.id, d));

    this.msgSel.each((m, i, elems) => {
      const el = d3.select(elems[i]);

      // Kanonikális él azonosítása a channelId + csúcspár alapján
      const a = Math.min(m.from, m.to); // él source (kisebb ID)
      const b = Math.max(m.from, m.to); // él target (nagyobb ID)
      const linkId = `ch${m.ch}-${a}-${b}`;
      const bend = this.linkBend.get(linkId) ?? 0;

      const nodeA = nodeById.get(a);
      const nodeB = nodeById.get(b);
      if (!nodeA || !nodeB) return;

      // sx/sy = source node (min ID), ex/ey = target node (max ID)
      const sx = nodeA.x ?? 0, sy = nodeA.y ?? 0;
      const ex = nodeB.x ?? 0, ey = nodeB.y ?? 0;

      const dist = Math.hypot(ex - sx, ey - sy) || 1;
      const edgeFrac = (NODE_R + PAD) / dist;
      const tStart = Math.min(edgeFrac, 0.45);       // csúcs széléhez közeli t
      const tEnd   = Math.max(1 - edgeFrac, 0.55);   // másik csúcs széléhez közeli t

      const sendFilm = this.realToFilmMs(m.sendAt ?? 0);
      const p = Math.max(0, Math.min(1, (nowFilm - sendFilm) / travel));

      // Ha from > to, az üzenet B→A irányban halad (fordított t paraméterezés)
      const reversed = m.from > m.to;
      const tParam = reversed
        ? tEnd - p * (tEnd - tStart)    // B→A: tEnd-től tStart felé
        : tStart + p * (tEnd - tStart); // A→B: tStart-tól tEnd felé

      const pos = this.quadBezierPoint(sx, sy, ex, ey, bend, tParam);
      el.attr('x', pos.x).attr('y', pos.y);
    });
  }

  private realToFilmMs(realMs: number): number {
    const travel = Math.max(1, this.msgTravelFilmMs ?? 800);
    const usableFilm = Math.max(1, (this.filmDuration ?? 0) - travel - 1);
    if (this.realDuration <= 0 || usableFilm <= 0) return realMs;
    return realMs * (usableFilm / this.realDuration);
  }
}

type SimNode = d3.SimulationNodeDatum & {
  id: number;
  label: string;
  appearAt?: number;
  fx?: number | null;
  fy?: number | null;
};

type SimLink = d3.SimulationLinkDatum<SimNode> & {
  id: string;
  ch: number;
  buffered?: boolean;
  bufferSize?: number;
  appearAt?: number;
  source: string | SimNode;
  target: string | SimNode;
};
