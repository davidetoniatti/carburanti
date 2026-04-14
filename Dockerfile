# Stage 1: Build
FROM golang:1.23-alpine AS builder

WORKDIR /app

# Copy go.mod and go.sum and download dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source code
COPY . .

# Build the application
# CGO_ENABLED=0 for a static binary
RUN CGO_ENABLED=0 GOOS=linux go build -o carburanti main.go

# Stage 2: Final image
FROM alpine:latest

WORKDIR /app

# Install ca-certificates for HTTPS requests
RUN apk --no-cache add ca-certificates

# Copy the binary from the builder stage
COPY --from=builder /app/carburanti .

# Expose the default port
EXPOSE 8080

# Run the application
CMD ["./carburanti"]
