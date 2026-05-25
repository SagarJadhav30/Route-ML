package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PredictRequest struct {
	OriginLat  float64 `json:"origin_lat" query:"origin_lat"`
	OriginLng  float64 `json:"origin_lng" query:"origin_lng"`
	DestLat    float64 `json:"dest_lat" query:"dest_lat"`
	DestLng    float64 `json:"dest_lng" query:"dest_lng"`
	HourOfDay  int     `json:"hour_of_day" query:"hour_of_day"`
	DayOfWeek  int     `json:"day_of_week" query:"day_of_week"`
	Weather    string  `json:"weather" query:"weather"`
	DistanceKm float64 `json:"distance_km" query:"distance_km"`
}

type MLRequest struct {
	DistanceKm float64 `json:"distance_km"`
	HourOfDay  int     `json:"hour_of_day"`
	DayOfWeek  int     `json:"day_of_week"`
	Weather    string  `json:"weather"`
	IsRushHour int     `json:"is_rush_hour"`
	IsWeekend  int     `json:"is_weekend"`
}

type MLResponse struct {
	EtaMinutes       float64            `json:"eta_minutes"`
	ConfidenceLow    float64            `json:"confidence_low"`
	ConfidenceHigh   float64            `json:"confidence_high"`
	FeatureImportance map[string]float64 `json:"feature_importances"`
}

type PredictResponse struct {
	ML      MLResult      `json:"ml"`
	Formula FormulaResult `json:"formula"`
}

type MLResult struct {
	EtaMinutes       float64            `json:"eta_minutes"`
	ConfidenceLow    float64            `json:"confidence_low"`
	ConfidenceHigh   float64            `json:"confidence_high"`
	FeatureImportance map[string]float64 `json:"feature_importances"`
}

type FormulaResult struct {
	EtaMinutes        float64 `json:"eta_minutes"`
	AverageSpeedKmh   float64 `json:"average_speed_kmh"`
	TrafficMultiplier float64 `json:"traffic_multiplier"`
	WeatherMultiplier float64 `json:"weather_multiplier"`
}

type CompareResponse struct {
	Input   PredictRequest `json:"input"`
	ML      MLResult       `json:"ml"`
	Formula FormulaResult  `json:"formula"`
	Delta   DeltaResult    `json:"delta"`
}

type DeltaResult struct {
	DifferenceMinutes float64 `json:"difference_minutes"`
	DifferencePercent float64 `json:"difference_percent"`
	MLFaster          bool    `json:"ml_predicts_faster"`
}

// ---------------------------------------------------------------------------
// Formula-based prediction (the "Bhupesh approach")
// ---------------------------------------------------------------------------

func formulaPredict(req PredictRequest) FormulaResult {
	avgSpeed := 35.0 // km/h base speed in city

	// Traffic multiplier by hour
	trafficMult := 1.0
	if (req.HourOfDay >= 7 && req.HourOfDay <= 9) || (req.HourOfDay >= 17 && req.HourOfDay <= 19) {
		trafficMult = 1.45 // rush hour
	} else if req.HourOfDay >= 22 || req.HourOfDay <= 5 {
		trafficMult = 0.75 // night = faster
	} else if req.HourOfDay >= 10 && req.HourOfDay <= 16 {
		trafficMult = 1.1 // midday
	}

	// Weekend discount
	if req.DayOfWeek == 5 || req.DayOfWeek == 6 {
		trafficMult *= 0.85
	}

	// Weather
	weatherMult := 1.0
	switch req.Weather {
	case "rain":
		weatherMult = 1.15
	case "snow":
		weatherMult = 1.40
	}

	dist := req.DistanceKm
	if dist <= 0 {
		dist = haversineKm(req.OriginLat, req.OriginLng, req.DestLat, req.DestLng)
	}

	eta := (dist / avgSpeed) * 60.0 * trafficMult * weatherMult

	return FormulaResult{
		EtaMinutes:        math.Round(eta*100) / 100,
		AverageSpeedKmh:   avgSpeed,
		TrafficMultiplier: trafficMult,
		WeatherMultiplier: weatherMult,
	}
}

func haversineKm(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}

// ---------------------------------------------------------------------------
// ML service call
// ---------------------------------------------------------------------------

func mlServiceURL() string {
	u := os.Getenv("ML_SERVICE_URL")
	if u == "" {
		u = "http://localhost:5000"
	}
	return u
}

