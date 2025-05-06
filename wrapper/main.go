package wrapper

import (
	"encoding/json"
	"log"
	"sync"
	"time"
    "os"
)

var channelCounter int
var mu sync.Mutex
const logFile = "channels.json"


type Channel[T any] struct {
    ID int
    Chan chan T
}


func CreateChannel[T any]() Channel[T] {
    log.SetFlags(log.LstdFlags | log.Lmicroseconds)

    mu.Lock()
    channelCounter++
	defer mu.Unlock()
    log.Printf("Creating channel, with ID: %d", channelCounter)

	toJson(channelCounter)
    return Channel[T]{
        ID: channelCounter,
        Chan: make(chan T),
    }

    
}

func toJson(id int) string {
    data := map[string]interface{}{
		"channelId":    id,
		"Timestamp":   time.Now().Format(time.RFC3339Nano),
    }

    jsonData, err := json.Marshal(data)
    if err != nil {
        log.Fatalf("Error marshalling channel to JSON: %v", err)
    }
    log.Printf("Channel JSON: %s", jsonData)

    f, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
    if err != nil {
        log.Fatalf("Error opening log file: %v", err)
    }
    defer f.Close()

    if _, err := f.Write(append(jsonData, '\n')); err != nil {
        log.Fatalf("Error writing to log file: %v", err)
    }

    log.Printf("Channel JSON: %s", jsonData)
    return string(jsonData)
}