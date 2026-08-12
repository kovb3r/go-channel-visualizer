# Go Channel Visualizer – Használati útmutató

Ez az eszköz a Go goroutine-ok közötti, **csatornákon átmenő kommunikációt**
teszi láthatóvá: a program futása közben naplózza a csatorna-műveleteket, majd
a naplóból a böngészőben animált gráfot rajzol, ahol a **csomópontok a
goroutine-ok**, az **élek a csatornák**, az üzenetek pedig a küldőtől a
fogadóig „utaznak" az idővonal mentén.

A használat három lépésből áll:

1. **Instrumentálás** – a kódban a beépített `chan T` csatornákat a
   `wrapper.Channel[T]` típusra cseréled, a `<-` operátorokat pedig a
   `Send` / `Receive` metódushívásokra.
2. **Napló készítése** – a program futtatásakor a wrapper minden
   csatorna-létrehozást és minden **kézbesített** üzenetet (küldő és fogadó
   goroutine, időbélyegek, érték) egy `channels_<időbélyeg>.json` fájlba ment
   a munkakönyvtárban.
3. **Megjelenítés** – a JSON fájlt feltöltöd a webes felületre, és elindul az
   animáció.

---

## 1. Előfeltételek

- **Go 1.22.5 vagy újabb** – a könyvtár generikusokat használ, ezért ez a
  minimum. Ellenőrzés: `go version`.
- Egy böngésző a megjelenítéshez. A felület telepítés nélkül elérhető:
  <https://go-channel-visualizer.web.app/>

---

## 2. A `wrapper` könyvtár behúzása

A könyvtár egy nyilvános Go modul, így egyszerűen letölthető.

**2.1** Ha a projektednek még nincs modulja, hozz létre egyet a projekt
gyökerében:

```sh
go mod init a-modulod-neve
```

**2.2** Húzd be a wrapper könyvtárat:

```sh
go get github.com/kovb3r/go-channel-visualizer/wrapper@latest
```

**2.3** Importáld a kódba:

```go
import "github.com/kovb3r/go-channel-visualizer/wrapper"
```

---

## 3. Átírási szabályok: beépített csatorna → wrapper

Minden csatorna-műveletnek van wrapper-megfelelője. A `Send` és `Receive`
ugyanúgy **blokkol**, mint a beépített `<-` operátor, csak közben naplóznak is
— a program viselkedése tehát nem változik.

| Beépített Go | Wrapper megfelelő |
|---|---|
| `c := make(chan string)` | `c := wrapper.CreateChannel[string]()` |
| `c := make(chan int, 2)` | `c := wrapper.CreateChannel[int](2)` *(pufferelt)* |
| `c <- "ping"` | `c.Send("ping")` |
| `msg := <-c` | `msg, ok := c.Receive()` |
| `for v := range c { … }` | `for v := range c.Range() { … }` |
| `close(c)` | `c.Close()` |
| `c chan T` | `c wrapper.Channel[T]` |
| `func f(c chan<- T)` | `func f(c wrapper.Sender[T])` + híváskor `f(c.AsSender())` |
| `func f(c <-chan T)` | `func f(c wrapper.Receiver[T])` + híváskor `f(c.AsReceiver())` |

Három dolog, amire figyelni kell:

> **A `Receive` két értéket ad vissza:** `(érték, ok)`. Az `ok` `false`, ha a
> csatorna már le van zárva és kiürült. Ha nincs rá szükséged, eldobhatod:
> `msg, _ := c.Receive()`.

> **Az irányított nézetek szigorúak:** a `Sender[T]`-nek csak `Send` és
> `Close` metódusa van, a `Receiver[T]`-nek csak `Receive` és `Range`. Így —
> a beépített `chan<-` / `<-chan` típusokhoz hasonlóan — fordítási időben
> kiderül, ha egy függvény rossz irányban használná a csatornát.

> **A `select` nem támogatott:** a Go `select` utasítása csak beépített
> csatornákon működik, ezért nincs wrapper-megfelelője. Ha a programodban
> `select` van, az azon keresztül fogadott üzenetek **nem kerülnek be a
> naplóba**. Olyan programot érdemes választani, amely `Send` / `Receive` (vagy
> `range`) hívásokkal dolgozik.

---

## 4. Példák: egy teljes program átírva

Az alábbi részletek a repó `example/example.go` programjából származnak. Ez egy
önálló, futtatható program, amely **egyszerre mutatja be az összes átírási
esetet**: szinkron és pufferelt csatornát, saját típust, irányított nézeteket,
`range`-et és `close`-t. Minden szakasznál az eredeti és a wrapperre átírt
változat látható egymás mellett.

A program magától lefut (nem vár bemenetre), és a végén egy trace fájlt hagy
maga után 4 csatornával, 8 goroutine-nal és 16 eseménnyel.

### 4.1 Ping-pong — a legegyszerűbb eset

