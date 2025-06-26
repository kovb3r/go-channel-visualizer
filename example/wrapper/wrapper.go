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

var channelCounter int      // egyedi azonosító a csatornákhoz
var mu sync.Mutex
var logFile string
var messageCounter int // egyedi azonosító küldött üzenetekhez

func init() {           
    timestamp := time.Now().Format("20060102_150405.000") // ÉvHónapNap_ÓraPercMásodperc.Millisec
    logFile = fmt.Sprintf("channels_%s.json", timestamp)

    if err := os.WriteFile(logFile, []byte("[]"), 0644); err != nil {
        log.Fatalf("init log file: %v", err)
    }
}

type Channel struct {
    ID int
    Chan chan Message
}

type Message struct {
    SenderID int64  
    ChannelID int
    MessageID int
    Value string
}

func CreateChannel() Channel {          //

    mu.Lock()
    channelCounter++
    id := channelCounter
    mu.Unlock()

    appendJSON(map[string]interface{}{
        "channelId": id,
        "timestamp": time.Now().Format(time.RFC3339Nano),
    })

    return Channel{
        ID:   id,
        Chan: make(chan Message),
    }

}

func (c Channel) Send(value string) {
    gid := GetGoid()
    mu.Lock()
    messageCounter++
    id := messageCounter
    mu.Unlock()

    message := Message{
        SenderID:  gid,
        ChannelID: c.ID,
        MessageID: id,
        Value:     value,
    }

    appendJSON(map[string]interface{}{
        "event":       "send",
        "goroutineId": gid,
        "channelId":   c.ID,
        "messageId": id,
        "value":       value,
        "timestamp":   time.Now().Format(time.RFC3339Nano),
    })
    
    c.Chan <- message
}

func (c Channel) Receive() Message {
    gid := GetGoid()
    for {
        msg := <-c.Chan
        if msg.SenderID != gid {
            appendJSON(map[string]interface{}{
                "event":       "receive",
                "goroutineId": gid,
                "channelId":   c.ID,
                "messageId":   msg.MessageID,
                "value":       msg.Value,
                "timestamp":   time.Now().Format(time.RFC3339Nano),
            })
            return msg
        }

        // saját üzenet, visszatesszük, várunk
        go func(m Message) {
            time.Sleep(time.Millisecond)
            c.Chan <- m
        }(msg)
    }
}

func appendJSON(entry map[string]interface{}) {
    mu.Lock()
    defer mu.Unlock()

    var all []map[string]interface{}
    data, err := os.ReadFile(logFile)
    if err == nil && len(data) > 0 {
        if err := json.Unmarshal(data, &all); err != nil {
            log.Fatalf("Régi JSON parse hiba: %v\nAdat: %s", err, data)
        }
    }
    
    all = append(all, entry)

    
    out, err := json.MarshalIndent(all, "", "  ")
    if err != nil {
        log.Fatalf("JSON marshal hiba: %v", err)
    }
    if err := os.WriteFile(logFile, out, 0644); err != nil {
        log.Fatalf("JSON fájl írási hiba: %v", err)
    }
}

func GetGoid() int64 {
    var (
        buf [64]byte
        n   = runtime.Stack(buf[:], false)
        stk = strings.TrimPrefix(string(buf[:n]), "goroutine")
    )

    idField := strings.Fields(stk)[0]
    id, err := strconv.Atoi(idField)
    if err!= nil {
        panic(fmt.Errorf("can not get goroutine id: %v", err))
    }

    return int64(id)
}