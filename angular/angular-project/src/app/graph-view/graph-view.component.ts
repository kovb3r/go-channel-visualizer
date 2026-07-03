import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
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
export class GraphViewComponent implements OnChanges, AfterViewInit, OnDestroy {
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
  private msgSel!: d3.Selection<SVGGElement, VizMessage, SVGGElement, unknown>;
  private gViewport!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private linkSel!: d3.Selection<SVGPathElement, SimLink, SVGGElement, unknown>;
  private nodeSel!: d3.Selection<SVGGElement, SimNode, SVGGElement, unknown>;

  private sim!: d3.Simulation<SimNode, SimLink>;

  private gArrived!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private arrivedSel!: d3.Selection<SVGGElement, ArrivedGroup, SVGGElement, unknown>;

  // Badge + hover-popover állapot a beérkezett üzenetekhez
  private gTooltip!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private hoveredArrived: number | null = null;
  private pinnedArrived = new Set<number>(); // kattintással rögzített popoverek (több is)
  private arrivedByNode = new Map<number, string[]>();

  private width = 1000;
  private height = 640;

  // Determinisztikus csatorna -> szín leképezés. Szándékosan NEM d3.scaleOrdinal:
  // az ordinal skála állapotfüggő (ismeretlen értékre bővíti a domaint), ami a
  // link- és pill-festés között eltérő színt adhatott ugyanarra a csatornára.
  private chColorMap = new Map<number, string>();
  private viewReady = false;

  private colorForCh(ch: number): string {
    return this.chColorMap.get(ch) ?? 'var(--cv-text-muted)';
  }

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

  private resizeObs?: ResizeObserver;

  ngAfterViewInit(): void {
    this.measureSize();
    this.initSvg();
    this.viewReady = true;
    this.observeResize();
    if (this.nodes?.length || this.links?.length) this.draw();
  }

  ngOnDestroy(): void {
    this.resizeObs?.disconnect();
    this.sim?.stop();
  }

  // A tényleges konténer-méret kiolvasása, hogy a gráf a teljes rendelkezésre
  // álló területet használja (nincs fix 1000×640-es letterbox).
  private measureSize(): void {
    const rect = this.svgRef.nativeElement.getBoundingClientRect();
    this.width = Math.max(320, Math.round(rect.width) || this.width);
    this.height = Math.max(240, Math.round(rect.height) || this.height);
  }

  private observeResize(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObs = new ResizeObserver(() => this.onResize());
    this.resizeObs.observe(this.svgRef.nativeElement);
  }

  private onResize(): void {
    const prevW = this.width;
    const prevH = this.height;
    this.measureSize();
    if (this.width === prevW && this.height === prevH) return;
    if (!this.svg) return;

    this.svg.attr('viewBox', `0 0 ${this.width} ${this.height}`);
    this.zoom.translateExtent([
      [0, 0],
      [this.width, this.height],
    ]);

    if (this.sim) {
      (this.sim.force('center') as d3.ForceCenter<SimNode>)?.x(this.width / 2).y(this.height / 2);
      (this.sim.force('x') as d3.ForceX<SimNode>)?.x(this.width / 2);
      (this.sim.force('y') as d3.ForceY<SimNode>)?.y(this.height / 2);
      this.sim.alpha(0.3).restart();
    }
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
    // A zoom pan-tartományát a tényleges mérethez igazítjuk
    this.zoom.translateExtent([
      [0, 0],
      [this.width, this.height],
    ]);

    this.svg = d3
      .select(this.svgRef.nativeElement)
      .attr('viewBox', `0 0 ${this.width} ${this.height}`)
      .call(this.zoom as any)
      .style('background', 'var(--cv-bg-surface-2)')
      .style('overflow', 'hidden');

    this.svg.selectAll('*').remove();

    // Nincs külön clipPath: az SVG overflow:hidden vág, és így a vágódoboz
    // NEM skálázódik együtt a zoommal (a clip a zoomolt csoporton ült korábban).
    this.gViewport = this.svg.append('g').attr('class', 'viewport');

    this.gLinks = this.gViewport.append('g').attr('class', 'links');
    this.gNodes = this.gViewport.append('g').attr('class', 'nodes');
    this.gMsgs = this.gViewport.append('g').attr('class', 'messages');
    this.gArrived = this.gViewport.append('g').attr('class', 'arrived');
    this.gTooltip = this.gViewport
      .append('g')
      .attr('class', 'arrived-tooltip')
      .style('pointer-events', 'none');
  }