Két goroutine oda-vissza üzenget ugyanazon a csatornán. Az átírás mindössze négy
mechanikus csere: a típus, a létrehozás, a küldés és a fogadás.

**Eredeti:**

```go
func ping(c chan string) {
    c <- "ping"
    msg := <-c
    fmt.Println(msg)
    wg.Done()
}

func pong(c chan string) {
    msg := <-c
    fmt.Println(msg)
    c <- "pong"
    wg.Done()
}
```

**Wrapperrel:**

```go
func ping(c wrapper.Channel[string]) {
    c.Send("ping")
    msg, _ := c.Receive()
    fmt.Println(msg)
    wg.Done()
}

func pong(c wrapper.Channel[string]) {
    msg, _ := c.Receive()
    fmt.Println(msg)
    c.Send("pong")
    wg.Done()
}
```

### 4.2 Saját típus a csatornán

A wrapper generikus, ezért **bármilyen típus mehet rajta** — pontosan az kerül a
szögletes zárójelbe, ami az eredetiben a `chan` után állt.

**Eredeti:**

```go
type name struct {
    Name string
    Age  int
}

func nameChannel(c chan name) {
    c <- name{"Alice", 30}
    msg := <-c
    fmt.Printf("Name: %s, Age: %d\n", msg.Name, msg.Age)
    wg.Done()
}
```

**Wrapperrel:**

```go
func nameChannel(c wrapper.Channel[name]) {
    c.Send(name{"Alice", 30})
    msg, _ := c.Receive()
    fmt.Printf("Name: %s, Age: %d\n", msg.Name, msg.Age)
    wg.Done()
}
```

### 4.3 Pufferelt csatorna

A puffer méretét a `make` második paramétere adja meg; a wrappernél ugyanez a
`CreateChannel` argumentuma lesz. A többi művelet (küldés, fogadás) semmiben
nem tér el a szinkron csatornáétól.

**Eredeti:**

```go
c := make(chan string, 3)
```

**Wrapperrel:**

```go
c := wrapper.CreateChannel[string](3)
```

A pufferelt csatornát a megjelenítés **szaggatott éllel** rajzolja, így a gráfon
ránézésre megkülönböztethető a szinkron csatornáktól.

### 4.4 Csővezeték irányított nézetekkel

Ez a leggazdagabb eset: egyszerre jelenik meg benne az **egyirányú
csatornatípus**, a **`range`** és a **`close`**. A kétfázisú csővezeték első
szakasza csak küld (szűr), a második csak fogad (nagybetűssé alakít) — a
feldolgozó logika sorról sorra változatlan marad, csak a szignatúrák és a
csatorna-műveletek cserélődnek.

**Eredeti:**

```go
// szűrés: csak a kisbetűket engedi tovább, a '0' zárja a csatornát
func first(in *bufio.Reader, out chan<- int) {
    reading := true

    for reading {
        value, _ := in.ReadByte()

        if 97 <= value && value <= 122 {
            out <- int(value)
        } else if value == 48 {
            reading = false
            close(out)
        }
    }
    wg.Done()
}

// transzformálás: nagybetűssé alakít
func second(in <-chan int, out *bufio.Writer) {
    for value := range in {
        out.WriteByte(byte(value - 32))
        out.Flush()
    }
    wg.Done()
}

func main() {
    a := make(chan int)
    ...
    go first(in, a)
    go second(a, out)
}
```

**Wrapperrel:**

```go
// csak küldő nézet (a beépített chan<- int megfelelője)
func first(in *bufio.Reader, out wrapper.Sender[int]) {
    reading := true

    for reading {
        value, _ := in.ReadByte()

        if 97 <= value && value <= 122 {
            out.Send(int(value))
        } else if value == 48 {
            reading = false
            out.Close()
        }
    }
    wg.Done()
}

// csak fogadó nézet (a beépített <-chan int megfelelője)
func second(in wrapper.Receiver[int], out *bufio.Writer) {
    for value := range in.Range() {
        out.WriteByte(byte(value - 32))
        out.Flush()
    }
    wg.Done()
}

func main() {
    a := wrapper.CreateChannel[int]()
    ...
    go first(in, a.AsSender())     // az irányított nézetet a hívó állítja elő
    go second(a.AsReceiver(), out)
}
```

Figyeld meg a lényegi különbséget: az egyirányúsítás a beépített Go-ban
**implicit** típuskonverzió (`chan int` → `chan<- int` a híváskor), a wrappernél
viszont **explicit** — a hívó az `AsSender()` / `AsReceiver()` metódussal adja át
a megfelelő nézetet. Cserébe ugyanaz a védelem: a `first` fordítási hibát kapna,
ha fogadni próbálna a csatornáról.

---

## 5. Futtatás és a trace fájl

Futtasd a programot a szokásos módon:

```sh
go run .
```

A munkakönyvtárban létrejön egy trace fájl, például:

```
channels_20260706_222953.758.json
```

A minta: `channels_ÉÉÉÉHHNN_ÓÓPPMM.ezredmp.json`.

