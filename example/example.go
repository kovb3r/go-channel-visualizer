package main

import (
	"example/wrapper"
	"fmt"
	"sync"
)

var wg sync.WaitGroup

func ping(c wrapper.Channel) {
    c.Send("ping")
    msg := c.Receive()
    fmt.Println(msg.Value)
    wg.Done()
}

func pong(c wrapper.Channel) {
    msg := c.Receive()
    fmt.Println(msg.Value)
    c.Send("pong") 
    wg.Done()
}

func main() {
    c := wrapper.CreateChannel()
    b := wrapper.CreateChannel()

    wg.Add(4)
    go ping(c) 
    go pong(c)
    go ping(b)
    go pong(b)
    wg.Wait()
}
