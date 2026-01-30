/**
 * A nyers (feltöltött) JSON szerkezete. Ezt a trace-upload ismeri és küldi felénk.
 */
export type RawValue = string | number | Record<string, unknown>;

export interface Channel {
    channelId: number;
    timestamp: string; // ISO string (pl. 2025-10-27T12:19:46.5502455+01:00)
    buffered?: boolean;
    bufferSize?: number;
}

export interface TraceEvent {
    ChannelID: number;
    MessageID: number;
    SenderID: number;
    ReceiverID: number;
    SendTime: string; // ISO string
    ReceiveTime: string; // ISO string
    Value: RawValue;
}

export interface TraceFile {
    Channels: Channel[];
    Events: TraceEvent[];
}

/**
 * Normalizált, időben ms-ra átszámolt változat.
 */

export interface NormalizedChannel {
    id: number;
    createdAt: number; // ms, t0-hoz képest
    buffered: boolean;
    bufferSize: number;
    firstUseAt: number | null; // első használat (ms, t0-hoz képest)
}

export interface NormalizedEvent {
    ch: number;
    msg: number;
    from: number;
    to: number;
    sendAt: number; // ms, t0-hoz képest
    recvAt: number; // ms, t0-hoz képest
    value: RawValue;
}

export interface NormalizedTrace {
    channels: NormalizedChannel[];
    events: NormalizedEvent[];
    t0: number;
    t1: number;
}

/**
 * A vizualizációhoz használt minimális gráf-struktúra:
 * nodes = goroutine-ok, links = csatorna-használat élek.
 * Egy él egy (ChannelID, min(from,to), max(from,to)) egyedi kombináció.
 */
export interface VizNode {
    id: number; // goroutine azonosító (pl. 23)
    label: string; // felirat (pl. "g23")
    appearAt?: number; // ms, mikor jelenjen meg (opcionális)
}

export interface VizLink {
    id: string; // egyedi él ID (pl. "ch2-23-24")
    ch: number; // ChannelID, a színezéshez
    source: number; // goroutine id (kisebb)
    target: number; // goroutine id (nagyobb)
    buffered?: boolean;
    bufferSize?: number;
    appearAt?: number; // ms, mikor jelenjen meg (opcionális)
}

export interface VizMessage {
    id: number; // MessageID
    ch: number; // ChannelID
    from: number; // goroutine id
    to: number; // goroutine id
    sendAt: number; // ms
    recvAt: number; // ms
    value: RawValue;
}
