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
    jsonData, err := json.Marshal(entry)
    if err != nil {
        log.Fatalf("Error marshalling JSON entry: %v", err)
    }

    f, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
    if err != nil {
        log.Fatalf("Error opening log file: %v", err)
    }
    defer f.Close()

    if _, err := f.Write(append(jsonData, '\n')); err != nil {
        log.Fatalf("Error writing to log file: %v", err)
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