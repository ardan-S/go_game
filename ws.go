package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ─── Upgrader ────────────────────────────────────────────────────────────────

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		origin = strings.TrimPrefix(origin, "https://")
		origin = strings.TrimPrefix(origin, "http://")
		return origin == r.Host
	},
}

// ─── Data structures ─────────────────────────────────────────────────────────

type Client struct {
	conn  *websocket.Conn
	send  chan []byte
	color string
	room  *Room
}

type Room struct {
	id           string
	clients      [2]*Client   // slots 0 and 1; color tracked via Client.color
	colors       [2]string    // colors[i] = color assigned to slot i
	mu           sync.Mutex
	size         int
	komi         float64
	superko      int
	done         chan struct{}
	started      bool        // true once game_start has been sent
	cleanupTimer *time.Timer // runs after a disconnect in a started room
}

var (
	rooms   = make(map[string]*Room)
	roomsMu sync.RWMutex
)

// ─── Room ID generation ───────────────────────────────────────────────────────

func newRoomID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		log.Printf("crypto/rand failed: %v", err)
	}
	return hex.EncodeToString(b)
}

// randBit returns true or false randomly using crypto/rand.
func randBit() bool {
	b := make([]byte, 1)
	rand.Read(b)
	return b[0]&1 == 1
}

// ─── Send helpers ─────────────────────────────────────────────────────────────

func sendJSON(c *Client, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		log.Printf("sendJSON marshal: %v", err)
		return
	}
	select {
	case c.send <- data:
	default:
		log.Printf("sendJSON: send channel full for %s", c.color)
	}
}

func writeAndClose(conn *websocket.Conn, msgType string) {
	data, _ := json.Marshal(map[string]string{"type": msgType})
	conn.WriteMessage(websocket.TextMessage, data)
	conn.Close()
}

// ─── Full teardown ────────────────────────────────────────────────────────────

// fullTeardown removes the room from the map, closes the done channel, and
// sends opponent_disconnected to any still-connected client.
func fullTeardown(room *Room) {
	roomsMu.Lock()
	_, exists := rooms[room.id]
	if exists {
		delete(rooms, room.id)
	}
	roomsMu.Unlock()

	if !exists {
		return // already torn down
	}

	select {
	case <-room.done:
	default:
		close(room.done)
	}

	room.mu.Lock()
	for _, cl := range room.clients {
		if cl != nil {
			sendJSON(cl, map[string]string{"type": "opponent_disconnected"})
		}
	}
	room.mu.Unlock()
}

// ─── Per-client disconnect handling ──────────────────────────────────────────

func teardownRoom(disconnected *Client) {
	room := disconnected.room
	room.mu.Lock()

	// Nil out the disconnected client's slot.
	for i, cl := range room.clients {
		if cl == disconnected {
			room.clients[i] = nil
			break
		}
	}

	if !room.started {
		// Game never started — tear down immediately.
		room.mu.Unlock()
		fullTeardown(room)
		return
	}

	// Game was in progress — give the player 15 seconds to reconnect
	// (this covers the lobby→game.html navigation gap).
	if room.cleanupTimer != nil {
		room.cleanupTimer.Stop()
	}
	room.cleanupTimer = time.AfterFunc(15*time.Second, func() {
		fullTeardown(room)
	})
	room.mu.Unlock()
}

// ─── Goroutines per client ───────────────────────────────────────────────────

func (c *Client) writePump() {
	defer c.conn.Close()
	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-c.room.done:
			return
		}
	}
}

func (c *Client) readPump() {
	defer teardownRoom(c)
	for {
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		// Relay to the other client verbatim.
		c.room.mu.Lock()
		var other *Client
		for _, cl := range c.room.clients {
			if cl != nil && cl != c {
				other = cl
				break
			}
		}
		c.room.mu.Unlock()

		if other != nil {
			select {
			case other.send <- msg:
			default:
				log.Printf("relay: send channel full for %s", other.color)
			}
		}
	}
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────

func wsHandler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	roomParam := q.Get("room")

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}

	if roomParam == "new" {
		// ── Player A: create a new room ──────────────────────────────────────
		size, _ := strconv.Atoi(q.Get("size"))
		if size != 9 && size != 13 && size != 19 {
			size = 19
		}
		komi, _ := strconv.ParseFloat(q.Get("komi"), 64)
		superko, _ := strconv.Atoi(q.Get("superko"))

		// Resolve creator's color. Random is decided now so both sides know it.
		var creatorColor, joinerColor string
		switch q.Get("creatorColor") {
		case "black":
			creatorColor, joinerColor = "black", "white"
		case "white":
			creatorColor, joinerColor = "white", "black"
		default: // "random" or empty
			if randBit() {
				creatorColor, joinerColor = "black", "white"
			} else {
				creatorColor, joinerColor = "white", "black"
			}
		}

		roomID := newRoomID()
		room := &Room{
			id:      roomID,
			size:    size,
			komi:    komi,
			superko: superko,
			done:    make(chan struct{}),
			colors:  [2]string{creatorColor, joinerColor},
		}

		client := &Client{
			conn:  conn,
			send:  make(chan []byte, 8),
			color: creatorColor,
			room:  room,
		}
		room.clients[0] = client

		roomsMu.Lock()
		rooms[roomID] = room
		roomsMu.Unlock()

		go client.writePump()
		sendJSON(client, map[string]any{"type": "waiting_for_opponent", "roomId": roomID})
		client.readPump() // blocks

	} else {
		// ── Player B (or reconnecting player): join an existing room ─────────
		roomsMu.RLock()
		room, ok := rooms[roomParam]
		roomsMu.RUnlock()

		if !ok {
			writeAndClose(conn, "room_not_found")
			return
		}

		room.mu.Lock()

		if room.started {
			// Reconnect path: game.html is re-opening the WS after navigation.
			// Match the incoming ?color= param to the correct slot.
			colorParam := q.Get("color")
			targetIdx := -1
			for i, c := range room.colors {
				if c == colorParam && room.clients[i] == nil {
					targetIdx = i
					break
				}
			}

			if targetIdx == -1 {
				room.mu.Unlock()
				writeAndClose(conn, "room_full")
				return
			}

			client := &Client{
				conn:  conn,
				send:  make(chan []byte, 8),
				color: colorParam,
				room:  room,
			}
			room.clients[targetIdx] = client

			if room.cleanupTimer != nil {
				room.cleanupTimer.Stop()
				room.cleanupTimer = nil
			}
			room.mu.Unlock()

			go client.writePump()
			client.readPump() // blocks
			return
		}

		// Normal join: Player B arrives for the first time.
		if room.clients[1] != nil {
			room.mu.Unlock()
			writeAndClose(conn, "room_full")
			return
		}

		client := &Client{
			conn:  conn,
			send:  make(chan []byte, 8),
			color: room.colors[1], // assigned when room was created
			room:  room,
		}
		room.clients[1] = client
		room.started = true

		room.mu.Unlock()

		go client.writePump()

		// Notify both players — game is starting.
		room.mu.Lock()
		for _, cl := range room.clients {
			if cl == nil {
				continue
			}
			sendJSON(cl, map[string]any{
				"type":      "game_start",
				"yourColor": cl.color,
				"size":      room.size,
				"komi":      room.komi,
				"superko":   room.superko,
			})
		}
		room.mu.Unlock()

		client.readPump() // blocks
	}
}
