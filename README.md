# Personal page (GitHub Pages)

This repository contains a lightweight, static portfolio website for Adam Ropelewski.
It supports multilingual content (English and Polish), dark mode, project-driven video embeds, and a simple GitHub Actions-based deployment pipeline to GitHub Pages.

Live demo: https://adamropelewski.github.io/ 

Features
- Multilanguage support (`content/*.json`), with fallback to `content/template.json`.
- Project list driven by `projects.json` (supports images and YouTube embeds).
- Simple, static site: `index.html`, `styles.css`, and `script.js`.
- GitHub Actions deployment to GitHub Pages (`.github/workflows/deploy.yml`).

Files of interest
- `index.html`, `styles.css`, `script.js` — the website source and layout.
- `settings.json` — defaultLanguage, defaultTheme, defaultAutoplay.
- `content/en.json`, `content/pl.json` — translation strings for each language.
- `content/template.json` — the template used as fallback for missing language keys.
- `projects.json` — projects data (ids, titles, descriptions, images, YouTube `id` / `youtube_embed`).
- `profile.json` — personal profile (full name, email, CV link, GitHub, website). This file is used by the site at build time. It is currently included in the repo; see "Secure personal data" below if you prefer to keep it private.
- `assets/` — images, favicon, and CV PDF.
- `.github/workflows/deploy.yml` — automated deployment to GitHub Pages.

GitHub Pages & deployment
- This repo includes `.github/workflows/deploy.yml`, which runs on push to `main` (and `master`) and deploys the site to GitHub Pages using the `actions/deploy-pages` action.
- Because this repository is named `AdamRopelewski.github.io`, GitHub Pages can operate as a "user" site and will host the site at `https://adamropelewski.github.io/`. The Action will still upload the site output to Pages.

License & author
- This site is built and maintained by Adam Ropelewski. 
