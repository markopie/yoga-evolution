# Yoga Evolution

An open-source, text-first yoga teaching and sequencing app with offline practice support.

Yoga Evolution separates the application from its curriculum data. This repository contains the web application, tests, and deployment workflow. It intentionally does not include proprietary curriculum sequences, therapeutic protocols, database seeds or migrations, image assets, or book-derived research notes.

## Run locally

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env.local` and configure a compatible Supabase project with a publishable key.
3. Start the app with `npm run dev`.

Run checks with `npm test`, `npm run build`, and `npm run test:browser`.

## Deploy

GitHub Pages deployment is configured through `.github/workflows/deploy-pages.yml`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as repository variables or secrets before enabling Pages with GitHub Actions.

## Contributing

Issues and pull requests are welcome. Keep contributions independent of copyrighted source materials and do not commit credentials, private media, curriculum exports, or production database data.

## Sources and curriculum data

See [SOURCES.md](SOURCES.md). The application may connect to a separately managed Supabase instance that serves authorised runtime data; that data is not distributed in this repository.

## License

The source code in this repository is licensed under the MIT License. Third-party names, trademarks, external content, and separately managed curriculum data are not granted by that license.
