# Bridgeport Storm Watch

Hyperlocal severe-weather tracking for Bridgeport, Chicago.

## V1 priorities

1. Live Ambient Weather WS-2902 observations.
2. Bridgeport-focused official NWS alerts.
3. Radar and severe-weather data ingestion.
4. Storm evolution: strengthening, steady, weakening.
5. Threat interpretation that separates heavy rain from damaging wind, hail, and rotation.
6. Local verification from pressure, wind/gust trends, wind shifts, rainfall onset, temperature/humidity, and solar radiation.

## Sensor strategy

Raw WS-2902 readings are retained. The current installation is intentionally elevated for wind exposure. Temperature can be solar-biased and rainfall can be affected by deck/wind exposure, so these values must not be treated as unquestioned ground truth. A shaded secondary temperature/humidity sensor can be added later without changing the app architecture.

## Secrets

Ambient Weather credentials must be stored as server-side environment variables and never committed to GitHub or exposed to the browser.
