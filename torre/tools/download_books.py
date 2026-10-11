#!/usr/bin/env python3
"""Download curated public-domain chess literature from archive.org (+ Gutenberg
fallbacks) into books/. Resumable: re-running skips files already present and
reuses the cached resolve plan (books/_plan.json) unless --replan is given."""

import json
import os
import re
import sys
import time
import unicodedata
from urllib.parse import quote

import requests
from torre import paths

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.join(str(paths.REPO), "books")
PER_DIR = os.path.join(ROOT, "periodicals")
GUT_DIR = os.path.join(ROOT, "gutenberg")
PLAN_PATH = os.path.join(ROOT, "_plan.json")
MANIFEST_PATH = os.path.join(ROOT, "manifest.json")
INDEX_PATH = os.path.join(ROOT, "INDEX.md")
MIN_SIZE = 100 * 1024
YEAR_MAX = 1930

IA = "https://archive.org"
S = requests.Session()
S.headers["User-Agent"] = "chess-jd/1.0 (public-domain chess literature collection)"
_last_req = 0.0


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def _pace():
    global _last_req
    dt = time.time() - _last_req
    if dt < 1.05:
        time.sleep(1.05 - dt)


def ia_get(url, stream=False, **kw):
    """GET with pacing, backoff on 429/5xx, one retry built into the loop."""
    global _last_req
    for attempt in range(4):
        _pace()
        try:
            r = S.get(url, stream=stream, timeout=(20, 90), **kw)
            _last_req = time.time()
        except requests.RequestException as e:
            log(f"  net error {e}; retrying")
            time.sleep(4 * (attempt + 1))
            continue
        if r.status_code in (429, 500, 502, 503, 520):
            wait = 6 * (2 ** attempt)
            log(f"  HTTP {r.status_code}; backing off {wait}s")
            r.close()
            time.sleep(wait)
            continue
        return r
    return None


def search(query, rows=12):
    params = [("q", query), ("rows", rows), ("output", "json"),
              ("fl[]", "identifier"), ("fl[]", "title"),
              ("fl[]", "creator"), ("fl[]", "year")]
    r = ia_get(f"{IA}/advancedsearch.php", params=params)
    if r is None or r.status_code != 200:
        log(f"  search failed: {query!r} -> {r.status_code if r else 'no response'}")
        return []
    try:
        return r.json()["response"]["docs"]
    except Exception:
        return []


def get_meta(identifier):
    r = ia_get(f"{IA}/metadata/{identifier}")
    if r is None or r.status_code != 200:
        return None
    try:
        return r.json()
    except Exception:
        return None


def is_restricted(md):
    if md.get("is_dark"):
        return True
    m = md.get("metadata") or {}
    if m.get("access-restricted-item") in (True, "true", "True"):
        return True
    if any(k.startswith("lending___") for k in m):
        return True
    cols = m.get("collection") or []
    if isinstance(cols, str):
        cols = [cols]
    if "inlibrary" in cols:
        return True
    return False


def pick_pdf(files):
    pdfs = []
    for f in files or []:
        name = (f.get("name") or "")
        if not name.lower().endswith(".pdf"):
            continue
        try:
            size = int(f.get("size") or 0)
        except ValueError:
            size = 0
        if size < MIN_SIZE:
            continue
        pdfs.append((name, size))
    if not pdfs:
        return None
    pdfs.sort(key=lambda t: (0 if t[0].endswith("_text.pdf") else 1, -t[1]))
    return pdfs[0]


def first_int(v):
    if isinstance(v, list):
        v = v[0] if v else None
    try:
        return int(str(v)[:4])
    except (TypeError, ValueError):
        return None


def sanitize(name):
    name = re.sub(r'[\\/:*?"<>|]', "", name)
    name = re.sub(r"\s+", " ", name).strip().rstrip(".")
    return name[:150]


ID_BLOCKLIST = ("piranesi-", "arxiv-", "pubmed-", "bpr-", "cia-readingroom")
STOPWORDS = {
    "chess", "schach", "echecs", "échecs", "scacchi", "scachi", "ajedrez",
    "axedrez", "game", "games", "spiel", "jeu", "giuoco", "gioco", "book",
    "international", "internationale", "internationales", "tournament",
    "turnier", "congress", "the", "das", "der", "des", "und", "with",
    "from", "being", "collection", "complete",
}


def norm_words(s):
    n = unicodedata.normalize("NFKD", (s or "").lower())
    n = "".join(c for c in n if not unicodedata.combining(c))
    return set(re.findall(r"[a-z0-9]+", n))


def keywords(name):
    return {w for w in norm_words(name) if len(w) >= 4 and w not in STOPWORDS}


def title_matches(kw, title):
    if not kw:
        return True
    tw = norm_words(title)
    return any(k in tw for k in kw)


USED_IDS = set()


