FROM golang:1.21-bullseye AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o server .

FROM debian:bullseye-slim
RUN apt-get update && \
    apt-get install -y --no-install-recommends gnugo ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/server .
COPY static ./static
CMD ["./server"]
