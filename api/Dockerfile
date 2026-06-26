FROM golang:1.22-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .v
RUN CGO_ENABLED=0 go build -o routeml-api .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates curl
WORKDIR /app
COPY --from=build /app/routeml-api .
EXPOSE 8080
CMD ["./routeml-api"]