def resolve_item(queries, name, year_max=YEAR_MAX):
    """Return list of (identifier, pdf_name, pdf_size, year) candidates."""
    kw = keywords(name)
    cands = []
    seen = set()
    for q in queries:
        full = q if "mediatype" in q else q + " AND mediatype:texts"
        need_check = "title:(" not in q and "identifier:(" not in q
        for d in search(full):
            ident = d.get("identifier")
            if not ident or ident in USED_IDS or ident in seen:
                continue
            if ident.startswith(ID_BLOCKLIST):
                continue
            seen.add(ident)
            yr = first_int(d.get("year"))
            if yr and yr > year_max:
                continue
            if need_check and not title_matches(kw, d.get("title")):
                continue
            cands.append((ident, yr))
    for ident, yr in cands[:8]:
        md = get_meta(ident)
        if not md or is_restricted(md):
            continue
        pdf = pick_pdf(md.get("files"))
        if not pdf:
            continue
        m = md.get("metadata") or {}
        myr = first_int(m.get("year")) or first_int(m.get("date")) or yr
        if myr and myr > year_max:
            continue
        USED_IDS.add(ident)
        alts = [(ident, pdf[0], pdf[1], myr)]
        for ident2, yr2 in cands[1:8]:
            if len(alts) >= 3:
                break
            md2 = get_meta(ident2)
            if not md2 or is_restricted(md2):
                continue
            pdf2 = pick_pdf(md2.get("files"))
            if not pdf2:
                continue
            alts.append((ident2, pdf2[0], pdf2[1], yr2))
        return alts
    return None


# ----------------------------------------------------------------------------
# Specs
# ----------------------------------------------------------------------------
B = "book"


def bk(name, author, year, *queries):
    return {"category": B, "name": name, "author": author, "year": year,
            "queries": list(queries)}


