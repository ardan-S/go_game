package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
)

func main() {
	port := "8080"
	if p := os.Getenv("PORT"); p != "" {
		port = p
	}

	fs := http.FileServer(http.Dir("static"))
	http.Handle("/", noCacheMiddleware(fs))

	fmt.Printf("\nGo Game is running.\nOpen your browser at: http://localhost:%s\n\n", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func noCacheMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
		next.ServeHTTP(w, r)
	})
}
