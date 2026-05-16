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
	cmd    *exec.Cmd
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

func startGnuGoProcess() (*exec.Cmd, io.WriteCloser, *bufio.Reader, error) {
	bin, err := gnugoPath()
	if err != nil {
		return nil, nil, nil, err
	}
	cmd := exec.Command(bin, "--mode", "gtp")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, nil, nil, err
	}
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, nil, nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, nil, nil, fmt.Errorf("gnugo start: %w", err)
	}
	return cmd, stdin, bufio.NewReader(stdoutPipe), nil
}

func newGnuGoEngine() (*gnuGoEngine, error) {
	cmd, stdin, stdout, err := startGnuGoProcess()
	if err != nil {
		return nil, err
	}
	return &gnuGoEngine{cmd: cmd, stdin: stdin, stdout: stdout}, nil
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

// restart kills the dead process and starts a fresh one. Must be called with mu held.
func (g *gnuGoEngine) restart() error {
	g.stdin.Close()
	if g.cmd != nil && g.cmd.Process != nil {
		g.cmd.Process.Kill()
		g.cmd.Wait()
	}
	cmd, stdin, stdout, err := startGnuGoProcess()
	if err != nil {
		return err
	}
	g.cmd = cmd
	g.stdin = stdin
	g.stdout = stdout
	log.Println("GnuGo restarted successfully")
	return nil
}

// attempt sends the full GTP sequence for req and returns the chosen move.
// Must be called with mu held.
func (g *gnuGoEngine) attempt(req botRequest) (botResponse, error) {
	size := req.Size
	if _, err := g.send(fmt.Sprintf("boardsize %d", size)); err != nil {
		return botResponse{}, err
	}
	if _, err := g.send("clear_board"); err != nil {
		return botResponse{}, err
	}
	if _, err := g.send(fmt.Sprintf("komi %.1f", req.Komi)); err != nil {
		return botResponse{}, err
	}
	if _, err := g.send(fmt.Sprintf("level %d", req.Level)); err != nil {
		return botResponse{}, err
	}

	if len(req.HandicapStones) > 0 {
		coords := make([]string, len(req.HandicapStones))
		for i, s := range req.HandicapStones {
			coords[i] = toGTPCoord(s.X, s.Y, size)
		}
		if _, err := g.send("set_free_handicap " + strings.Join(coords, " ")); err != nil {
			return botResponse{}, err
		}
	}

	for _, m := range req.Moves {
		var coord string
		if m.Pass {
			coord = "pass"
		} else {
			coord = toGTPCoord(m.X, m.Y, size)
		}
		if _, err := g.send(fmt.Sprintf("play %s %s", m.Color, coord)); err != nil {
			return botResponse{}, err
		}
	}

	result, err := g.send(fmt.Sprintf("genmove %s", req.Color))
	if err != nil {
		return botResponse{}, err
	}

	x, y, pass := fromGTPCoord(result, size)
	if pass {
		return botResponse{Pass: true}, nil
	}
	return botResponse{X: x, Y: y}, nil
}

// genMove sets up the full board position from req and asks GnuGo to choose a move.
// On any communication error it restarts the subprocess and retries once.
func (g *gnuGoEngine) genMove(req botRequest) botResponse {
	g.mu.Lock()
	defer g.mu.Unlock()

	resp, err := g.attempt(req)
	if err == nil {
		return resp
	}

	log.Printf("GnuGo error (%v) — restarting and retrying", err)
	if rerr := g.restart(); rerr != nil {
		log.Printf("GnuGo restart failed: %v", rerr)
		return botResponse{Pass: true}
	}

	resp, err = g.attempt(req)
	if err != nil {
		log.Printf("GnuGo retry after restart failed: %v", err)
		return botResponse{Pass: true}
	}
	return resp
}