BOOK_SPECS = [
    bk("Analysis of the Game of Chess", "François-André Danican Philidor", 1777,
       "title:(analysis of the game of chess) AND creator:(philidor)"),
    bk("The Chess-Player's Handbook", "Howard Staunton", 1847,
       "identifier:(chessplayershan00etiqgoog)",
       "identifier:(10431962bsb)",
       "title:(chess players handbook) AND creator:(staunton)"),
    bk("Chess Praxis", "Howard Staunton", 1860,
       "title:(chess praxis) AND creator:(staunton)"),
    bk("The Chess-Player's Companion", "Howard Staunton", 1849,
       "title:(chess players companion) AND creator:(staunton)"),
    bk("The Chess Tournament (London 1851)", "Howard Staunton", 1852,
       "title:(chess tournament) AND creator:(staunton)"),
    bk("Chess Studies", "George Walker", 1844,
       "title:(chess studies) AND creator:(walker)"),
    bk("Chess and Chess-Players", "George Walker", 1850,
       "title:(chess and chess players) AND creator:(walker)"),
    bk("A Selection of Games at Chess", "George Walker", 1835,
       "title:(selection of games at chess)"),
    bk("The Exploits and Triumphs in Europe of Paul Morphy", "Frederick Milnes Edge", 1859,
       "title:(exploits and triumphs) AND creator:(edge)"),
    bk("Morphy's Games of Chess", "Johann Jacob Löwenthal", 1860,
       "identifier:(morphysgamesofch00frer)",
       "title:(morphy games of chess) AND year:[1855 TO 1900]"),
    bk("The Modern Chess Instructor", "Wilhelm Steinitz", 1889,
       "title:(modern chess instructor)"),
    bk("Common Sense in Chess", "Emanuel Lasker", 1896,
       "identifier:(kpbc.umk.pl.Magazyn_392_POWER_004_07_264926)",
       "title:(common sense in chess)"),
    bk("The International Chess Congress, St. Petersburg 1909", "Emanuel Lasker", 1909,
       "title:(petersburg) AND creator:(lasker) AND (chess OR schach)",
       "title:(international chess congress) AND creator:(lasker)"),
    bk("Lasker's Manual of Chess", "Emanuel Lasker", 1925,
       "title:(manual of chess) AND creator:(lasker)"),
    bk("Chess Fundamentals", "José Raúl Capablanca", 1921,
       "title:(chess fundamentals) AND creator:(capablanca)"),
    bk("My Chess Career", "José Raúl Capablanca", 1920,
       "title:(my chess career)"),
    bk("Chess Strategy", "Edward Lasker", 1915,
       "title:(chess strategy) AND creator:(lasker)"),
    bk("The Principles of Chess in Theory and Practice", "James Mason", 1894,
       "title:(principles of chess) AND creator:(mason)"),
    bk("The Art of Chess", "James Mason", 1895,
       "title:(art of chess) AND creator:(mason)"),
    bk("Chess History and Reminiscences", "Henry Edward Bird", 1893,
       "title:(chess history and reminiscences)"),
    bk("Chess Masterpieces", "Henry Edward Bird", 1875,
       "title:(chess masterpieces) AND creator:(bird)",
       "title:(chess masterpieces)"),
    bk("Mr. Blackburne's Games at Chess", "Joseph Henry Blackburne", 1899,
       "title:(blackburne games at chess)",
       "title:(blackburne) AND creator:(graham)"),
    bk("My System (Mein System)", "Aaron Nimzowitsch", 1925,
       "identifier:(nimzowitsch-my-system)",
       "title:(my system) AND (nimzowitsch)"),
    bk("Die Praxis meines Systems / Chess Praxis", "Aaron Nimzowitsch", 1928,
       "identifier:(my-system-n-chess-praxis-aron-nimzowitsch)"),
    bk("Modern Ideas in Chess", "Richard Réti", 1923,
       "title:(modern ideas in chess)"),
    bk("The Book of the First American Chess Congress", "Daniel Willard Fiske", 1859,
       "title:(first american chess congress)"),
    bk("Horae Divanianae", "Elijah Williams", 1852,
       "title:(horae divanianae)"),
    bk("Amusements in Chess", "Henry Tomlinson", 1845,
       "title:(amusements in chess)"),
    bk("The Chess-Player's Annual for 1856", "Charles Tomlinson", 1856,
       "title:(chess players annual)"),
    bk("A Treatise on the Game of Chess", "Jacob Henry Sarratt", 1808,
       "title:(treatise on the game of chess) AND creator:(sarratt)"),
    bk("The Works of Damiano, Ruy-Lopez and Salvio on the Game of Chess", "Jacob Henry Sarratt", 1813,
       "creator:(sarratt) AND title:(damiano)",
       "identifier:(bub_gb_itBelZLYuZcC)"),
    bk("The Works of Gianutio and Gustavus Selenus on the Game of Chess", "Jacob Henry Sarratt", 1817,
       "creator:(sarratt) AND title:(gianutio)"),
    bk("Chess", "Richard Twiss", 1787,
       "creator:(twiss) AND title:(chess)"),
    bk("Anecdotes of Chess", "Richard Twiss", 1787,
       "creator:(twiss) AND title:(anecdotes)"),
    bk("Essai sur le Jeu des Échecs", "Philipp Stamma", 1741,
       "identifier:(bub_gb_4_0UAAAAYAAJ)",
       "creator:(stamma)"),
    bk("The Chess-Player's Manual", "George Hatfeild Gossip", 1874,
       "title:(chess players manual) AND creator:(gossip)"),
    bk("Chess Openings Ancient and Modern", "Freeborough & Ranken", 1889,
       "title:(chess openings ancient and modern)"),
    bk("Synopsis of the Chess Openings", "William Cook", 1874,
       "title:(synopsis of chess openings)"),
    bk("Chess Generalship", "Franklin Knowles Young", 1910,
       "title:(chess generalship)"),
    bk("Grand Tactics of Chess", "Franklin Knowles Young", 1898,
       "title:(grand tactics of chess)"),
    bk("Chess Studies; or, Endings of Games", "Kling & Horwitz", 1851,
       "title:(chess studies) AND (kling OR horwitz)"),
    bk("A Collection of Two Hundred Chess Problems", "Francis Healey", 1862,
       "title:(two hundred chess problems)",
       "creator:(healey) AND title:(problems)"),
    bk("Chess Strategy", "Sam Loyd", 1878,
       "title:(chess strategy) AND creator:(loyd)"),
    bk("A History of Chess", "H. J. R. Murray", 1913,
       "title:(history of chess) AND creator:(murray)"),
    bk("Geschichte und Literatur des Schachspiels", "Antonius van der Linde", 1874,
       "creator:(linde) AND title:(schachspiels)",
       "identifier:(geschichteundli00lindgoog)"),
    bk("Handbuch des Schachspiels", "Bilguer / von der Lasa", 1843,
       "title:(handbuch des schachspiels)"),
    bk("Theoretisch-praktisches Handbuch des Schachspiels", "Jean Dufresne", 1863,
       "creator:(dufresne) AND title:(handbuch)",
       "title:(lehrbuch des schachspiels) AND creator:(dufresne)"),
    bk("Theorie und Praxis der Endspiele", "Johann Berger", 1890,
       "title:(theorie und praxis der endspiele)"),
    bk("Repetición de Amores e Arte de Ajedrez", "Luis Ramírez de Lucena", 1497,
       "creator:(lucena) AND (ajedrez OR axedrez OR chess)",
       "title:(repeticion de amores)"),
    bk("Questo Libro e da Imparare Giocare a Scachi", "Pedro Damiano", 1512,
       "creator:(damiano) AND (scacchi OR scachi OR chess)"),
    bk("Libro de la Invención Liberal y Arte del Juego del Axedrez", "Ruy López de Segura", 1561,
       "creator:(ruy lopez) AND (axedrez OR ajedrez)",
       "title:(invencion liberal y arte del juego del axedrez)"),
    bk("Il Puttino", "Alessandro Salvio", 1604,
       "title:(puttino)",
       "creator:(salvio) AND (scacchi OR chess)"),
    bk("The Royall Game of Chesse-Playe", "Gioachino Greco", 1656,
       "identifier:(TheRoyallGameOfChessePlay)",
       "title:(royall game of chesse)"),
    bk("Osservazioni Teorico-Pratiche sopra il Giuoco degli Scacchi", "Giambattista Lolli", 1763,
       "title:(osservazioni teorico pratiche sopra il giuoco)",
       "creator:(lolli) AND (scacchi)"),
    bk("Il Giuoco Incomparabile degli Scacchi", "Domenico Lorenzo Ponziani", 1769,
       "creator:(ponziani)",
       "title:(giuoco incomparabile degli scacchi)"),
    bk("Il Giuoco degli Scacchi", "Carlo Cozio", 1766,
       "creator:(cozio) AND (scacchi OR chess)"),
    bk("Il Gioco degli Scacchi", "Pietro Carrera", 1617,
       "identifier:(bub_gb_-fRYAAAAYAAJ)",
       "creator:(carrera) AND (scacchi OR chess)"),
    bk("The History of Chess", "Robert Lambe", 1764,
       "title:(history of chess) AND creator:(lambe)"),
    bk("A Treatise on the Game of Chess", "William Lewis", 1817,
       "creator:(lewis) AND title:(treatise on the game of chess)"),
    bk("Elements of the Game of Chess", "William Lewis", 1822,
       "title:(elements of the game of chess)"),
    bk("Analyse Nouvelle des Ouvertures du Jeu des Échecs", "Carl Friedrich Jaenisch", 1842,
       "creator:(jaenisch)",
       "title:(analyse nouvelle des ouvertures)"),
    bk("Encyclopédie des Échecs", "Aaron Alexandre", 1837,
       "title:(encyclopedie des echecs)",
       "creator:(alexandre) AND (echecs OR chess)"),
    bk("Lehrbuch des Schachspiels", "Max Lange", 1856,
       "title:(lehrbuch des schachspiels) AND creator:(lange)"),
    bk("Schachmeister Steinitz", "Ludwig Bachmann", 1910,
       "title:(schachmeister steinitz)"),
    bk("Adolf Anderssen, der Altmeister deutscher Schachspielkunst", "Hermann von Gottschall", 1912,
       "title:(adolf anderssen) AND creator:(gottschall)",
       "title:(adolf anderssen) AND (schach)"),
    bk("Morphy's Games of Chess", "Philip W. Sergeant", 1916,
       "identifier:(MorphysGamesOfChessPhilipSergeant)",
       "title:(morphy games of chess) AND creator:(sergeant)"),
    bk("Charousek's Games of Chess", "Philip W. Sergeant", 1923,
       "title:(charousek)"),
    bk("The Middle Game in Chess", "Eugene Znosko-Borovsky", 1922,
       "title:(middle game in chess)"),
    bk("Das Schachspiel", "Siegbert Tarrasch", 1925,
       "title:(schachspiel) AND creator:(tarrasch)"),
    # --- tournament books ---
    bk("The Chess Congress of 1862 (London)", "J. J. Löwenthal & G. W. Medley", 1864,
       "title:(chess congress of 1862)",
       "title:(london 1862) AND (chess)"),
    bk("Le Tournoi International d'Échecs de Paris 1867", "collective", 1868,
       "title:(tournoi) AND (1867) AND (echecs)"),
    bk("The Book of the Sixth American Chess Congress (New York 1889)", "Wilhelm Steinitz", 1891,
       "title:(sixth american chess congress)",
       "title:(new york 1889) AND (chess)"),
    bk("The Hastings Chess Tournament 1895", "Horace F. Cheshire (ed.)", 1896,
       "title:(hastings) AND (chess) AND year:[1895 TO 1898]"),
    bk("Das Internationale Schachturnier Nürnberg 1896", "Siegbert Tarrasch", 1897,
       "title:(nurnberg) AND (schach)",
       "title:(nuremberg) AND (chess)"),
    bk("Das Internationale Kaiser-Jubiläums-Schachturnier Wien 1898, Band 1", "Ludwig Halprin & Georg Marco", 1898,
       "identifier:(internationales00halpgoog)",
       "title:(wien 1898) AND (schach)"),
    bk("Das Internationale Kaiser-Jubiläums-Schachturnier Wien 1898, Band 2", "Ludwig Halprin & Georg Marco", 1899,
       "identifier:(internationales01halpgoog)"),
    bk("Le Tournoi d'Échecs de Paris 1900", "Samuel Rosenthal", 1901,
       "title:(paris 1900) AND (echecs OR chess OR schach)"),
    bk("The Cambridge Springs International Chess Congress 1904", "collective", 1906,
       "title:(cambridge springs) AND (chess)"),
    bk("Das Schachturnier Ostende 1906", "collective", 1907,
       "title:(ostende) AND (schach OR chess OR echecs)"),
    bk("Internationales Schachturnier Karlsbad 1907", "Marco & Schlechter", 1908,
       "title:(karlsbad) AND (schach)",
       "title:(carlsbad) AND (chess)"),
    bk("Das Grossmeisterturnier St. Petersburg 1914", "Siegbert Tarrasch", 1914,
       "title:(petersburg 1914) AND (schach OR chess)",
       "title:(grossmeisterturnier)"),
    bk("London International Chess Tournament 1922", "Géza Maróczy", 1923,
       "title:(london 1922) AND (chess)"),
    bk("The Book of the New York International Chess Tournament 1924", "Alexander Alekhine", 1925,
       "title:(new york 1924) AND (chess)"),
    bk("Das Grossmeisterturnier Baden-Baden 1925", "Siegbert Tarrasch", 1925,
       "title:(baden baden) AND (schach)"),
    bk("Moskau 1925 - Internationales Schachturnier", "Efim Bogoljubow", 1926,
       "title:(moskau 1925) AND (schach)",
       "title:(moscow 1925) AND (chess)"),
    bk("The Book of the Kecskemét International Chess Tournament 1927", "Alexander Alekhine", 1928,
       "title:(kecskemet) AND (chess OR schach)"),
]

