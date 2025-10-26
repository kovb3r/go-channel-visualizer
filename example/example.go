package main

import (
	"example/wrapper"
	"fmt"
	"sync"
)

var wg sync.WaitGroup // WaitGroup a goroutine-ok befejeződésének megvárásához

// Saját típus: név és életkor
type name struct {
	Name string
	Age  int
}

// Egyik goroutine, amely küld egy name típusú értéket, majd vár egy választ
func nameChannel(c wrapper.Channel[name]) {
	c.Send(name{"Alice", 30})
	msg := c.Receive()
	fmt.Printf("Name: %s, Age: %d\n", msg.Name, msg.Age)
	wg.Done()
}

// Másik goroutine: fogadja az előzőtől kapott name értéket, majd visszaküld egy másikat
func nameChannel2(c wrapper.Channel[name]) {
	msg := c.Receive()
	fmt.Printf("Name: %s, Age: %d\n", msg.Name, msg.Age)
	c.Send(name{"Bob", 25})
	wg.Done()
}

// Goroutine: string típusú üzenetküldés ("ping"), majd válasz fogadása
func ping(c wrapper.Channel[string]) {
	c.Send("ping")
	msg := c.Receive()
	fmt.Println(msg)
	wg.Done()
}

// Goroutine: fogad egy string üzenetet, kiírja, majd válaszként "pong"-ot küld
func pong(c wrapper.Channel[string]) {
	msg := c.Receive()
	fmt.Println(msg)
	c.Send("pong")
	wg.Done()
}

// Int típusú csatorna: küld egy számot, majd fogad egy választ
func number(c wrapper.Channel[int]) {
	c.Send(42)
	msg := c.Receive()
	fmt.Println(msg)
	wg.Done()
}

// Int típusú csatorna másik fele: fogad, majd válaszol
func number2(c wrapper.Channel[int]) {
	msg := c.Receive()
	fmt.Println(msg)
	c.Send(24)
	wg.Done()
}

func main() {
	// Három típusos csatorna létrehozása: string, name és int
	c := wrapper.CreateChannel[string]()
	n := wrapper.CreateChannel[name]()
	i := wrapper.CreateChannel[int]()

	// 6 goroutine-t indítunk el
	wg.Add(6)
	go ping(c)
	go pong(c)
	go number(i)
	go number2(i)
	go nameChannel(n)
	go nameChannel2(n)

	// Várakozás az összes goroutine befejeződésére
	wg.Wait()
}
