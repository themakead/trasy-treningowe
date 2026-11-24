# Trasy treningowe – Baranowo

Darmowa strona sportpluss z mapą okolicy Baranowa (gm. Tarnowo Podgórne), która układa trasy biegowe i rowerowe według przewyższeń:

- **Pętla** o zadanej długości – od płaskiej do pagórkowatej albo z podanym podejściem w metrach,
- **Podbiegi** – najbliższe wzniesienia o zadanej długości i nachyleniu,
- **A → B** – od najkrótszej do najpłaściejszej drogi.

Profil wysokości, najbardziej strome miejsce, eksport GPX i link do trasy. Wszystko liczy się w przeglądarce.

## Pliki

- `strona/` – strona (HTML + JS, Leaflet), publikowana na GitHub Pages.
- `dane/przygotuj.py` – przygotowanie sieci dróg z wysokościami (`strona/dane/siec.json`).

## Źródła i licencje

- Ulice i ścieżki: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licencja ODbL. Plik `strona/dane/siec.json` jest bazą pochodną OSM i podlega licencji ODbL.
- Wysokości: Główny Urząd Geodezji i Kartografii (GUGiK), Numeryczny Model Terenu.
- Pomysł i podejście (trasy od najkrótszej do najpłaściejszej): [flattensf](https://github.com/almostimplemented/flattensf), licencja MIT, © autorzy flattensf.
- Mapa: [Leaflet](https://leafletjs.com) (BSD-2).
