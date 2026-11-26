/**
 * Configuration for Historic American Train Stations Map
 *
 * To deploy on GitHub Pages:
 * 1. Create a Google Maps Platform API key in Google Cloud Console.
 * 2. Enable "Maps JavaScript API" and "Places API (New)" (and "Places UI Kit" if listed).
 * 3. Restrict the key by HTTP referrer to your GitHub Pages URL
 *    (e.g., https://<username>.github.io/<repo>/*).
 * 4. Paste the restricted API key into `googleMapsApiKey` below.
 *
 * Note: You can also test locally without editing this file by pasting
 * your key into the in-app setup dialog (saved only in your browser's localStorage)
 * or passing `?key=YOUR_API_KEY` in the URL.
 */
window.APP_CONFIG = {
  googleMapsApiKey: "",
  // Required for Google Maps Advanced Markers. You can replace "DEMO_MAP_ID"
  // with your own Cloud-based Map ID from Google Cloud Console for custom map styling.
  mapId: "DEMO_MAP_ID",
};
