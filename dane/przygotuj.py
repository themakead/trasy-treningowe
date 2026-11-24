"""Przygotowanie danych: sieć ulic i ścieżek z OSM + wysokości z GUGiK NMT.

Uruchom:  .venv\\Scripts\\python dane\\przygotuj.py
Wynik:    strona\\dane\\siec.json  (graf dla przeglądarki)
          dane\\statystyki.txt     (ile przewyższeń jest w okolicy)
Dane OSM: © OpenStreetMap contributors, licencja ODbL. Wysokości: GUGiK (NMT).
"""
import json, math, os, sys, time
from collections import defaultdict

import numpy as np
import osmium
import requests
from pyproj import Transformer

TU = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(TU, "surowe", "wielkopolskie.osm.pbf")
CACHE = os.path.join(TU, "surowe", "wysokosci_cache.npz")
WYNIK = os.path.join(TU, "..", "strona", "dane", "siec.json")
STATY = os.path.join(TU, "statystyki.txt")

SRODEK = (52.4372, 16.7875)   # Baranowo (lat, lon) – nadpisywane węzłem place=Baranowo z OSM
PROMIEN_M = 8000
KROK_M = 10                   # co ile metrów próbkujemy wysokość
GUGIK = "https://services.gugik.gov.pl/nmt/"

DROGI = {
    "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link",
    "unclassified", "residential", "living_street", "service", "track", "path",
    "footway", "cycleway", "bridleway", "pedestrian", "road",
}
NIE_SERVICE = {"parking_aisle", "drive-through"}

do92 = Transformer.from_crs(4326, 2180, always_xy=True)


UTWARDZONE = {"asphalt", "paved", "concrete", "concrete:plates", "paving_stones", "sett", "chipseal", "concrete:lanes"}
SZUTER = {"compacted", "fine_gravel", "gravel", "pebblestone", "unhewn_cobblestone", "cobblestone", "unpaved", "wood"}
TYPY = ["primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service",
        "track", "path", "footway", "cycleway", "bridleway", "pedestrian", "road"]


def flagi(t, hw):
    """Bit 0: można biegać, bit 1: można jechać rowerem, bity 2-3: nawierzchnia (0 utwardzona, 1 szuter, 2 grunt/piach)."""
    foot, bike = t.get("foot"), t.get("bicycle")
    bieg = foot not in ("no", "private")
    if hw in ("footway", "pedestrian", "bridleway"):
        # W Polsce rower na chodniku tylko wyjątkowo – dopuszczamy, gdy OSM to wprost pozwala
        rower = bike in ("yes", "designated", "permissive")
    else:
        rower = bike not in ("no", "dismount", "private")
    if hw == "cycleway" and foot in (None,) and t.get("segregated") is None:
        bieg = True
    s = t.get("surface")
    if s in UTWARDZONE:
        naw = 0
    elif s in SZUTER:
        naw = 1
    elif s is not None:
        naw = 2
    elif hw == "track":
        tt = t.get("tracktype", "")
        naw = 0 if tt == "grade1" else 1 if tt in ("grade2", "grade3") else 2
    elif hw in ("path", "bridleway"):
        naw = 2
    else:
        naw = 0
    return int(bieg) | (int(rower) << 1) | (naw << 2)


def uprosc(pts, tol_m=1.5):
    """Douglas-Peucker w metrach – mniej punktów do rysowania."""
    if len(pts) <= 2:
        return pts
    la0 = math.radians(pts[0][0])
    xy = [((p[1] - pts[0][1]) * 111320 * math.cos(la0), (p[0] - pts[0][0]) * 111320) for p in pts]
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stos = [(0, len(pts) - 1)]
    while stos:
        a, b = stos.pop()
        (x1, y1), (x2, y2) = xy[a], xy[b]
        dl = math.hypot(x2 - x1, y2 - y1) or 1e-9
        best, bi = 0, -1
        for i in range(a + 1, b):
            x0, y0 = xy[i]
            d = abs((x2 - x1) * (y1 - y0) - (x1 - x0) * (y2 - y1)) / dl
            if d > best:
                best, bi = d, i
        if best > tol_m:
            keep[bi] = True
            stos += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