  private draw() {
    if (!this.nodes?.length && !this.links?.length) {
      this.gViewport.selectAll('*').remove();
      this.gLinks = this.gViewport.append('g').attr('class', 'links');
      this.gNodes = this.gViewport.append('g').attr('class', 'nodes');
      return;
    }

    // Determinisztikus, hívási sorrendtől független csatorna-színek
    const palette = d3.schemeTableau10;
    const uniqueChs = Array.from(new Set(this.links.map((l) => l.ch))).sort((a, b) => a - b);
    this.chColorMap.clear();
    uniqueChs.forEach((ch, i) => this.chColorMap.set(ch, palette[i % palette.length]));

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
      .attr('stroke', (d) => this.colorForCh(d.ch))
      .attr('opacity', 0.85)
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
      .attr('stroke-width', 2)
      .style('fill', 'var(--cv-accent-bg)')
      .style('stroke', 'var(--cv-accent)');
    enter
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('y', 5)
      .attr('font-size', 12)
      .attr('font-weight', 600)
      .style('fill', 'var(--cv-accent-text)')
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
      .selectAll<SVGGElement, VizMessage>('g.msg')
      .data(this.messages ?? [], (d: any) => d.id);

    this.msgSel.exit().remove();

    const msgEnter = this.msgSel
      .enter()
      .append('g')
      .attr('class', 'msg');

    // Pill háttér a csatorna színével
    msgEnter
      .append('rect')
      .attr('class', 'msg-bg')
      .attr('rx', 6)
      .attr('ry', 6)
      .style('fill', (d) => this.colorForCh(d.ch));

    // Felirat: fehér szöveg a pillen
    msgEnter
      .append('text')
      .attr('class', 'msg-label')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', 11)
      .attr('font-weight', 600)
      .attr('fill', '#ffffff');

    this.msgSel = msgEnter.merge(this.msgSel as any);

    // Szöveg + a hátteret a szöveg köré méretezzük
    this.msgSel.select<SVGTextElement>('text.msg-label').text((d) => this.formatMsgValue(d.value));
    this.sizeMessagePills();

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
      this.hideArrivedTooltip();
      this.arrivedByNode.clear();
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
    this.arrivedByNode = byTo;

    const data: ArrivedGroup[] = Array.from(byTo.entries())
      .filter(([to]) => nodeById.has(to))
      .map(([to, lines]) => ({ to, lines }));

    const sel = this.gArrived
      .selectAll<SVGGElement, ArrivedGroup>('g.arrived-badge')
      .data(data, (d: any) => d.to);

    sel.exit().remove();

    // Belépő badge: kör + darabszám, saját egérfigyeléssel (a szülő pointer-events:none).
    // Hover: ideiglenes popover. Kattintás: rögzítés (pin), újra kattintva old.
    const enter = sel.enter().append('g').attr('class', 'arrived-badge');
    enter
      .style('pointer-events', 'all')
      .style('cursor', 'pointer')
      .on('mouseenter', (_e, d) => {
        this.hoveredArrived = d.to;
        this.refreshArrivedTooltip();
      })
      .on('mouseleave', () => {
        this.hoveredArrived = null;
        this.refreshArrivedTooltip();
      })
      .on('click', (e, d) => {
        e.stopPropagation();
        if (this.pinnedArrived.has(d.to)) this.pinnedArrived.delete(d.to);
        else this.pinnedArrived.add(d.to);
        this.refreshArrivedTooltip();
        this.updateArrivedBadgeStyles();
      });
    enter.append('circle').attr('class', 'arrived-badge-bg');
    enter
      .append('text')
      .attr('class', 'arrived-badge-count')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', 10)
      .attr('font-weight', 600)
      .style('fill', '#ffffff');

    this.arrivedSel = enter.merge(sel as any);

    const NODE_R = 20;
    const BADGE_R = 9;
    const dx = NODE_R * 0.72; // jobb-felső sarok
    const dy = -NODE_R * 0.72;

    this.arrivedSel.each((d, i, groups) => {
      const g = d3.select(groups[i]);
      const n = nodeById.get(d.to);
      if (!n) return;
      g.attr('transform', `translate(${n.x ?? 0},${n.y ?? 0})`);

      const pinned = this.pinnedArrived.has(d.to);
      g.select('circle.arrived-badge-bg')
        .attr('cx', dx)
        .attr('cy', dy)
        .attr('r', BADGE_R)
        .style('fill', 'var(--cv-accent)')
        .style('stroke', pinned ? 'var(--cv-warning)' : 'var(--cv-bg-header)')
        .style('stroke-width', pinned ? 2 : 1.5);

      g.select('text.arrived-badge-count')
        .attr('x', dx)
        .attr('y', dy)
        .text(d.lines.length > 99 ? '99+' : String(d.lines.length));
    });

    // Nyitott popover frissítése (a lista nőhetett), vagy bezárása ha elfogyott
    this.refreshArrivedTooltip();
  }

