package wrapper

import (
	"encoding/json"
	"log"
	"os"
	"sync"
)

var logMu sync.Mutex // fájlírás szinkronizálására

// A teljes JSON szerkezete
type LogData struct {
	Channels []map[string]any 
	Events   []Event          
}

// Globális log struktúra, amit futás közben bővítünk
var logData LogData

// JSON mentése fájlba
func saveJSON() {
	out, err := json.MarshalIndent(logData, "", "  ")
	if err != nil {
		log.Fatalf("JSON marshal hiba: %v", err)
	}
	if err := os.WriteFile(logFile, out, 0644); err != nil {
		log.Fatalf("JSON írási hiba: %v", err)
	}
}

// Új csatorna hozzáadása a loghoz
func LogChannel(info map[string]any) {
	logMu.Lock()
	defer logMu.Unlock()

	logData.Channels = append(logData.Channels, info)
	saveJSON()
}

// Új esemény hozzáadása a loghoz
func LogEvent(event Event) {
	logMu.Lock()
	defer logMu.Unlock()

	logData.Events = append(logData.Events, event)
	saveJSON()
}