class Czytnik(osmium.SimpleHandler):
    def __init__(self, bbox):
        super().__init__()
        self.bbox = bbox
        self.drogi = []      # (lista id węzłów, tagi)
        self.wsp = {}        # id węzła -> (lat, lon)
        self.srodek = None

    def node(self, n):
        if n.tags.get("place") in ("village", "hamlet") and n.tags.get("name") == "Baranowo":
            la, lo = n.location.lat, n.location.lon
            if abs(la - SRODEK[0]) < 0.05 and abs(lo - SRODEK[1]) < 0.08:
                self.srodek = (la, lo)

    def way(self, w):
        t = w.tags
        hw = t.get("highway")
        if hw not in DROGI:
            return
        if t.get("area") == "yes":
            return
        if t.get("access") in ("private", "no") and t.get("foot") not in ("yes", "designated") and t.get("bicycle") not in ("yes", "designated"):
            return
        if hw == "service" and t.get("service") in NIE_SERVICE:
            return
        s, w_, n_, e = self.bbox
        ids, pts = [], []
        wewnatrz = False
        for nd in w.nodes:
            if not nd.location.valid():
                return
            la, lo = nd.location.lat, nd.location.lon
            ids.append(nd.ref)
            pts.append((la, lo))
            if s <= la <= n_ and w_ <= lo <= e:
                wewnatrz = True
        if not wewnatrz:
            return
        for i, p in zip(ids, pts):
            self.wsp[i] = p
        self.drogi.append((ids, {
            "hw": hw,
            "flagi": flagi(t, hw),
            "most": t.get("bridge") not in (None, "no"),
            "tunel": t.get("tunnel") not in (None, "no"),
            "nazwa": t.get("name", ""),
            "naw": t.get("surface", ""),
            "wid": w.id,
        }))


class Szlaki(osmium.SimpleHandler):
    """Oznakowane szlaki (relacje route=…): id dróg na szlakach rowerowych i pieszych."""
    def __init__(self):
        super().__init__()
        self.rower, self.pieszo = set(), set()

    def relation(self, r):
        if r.tags.get("type") != "route":
            return
        route = r.tags.get("route")
        cel = self.rower if route in ("bicycle", "mtb") else self.pieszo if route in ("hiking", "foot", "walking", "running", "nordic_walking") else None
        if cel is None:
            return
        for m in r.members:
            if m.type == "w":
                cel.add(m.ref)


ZIELEN = {("landuse", "forest"), ("natural", "wood"), ("leisure", "park"), ("leisure", "nature_reserve"),
          ("landuse", "recreation_ground"), ("natural", "heath"), ("natural", "scrub"), ("landuse", "meadow")}
PRZEMYSL = {("landuse", "industrial"), ("landuse", "commercial"), ("landuse", "retail"), ("landuse", "quarry"),
            ("landuse", "railway"), ("aeroway", "aerodrome")}


class Tereny(osmium.SimpleHandler):
    """Lasy/parki i tereny przemysłowe jako wielokąty (tylko w obszarze)."""
    def __init__(self, bbox):
        super().__init__()
        self.bbox = bbox
        self.ziel, self.przem = [], []

    def area(self, a):
        t = a.tags
        klucze = {(k, t.get(k)) for k in ("landuse", "natural", "leisure", "aeroway") if t.get(k)}
        cel = self.ziel if klucze & ZIELEN else self.przem if klucze & PRZEMYSL else None
        if cel is None:
            return
        s, w_, n_, e = self.bbox
        try:
            for outer in a.outer_rings():
                pts = [(nd.lat, nd.lon) for nd in outer]
                if not pts or max(p[0] for p in pts) < s or min(p[0] for p in pts) > n_ \
                        or max(p[1] for p in pts) < w_ or min(p[1] for p in pts) > e:
                    continue
                dziury = [[(nd.lat, nd.lon) for nd in inner] for inner in a.inner_rings(outer)]
                cel.append((pts, dziury))
        except Exception:
            pass  # uszkodzony wielokąt w OSM – pomijamy


def rastruj(wielokaty, bbox, krok_m=20):
    """Siatka ~20 m: True tam, gdzie jest wielokąt (bez dziur)."""
    from PIL import Image, ImageDraw
    s, w_, n_, e = bbox
    kx = 111320 * math.cos(math.radians((s + n_) / 2))
    W, H = int((e - w_) * kx / krok_m) + 1, int((n_ - s) * 111320 / krok_m) + 1
    img = Image.new("1", (W, H), 0)
    dr = ImageDraw.Draw(img)
    px = lambda p: ((p[1] - w_) * kx / krok_m, (n_ - p[0]) * 111320 / krok_m)
    for zew, dziury in wielokaty:
        if len(zew) >= 3:
            dr.polygon([px(p) for p in zew], fill=1)
        for d in dziury:
            if len(d) >= 3:
                dr.polygon([px(p) for p in d], fill=0)
    arr = np.array(img, dtype=bool)
    def czy(lat, lon):
        x, y = int((lon - w_) * kx / krok_m), int((n_ - lat) * 111320 / krok_m)
        return 0 <= x < W and 0 <= y < H and arr[y, x]
    return czy


