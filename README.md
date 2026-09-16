# 🌧️ RainGuard-AI India

**AI/ML-Based Integrated Heavy Rainfall Early Warning and Inundation Prediction System for India**

> A production-grade flood monitoring platform combining real-time weather data, satellite precipitation, SAR flood detection, and cloudburst prediction — built with Next.js 16, TypeScript, deck.gl, ONNX Runtime, and Recharts.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Dashboard Tabs](#dashboard-tabs)
- [Architecture](#architecture)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the App](#running-the-app)
- [ML Models](#ml-models)
- [API Endpoints](#api-endpoints)
- [Project Structure](#project-structure)
- [Data Sources](#data-sources)
- [License](#license)

---

## 🌍 Overview

RainGuard-AI India is a comprehensive flood early warning system that monitors **16 major Indian cities** in real-time. It integrates multiple data sources — weather observations, satellite precipitation (NASA GPM IMERG), SAR flood detection, and physics-based cloudburst prediction — into a single Google Weather-inspired dashboard.

The system provides:
- **Real-time weather monitoring** for 16 Indian cities
- **Flood risk assessment** with 6-level alert system
- **SAR-based flood detection** using trained U-Net models
- **Cloudburst prediction** with physics-informed ML
- **Interactive inundation grid** with cell-level inspection
- **NASA GPM IMERG** satellite rainfall integration

---

## ✨ Features

### Weather Monitoring
- Live weather from **OpenWeatherMap API** (real data, not demo)
- Google Weather-inspired UI with hero card, hourly forecast, city list
- 16-city pan-India monitoring with temperature range bars
- deck.gl 3D India map with OpenStreetMap tiles
- Weather detail cards (wind, humidity, pressure, cloud cover, precipitation)

### Cloudburst Early Warning
- Physics-informed prediction engine (CAPE, Lifted Index, Precipitable Water, K-Index)
- Trained **ConvLSTM** model (ONNX Runtime, in-process inference)
- 1–3 hour lead time warnings
- Impact assessment (flash flood, landslide, peak runoff, affected population)
- Spatial heatmaps (12×12 grid)
- Radar chart, grouped bar chart, area chart visualizations
- Alert levels: GREEN → YELLOW → ORANGE → RED → BLACK

### Flood Detection (SAR)
- **ETCI U-Net** (MobileNetV2, 6.6M params) — trained on Sentinel-1 SAR
- **Sen1Floods11 FCN-ResNet50** (32.9M params) — trained on real labeled data
- **Threshold baseline** (Otsu on VV backscatter)
- Interactive hexagonal inundation grid with cell inspector
- Layer toggle: Flood Probability, Rainfall, Risk Class, Terrain (DEM)
- 8 India flood-prone regions with place names (cities, rivers, districts)

### NASA GPM IMERG
- Satellite precipitation at 0.1° × 0.1° resolution
- 30-minute temporal resolution
- Python IMERG worker for real NASA GES DISC data
- Recharts bar chart (color-coded by severity) + cumulative area chart
- IMD-adapted rainfall thresholds (Light/Normal/Heavy/Very Heavy/Extreme)

### Alert System
- 6 severity levels: INFO → WATCH → ADVISORY → WARNING → SEVERE_WARNING → EMERGENCY
- Auto-evaluation triggered on weather data refresh
- Deduplication (1 alert per city per level per hour)
- Acknowledge button for each alert
- Demo alert seeding endpoint for demonstrations

---

## 🛠 Tech Stack

| Category | Technology |
|----------|-----------|
| **Framework** | Next.js 16 (App Router, Turbopack) |
| **Language** | TypeScript 5 |
| **Styling** | Tailwind CSS 4 + shadcn/ui (New York) |
| **Maps** | deck.gl v8 + OpenStreetMap tiles |
| **Charts** | Recharts (bar, area, line, radar) |
| **Database** | Prisma ORM + SQLite |
| **Weather API** | OpenWeatherMap (real-time) |
| **Satellite** | NASA GPM IMERG (via Python worker) |
| **ML Inference** | ONNX Runtime (Node.js, in-process) |
| **ML Training** | PyTorch + segmentation_models_pytorch |
| **Icons** | Lucide React |
| **State** | React hooks (useState, useMemo, useEffect) |

---

## 📊 Dashboard Tabs

| Tab | Description |
|-----|-------------|
| **Weather** | Google Weather-style dashboard with hero card, hourly forecast, weather details, flood risk index, India map, 16-city forecast |
| **Cloudburst** | Physics-informed cloudburst prediction with alert banner, CAPE/moisture/instability metrics, impact assessment, radar chart, 6-hour forecast, XAI feature importance |
| **Flood Detection** | SAR flood detection with region selector, model selector (threshold/ETCI U-Net), 3 canvas panels (SAR, mask, probability), interactive hex grid with cell inspector |
| **NASA IMERG** | Satellite precipitation data with current rate, accumulations (30min–24h), Recharts bar chart (color-coded by severity), cumulative area chart |
| **Alerts** | Alert list with 6 severity levels, acknowledge buttons, flood probability, expected rainfall, recommended actions |
| **Rainfall** | Hourly rainfall analysis with Recharts bar chart, cumulative area chart, aggregation cards (1h/3h/6h/24h), IMD thresholds |
| **Models** | Model registry with trained model metrics, training history charts, baseline model info |
| **Pipeline** | Pipeline monitoring with run history, data source status, trigger button |
| **Data Sources** | Documentation of 8 data sources (weather, rainfall, satellite, radar, NWP, DEM, land use, flood labels) |

---

## 🏗 Architecture

```
                    USER
                      │
                      ▼
               WEB DASHBOARD (Next.js)
                      │
                      ▼
               API ROUTES (Next.js)
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
    OpenWeatherMap  IMERG    Flood Detection
    (Weather)     (Python    (ONNX U-Net)
          │       worker)        │
          │           │          │
          ▼           ▼          ▼
    Feature Engineering + ML Baselines
          │
          ▼
    Alert Engine (6 levels)
          │
          ▼
    Prisma/SQLite (persistence)
```

---

## 🚀 Installation

### Prerequisites

- **Node.js** 18+ (or Bun)
- **Python 3.10+** (for ML training scripts, optional)
- **Git**

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/Ranjith9916/RainGuard-AI-India.git
cd RainGuard-AI-India

# 2. Install dependencies
bun install

# 3. Create .env file
cp .env.example .env
# Edit .env and add your OpenWeatherMap API key

# 4. Push database schema
bun run db:push

# 5. Start the dev server
bun run dev
```

Open **http://localhost:3000** in your browser.

---

## ⚙️ Configuration

### Environment Variables (.env)

```env
# Database
DATABASE_URL=file:./db/custom.db

# Weather API (required — get free key at https://openweathermap.org/api)
OPENWEATHER_API_KEY=your_api_key_here
WEATHER_PROVIDER=openweathermap

# NASA GPM IMERG (optional — falls back to Open-Meteo)
IMERG_USERNAME=your_earthdata_username
IMERG_PASSWORD=your_earthdata_password
IMERG_RUN=late
IMERG_PRODUCT=GPM_3IMERGHL
SATELLITE_PROVIDER=open-meteo-proxy
```

### Get OpenWeatherMap API Key (Free)

1. Register at https://openweathermap.org/users/sign_up
2. Go to API keys: https://home.openweathermap.org/api_keys
3. Copy your key
4. Paste into `.env` file

---

## 🏃 Running the App

```bash
# Start the dev server
bun run dev

# Run lint
bun run lint

# Push database schema
bun run db:push
```

### Optional: Python ML Services

```bash
# Install Python deps for ML training
cd mini-services/flood-unet-worker
pip install -r requirements.txt

# Train ETCI U-Net flood detection model
python train.py --epochs 8 --batch-size 4 --samples 80

# Train Sen1Floods11 FCN-ResNet50
python train_sen1floods11.py --epochs 3 --batch-size 2

# Train Cloudburst ConvLSTM
python train_cloudburst.py --epochs 25 --batch-size 32 --samples 1500
```

---

## 🧠 ML Models

| Model | Architecture | Params | Training Data | Status |
|-------|-------------|--------|---------------|--------|
| **ETCI U-Net** | U-Net + MobileNetV2 | 6.6M | Sentinel-1 SAR (synthetic + ETCI pretrained) | ✅ Trained (IoU 98.6%) |
| **Sen1Floods11** | FCN-ResNet50 | 32.9M | REAL hand-labeled Sentinel-1 (Spain sample) | ✅ Trained (IoU 38.4%) |
| **Cloudburst ConvLSTM** | LSTM(2-layer, 32-hidden) | 14.4K | Physics-labeled synthetic (CAPE, LI, PW) | ✅ Trained (Acc 79.7%) |
| **Threshold Baseline** | Otsu on VV backscatter | N/A | None (classical algorithm) | ✅ Active |
| **Flood Probability** | NRCS Curve-Number | N/A | None (deterministic) | Baseline |
| **Rainfall Forecast** | Persistence + NWP blend | N/A | None (deterministic) | Baseline |

All trained models run in-process via **ONNX Runtime** (no Python server required).

---

## 📡 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/system/status` | GET | System health, provider config, active alerts |
| `/api/weather/cities` | GET | Weather for 16 cities + auto alert evaluation |
| `/api/weather/forecast` | GET | Single location forecast |
| `/api/weather/search` | GET | City geocoding (India-filtered) |
| `/api/weather/observations` | GET | Current weather observations |
| `/api/weather/stations` | GET | Synced station list |
| `/api/risk/current` | GET | Full prediction bundle per city |
| `/api/risk/history` | GET | Recent flood predictions |
| `/api/predictions/rainfall` | GET | Rainfall forecast |
| `/api/predictions/heavy-rain` | GET | Heavy-rain classification |
| `/api/predictions/flood` | GET | Flood probability |
| `/api/predictions/inundation` | GET | Inundation depth |
| `/api/alerts` | GET | Paginated alerts |
| `/api/alerts/active` | GET | Active alerts |
| `/api/alerts/[id]/acknowledge` | POST | Acknowledge alert |
| `/api/alerts/seed-demo` | POST | Seed demo flood alerts |
| `/api/models` | GET | Model registry |
| `/api/models/training-metrics` | GET | Training metrics |
| `/api/pipeline/runs` | GET/POST | Pipeline runs + trigger |
| `/api/flood-detection/detect` | GET | SAR flood detection |
| `/api/flood-detection/regions` | GET | India flood-prone regions |
| `/api/imerg/status` | GET | IMERG provider status |
| `/api/imerg/rainfall` | GET | IMERG rainfall time series |
| `/api/imerg/features` | GET | IMERG ML features |
| `/api/imerg/history` | GET | Historical IMERG analysis |
| `/api/cloudburst/predict` | GET | Cloudburst prediction (cached 5min) |

---

## 📁 Project Structure

```
RainGuard-AI-India/
├── src/
│   ├── app/
│   │   ├── api/              # 25 API route handlers
│   │   ├── globals.css       # Tailwind + custom scrollbar
│   │   ├── layout.tsx        # Root layout (dark theme)
│   │   └── page.tsx          # Main page (renders WeatherApp)
│   ├── components/
│   │   ├── weather/          # 10 UI components (WeatherApp, tabs, etc.)
│   │   ├── floodai/          # 5 sub-tab components
│   │   ├── rainguard/         # deck.gl IndiaMap
│   │   └── ui/               # shadcn/ui components
│   └── lib/
│       ├── adapters/         # Provider interfaces (weather, satellite, radar, etc.)
│       ├── alerts/           # Alert engine + pipeline
│       ├── cloudburst/       # Cloudburst prediction engine
│       ├── config/           # Config + logger
│       ├── features/         # Feature engineering
│       ├── flood-detection/  # SAR preprocessing + India regions
│       ├── ml/               # ML baselines
│       └── weather/          # Weather API clients + cities
├── mini-services/
│   └── flood-unet-worker/    # Python ML training scripts
│       ├── train.py           # ETCI U-Net training
│       ├── train_sen1floods11.py  # Sen1Floods11 training
│       ├── train_cloudburst.py    # Cloudburst ConvLSTM training
│       └── requirements.txt
├── prisma/
│   └── schema.prisma         # 9 database models
├── package.json
└── .env.example
```

---

## 🗺 Data Sources

| Source | Provider | Resolution | Access |
|--------|---------|-----------|--------|
| Weather | OpenWeatherMap API | Real-time | Free API key |
| Satellite Rainfall | NASA GPM IMERG | 0.1° / 30min | Earthdata login (free) |
| Base Map | OpenStreetMap | Global | Free, no key |
| Flood Detection | Sentinel-1 SAR (ETCI/Sen1Floods11) | 10m | Trained models |
| Cloudburst Physics | Computed from weather data | Real-time | Built-in |

---

## 📄 License

MIT License — feel free to use this project for research, education, or operational flood monitoring.

---

## 🙏 Acknowledgements

- [OpenWeatherMap](https://openweathermap.org/) — Weather data
- [NASA GPM IMERG](https://gpm.nasa.gov/data) — Satellite precipitation
- [ETCI-2021 Competition](https://github.com/sidgan/ETCI-2021-Competition-on-Flood-Detection) — Flood detection reference
- [Sen1Floods11](https://github.com/cloudtostreet/Sen1Floods11) — Labeled SAR dataset
- [Cloudburst-Early-Warning](https://github.com/g-aaditya/Cloudburst-Early-Warning) — Cloudburst engine reference
- [OpenStreetMap](https://www.openstreetmap.org/) — Map tiles
- [shadcn/ui](https://ui.shadcn.com/) — UI components
- [deck.gl](https://deck.gl/) — Geospatial visualization
- [Recharts](https://recharts.org/) — Charts

---

**Built with ❤️ for India's flood resilience**