# Gutenberg fallbacks: (id, author, title, year) — used only if IA resolve failed
GUTENBERG = [
    (33870, "José Raúl Capablanca", "Chess Fundamentals", 1921),
    (5614, "Edward Lasker", "Chess Strategy", 1915),
    (16377, "Howard Staunton (ed.)", "The Blue Book of Chess", 1918),
    (4913, "Edward Lasker", "Chess and Checkers: the Way to Mastership", 1918),
    (34180, "Frederick Milnes Edge", "The Exploits and Triumphs in Europe of Paul Morphy", 1859),
    (10672, "William Caxton", "Game and Playe of the Chesse", 1474),
    (55278, "Franklin Knowles Young", "Chess Generalship, Vol. I", 1910),
    (4902, "Henry Edward Bird", "Chess History and Reminiscences", 1893),
]

PERIODICALS = [
    ("Deutsche Schachzeitung", ["title:(deutsche schachzeitung)"], 10, (), False),
    ("Schachzeitung (Berlin)", ["identifier:(bub_gb_I61AAAAAcAAJ)",
                                "identifier:(bub_gb_x61AAAAAcAAJ)",
                                "identifier:(bub_gb_QnE9AAAAYAAJ)"], 3, (), False),
    ("British Chess Magazine", ["title:(british chess magazine)"], 13, (), False),
    ("The Chess-Player's Chronicle", ["title:(chess players chronicle)",
                                      "identifier:(chessplayerschr*)"], 13, (), True),
    ("The Chess Monthly (London)", ["title:(chess monthly) AND year:[1878 TO 1897]"],
     6, ("westminsterpape", "brentanoschessmo"), False),
    ("The Chess Monthly (New York)", ["title:(chess monthly) AND year:[1856 TO 1862]"],
     5, ("westminsterpape", "brentanoschessmo"), False),
    ("American Chess Bulletin", ["title:(american chess bulletin)"], 10, (), False),
    ("The Chess World", ["title:(chess world) AND year:[1864 TO 1870]"], 4, (), False),
    ("Wiener Schachzeitung", ["title:(wiener schachzeitung)"], 8, (), False),
    ("La Stratégie", ["title:(la strategie journal d echecs)",
                      "title:(strategie) AND (echecs) AND year:[1867 TO 1930]"], 8, (), False),
    ("Lasker's Chess Magazine", ["title:(laskers chess magazine)",
                                 "title:(lasker chess magazine)"], 5, (), False),
    ("The Westminster Chess Club Papers", ["title:(westminster papers) AND (chess)"], 6, (), False),
    ("The Chess Amateur", ["title:(chess amateur) AND year:[1905 TO 1930]"], 6, (), False),
    ("Brentano's Chess Monthly", ["title:(brentanos chess monthly)",
                                  'title:("chess monthly")'], 3, ("westminsterpape",), False),
]
PERIODICAL_CAP = 48


