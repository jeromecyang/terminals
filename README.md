# Historic American Train Stations — Interactive Map

A static, GitHub Pages–ready interactive map showcasing **77 historic train stations across the United States**:

- **In Rail Use (38 stations)** — Signal emerald train pins (`#146C43`)
- **Defunct / Repurposed (39 stations)** — Burnished rust arch pins (`#B8432E`)

Clicking any station pin (or selecting it from the searchable, filterable sidebar) opens a Google Maps `InfoWindow` featuring the official **Google Place Card** powered by the Google Maps Platform **Places UI Kit** (`<gmp-place-details-compact>`).

---

## Quick Start & GitHub Pages Deployment

### 1. Create and restrict a Google Maps API key

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select or create a project with billing enabled.
2. Go to **APIs & Services → Library** and enable:
   - **Maps JavaScript API**
   - **Places API (New)**
   - **Places UI Kit** *(if listed separately in your project)*
3. Go to **APIs & Services → Credentials → Create Credentials → API key**.
4. Click **Edit API key** and configure restrictions:
   - **Application restrictions → Websites (HTTP referrers)**:
     - `https://<your-username>.github.io/*`
     - `http://localhost:*/*` *(optional, for local testing)*
   - **API restrictions → Restrict key**: select **Maps JavaScript API**, **Places API (New)**, and **Places UI Kit** (if present).

### 2. Publish on GitHub Pages (via GitHub Actions Secret — Recommended)

This repo includes [.github/workflows/deploy.yml](.github/workflows/deploy.yml), which keeps your API key out of git history and injects it into `config.js` during deployment:

1. Push the repository to GitHub (keep `googleMapsApiKey: ""` blank in `config.js`).
2. In your GitHub repo, go to **Settings → Secrets and variables → Actions → New repository secret**:
   - **Name:** `GOOGLE_MAPS_API_KEY`
   - **Secret:** paste your HTTP-referrer-restricted Google Maps API key
3. Go to **Settings → Pages** and under **Build and deployment → Source**, choose **GitHub Actions**.
4. Trigger a deploy by pushing to `main` or running **Actions → Deploy to GitHub Pages → Run workflow**.
5. Visit `https://<your-username>.github.io/<repo-name>/`.

*(For local testing without touching `config.js`, paste your key into the in-app setup prompt — stored only in `localStorage` — or append `?key=YOUR_API_KEY` to the URL.)*

---

## Optional: Pre-bake Google Place IDs

By default, clicking a station pin resolves its Google Place ID on demand via `Place.searchByText` (ID-only lookup, cached in `localStorage`) and renders `<gmp-place-details-compact>` inside the InfoWindow.

If you want zero text-search lookups at runtime, you can optionally run the helper script once locally with your API key to bake each station's `placeId` directly into `stations.js`:

```bash
GOOGLE_MAPS_API_KEY="YOUR_KEY" node scripts/resolve-place-ids.mjs
```

---

## Project Structure

- `index.html` — Semantic page layout, sidebar directory, map container, and setup dialog
- `styles.css` — Responsive Heritage Rail Atlas styling and custom pin/InfoWindow styles
- `config.js` — Google Maps API key & Map ID configuration
- `stations.js` — Verified coordinates, status (`active` / `defunct`), opened year, and search queries for all 77 stations
- `app.js` — Google Maps JS API loader, color-coded `AdvancedMarkerElement` pins, live filtering/search, and Places UI Kit Place Card integration
- `scripts/resolve-place-ids.mjs` — Optional CLI utility to pre-populate `placeId` fields in `stations.js`
