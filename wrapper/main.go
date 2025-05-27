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

var channelCounter int
var mu sync.Mutex
const logFile = "channels.json"

func init() {
    if err := os.WriteFile(logFile, []byte("[]"), 0644); err != nil {
        log.Fatalf("Nem sikerült inicializálni a log fájlt: %v", err)
    }
}

type Channel struct {
    ID int
    Chan chan Message
}

type Message struct {
    SenderID int64  
    ChannelID int
    Value string
}

func CreateChannel() Channel {

    mu.Lock()
    channelCounter++
	defer mu.Unlock()

	appendJSON(map[string]interface{}{
        "channelId": channelCounter,
        "timestamp": time.Now().Format(time.RFC3339Nano),
    })

    return Channel{
        ID: channelCounter,
        Chan: make(chan Message),
    }

    
}

func (c Channel) Send(value string) {
    gid := GetGoid()
    message := Message{
        SenderID:  gid,
        ChannelID: c.ID,
        Value:     value,
    }
    appendJSON(map[string]interface{}{
        "event":       "send",
        "goroutineId": gid,
        "channelId":   c.ID,
        "value":       value,
        "timestamp":   time.Now().Format(time.RFC3339Nano),
    })

    c.Chan <- message
}

func appendJSON(entry map[string]interface{}) {
    
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