def resolve_periodicals():
    prov = {}
    prov_path = os.path.join(ROOT, "_provenance.json")
    if os.path.exists(prov_path):
        with open(prov_path, encoding="utf-8") as fh:
            prov = json.load(fh)
    plan = []
    total_vols = 0
    assigned_counts = {}

    def assign(name, yr):
        base = sanitize(f"{name} - {yr}.pdf")
        n = assigned_counts.get(base, 0) + 1
        assigned_counts[base] = n
        return base if n == 1 else f"{base[:-4]} ({n}).pdf"

    for name, queries, max_vols, exclude, allow_dup_year in PERIODICALS:
        if total_vols >= PERIODICAL_CAP:
            break
        docs = []
        seen_idents = set()
        for q in queries:
            for d in search(q + " AND mediatype:texts", rows=40):
                if d.get("identifier") not in seen_idents:
                    seen_idents.add(d.get("identifier"))
                    docs.append(d)
        vols = []
        seen_keys = set()
        for d in docs:
            ident = d.get("identifier")
            if not ident or ident in USED_IDS or ident.startswith(ID_BLOCKLIST):
                continue
            if any(x in ident for x in exclude):
                continue
            yr = first_int(d.get("year"))
            if not yr:
                m = re.search(r"(1[789]\d{2})", d.get("title") or "")
                yr = int(m.group(1)) if m else None
            if not yr or yr < 1800 or yr > YEAR_MAX:
                continue
            if allow_dup_year:
                # metadata years are unreliable; treat each physical scan
                # (identifier volume number) as a distinct volume
                num = re.search(r"(\d{2,})", ident)
                key = (yr, num.group(1) if num else ident)
            else:
                key = yr
            if key in seen_keys:
                continue
            seen_keys.add(key)
            vols.append((yr, ident))
        vols.sort()
        got = 0
        for yr, ident in vols:
            if got >= max_vols or total_vols >= PERIODICAL_CAP:
                break
            fname = assign(name, yr)
            pid = prov.get(fname)
            if pid and os.path.exists(os.path.join(PER_DIR, fname)):
                ident = pid  # pin to the identifier of the file already on disk
            md = get_meta(ident)
            if not md or is_restricted(md):
                continue
            pdf = pick_pdf(md.get("files"))
            if not pdf:
                continue
            USED_IDS.add(ident)
            plan.append({
                "category": "periodical", "name": f"{name} — {yr}",
                "author": name, "year": yr,
                "filename": fname,
                "candidates": [(ident, pdf[0], pdf[1], yr)],
            })
            got += 1
            total_vols += 1
            log(f"  periodical: {name} {yr} -> {ident}")
        if got == 0:
            plan.append({"category": "periodical", "name": name, "author": name,
                         "year": None, "filename": None, "candidates": [],
                         "failed": "no unrestricted volumes found on archive.org"})
    return plan


