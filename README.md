# Go Channel Visualizer

Eszköz a Go **goroutine-ok közötti csatorna-kommunikáció** láthatóvá tételére.
A program futása közben naplózza a csatorna-műveleteket, a naplóból pedig a
böngészőben animált gráfot rajzol: a **csomópontok a goroutine-ok**, az **élek a
csatornák**, az üzenetek pedig a küldőtől a fogadóig utaznak az idővonal mentén.

**Élő felület:** <https://go-channel-visualizer.web.app/>

---

## Hogyan működik

1. **Instrumentálás** – a Go kódban a beépített `chan T` csatornákat a
   `wrapper.Channel[T]` típusra cseréled, a `<-` operátorokat pedig `Send` /
   `Receive` hívásokra.
2. **Napló** – futtatáskor a wrapper egy `channels_<időbélyeg>.json` fájlba menti
   a létrehozott csatornákat és a kézbesített üzeneteket.
3. **Megjelenítés** – a JSON fájlt feltöltöd a webes felületre, és lejátszhatod.

A részletes átírási táblázatot, példákat és a felület leírását a
**[setup_guide.md](setup_guide.md)** tartalmazza.

---

## A repó felépítése

| Mappa | Tartalom |
|---|---|
| `wrapper/` | a Go könyvtár (`github.com/kovb3r/go-channel-visualizer/wrapper`) |
| `example/` | futtatható példaprogram, amely az összes átírási esetet bemutatja |
| `angular/angular-project/` | az Angular megjelenítő felület |
| `setup_guide.md` | részletes használati útmutató |

---

## Gyors indítás

A könyvtár behúzása saját projektbe:

```sh
go get github.com/kovb3r/go-channel-visualizer/wrapper@latest
```

A példaprogram kipróbálása (magától lefut, és trace fájlt hagy maga után):

```sh
cd example
go run .
```

A keletkező `channels_*.json` fájlt töltsd fel a felületre.

A megjelenítő helyi futtatása:

```sh
cd angular/angular-project
npm install
npm start
```

---

## Korlátok

- A Go **`select`** utasítása nem támogatott: az azon keresztül fogadott
  üzenetek nem kerülnek be a naplóba.
- Egy üzenet akkor kerül a trace-be, amikor a fogadó oldal ténylegesen
  **megkapja**; a soha nem fogadott küldések nem jelennek meg.
- A goroutine-azonosítót a `runtime.Stack` kimenetéből olvassa ki, ami nem
  hivatalos módszer, és minden művelethez mérhető többletköltséget ad.
- A napló minden eseménynél teljes egészében újraíródik, ami nagy trace-eknél
  lassú.
- A felhőbe mentett trace-ek 24 óra után törlődnek – ez ideiglenes tárolás.

---

Szakdolgozati projekt.
