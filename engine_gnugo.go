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

// GTP column labels — the letter I is intentionally skipped by the protocol.
const gtpCols = "ABCDEFGHJKLMNOPQRST"

func toGTPCoord(x, y, size int) string {
	return fmt.Sprintf("%c%d", gtpCols[x], size-y)
}

// fromGTPCoord converts a GTP vertex string to board coordinates.
// Returns pass=true for PASS, RESIGN, or any unrecognised value.
func fromGTPCoord(coord string, size int) (x, y int, pass bool) {
	coord = strings.ToUpper(strings.TrimSpace(coord))
	if coord == "" || coord == "PASS" || coord == "RESIGN" {
		return 0, 0, true
	}
	col := strings.IndexByte(gtpCols, coord[0])
	if col < 0 || len(coord) < 2 {
		return 0, 0, true
	}
	row := 0
	fmt.Sscanf(coord[1:], "%d", &row)
	if row < 1 || row > size {
		return 0, 0, true
	}
	return col, size - row, false
}

// gnuGoEngine manages a persistent GnuGo subprocess over GTP.
type gnuGoEngine struct {
	mu     sync.Mutex
	stdin  io.WriteCloser
	stdout *bufio.Reader
}

// gnugoPath locates the gnugo binary. On Ubuntu/Debian, apt installs it to
// /usr/games which is often absent from a server process's PATH.
func gnugoPath() (string, error) {
	if p, err := exec.LookPath("gnugo"); err == nil {
		return p, nil
	}
	for _, p := range []string{"./gnugo", "/usr/games/gnugo"} {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("gnugo not found (install with: apt-get install gnugo)")
}

func newGnuGoEngine() (*gnuGoEngine, error) {
	bin, err := gnugoPath()
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(bin, "--mode", "gtp")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("gnugo start: %w", err)
	}
	return &gnuGoEngine{
		stdin:  stdin,
		stdout: bufio.NewReader(stdoutPipe),
	}, nil
}

// send writes one GTP command and reads the response up to the blank-line terminator.
func (g *gnuGoEngine) send(cmd string) (string, error) {
	if _, err := fmt.Fprintln(g.stdin, cmd); err != nil {
		return "", err
	}
	var firstLine string
	for {
		line, err := g.stdout.ReadString('\n')
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
		return "", fmt.Errorf("gnugo: %s", strings.TrimPrefix(firstLine, "? "))
	}
	return strings.TrimPrefix(firstLine, "= "), nil
}

// genMove sets up the full board position from req and asks GnuGo to choose a move.
func (g *gnuGoEngine) genMove(req botRequest) botResponse {
	g.mu.Lock()
	defer g.mu.Unlock()

	size := req.Size
	g.send(fmt.Sprintf("boardsize %d", size))
	g.send("clear_board")
	g.send(fmt.Sprintf("komi %.1f", req.Komi))
	g.send(fmt.Sprintf("level %d", req.Level))

	if len(req.HandicapStones) > 0 {
		coords := make([]string, len(req.HandicapStones))
		for i, s := range req.HandicapStones {
			coords[i] = toGTPCoord(s.X, s.Y, size)
		}
		g.send("set_free_handicap " + strings.Join(coords, " "))
	}

	for _, m := range req.Moves {
		var coord string
		if m.Pass {
			coord = "pass"
		} else {
			coord = toGTPCoord(m.X, m.Y, size)
		}
		if _, err := g.send(fmt.Sprintf("play %s %s", m.Color, coord)); err != nil {
			log.Printf("gnugo play error: %v", err)
		}
	}

	result, err := g.send(fmt.Sprintf("genmove %s", req.Color))
	if err != nil {
		log.Printf("gnugo genmove error: %v", err)
		return botResponse{Pass: true}
	}

	x, y, pass := fromGTPCoord(result, size)
	if pass {
		return botResponse{Pass: true}
	}
	return botResponse{X: x, Y: y}
}