def resolve_books():
    prov = {}
    prov_path = os.path.join(ROOT, "_provenance.json")
    if os.path.exists(prov_path):
        with open(prov_path, encoding="utf-8") as fh:
            prov = json.load(fh)
    plan = []
    for spec in BOOK_SPECS:
        fname = sanitize(f"{spec['author']} - {spec['name']} ({spec['year']}).pdf")
        queries = list(spec["queries"])
        # pin to the identifier of the file already on disk, if any
        if fname in prov and os.path.exists(os.path.join(ROOT, fname)):
            queries.insert(0, f"identifier:({prov[fname]})")
        alts = resolve_item(queries, spec["name"])
        if alts:
            log(f"  book: {spec['name']} -> {alts[0][0]}")
            plan.append({"category": "book", "name": spec["name"],
                         "author": spec["author"], "year": spec["year"],
                         "filename": fname, "candidates": alts})
        else:
            log(f"  MISS: {spec['name']} ({spec['author']})")
            plan.append({"category": "book", "name": spec["name"],
                         "author": spec["author"], "year": spec["year"],
                         "filename": fname, "candidates": [],
                         "failed": "no unrestricted scan found on archive.org"})
    return plan


def resolve_gutenberg(plan):
    """For book specs that failed on IA, try the Gutenberg list."""
    norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
    last = lambda s: (re.sub(r"[^a-z0-9]", "", s.split()[-1].lower())
                      if s.split() else "")
    for entry in plan:
        if entry["category"] != "book" or entry.get("candidates"):
            continue
        for gid, gauthor, gtitle, gyear in GUTENBERG:
            if norm(entry["name"]) == norm(gtitle) or (
                    "exploitsandtriumphs" in norm(entry["name"])
                    and "exploitsandtriumphs" in norm(gtitle)):
                if last(gauthor) not in norm(entry["author"] or ""):
                    continue  # same title, different author (e.g. Loyd vs Lasker)
                entry["gutenberg"] = gid
                entry.pop("failed", None)
    # Gutenberg titles not represented in book specs at all -> add directly
    covered = {norm(e.get("name") or "") for e in plan}
    for gid, gauthor, gtitle, gyear in GUTENBERG:
        n = norm(gtitle)
        dup = n in covered or any(
            len(c) > 10 and (c in n or n in c) for c in covered)
        if not dup:
            plan.append({"category": "book", "name": gtitle, "author": gauthor,
                         "year": gyear, "filename": None, "candidates": [],
                         "gutenberg": gid})
    return plan


