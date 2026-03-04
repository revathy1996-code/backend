# Local OSRM Setup (Windows) + New Machine Migration Checklist

This document is the reference for reproducing the same local setup on another machine.

## 0) What To Push To Git

Push source/config only:

- `backEnd/src/**`
- `backEnd/scripts/**`
- `backEnd/OSRM_LOCAL_SETUP.md`
- `backEnd/.env.example` (keep this updated)
- `frontEnd/track/src/**`
- `frontEnd/track/package.json`, `package-lock.json`
- `backEnd/package.json`, `package-lock.json`

## 1) What Not To Push

Do not push local/runtime artifacts:

- `backEnd/.env`
- `backEnd/node_modules/`
- `frontEnd/track/node_modules/`
- `frontEnd/track/dist/`
- `.run-logs/`
- `.mongodb-data/`
- `osrm-data/*.osm.pbf`
- `osrm-data/*.osrm*`

Note: OSRM map/extract files are very large and should be recreated or copied manually, not committed.

## 2) Prerequisites On New Machine

- Windows 10/11
- Docker Desktop (Linux engine/WSL2)
- Node.js + npm
- MongoDB server

If WSL features are missing, run this in Administrator PowerShell and reboot:

```powershell
cd <repo>\backEnd
powershell -ExecutionPolicy Bypass -File .\scripts\enable-wsl-prereqs-admin.ps1
```

## 3) Clone + Install

```powershell
git clone <your-repo-url>
cd <repo>\backEnd
npm install
cd ..\frontEnd\track
npm install
```

## 4) Start MongoDB

Example:

```powershell
& "C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe" --dbpath "<repo>\.mongodb-data" --bind_ip 127.0.0.1 --port 27017
```

## 5) Build + Run Local OSRM

### Option A: Full South-India dataset (heavier)

From `backEnd`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-local-osrm.ps1
```

This uses `southern-zone-latest.osm.pbf` by default.
It can require high Docker memory (8GB+ recommended).

### Option B: Chennai bounding-box dataset (lighter, recommended for local dev)

From repo root:

```powershell
mkdir osrm-data -ErrorAction SilentlyContinue
curl.exe -L "https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf" -o ".\osrm-data\southern-zone-latest.osm.pbf"
docker pull iboates/osmium:latest
docker run --rm -v "${PWD}\\osrm-data:/data" iboates/osmium:latest extract -b 79.95,12.85,80.35,13.35 -o /data/chennai-bbox.osm.pbf /data/southern-zone-latest.osm.pbf --overwrite
docker pull osrm/osrm-backend:latest
docker run --rm -v "${PWD}\\osrm-data:/data" osrm/osrm-backend:latest osrm-extract -p /opt/car.lua --threads 2 /data/chennai-bbox.osm.pbf
docker run --rm -v "${PWD}\\osrm-data:/data" osrm/osrm-backend:latest osrm-partition /data/chennai-bbox.osrm
docker run --rm -v "${PWD}\\osrm-data:/data" osrm/osrm-backend:latest osrm-customize /data/chennai-bbox.osrm
docker rm -f osrm-local
docker run -d --name osrm-local -p 5001:5000 -v "${PWD}\\osrm-data:/data" osrm/osrm-backend:latest osrm-routed --algorithm mld /data/chennai-bbox.osrm
```

## 6) Backend Env

Create `backEnd/.env` (copy from `.env.example`) and ensure:

```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/fleet_management
OSRM_BASE_URL=http://localhost:5001
OSRM_TIMEOUT_MS=8000
```

## 7) Start Apps

Backend:

```powershell
cd <repo>\backEnd
npm run dev
```

Frontend:

```powershell
cd <repo>\frontEnd\track
npx ng serve --host 0.0.0.0 --port 4200
```

## 8) Verify

OSRM:

```powershell
Invoke-WebRequest -UseBasicParsing "http://localhost:5001/route/v1/driving/80.2707,13.0827;80.2900,13.0600?overview=false"
```

Backend:

```powershell
Invoke-WebRequest -UseBasicParsing "http://localhost:5000/health"
```

Frontend:

- `http://localhost:4200/fleet-management`

## 9) Stop

```powershell
docker rm -f osrm-local
```

Stop backend/frontend terminal processes with `Ctrl + C`.