func callMLService(req PredictRequest) (*MLResponse, error) {
	isRushHour := 0
	if (req.HourOfDay >= 7 && req.HourOfDay <= 9) || (req.HourOfDay >= 17 && req.HourOfDay <= 19) {
		isRushHour = 1
	}
	isWeekend := 0
	if req.DayOfWeek == 5 || req.DayOfWeek == 6 {
		isWeekend = 1
	}

	dist := req.DistanceKm
	if dist <= 0 {
		dist = haversineKm(req.OriginLat, req.OriginLng, req.DestLat, req.DestLng)
	}

	mlReq := MLRequest{
		DistanceKm: dist,
		HourOfDay:  req.HourOfDay,
		DayOfWeek:  req.DayOfWeek,
		Weather:    req.Weather,
		IsRushHour: isRushHour,
		IsWeekend:  isWeekend,
	}

	body, _ := json.Marshal(mlReq)
	client := http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(mlServiceURL()+"/predict", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("ml service unreachable: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	var mlResp MLResponse
	if err := json.Unmarshal(respBody, &mlResp); err != nil {
		return nil, fmt.Errorf("ml service bad response: %w", err)
	}
	return &mlResp, nil
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

func handlePredict(c *fiber.Ctx) error {
	var req PredictRequest

	if c.Method() == "POST" {
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body: " + err.Error()})
		}
	} else {
		if err := c.QueryParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid query params: " + err.Error()})
		}
	}

	if req.Weather == "" {
		req.Weather = "clear"
	}

	formulaRes := formulaPredict(req)

	mlRes, err := callMLService(req)
	if err != nil {
		// Fallback: return formula only
		return c.JSON(PredictResponse{
			ML: MLResult{
				EtaMinutes:    formulaRes.EtaMinutes,
				ConfidenceLow: formulaRes.EtaMinutes * 0.85,
				ConfidenceHigh: formulaRes.EtaMinutes * 1.15,
				FeatureImportance: map[string]float64{},
			},
			Formula: formulaRes,
		})
	}

	return c.JSON(PredictResponse{
		ML: MLResult{
			EtaMinutes:       mlRes.EtaMinutes,
			ConfidenceLow:    mlRes.ConfidenceLow,
			ConfidenceHigh:   mlRes.ConfidenceHigh,
			FeatureImportance: mlRes.FeatureImportance,
		},
		Formula: formulaRes,
	})
}

func handleCompare(c *fiber.Ctx) error {
	var req PredictRequest
	if err := c.QueryParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid query params: " + err.Error()})
	}
	if req.Weather == "" {
		req.Weather = "clear"
	}

	formulaRes := formulaPredict(req)

	mlResult := MLResult{
		EtaMinutes:     formulaRes.EtaMinutes,
		ConfidenceLow:  formulaRes.EtaMinutes * 0.85,
		ConfidenceHigh: formulaRes.EtaMinutes * 1.15,
		FeatureImportance: map[string]float64{},
	}

	mlRes, err := callMLService(req)
	if err == nil {
		mlResult = MLResult{
			EtaMinutes:       mlRes.EtaMinutes,
			ConfidenceLow:    mlRes.ConfidenceLow,
			ConfidenceHigh:   mlRes.ConfidenceHigh,
			FeatureImportance: mlRes.FeatureImportance,
		}
	}

	diff := mlResult.EtaMinutes - formulaRes.EtaMinutes
	diffPct := 0.0
	if formulaRes.EtaMinutes > 0 {
		diffPct = (diff / formulaRes.EtaMinutes) * 100
	}

	return c.JSON(CompareResponse{
		Input:   req,
		ML:      mlResult,
		Formula: formulaRes,
		Delta: DeltaResult{
			DifferenceMinutes: math.Round(diff*100) / 100,
			DifferencePercent: math.Round(diffPct*100) / 100,
			MLFaster:          diff < 0,
		},
	})
}

func handleHealth(c *fiber.Ctx) error {
	// Check ML service health too
	mlHealthy := false
	client := http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(mlServiceURL() + "/health")
	if err == nil && resp.StatusCode == 200 {
		mlHealthy = true
		resp.Body.Close()
	}

	return c.JSON(fiber.Map{
		"status":     "ok",
		"service":    "routeml-api",
		"ml_healthy": mlHealthy,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
	})
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

func main() {
	app := fiber.New(fiber.Config{
		AppName: "routeml-api",
	})

	app.Use(logger.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowHeaders: "Origin, Content-Type, Accept",
	}))

	app.Get("/api/health", handleHealth)
	app.Post("/api/predict", handlePredict)
	app.Get("/api/predict", handlePredict)
	app.Get("/api/compare", handleCompare)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	fmt.Printf("routeml API listening on :%s\n", port)
	if err := app.Listen(":" + port); err != nil {
		panic(err)
	}
}
