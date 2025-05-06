package wrapper

import (
    "sync"
)

var channelCounter int
var mu sync.Mutex


type Channel[T any] struct {
    ID int
    Chan chan T
}


func CreateChannel[T any]() Channel[T] {
    mu.Lock()
    channelCounter++
	defer mu.Unlock()
	
    return Channel[T]{
        ID: channelCounter,
        Chan: make(chan T),
    }
}