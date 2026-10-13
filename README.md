# Investor Bank Account Opening — Flutter + Backend

A development prototype for a **Local Investor / Corporate Bank Account Opening** workflow based on the supplied six-page form.

The project is intentionally split into:

- `flutter_frontend/` — Flutter customer application
- `backend/` — Node.js + Express REST API
- `db/schema.sql` — PostgreSQL schema
- `docker-compose.yml` — local PostgreSQL container

## Frontend workflow

The Flutter app turns the form into five guided steps:

1. General & Company — bank/branch and company registration
2. Trade, Tax & Office — trade license, TIN and office address
3. Account — account title, nature, business sector, currency, entity and account type
4. Operating Person — authorised person's identity, occupation, income/source of funds and addresses
5. Documents & Review — required attachments, declaration and final review

Required uploads are PDF/JPG/PNG and are limited to 5 MB per file in this prototype.

## Backend API

Endpoints:

- `GET /health`
- `POST /api/applications`
- `GET /api/applications/:id`
- `POST /api/applications/:id/documents`
- `POST /api/applications/:id/submit`

The backend validates the required application fields and prevents submission when any mandatory document is missing.

## Run PostgreSQL

From this directory:

```powershell
docker compose up -d
```

## Run backend

```powershell
cd backend
copy .env.example .env
npm install
npm run dev
```

The API runs on `http://localhost:4000`.

## Run Flutter frontend

Open `flutter_frontend` as a Flutter project. If it is being merged into your existing Flutter project, copy the `lib/` folder and the dependencies from `pubspec.yaml` into that project.

For the Android emulator, the default API URL is:

```text
http://10.0.2.2:4000/api
```

For another backend address:

```powershell
flutter run --dart-define=API_BASE_URL=http://YOUR_HOST:4000/api
```

## Important

This is a development prototype, not production banking software. Real deployments need authentication, authorisation, encryption, secure document storage, audit logging, validation, rate limiting, malware scanning, secrets management and compliance controls.
