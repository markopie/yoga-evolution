# Yoga Evolution

An open-source, text-first yoga teaching and sequencing app with offline practice support.

Yoga Evolution separates the application from its curriculum data. This repository contains the web application, tests, and deployment workflow. It intentionally does not include proprietary curriculum sequences, therapeutic protocols, database seeds or migrations, image assets, or book-derived research notes.

## Run locally

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env.local` and configure the hosted Supabase project with its publishable key. The hosted URL and key use the same names as the GitHub Actions `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` settings.
3. Start the app with `npm run dev`.

The repository's normal/testing app must use hosted Supabase. The local Supabase stack is reserved for private personal data and should only be selected intentionally by changing `.env.local` to the local URL and local publishable key. GitHub Actions secrets are not available to a local dev server, and GitHub will not show secret values after they are saved, so copy the hosted publishable key from the Supabase project settings into the untracked `.env.local` file. Never commit that file or a service-role/secret key.

Run checks with `npm test`, `npm run build`, and `npm run test:browser`.

Use `npm run test:browser:connected` to verify Classes, sequence PDF downloads,
manual/curriculum playback, Browse, and backup import against the hosted Supabase
configuration in `.env.local`. This run uses real authentication and database
requests, creates dedicated integration profiles and a backup copy, and leaves
existing profiles and sequences alone. Class/student records stay in browser
storage and are checked for exclusion from outgoing database requests.
`test:browser` remains the separate fixture-based regression suite; it is not a
replacement for the connected test. Use `npm run dev` for the connected visual
preview. Development previews do not install the offline app cache.

## Classes

Classes belong to the open profile and are saved explicitly in this browser.
Each class references an existing sequence and keeps its own student names,
form-received-and-reviewed checkbox/date, and additional props. Keep signed
documents outside the app. Recorded props come only from sequence metadata and
recognised prop tags, including linked sequences. All props are included by
default; saved ticks record which props to include in that class.
Use **View sequence → Download PDF** for the existing printable sequence sheet.
Saved classes open as a class sheet; choose **Edit class** to change their details.
The class sheet also offers **Download PDF** with an optional cover containing
the class name, sequence, selected props, and student names. Form-review status
and dates are excluded from the cover, and the sequence pages retain their design.
Class/student records are included in an exported backup and restored locally
when that backup is imported. They are not synced to Supabase.

## Deploy

GitHub Pages deployment is configured through `.github/workflows/deploy-pages.yml`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as repository variables or secrets before enabling Pages with GitHub Actions.

## Contributing

Issues and pull requests are welcome. Keep contributions independent of copyrighted source materials and do not commit credentials, private media, curriculum exports, or production database data.

## Sources and curriculum data

See [SOURCES.md](SOURCES.md). The application may connect to a separately managed Supabase instance that serves authorised runtime data; that data is not distributed in this repository.

## License

The source code in this repository is licensed under the MIT License. Third-party names, trademarks, external content, and separately managed curriculum data are not granted by that license.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the separate licensing status of hosted media assets, including generated audio.