  // A megjelenítendő popoverek: minden rögzített (pin) + az épp hoverelt (ha van).
  private visibleTooltipIds(): number[] {
    const ids = new Set<number>();
    for (const id of this.pinnedArrived) if (this.arrivedByNode.has(id)) ids.add(id);
    if (this.hoveredArrived != null && this.arrivedByNode.has(this.hoveredArrived)) {
      ids.add(this.hoveredArrived);
    }
    return Array.from(ids);
  }

  private refreshArrivedTooltip(): void {
    if (!this.gTooltip) return;
    this.gTooltip.selectAll('*').remove();
    for (const id of this.visibleTooltipIds()) this.renderArrivedTooltip(id);
  }

  // Csak a badge-körvonalak frissítése (pin jelzés) – teljes újraépítés nélkül.
  private updateArrivedBadgeStyles(): void {
    if (!this.arrivedSel) return;
    this.arrivedSel.each((d, i, groups) => {
      const pinned = this.pinnedArrived.has(d.to);
      d3.select(groups[i])
        .select('circle.arrived-badge-bg')
        .style('stroke', pinned ? 'var(--cv-warning)' : 'var(--cv-bg-header)')
        .style('stroke-width', pinned ? 2 : 1.5);
    });
  }

  private hideArrivedTooltip(): void {
    this.hoveredArrived = null;
    this.pinnedArrived.clear();
    this.gTooltip?.selectAll('*').remove();
  }