> **Fontos a teljes naplóhoz:** egy üzenet akkor kerül a trace-be, amikor a
> fogadó oldal ténylegesen **megkapja** (`Receive`). Egy `Send`, amit soha
> senki nem fogad – illetve bármi, ami a program idő előtti kilépésekor még
> „úton van" – **nem jelenik meg** a naplóban. Ezért mindig várd meg a
> goroutine-okat (pl. `sync.WaitGroup`-pal), mielőtt a `main` visszatér —
> ahogy a fenti példák mindegyike teszi.

### A trace JSON felépítése

```json
{
  "Channels": [
    { "channelId": 1, "timestamp": "2026-07-06T22:29:53.78+02:00",
      "buffered": false, "bufferSize": 0 }
  ],
  "Events": [
    { "ChannelID": 1, "MessageID": 1,
      "SenderID": 19, "ReceiverID": 20,
      "SendTime": "…", "ReceiveTime": "…", "Value": "ping" }
  ]
}
```

- **`Channels`** – minden létrehozott csatorna (id, mikor jött létre, pufferelt-e, mekkora puffer).
- **`Events`** – minden kézbesített üzenet: melyik csatornán, mely
  goroutine-tól melyikig, mikor küldték, mikor érkezett meg, és mi az érték.

---

## 6. Megjelenítés a böngészőben

1. Nyisd meg: <https://go-channel-visualizer.web.app/>
2. A fájlválasztóval töltsd fel a keletkezett `channels_….json` fájlt.
3. Elindul az animáció:
   - a **csomópontok** a goroutine-ok, az **élek** a csatornák (a pufferelt
     csatorna szaggatott vonallal),
   - **minden csatorna külön színt kap**, és a rajta utazó üzenet címkéje
     ugyanazt a színt viseli — így látszik, melyik üzenet melyik csatornán megy,
   - az üzenetek a küldő goroutine-tól a fogadóig utaznak.
4. A csomópontokat **egérrel elhúzhatod**, a gráfban pedig nagyíthatsz és
   pásztázhatsz (zoom / pan).

### A vezérlők

| Vezérlő | Mit csinál |
|---|---|
| **Play / Pause** | Indítja, illetve megállítja a lejátszást. Ha a film a végén áll, a Play elölről indítja. |
| **⟲** | Visszaugrik a film elejére. |
| **◀ Prev event / Next event ▶** | Az előző, illetve a következő üzenetküldés pillanatára ugrik. |
| **Idővonal-csúszka** | Szabadon tekerhető. A rajta lévő **sárga pöttyök** az egyes üzenetküldéseket jelölik. |
| **Speed** | A lejátszás tempója: középen 1×, a két szélén 0.25× és 4×. |
| **Show arrived** | Bekapcsolva minden goroutine jobb felső sarkában egy **darabszám-jelvény** mutatja, hány üzenetet kapott. A jelvény fölé húzva megjelenik a kapott értékek listája, rákattintva pedig **rögzíthető** (egyszerre több is). |
| **☀ / ☾** | Váltás a világos és a sötét téma között. |

A teljes futás egy „filmbe" van sűrítve, amelynek a hossza állítható: a csúszka
fölötti kijelzőben (`film … / 20000 ms`) a **második szám átírható**.
Alapértelmezés 20 000 ms (20 másodperc), a megengedett tartomány 3 000 és
120 000 ms között van.

### (Opcionális) Mentés felhőbe

Feltöltés után a trace-t elnevezheted és elmentheted a felhőbe, majd később
fájl nélkül visszatöltheted a mentett listából. A **24 óránál régebbi** mentett
trace-ek automatikusan törlődnek – ez ideiglenes tárolás, nem tartós archívum,
ezért a fontos trace fájlokat tartsd meg helyben is.

---

## 7. Hibaelhárítás

| Tünet | Megoldás |
|---|---|
| Fordítási hiba generikusokra (`type parameters…`) | Túl régi Go – frissíts **1.22.5+**-ra (`go version`). |
| `go get` SSL / tanúsítvány hibát dob (jellemzően vállalati hálón) | Állítsd a git-et a Windows tanúsítványtárára: `git config --global http.sslBackend schannel`. |
| Üres vagy hiányos a trace | A `main` a goroutine-ok befejeződése előtt kilépett, vagy voltak nem fogadott `Send`-ek – várd meg a goroutine-okat (`sync.WaitGroup`). |
| Néhány üzenet hiányzik a gráfból | `select`-tel fogadod őket – azt a wrapper nem tudja naplózni (lásd a 3. fejezet végét). |
| „Missing Channels/Events array" a feltöltéskor | Nem a wrapper által generált (vagy sérült) JSON-t töltöttél fel. |
| A futtatott exe „requires elevation" hibát kér | Ne nevezd a binárisod `setup`/`install`/`update`/`patch` szóval – a Windows ezeket telepítőnek hiszi. Használj más nevet (`go build -o app.exe`). |
