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

### 2. Configure the site

Open `config.js` and paste your HTTP-referrer-restricted API key:

```js
window.APP_CONFIG = {
  googleMapsApiKey: "YOUR_RESTRICTED_API_KEY",
  mapId: "DEMO_MAP_ID",
};
```

*(Optional: you can also test locally without modifying `config.js` by pasting a key into the in-app setup modal — stored only in `localStorage` — or by appending `?key=YOUR_API_KEY` to the URL.)*

### 3. Publish on GitHub Pages

No build step is needed — this is 100% static HTML, CSS, and JavaScript.

1. Push the repository to GitHub.
2. In your repository settings, go to **Settings → Pages**.
3. Under **Build and deployment**, select **Deploy from a branch** (`main` / `/ (root)`).
4. Visit `https://<your-username>.github.io/<repo-name>/`.

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
