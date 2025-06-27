package wrapper

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

var channelCounter int    // egyedi azonosító a csatornákhoz
var mu sync.Mutex        // szinkronizáláshoz használt mutex
var logFile string      // log fájl neve
var messageCounter int // egyedi azonosító üzenetekhez

// A program indulásakor legenerál egy egyedi fájlnevet az eseménylog számára
func init() {           
    timestamp := time.Now().Format("20060102_150405.000") // ÉvHónapNap_ÓraPercMásodperc.Millisec
    logFile = fmt.Sprintf("channels_%s.json", timestamp) // például: channels_20250627_114301.123.json
}

//Általános csatorna típus generikus T típussal
type Channel[T any] struct {
    ID int  
    Chan chan Message[T]
}

// M
type Message[T any] struct {
    SenderID   int64 // küldő goroutine ID
	ChannelID  int   // az adott csatorna azonosítója
	MessageID  int   // az üzenet egyedi azonosítója
	Value      T     // maga az üzenet (bármilyen típus lehet)
}

// Létrehoz egy új, típusos csatornát
func CreateChannel[T any]() Channel[T] {          
    //Kritikus szakasz, ahol növeljük a csatorna számlálót
    mu.Lock()
    channelCounter++
    id := channelCounter
    mu.Unlock()

    // logoljuk a csatorna létrehozását
    appendJSON(map[string]interface{}{
        "channelId": id,
        "timestamp": time.Now().Format(time.RFC3339Nano),
    })

    return Channel[T]{
        ID:   id,
        Chan: make(chan Message[T]),
    }

}

// Üzenet küldése a csatornára, és esemény logolása
func (c Channel[T]) Send(value T) {
    gid := GetGoid() // küldő goroutine id-ja

    // Kritikus szakasz, ahol növeljük az üzenet számlálót
    mu.Lock()
    messageCounter++
    id := messageCounter
    mu.Unlock()

    message := Message[T]{
        SenderID:  gid,
        ChannelID: c.ID,
        MessageID: id,
        Value:     value,
    }

    // esemény logolása
    appendJSON(map[string]interface{}{
        "event":       "send",
        "senderId": gid,
        "channelId":   c.ID,
        "messageId": id,
        "value":       value,
        "timestamp":   time.Now().Format(time.RFC3339Nano),
    })
    
    c.Chan <- message
}

func (c Channel[T]) Receive() T {
    gid := GetGoid() // fogadó goroutine id-ja

    msg := <-c.Chan 
        
    // esemény logolása
    appendJSON(map[string]interface{}{
        "event":       "receive",
        "recieverId": gid,
        "channelId":   c.ID,
        "messageId":   msg.MessageID,
        "value":       msg.Value,
        "timestamp":   time.Now().Format(time.RFC3339Nano),
    })
    return msg.Value
}

// Log bejegyzés hozzáadása a JSON fájlhoz
func appendJSON(entry map[string]interface{}) {

    mu.Lock()
    defer mu.Unlock()

    var all []map[string]interface{}

    // meglévő adatok beolvasása (ha már létezik a fájl)
    data, err := os.ReadFile(logFile)
    if err == nil && len(data) > 0 {
        if err := json.Unmarshal(data, &all); err != nil {
            log.Fatalf("Régi JSON parse hiba: %v\nAdat: %s", err, data)
        }
    }
    
    // új bejegyzés hozzáadása
    all = append(all, entry)

    // JSON formátumra alakítás és fájlba írás
    out, err := json.MarshalIndent(all, "", "  ")
    if err != nil {
        log.Fatalf("JSON marshal hiba: %v", err)
    }
    if err := os.WriteFile(logFile, out, 0644); err != nil {
        log.Fatalf("JSON fájl írási hiba: %v", err)
    }
}

// Goroutine ID lekérdezése (nem hivatalos módszer, de működik)
func GetGoid() int64 {
    var (
        buf [64]byte // ide másoljuk be a goroutine stack header-t
        n   = runtime.Stack(buf[:], false) // stack trace lekérése (false = csak aktuális goroutine)
        stk = strings.TrimPrefix(string(buf[:n]), "goroutine") // eltávolítjuk a "goroutine" szöveget az elejéről
    )

    // A maradék szöveg első szóközig tartó része a goroutine ID pl. "123 [running]:"
    idField := strings.Fields(stk)[0]

    // Konvertáljuk a szöveget számmá (pl. "123" → 123)
    id, err := strconv.Atoi(idField)
    if err != nil {
        panic(fmt.Errorf("can not get goroutine id: %v", err))
    }

    return int64(id)
}