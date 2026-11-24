// Miejsca do treningu na mapie (próbka: siłownie plenerowe z OSM, dane/miejsca.json).
"use strict";

const warstwaMiejsc = L.layerGroup();
let miejscaWczytane = false;

function pokazMiejsca(wlacz) {
  if (!wlacz) { warstwaMiejsc.remove(); return; }
  warstwaMiejsc.addTo(mapa);
  if (miejscaWczytane) return;
  miejscaWczytane = true;
  fetch("dane/miejsca.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then((d) => {
      for (const [la, lo, n] of d.silownie) {
        L.marker([la, lo], {
          icon: L.divIcon({ className: "miejsce-ikona", html: IKONA_SILOWNI, iconSize: [26, 26] }),
          keyboard: false,
        })
          // dymek po kliknięciu/dotknięciu – działa też na telefonie (najechanie myszą nie)
          .bindPopup(`<b>Siłownia plenerowa</b>${n > 1 ? `<br>${n} ${n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "urządzenia" : "urządzeń"}` : ""}`, { offset: [0, -8] })
          .addTo(warstwaMiejsc);
      }
      $("silownieIle").textContent = `(${d.silownie.length} w okolicy)`;
    })
    .catch(() => { miejscaWczytane = false; $("silownieIle").textContent = "(nie udało się wczytać)"; });
}

// hantla (rysunek prosty, kolor z CSS)
const IKONA_SILOWNI = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">' +
  '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>';

$("silownie").checked = localStorage.getItem("trasy.silownie") !== "0";
$("silownie").onchange = () => {
  localStorage.setItem("trasy.silownie", $("silownie").checked ? "1" : "0");
  pokazMiejsca($("silownie").checked);
};
pokazMiejsca($("silownie").checked);