# ----------------------------------------------------------------------------
# Downloads
# ----------------------------------------------------------------------------

def valid_file(path):
    try:
        if os.path.getsize(path) < MIN_SIZE:
            return False
        with open(path, "rb") as fh:
            head = fh.read(5)
        return head.startswith(b"%PDF-") or head[:2] == b"PK"
    except OSError:
        return False


def download_ia(dest, candidates):
    for ident, fname, _size, _yr in candidates:
        url = f"{IA}/download/{ident}/{quote(fname)}"
        r = ia_get(url, stream=True)
        if r is None or r.status_code != 200:
            log(f"  {ident}: HTTP {r.status_code if r else 'fail'} for {fname}")
            continue
        tmp = dest + ".part"
        ok = True
        try:
            with open(tmp, "wb") as fh:
                for chunk in r.iter_content(1 << 20):
                    fh.write(chunk)
        except requests.RequestException as e:
            log(f"  download interrupted for {ident}: {e}; one retry")
            try:
                r = ia_get(url, stream=True)
                if r and r.status_code == 200:
                    with open(tmp, "wb") as fh:
                        for chunk in r.iter_content(1 << 20):
                            fh.write(chunk)
                else:
                    ok = False
            except requests.RequestException:
                ok = False
        finally:
            r.close() if r else None
        if not ok:
            if os.path.exists(tmp):
                os.remove(tmp)
            continue
        os.replace(tmp, dest)
        if valid_file(dest):
            return {"identifier": ident, "file": fname, "url": url}
        log(f"  invalid file from {ident} (bad header/size); removed")
        os.remove(dest)
    return None


def download_gutenberg(dest_base, gid):
    r = None
    for attempt in range(3):
        try:
            r = S.get(f"https://gutendex.com/books/{gid}", timeout=30)
            break
        except requests.RequestException:
            time.sleep(3 * (attempt + 1))
    if r is None or r.status_code != 200:
        return None, "gutendex lookup failed"
    try:
        formats = r.json().get("formats", {})
    except Exception:
        return None, "gutendex bad json"
    url = None
    ext = ".pdf"
    for k, v in formats.items():
        if "pdf" in k:
            url, ext = v, ".pdf"
            break
    if not url:
        for k, v in formats.items():
            if "epub" in k:
                url, ext = v, ".epub"
                break
    if not url:
        return None, "no pdf/epub format on Gutenberg"
    dest = os.path.splitext(dest_base)[0] + ext
    for attempt in range(2):
        try:
            with S.get(url, stream=True, timeout=(30, 120)) as resp:
                if resp.status_code != 200:
                    return None, f"Gutenberg HTTP {resp.status_code}"
                tmp = dest + ".part"
                with open(tmp, "wb") as fh:
                    for chunk in resp.iter_content(1 << 20):
                        fh.write(chunk)
            os.replace(tmp, dest)
            if valid_file(dest):
                return {"identifier": f"gutenberg:{gid}", "file": os.path.basename(url),
                        "url": url, "path": dest}, None
            os.remove(dest)
            return None, "Gutenberg file failed validation"
        except requests.RequestException as e:
            log(f"  gutenberg net error {e}; retrying")
            time.sleep(3)
    return None, "Gutenberg download failed"


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def main():
    os.makedirs(PER_DIR, exist_ok=True)
    os.makedirs(GUT_DIR, exist_ok=True)
    replan = "--replan" in sys.argv

    if os.path.exists(PLAN_PATH) and not replan:
        log("loading cached plan")
        with open(PLAN_PATH, encoding="utf-8") as fh:
            plan = json.load(fh)
        for e in plan:
            for c in e.get("candidates", []):
                USED_IDS.add(c[0])
    else:
        log("=== resolving books ===")
        plan = resolve_books()
        log("=== resolving periodicals ===")
        plan += resolve_periodicals()
        plan = resolve_gutenberg(plan)
        with open(PLAN_PATH, "w", encoding="utf-8") as fh:
            json.dump(plan, fh, ensure_ascii=False, indent=1)
        log(f"plan cached: {len(plan)} entries")

    manifest = []
    failures = []
    total = len(plan)
    used_names = set()
    for i, entry in enumerate(plan, 1):
        cat = entry["category"]
        subdir = PER_DIR if cat == "periodical" else (
            GUT_DIR if entry.get("gutenberg") else ROOT)
        fname = entry.get("filename") or sanitize(
            f"{entry['author']} - {entry['name']} ({entry.get('year') or 'n.d.'}).pdf")
        dest = os.path.join(subdir, fname)
        base, ext = os.path.splitext(dest)
        n = 2
        while os.path.abspath(dest).lower() in used_names:
            dest = f"{base} ({n}){ext}"
            n += 1
        used_names.add(os.path.abspath(dest).lower())

        existing = dest if os.path.exists(dest) else None
        if not existing and entry.get("gutenberg"):
            alt = os.path.splitext(dest)[0] + ".epub"
            if os.path.exists(alt):
                existing = alt
        if existing and valid_file(existing):
            log(f"[{i}/{total}] skip (exists): {os.path.basename(existing)}")
            manifest.append({**{k: entry.get(k) for k in
                                ("category", "name", "author", "year")},
                             "filename": os.path.relpath(existing, ROOT),
                             "size": os.path.getsize(existing),
                             "identifier": (entry.get("candidates") or [[None]])[0][0]
                             or entry.get("gutenberg"),
                             "source": "archive.org" if entry.get("candidates")
                             else "gutenberg"})
            continue

        log(f"[{i}/{total}] downloading: {entry['name']}")
        result = None
        if entry.get("candidates"):
            result = download_ia(dest, entry["candidates"])
            source = "archive.org"
        elif entry.get("gutenberg"):
            result, gerr = download_gutenberg(dest, entry["gutenberg"])
            if result:
                dest = result["path"]
            else:
                entry["failed"] = gerr
            source = "gutenberg"
        else:
            failures.append({**{k: entry.get(k) for k in
                                ("category", "name", "author", "year")},
                             "reason": entry.get("failed", "no source found")})
            continue

        if result:
            # actual saved file may have .epub extension for gutenberg
            actual = dest
            if not os.path.exists(actual):
                base = os.path.splitext(dest)[0]
                for ext in (".pdf", ".epub"):
                    if os.path.exists(base + ext):
                        actual = base + ext
                        break
            manifest.append({**{k: entry.get(k) for k in
                                ("category", "name", "author", "year")},
                             "filename": os.path.relpath(actual, ROOT),
                             "size": os.path.getsize(actual),
                             "identifier": result["identifier"],
                             "source": source,
                             "url": result["url"]})
            log(f"  OK ({os.path.getsize(actual) // 1024} KB): {os.path.basename(actual)}")
        else:
            failures.append({**{k: entry.get(k) for k in
                                ("category", "name", "author", "year")},
                             "reason": entry.get("failed", "download failed / restricted")})
            log(f"  FAILED: {entry['name']}")

    with open(MANIFEST_PATH, "w", encoding="utf-8") as fh:
        json.dump({"ok": manifest, "failed": failures}, fh,
                  ensure_ascii=False, indent=1)
    write_index(manifest, failures)
    log(f"done: {len(manifest)} files ok, {len(failures)} failed")


