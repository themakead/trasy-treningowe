"""Miejsca do treningu w plenerze z OSM (próbka: siłownie plenerowe).

Uruchom:  .venv\\Scripts\\python dane\\miejsca.py
Wynik:    strona\\dane\\miejsca.json
Dane OSM: © OpenStreetMap contributors, licencja ODbL.
"""
import json, math, os
from collections import Counter

import osmium

TU = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(TU, "surowe", "wielkopolskie.osm.pbf")
SIEC = os.path.join(TU, "..", "strona", "dane", "siec.json")
WYNIK = os.path.join(TU, "..", "strona", "dane", "miejsca.json")
SKUPIENIE_M = 60   # urządzenia bliżej niż tyle metrów = jedna siłownia


def odl(a, b):
    k = math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * k)


def main():
    with open(SIEC, encoding="utf-8") as f:
        siec = json.load(f)
    srodek, promien = tuple(siec["srodek"]), siec["promien"]

    punkty, inne = [], Counter()
    for obj in osmium.FileProcessor(PBF).with_locations().with_areas():
        t = obj.tags
        leisure, sport = t.get("leisure"), t.get("sport", "")
        silownia = leisure == "fitness_station" or (leisure == "pitch" and "fitness" in sport) \
            or (leisure == "fitness_centre" and t.get("outdoor") == "yes")
        # do statystyki: co jeszcze dałoby się pokazać później
        if not silownia:
            if leisure == "track": klucz = "bieżnie"
            elif t.get("amenity") == "drinking_water": klucz = "woda pitna"
            elif t.get("amenity") == "toilets": klucz = "toalety"
            elif leisure == "fitness_centre": klucz = "kluby fitness (w budynkach)"
            else: klucz = None
        if obj.is_node():
            p = (obj.location.lat, obj.location.lon)
        elif obj.is_area():
            try:
                pierscien = next(iter(obj.outer_rings()))
                pts = [(n.lat, n.lon) for n in pierscien]
            except Exception:
                continue
            p = (sum(x[0] for x in pts) / len(pts), sum(x[1] for x in pts) / len(pts))
        else:
            continue
        if odl(p, srodek) > promien:
            continue
        if silownia:
            punkty.append((p, t.get("name") or t.get("fitness_station") or ""))
        elif klucz:
            inne[klucz] += 1

    # skupienie pojedynczych urządzeń w jedną siłownię
    grupy = []
    for p, nazwa in punkty:
        for g in grupy:
            if odl(p, g["p"]) < SKUPIENIE_M:
                g["n"] += 1
                g["pts"].append(p)
                g["p"] = (sum(x[0] for x in g["pts"]) / len(g["pts"]), sum(x[1] for x in g["pts"]) / len(g["pts"]))
                break
        else:
            grupy.append({"p": p, "n": 1, "pts": [p]})

    silownie = [[round(g["p"][0], 5), round(g["p"][1], 5), g["n"]] for g in grupy]
    with open(WYNIK, "w", encoding="utf-8") as f:
        json.dump({"silownie": silownie}, f, separators=(",", ":"))
    print(f"Siłownie plenerowe: {len(silownie)} miejsc ({len(punkty)} obiektów w OSM)")
    for k, v in inne.most_common():
        print(f"  dla porównania – {k}: {v}")


if __name__ == "__main__":
    main()
