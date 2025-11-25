package wrapper

import (
	"fmt"
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
var events = make(map[int]Event)   // események tárolására

// A program indulásakor legenerál egy egyedi fájlnevet az eseménylog számára
func init() {           
    timestamp := time.Now().Format("20060102_150405.000") // ÉvHónapNap_ÓraPercMásodperc.Millisec
    logFile = fmt.Sprintf("channels_%s.json", timestamp) // például: channels_20250627_114301.123.json
}

// Esemény struktúra az üzenetküldési események naplózásához
type Event struct {
    ChannelID   int         
    MessageID   int         
    SenderID    int64       
    ReceiverID  int64       
    SendTime    string      
    ReceiveTime string      
    Value       any 
}

//Általános csatorna típus generikus T típussal
type Channel[T any] struct {
    ID int  
    Chan chan Message[T]
}

type Message[T any] struct {
    SenderID   int64 // küldő goroutine ID
	ChannelID  int   // az adott csatorna azonosítója
	MessageID  int   // az üzenet egyedi azonosítója
	Value      T     // maga az üzenet (bármilyen típus lehet)
}

// Létrehoz egy új, típusos csatornát
func CreateChannel[T any](buffer ...int) Channel[T] {          
    //Kritikus szakasz, ahol növeljük a csatorna számlálót
    mu.Lock()
    channelCounter++
    id := channelCounter
    mu.Unlock()

    size := 0
    
    if len(buffer) > 0 && buffer[0] > 0 {
        size = buffer[0]

        LogChannel(map[string]any{
            "channelId": id,
            "timestamp": time.Now().Format(time.RFC3339Nano),
            "buffered": true,
            "bufferSize": size,
        })

        return Channel[T]{
            ID:   id,
            Chan: make(chan Message[T], size),
        }
    }else {
        // logoljuk a csatorna létrehozását
        LogChannel(map[string]any{
            "channelId": id,
            "timestamp": time.Now().Format(time.RFC3339Nano),
            "buffered": false,
            "bufferSize": size,
        })

        return Channel[T]{
            ID:   id,
            Chan: make(chan Message[T]),
        }
    }
}

// Üzenet küldése a csatornára, és esemény logolása
func (c Channel[T]) Send(value T) {
    gid := GetGoid() // küldő goroutine id-ja

    // Kritikus szakasz, ahol növeljük az üzenet számlálót és logoljuk az eseményt
    mu.Lock()
    messageCounter++
    id := messageCounter

    events[id] = Event{
        ChannelID: c.ID,
        MessageID: id,
        SenderID:  gid,
        SendTime:  time.Now().Format(time.RFC3339Nano),
        Value:     value,
    }

    mu.Unlock()

    message := Message[T]{
        SenderID:  gid,
        ChannelID: c.ID,
        MessageID: id,
        Value:     value,
    }
    
    c.Chan <- message
}

func (c Channel[T]) Receive() T {
    gid := GetGoid() // fogadó goroutine id-ja

    msg := <-c.Chan 
        

    mu.Lock()
    event, exists := events[msg.MessageID]
    if exists {
        event.ReceiverID = gid
        event.ReceiveTime = time.Now().Format(time.RFC3339Nano)
        // essemény logolása
        LogEvent(event)
        // esemény eltávolítása a map-ból
        delete(events, msg.MessageID)
    }
    mu.Unlock()

    return msg.Value
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