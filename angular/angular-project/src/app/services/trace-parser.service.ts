import { Injectable } from '@angular/core';
import {
  TraceFile,
  NormalizedTrace,
  NormalizedEvent,
  VizNode,
  VizLink,
  VizMessage,
} from '../models/trace.model';

@Injectable({ providedIn: 'root' })
export class TraceParserService {
  // normalizeIso: rövidebb tizedesjegyeket vág le úgy, hogy a Date.parse konzisztensen működjön
  // (a regex a tizedes részre fókuszál, és legfeljebb 3 számjegyet hagy meg)
  private normalizeIso(iso: string): string {
    return iso.replace(
      /\.(\d+)(?=(Z|[+-]\d{2}:?\d{2})$)/,
      (_m, frac: string) => '.' + frac.slice(0, 3)
    );
  }

  // parseTimeMs: ISO stringet ms-ben visszaadó segédfüggvény
  // - normalizeIso-t használ, majd Date.parse-t hív
  // - hibát dob, ha az eredmény nem érvényes szám
  private parseTimeMs(iso: string): number {
    const n = Date.parse(this.normalizeIso(iso));
    if (!Number.isFinite(n)) throw new Error(`Érvénytelen időbélyeg: "${iso}"`);
    return n;
  }

  // toNormalized: nyers TraceFile-t normalize-olt objektummá alakít
  // - kiszedi a csatornák és események időbélyegeit ms-ben
  // - kiszámolja a globális t0 (minimum) és t1 (maximum) időpontokat
  // - normalizálja az események sendAt/recvAt mezőit úgy, hogy t0 legyen a 0 időpont
  // - rendezést alkalmaz az eseményekre küldési idő szerint
  toNormalized(raw: TraceFile): NormalizedTrace {
    const allTimes: number[] = [];
    const sendTimes: number[] = [];

    // csatornák feldolgozása: timestamp -> ms, gyűjtjük a timeokat
    const normChannels = (raw.Channels ?? []).map((ch) => {
      const t = this.parseTimeMs(ch.timestamp);
      allTimes.push(t);
      return {
        id: ch.channelId,
        createdAt: t,
        buffered: ch.buffered ?? false,
        bufferSize: ch.bufferSize ?? 0,
        firstUseAt: null,
      };
    });

    // események feldolgozása: SendTime és ReceiveTime -> ms
    const tmpEvents: NormalizedEvent[] = (raw.Events ?? []).map((e) => {
      const s = this.parseTimeMs(e.SendTime);
      const r = this.parseTimeMs(e.ReceiveTime);
      allTimes.push(s, r);
      sendTimes.push(s);
      return {
        ch: e.ChannelID,
        msg: e.MessageID,
        from: e.SenderID,
        to: e.ReceiverID,
        sendAt: s,
        recvAt: r,
        value: e.Value,
      };
    });

    // ha nincs legalább egy időbélyeg, nincs értelme folytatni
    if (allTimes.length === 0) {
      throw new Error('A fájl nem tartalmaz érvényes időbélyegeket.');
    }

    // t0 = legkisebb idő, t1 = legnagyobb idő (ms)
    const t0 = sendTimes.length > 0 ? Math.min(...sendTimes) : Math.min(...allTimes);
    const t1 = Math.max(...allTimes);

    // események rendezése és normalizálása (t0 levonása)
    const events = tmpEvents
      .sort((a, b) => a.sendAt - b.sendAt)
      .map((e) => ({ ...e, sendAt: e.sendAt - t0, recvAt: e.recvAt - t0 }));

    // csatornák normalizálása (createdAt relatív idő)
    const channels = normChannels.map((c) => ({
      id: c.id,
      createdAt: Math.max(0, c.createdAt - t0),
      buffered: c.buffered,
      bufferSize: c.bufferSize,
      firstUseAt: c.firstUseAt,
    }));

    return { channels, events, t0, t1 };
  }

  // toVizGraph: NormalizedTrace alapján vizualizációs gráf csomópontokkal és élekkel
  // - nodeSet: gyűjti az összes goroutine azonosítót (from/to)
  // - linkMap: csatorna+pair alapján egyedi élek létrehozása (iránytól független)
  // - a link id formátuma: `ch{channel}-{min(from,to)}-{max(from,to)}`
  toVizGraph(trace: NormalizedTrace): { nodes: VizNode[]; links: VizLink[] } {
    const nodeSet = new Set<number>();
    const linkMap = new Map<string, VizLink>();

    const chBuffered = new Map<number, boolean>();
    const chBufSize = new Map<number, number>();
    (trace.channels ?? []).forEach((c) => {
      chBuffered.set(c.id, !!c.buffered);
      chBufSize.set(c.id, c.bufferSize ?? 0);
    });

    const nodeFirstUse = new Map<number, number>(); // nodeId -> ms
    const linkFirstUse = new Map<string, number>(); // linkId -> ms

    for (const e of trace.events) {
      nodeSet.add(e.from);
      nodeSet.add(e.to);

      // Node first use (min sendAt)
      const t = e.sendAt;
      const prevFrom = nodeFirstUse.get(e.from);
      const prevTo = nodeFirstUse.get(e.to);
      if (prevFrom === undefined || t < prevFrom) nodeFirstUse.set(e.from, t);
      if (prevTo === undefined || t < prevTo) nodeFirstUse.set(e.to, t);

      // sorrendezés, hogy az él iránytól független legyen (konzisztens id)
      const a = Math.min(e.from, e.to);
      const b = Math.max(e.from, e.to);
      const id = `ch${e.ch}-${a}-${b}`;

      const prevLink = linkFirstUse.get(id);
      if (prevLink === undefined || t < prevLink) linkFirstUse.set(id, t);

      if (!linkMap.has(id)) {
        linkMap.set(id, {
          id: id,
          ch: e.ch,
          source: a,
          target: b,
          buffered: chBuffered.get(e.ch) ?? false,
          bufferSize: chBufSize.get(e.ch) ?? 0,
        });
      }
    }

    // csomópontok és élek tömbbé alakítása a vizualizációhoz
    const nodes: VizNode[] = Array.from(nodeSet).map((id) => ({
      id,
      label: `g${id}`,
      appearAt: nodeFirstUse.get(id) ?? 0
    }));
    const links: VizLink[] = Array.from(linkMap.values()).map(l => ({
      ...l,
      appearAt: linkFirstUse.get(l.id) ?? 0
    }));

    return { nodes, links };
  }

  toVizMessages(trace: NormalizedTrace): VizMessage[] {
    return (trace.events ?? []).map((e) => ({
      id: e.msg,
      ch: e.ch,
      from: e.from,
      to: e.to,
      sendAt: e.sendAt,
      recvAt: e.recvAt,
      value: e.value,
    }));
  }
}
