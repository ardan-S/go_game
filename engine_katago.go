package main

import (
	"bufio"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"
)

// kataGoVisits maps difficulty level (1–10) to KataGo visit counts.
// Higher visits = stronger play. Levels above 10 are reserved for future expert tiers.
var kataGoVisits = [11]int{0, 10, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400}

// kataGoEngine manages a persistent KataGo subprocess over GTP.
// Gated behind the KATAGO_ENABLED=true environment variable.
type kataGoEngine struct {
	mu     sync.Mutex
	stdin  io.WriteCloser
	stdout *bufio.Reader
}

func newKataGoEngine() (*kataGoEngine, error) {
	bin := os.Getenv("KATAGO_BIN")
	if bin == "" {
		bin = "katago"
	}
	model := os.Getenv("KATAGO_MODEL")
	if model == "" {
		return nil, fmt.Errorf("KATAGO_MODEL env var required")
	}
	cfg := os.Getenv("KATAGO_CONFIG")
	if cfg == "" {
		return nil, fmt.Errorf("KATAGO_CONFIG env var required")
	}

	cmd := exec.Command(bin, "gtp", "-config", cfg, "-model", model)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("katago start: %w", err)
	}

	e := &kataGoEngine{
		stdin:  stdin,
		stdout: bufio.NewReader(stdoutPipe),
	}
	if err := e.drainStartup(); err != nil {
		return nil, fmt.Errorf("katago startup drain: %w", err)
	}
	return e, nil
}

// drainStartup skips KataGo's verbose startup log lines and waits until GTP is ready.
func (k *kataGoEngine) drainStartup() error {
	if _, err := fmt.Fprintln(k.stdin, "name"); err != nil {
		return err
	}
	for {
		line, err := k.stdout.ReadString('\n')
		if err != nil {
			return err
		}
		line = strings.TrimRight(line, "\r\n")
		if strings.HasPrefix(line, "= ") || strings.HasPrefix(line, "? ") {
			k.stdout.ReadString('\n') // consume trailing blank line
			return nil
		}
	}
}

func (k *kataGoEngine) send(cmd string) (string, error) {
	if _, err := fmt.Fprintln(k.stdin, cmd); err != nil {
		return "", err
	}
	var firstLine string
	for {
		line, err := k.stdout.ReadString('\n')
		if err != nil {
			return "", err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		if firstLine == "" {
			firstLine = line
		}
	}
	if strings.HasPrefix(firstLine, "? ") {
		return "", fmt.Errorf("katago: %s", strings.TrimPrefix(firstLine, "? "))
	}
	return strings.TrimPrefix(firstLine, "= "), nil
}

func (k *kataGoEngine) genMove(req botRequest) botResponse {
	k.mu.Lock()
	defer k.mu.Unlock()

	size := req.Size
	k.send(fmt.Sprintf("boardsize %d", size))
	k.send("clear_board")
	k.send(fmt.Sprintf("komi %.1f", req.Komi))

	visits := kataGoVisits[req.Level]
	k.send(fmt.Sprintf("kata-set-param maxVisits %d", visits))

	if len(req.HandicapStones) > 0 {
		coords := make([]string, len(req.HandicapStones))
		for i, s := range req.HandicapStones {
			coords[i] = toGTPCoord(s.X, s.Y, size)
		}
		k.send("set_free_handicap " + strings.Join(coords, " "))
	}

	for _, m := range req.Moves {
		var coord string
		if m.Pass {
			coord = "pass"
		} else {
			coord = toGTPCoord(m.X, m.Y, size)
		}
		if _, err := k.send(fmt.Sprintf("play %s %s", m.Color, coord)); err != nil {
			log.Printf("katago play error: %v", err)
		}
	}

	result, err := k.send(fmt.Sprintf("genmove %s", req.Color))
	if err != nil {
		log.Printf("katago genmove error: %v", err)
		return botResponse{Pass: true}
	}

	x, y, pass := fromGTPCoord(result, size)
	if pass {
		return botResponse{Pass: true}
	}
	return botResponse{X: x, Y: y}
}
