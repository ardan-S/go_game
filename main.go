package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"
)

// noListFS wraps http.Dir and returns 404 for directories that have no index.html,
// preventing directory listing.
type noListFS struct {
	base http.FileSystem
}

func (fs noListFS) Open(name string) (http.File, error) {
	f, err := fs.base.Open(name)
	if err != nil {
		return nil, err
	}
	stat, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	if stat.IsDir() {
		index, err := fs.base.Open(name + "/index.html")
		if err != nil {
			f.Close()
			return nil, os.ErrNotExist
		}
		index.Close()
	}
	return f, nil
}

func main() {
	port := "8080"
	if p := os.Getenv("PORT"); p != "" {
		if n, err := strconv.Atoi(p); err == nil && n > 0 && n < 65536 {
			port = p
		} else {
			log.Printf("Invalid PORT %q — using default 8080", p)
		}
	}

	fs := http.FileServer(noListFS{http.Dir("static")})
	http.Handle("/", securityMiddleware(fs))

	fmt.Printf("\nGo Game is running.\nOpen your browser at: http://localhost:%s\n\n", port)

	srv := &http.Server{
		Addr:           ":" + port,
		ReadTimeout:    5 * time.Second,
		WriteTimeout:   10 * time.Second,
		IdleTimeout:    120 * time.Second,
		MaxHeaderBytes: 1 << 20,
	}
	log.Fatal(srv.ListenAndServe())
}

func securityMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; "+
				"script-src 'self'; "+
				"style-src 'self' https://fonts.googleapis.com; "+
				"font-src 'self' https://fonts.gstatic.com; "+
				"worker-src 'self'; "+
				"object-src 'none'; "+
				"frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}
