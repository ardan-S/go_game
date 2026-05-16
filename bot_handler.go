package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
)

type boardPoint struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type gameMove struct {
	Color string `json:"color"`
	X     int    `json:"x"`
	Y     int    `json:"y"`
	Pass  bool   `json:"pass"`
}

type botRequest struct {
	Size           int          `json:"size"`
	HandicapStones []boardPoint `json:"handicapStones"`
	Moves          []gameMove   `json:"moves"`
	Color          string       `json:"color"`
	Difficulty     int          `json:"difficulty"`
	Engine         string       `json:"engine"`
	Komi           float64      `json:"komi"`
	Level          int          // derived server-side from Difficulty
}

type botResponse struct {
	X    int  `json:"x"`
	Y    int  `json:"y"`
	Pass bool `json:"pass"`
}

var (
	gnugo  *gnuGoEngine
	katago *kataGoEngine
)

func initEngines() {
	var err error
	gnugo, err = newGnuGoEngine()
	if err != nil {
		log.Printf("GnuGo unavailable (install gnugo to enable bot play): %v", err)
	} else {
		log.Println("GnuGo engine ready")
	}

	if os.Getenv("KATAGO_ENABLED") == "true" {
		katago, err = newKataGoEngine()
		if err != nil {
			log.Printf("KataGo unavailable: %v", err)
		} else {
			log.Println("KataGo engine ready")
		}
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	status := map[string]any{
		"gnugo":  gnugo != nil,
		"katago": katago != nil,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

func botMoveHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req botRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	if req.Size < 1 || req.Size > 25 {
		http.Error(w, "invalid size", http.StatusBadRequest)
		return
	}
	if req.Color != "black" && req.Color != "white" {
		http.Error(w, "invalid color", http.StatusBadRequest)
		return
	}

	level := req.Difficulty
	if level < 1 {
		level = 1
	}
	if level > 10 {
		level = 10
	}
	req.Level = level

	var resp botResponse

	switch req.Engine {
	case "katago":
		if katago == nil {
			http.Error(w, "KataGo not enabled", http.StatusServiceUnavailable)
			return
		}
		resp = katago.genMove(req)
	default:
		if gnugo == nil {
			http.Error(w, "GnuGo not available — bot play requires GnuGo to be installed", http.StatusServiceUnavailable)
			return
		}
		resp = gnugo.genMove(req)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