  // Egy popover a csomópont mellé (a gTooltip törlését a hívó refresh végzi,
  // hogy egyszerre több rögzített popover is megférjen).
  private renderArrivedTooltip(nodeId: number): void {
    if (!this.gTooltip) return;

    const lines = this.arrivedByNode.get(nodeId);
    const n = this.getNode(nodeId);
    if (!lines || !lines.length || !n) return;

    const MAX_ROWS = 8;
    const shown = lines.slice(-MAX_ROWS).reverse();
    const overflow = lines.length - shown.length;

    const label = this.nodeLabel(nodeId) ?? `#${nodeId}`;
    const header = `${label} · ${lines.length} beérkezett`;

    const PAD = 8;
    const ROW_H = 15;
    const HEADER_H = 17;
    const NODE_R = 20;

    const g = this.gTooltip.append('g').attr('class', 'arrived-pop');

    // Előbb a szövegek (hogy meg tudjuk mérni a panel szélességét)
    const headerText = g
      .append('text')
      .attr('font-size', 10)
      .attr('font-weight', 600)
      .attr('dominant-baseline', 'hanging')
      .style('fill', 'var(--cv-text-muted)')
      .text(header);

    const rowTexts = shown.map((v) =>
      g
        .append('text')
        .attr('font-size', 11)
        .attr('dominant-baseline', 'hanging')
        .style('fill', 'var(--cv-text)')
        .text(v)
    );
    if (overflow > 0) {
      rowTexts.push(
        g
          .append('text')
          .attr('font-size', 11)
          .attr('dominant-baseline', 'hanging')
          .style('fill', 'var(--cv-text-dim)')
          .text(`+${overflow} korábbi…`)
      );
    }

    let maxW = (headerText.node() as SVGTextElement).getComputedTextLength();
    rowTexts.forEach((t) => {
      const w = (t.node() as SVGTextElement).getComputedTextLength();
      if (w > maxW) maxW = w;
    });

    const rows = rowTexts.length;
    const panelW = maxW + PAD * 2;
    const panelH = PAD + HEADER_H + rows * ROW_H + PAD;

    // Panel a csomópont jobb oldalán; ha kilógna, balra kerül
    let px = (n.x ?? 0) + NODE_R + 10;
    const py = (n.y ?? 0) - panelH / 2;
    if (px + panelW > this.width) px = (n.x ?? 0) - NODE_R - 10 - panelW;

    g.attr('transform', `translate(${px},${py})`);

    // Háttér a szövegek mögé
    g.insert('rect', ':first-child')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', panelW)
      .attr('height', panelH)
      .attr('rx', 8)
      .attr('ry', 8)
      .style('fill', 'var(--cv-bg-surface)')
      .style('stroke', 'var(--cv-border-strong)')
      .style('stroke-width', 1);

    headerText.attr('x', PAD).attr('y', PAD);
    rowTexts.forEach((t, idx) => {
      t.attr('x', PAD).attr('y', PAD + HEADER_H + idx * ROW_H);
    });
  }

  private getNode(id: number): SimNode | undefined {
    let found: SimNode | undefined;
    this.nodeSel?.each((d) => {
      if (d.id === id) found = d;
    });
    return found;
  }

  private nodeLabel(id: number): string | undefined {
    return this.nodes.find((n) => n.id === id)?.label;
  }

  private updateArrivedPositionsOnly(): void {
    if (!this.showArrived) return;
    if (!this.arrivedSel) return;

    const nodeById = new Map<number, SimNode>();
    this.nodeSel.each((d) => nodeById.set(d.id, d));

    this.arrivedSel.each((d, i, nodes) => {
      const g = d3.select(nodes[i]);
      const n = nodeById.get(d.to);
      if (!n) return;
      g.attr('transform', `translate(${n.x ?? 0},${n.y ?? 0})`);
    });

    // A nyitott popoverek (hover vagy pin) kövessék a mozgó csomópontokat
    if (this.visibleTooltipIds().length > 0) this.refreshArrivedTooltip();
  }

  // A pill hátteret a felirat köré méretezi (0,0 középpont körül centrálva)
  private sizeMessagePills(): void {
    if (!this.msgSel) return;

    const PAD_X = 8;
    const PILL_H = 18;

    this.msgSel.each((_d, i, els) => {
      const g = d3.select(els[i]);
      const textNode = g.select<SVGTextElement>('text.msg-label').node();
      const w = textNode ? textNode.getComputedTextLength() : 0;

      g.select('rect.msg-bg')
        .attr('x', -(w / 2) - PAD_X)
        .attr('y', -PILL_H / 2)
        .attr('width', w + PAD_X * 2)
        .attr('height', PILL_H);
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
      el.attr('transform', `translate(${pos.x},${pos.y})`);
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