def odl(a, b):
    """Odległość w metrach (lat, lon)."""
    la = math.radians((a[0] + b[0]) / 2)
    dy = (a[0] - b[0]) * 111320
    dx = (a[1] - b[1]) * 111320 * math.cos(la)
    return math.hypot(dx, dy)


def pobierz_wysokosci(xy):
    """xy: tablica (N,2) easting, northing w EPSG:2180. Zwraca wysokości (N,). Z pamięcią podręczną."""
    klucze = np.round(xy).astype(np.int64)
    pamiec = {}
    if os.path.exists(CACHE):
        z = np.load(CACHE)
        for (e, n), h in zip(z["k"], z["h"]):
            if h > 0:  # zera = błąd serwera, pobierz jeszcze raz
                pamiec[(int(e), int(n))] = float(h)
    brak = sorted({(int(e), int(n)) for e, n in klucze} - pamiec.keys())
    print(f"Wysokości: {len(klucze)} punktów, do pobrania {len(brak)}", flush=True)
    PACZKA = 1000
    sesja = requests.Session()
    for i in range(0, len(brak), PACZKA):
        cz = brak[i:i + PACZKA]
        lista = ",".join(f"{n} {e}" for e, n in cz)  # GUGiK: x = północ, y = wschód
        for proba in range(5):
            try:
                r = sesja.post(GUGIK, data={"request": "GetHByPointList", "list": lista}, timeout=120)
                wart = [float(p.split()[2]) for p in r.text.strip().split(",")]
                if len(wart) != len(cz):
                    raise ValueError("zła liczba wartości")
                if sum(1 for v in wart if v <= 0) > len(wart) * 0.2 and proba < 4:
                    raise ValueError("serwer zwrócił zera")
                break
            except Exception as ex:
                print("  ponawiam:", ex, flush=True)
                time.sleep(3 * (proba + 1))
        else:
            sys.exit("GUGiK nie odpowiada – spróbuj później")
        for k, h in zip(cz, wart):
            pamiec[k] = h
        if (i // PACZKA) % 20 == 0 or i + PACZKA >= len(brak):
            k = np.array(list(pamiec.keys()), dtype=np.int64)
            h = np.array(list(pamiec.values()), dtype=np.float32)
            np.savez_compressed(CACHE, k=k, h=h)
            print(f"  {min(i + PACZKA, len(brak))}/{len(brak)}", flush=True)
        time.sleep(0.2)
    return np.array([pamiec[(int(e), int(n))] for e, n in klucze], dtype=np.float64)


def podejscie(h, prog=2.0):
    """Suma podejść i zejść z histerezą (ignoruje wahania mniejsze niż próg) – jak zegarki."""
    up = down = 0.0
    ref = h[0]
    for v in h[1:]:
        if v - ref >= prog:
            up += v - ref; ref = v
        elif ref - v >= prog:
            down += ref - v; ref = v
    return up, down


def main():
    dlat = PROMIEN_M / 111320 + 0.005
    dlon = PROMIEN_M / (111320 * math.cos(math.radians(SRODEK[0]))) + 0.008
    bbox = (SRODEK[0] - dlat, SRODEK[1] - dlon, SRODEK[0] + dlat, SRODEK[1] + dlon)
    print("Czytam OSM…", flush=True)
    cz = Czytnik(bbox)
    cz.apply_file(PBF, locations=True)
    srodek = cz.srodek or SRODEK
    print("Środek:", srodek, "dróg:", len(cz.drogi), flush=True)
    print("Czytam szlaki…", flush=True)
    sz = Szlaki(); sz.apply_file(PBF)
    print("Czytam lasy/parki i tereny przemysłowe…", flush=True)
    te = Tereny(bbox); te.apply_file(PBF, locations=True)
    w_zieleni, w_przem = rastruj(te.ziel, bbox), rastruj(te.przem, bbox)
    print(f"Szlaki: {len(sz.rower)} dróg rowerowych, {len(sz.pieszo)} pieszych; wielokąty: {len(te.ziel)} zieleni, {len(te.przem)} przemysłu", flush=True)

    # Węzły grafu = końce dróg + punkty wspólne kilku dróg
    uzycia = defaultdict(int)
    for ids, _ in cz.drogi:
        for i in ids:
            uzycia[i] += 1
        uzycia[ids[0]] += 1
        uzycia[ids[-1]] += 1

    krawedzie = []  # (u, v, [(lat,lon)...], tagi)
    for ids, tagi in cz.drogi:
        start = 0
        for k in range(1, len(ids)):
            if uzycia[ids[k]] > 1 or k == len(ids) - 1:
                seg = ids[start:k + 1]
                if len(seg) >= 2 and seg[0] != seg[-1]:
                    krawedzie.append((seg[0], seg[-1], [cz.wsp[i] for i in seg], tagi))
                start = k

    # Tylko w promieniu + największa spójna część
    krawedzie = [e for e in krawedzie
                 if min(odl(srodek, e[2][0]), odl(srodek, e[2][-1])) <= PROMIEN_M]
    rodzic = {}
    def znajdz(a):
        while rodzic.setdefault(a, a) != a:
            rodzic[a] = rodzic[rodzic[a]]; a = rodzic[a]
        return a
    for u, v, _, _ in krawedzie:
        rodzic[znajdz(u)] = znajdz(v)
    licz = defaultdict(int)
    for u, v, _, _ in krawedzie:
        licz[znajdz(u)] += 1
    glowny = max(licz, key=licz.get)
    krawedzie = [e for e in krawedzie if znajdz(e[0]) == glowny]
    print("Krawędzi w grafie:", len(krawedzie), flush=True)

    # Zagęszczenie co KROK_M i wysokości
    geom = []
    wszystkie = []
    for u, v, pts, tagi in krawedzie:
        gesto = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            d = odl(a, b)
            n = max(1, int(d // KROK_M))
            for j in range(1, n + 1):
                t = j / n
                gesto.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        geom.append(gesto)
        wszystkie.extend(gesto)
    arr = np.array(wszystkie)
    e, n = do92.transform(arr[:, 1], arr[:, 0])
    h_all = pobierz_wysokosci(np.column_stack([e, n]))

    wezly = {}
    def wezel(i, p):
        if i not in wezly:
            wezly[i] = (len(wezly), p)
        return wezly[i][0]

    out_e = []
    poz = 0
    sum_len = sum_up = 0.0
    nachylenia = []
    strome = []
    for (u, v, pts_osm, tagi), gesto in zip(krawedzie, geom):
        h = h_all[poz:poz + len(gesto)].copy(); poz += len(gesto)
        d = np.concatenate([[0], np.cumsum([odl(a, b) for a, b in zip(gesto, gesto[1:])])])
        if tagi["most"] or tagi["tunel"] or np.any(h <= 0):
            # Pod mostem NMT pokazuje teren (rzeka, tory) – jezdnię prowadzimy prosto między końcami
            dobre = h > 0
            if tagi["most"] or tagi["tunel"] or not dobre.any():
                h0 = h[0] if h[0] > 0 else (h[dobre][0] if dobre.any() else 0)
                h1 = h[-1] if h[-1] > 0 else (h[dobre][-1] if dobre.any() else 0)
                h = h0 + (h1 - h0) * (d / max(d[-1], 1))
            else:
                h = np.interp(d, d[dobre], h[dobre])
        # Lekkie wygładzenie (okno ~30 m) – usuwa krawężniki i rowy z lidaru
        if len(h) >= 5:
            k = np.ones(3) / 3
            hp = np.pad(h, 1, mode="edge")
            h = np.convolve(hp, k, mode="valid")
        L = float(d[-1])
        dh = np.diff(h)
        up, down = float(dh[dh > 0].sum()), float(-dh[dh < 0].sum())  # surowe (po wygładzeniu); trasa liczona z histerezą w przeglądarce
        sum_len += L; sum_up += up
        if L > 100:
            strome.append(((up + down) / L, gesto[len(gesto)//2], tagi["nazwa"], tagi["hw"], float(h.min()), float(h.max())))
        if L > 50:
            nachylenia.append((up + down) / L)
        # Do przeglądarki (zwięźle): wysokość co ~20 m w decymetrach (pierwsza + różnice),
        # geometria uproszczona (tylko punkty pośrednie, w 1e-5 stopnia, różnicowo od węzła startu).
        idx = list(range(0, len(gesto), 2))
        if idx[-1] != len(gesto) - 1:
            idx.append(len(gesto) - 1)
        hd = [int(round(float(h[j]) * 10)) for j in idx]
        hd = [hd[0]] + [b - a for a, b in zip(hd, hd[1:])]
        pros = uprosc(pts_osm)[1:-1]
        g, pla, plo = [], round(pts_osm[0][0] * 1e5), round(pts_osm[0][1] * 1e5)
        for la, lo in pros:
            a, b = round(la * 1e5), round(lo * 1e5)
            g += [a - pla, b - plo]; pla, plo = a, b
        # Bit 4: szlak rowerowy, 5: szlak pieszy, 6: ponad połowa w lesie/parku, 7: ponad połowa w terenie przemysłowym
        fl = tagi["flagi"]
        if tagi["wid"] in sz.rower: fl |= 16
        if tagi["wid"] in sz.pieszo: fl |= 32
        if sum(w_zieleni(*p) for p in gesto) * 2 > len(gesto): fl |= 64
        if sum(w_przem(*p) for p in gesto) * 2 > len(gesto): fl |= 128
        out_e.append((wezel(u, gesto[0]), wezel(v, gesto[-1]), int(round(L * 10)), int(round(up * 10)),
                      int(round(down * 10)), TYPY.index(tagi["hw"].replace("_link", "")), fl, g, hd))

    nodes = [None] * len(wezly)
    for _, (k, p) in wezly.items():
        nodes[k] = (round(p[0] * 1e5), round(p[1] * 1e5))
    wez = []
    pa = pb = 0
    for a, b in nodes:
        wez += [a - pa, b - pb]; pa, pb = a, b

    kol = list(zip(*out_e))
    os.makedirs(os.path.dirname(WYNIK), exist_ok=True)
    with open(WYNIK, "w", encoding="utf-8") as f:
        json.dump({
            "wersja": 2,
            "srodek": [round(srodek[0], 5), round(srodek[1], 5)], "promien": PROMIEN_M,
            "zrodla": "© OpenStreetMap contributors (ODbL); wysokości: GUGiK NMT",
            "typy": TYPY,
            "wezly": wez,                       # różnicowo, 1e-5 stopnia
            "u": kol[0], "v": kol[1], "dl": kol[2], "up": kol[3], "down": kol[4],  # dl/up/down w dm
            "typ": kol[5], "flagi": kol[6], "geom": kol[7], "wys": kol[8],
        }, f, separators=(",", ":"))
    import gzip
    with open(WYNIK, "rb") as f:
        print(f"Po kompresji (tak wysyła serwer): {len(gzip.compress(f.read()))/1e6:.1f} MB")

    hv = h_all[h_all > 0]
    nach = np.array(nachylenia)
    tekst = (
        f"Obszar: promień {PROMIEN_M/1000:.0f} km wokół Baranowa {srodek}\n"
        f"Sieć: {len(out_e)} odcinków, {sum_len/1000:.0f} km dróg i ścieżek\n"
        f"Wysokość na drogach: min {hv.min():.1f} m, max {hv.max():.1f} m, rozpiętość {hv.max()-hv.min():.1f} m\n"
        f"Percentyle wysokości 5/50/95: {np.percentile(hv,5):.1f} / {np.percentile(hv,50):.1f} / {np.percentile(hv,95):.1f} m\n"
        f"Średnio podejścia na całej sieci: {sum_up/(sum_len/1000):.1f} m na km (jeden kierunek)\n"
        f"Odcinki >50 m: średnia zmienność (podejście+zejście)/długość: mediana {np.median(nach)*100:.2f}%, 90. percentyl {np.percentile(nach,90)*100:.2f}%, 99. {np.percentile(nach,99)*100:.2f}%\n"
    )
    strome.sort(key=lambda x: -x[0])
    tekst += "Najbardziej zmienne odcinki (>100 m):\n"
    for g, p, nz, hw, a, b in strome[:25]:
        tekst += f"  {g*100:5.1f}%  {p[0]:.5f},{p[1]:.5f}  {hw:12s} {nz}  ({a:.0f}–{b:.0f} m)\n"
    with open(STATY, "w", encoding="utf-8") as f:
        f.write(tekst)
    print(tekst)
    print("Zapisano", WYNIK, f"{os.path.getsize(WYNIK)/1e6:.1f} MB")


if __name__ == "__main__":
    main()