def write_index(manifest, failures):
    def fmt(e):
        yr = e.get("year") or "n.d."
        src = e.get("url") or (
            f"https://archive.org/details/{e['identifier']}"
            if e.get("identifier") and not str(e["identifier"]).startswith("gutenberg")
            else f"https://www.gutenberg.org/ebooks/{str(e.get('identifier','')).split(':')[-1]}")
        mb = e["size"] / 1e6
        return (f"- **{e['name']}** — {e.get('author') or '?'} ({yr}) — "
                f"`{e['filename'].replace(os.sep, '/')}` ({mb:.1f} MB) — [source]({src})")

    lines = ["# Public-Domain Chess Library", "",
             "Curated collection of pre-1931 chess books and periodicals, "
             "downloaded from the Internet Archive and Project Gutenberg.",
             f"Files: **{len(manifest)}** "
             f"({sum(m['size'] for m in manifest) / 1e9:.2f} GB total).", ""]

    for cat, label in (("book", "Books"), ("periodical", "Periodicals"),
                       ("gutenberg", "Project Gutenberg")):
        if cat == "book":
            items = [m for m in manifest if m["category"] == "book"
                     and m.get("source") != "gutenberg"]
        elif cat == "periodical":
            items = [m for m in manifest if m["category"] == "periodical"]
        else:
            items = [m for m in manifest if m.get("source") == "gutenberg"]
        if not items:
            continue
        lines.append(f"## {label} ({len(items)})")
        lines.append("")
        if cat == "periodical":
            lines.append("Note: for several 19th-century scans the archive "
                         "metadata year is unreliable (e.g. many distinct "
                         "Chess-Player's Chronicle volumes are all catalogued "
                         "as 1841); suffixes like `(2)` distinguish the "
                         "physical volumes.")
            lines.append("")
        for e in sorted(items, key=lambda x: (x.get("year") or 9999, x["name"])):
            lines.append(fmt(e))
        lines.append("")

    lines.append(f"## Failed / not found ({len(failures)})")
    lines.append("")
    for e in sorted(failures, key=lambda x: (x.get("year") or 9999, x["name"] or "")):
        yr = e.get("year") or "n.d."
        lines.append(f"- **{e['name']}** — {e.get('author') or '?'} ({yr}) — {e['reason']}")
    lines.append("")
    lines.append("See `manifest.json` for the full machine-readable catalogue.")
    with open(INDEX_PATH, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    log("INDEX.md written")


if __name__ == "__main__":
    main()
