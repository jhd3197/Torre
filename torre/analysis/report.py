"""Generate a mistakes report from data/analysis.jsonl -> data/report.md

Usage: .venv/Scripts/python report.py
"""

from torre import jsonio
from collections import defaultdict
from pathlib import Path

ANALYSIS_FILE = Path("data/analysis.jsonl")
REPORT_FILE = Path("data/report.md")

GAME_URL = {
    "computer": "https://www.chess.com/game/computer/",
    "live": "https://www.chess.com/game/live/",
    "daily": "https://www.chess.com/game/daily/",
}


def load(analysis_file=None):
    return jsonio.read_records(Path(analysis_file) if analysis_file is not None else ANALYSIS_FILE)


def month_of(rec):
    d = rec.get("date") or ""
    # PGN date "2026.09.05" or history "9/5/2026"
    if "." in d:
        parts = d.split(".")
        return f"{parts[0]}-{parts[1]}" if len(parts) >= 2 else "unknown"
    if "/" in d:
        parts = d.split("/")
        return f"{parts[2]}-{int(parts[0]):02d}" if len(parts) == 3 else "unknown"
    return "unknown"


def main(analysis_file=None, report_file=None):
    recs = load(analysis_file)
    if not recs:
        print("no analysis yet")
        return
    n = len(recs)
    wins = sum(1 for r in recs if r["user_result"] == 1)
    draws = sum(1 for r in recs if r["user_result"] == 0.5)
    losses = n - wins - draws

    tot_moves = sum(r["user_move_count"] for r in recs)
    tot_bl = sum(r["blunder"] for r in recs)
    tot_mi = sum(r["mistake"] for r in recs)
    tot_in = sum(r["inaccuracy"] for r in recs)
    avg_cpl = sum(r["avg_cpl"] * r["user_move_count"] for r in recs) / max(1, tot_moves)
    accs = [r["user_accuracy"] for r in recs if r.get("user_accuracy") is not None]

    L = []
    L.append("# Chess mistake report\n")
    L.append(f"Analyzed **{n}** games ({wins}W / {draws}D / {losses}L), "
             f"{tot_moves} of your moves checked with Stockfish.\n")
    if accs:
        L.append(f"- chess.com Game Review accuracy (avg): **{sum(accs)/len(accs):.1f}**")
    L.append(f"- Average centipawn loss per move (ACPL): **{avg_cpl:.1f}**")
    L.append(f"- Blunders: **{tot_bl}** ({tot_bl/n:.2f}/game)  |  "
             f"Mistakes: **{tot_mi}** ({tot_mi/n:.2f}/game)  |  "
             f"Inaccuracies: **{tot_in}** ({tot_in/n:.2f}/game)\n")

    # --- by game phase ---
    L.append("## Mistakes by game phase\n")
    L.append("| phase | your moves | avg cpl | mistakes | blunders | blunders/100 moves |")
    L.append("|---|---|---|---|---|---|")
    for ph in ("opening", "middlegame", "endgame"):
        mv = sum(r["phase_counts"][ph]["moves"] for r in recs)
        cpl = sum(r["phase_counts"][ph]["cpl"] for r in recs)
        mi = sum(r["phase_counts"][ph]["mistakes"] for r in recs)
        bl = sum(r["phase_counts"][ph]["blunders"] for r in recs)
        if mv:
            L.append(f"| {ph} | {mv} | {cpl/mv:.1f} | {mi} | {bl} | {100*bl/mv:.1f} |")
    L.append("")

    # --- by opponent ---
    L.append("## By opponent\n")
    L.append("| opponent | games | W-D-L | avg cpl | blunders/game | avg accuracy |")
    L.append("|---|---|---|---|---|---|")
    by_opp = defaultdict(list)
    for r in recs:
        by_opp[r["opponent"]].append(r)
    for opp, rs in sorted(by_opp.items(), key=lambda kv: -len(kv[1])):
        g = len(rs)
        w = sum(1 for r in rs if r["user_result"] == 1)
        d = sum(1 for r in rs if r["user_result"] == 0.5)
        l = g - w - d
        acpl = sum(r["avg_cpl"] * r["user_move_count"] for r in rs) / max(1, sum(r["user_move_count"] for r in rs))
        bl = sum(r["blunder"] for r in rs) / g
        a = [r["user_accuracy"] for r in rs if r.get("user_accuracy") is not None]
        L.append(f"| {opp} | {g} | {w}-{d}-{l} | {acpl:.1f} | {bl:.2f} | "
                 f"{f'{sum(a)/len(a):.1f}' if a else '-'} |")
    L.append("")

    # --- by color ---
    L.append("## By color\n")
    for color in ("white", "black"):
        rs = [r for r in recs if r["user_color"] == color]
        if not rs:
            continue
        g = len(rs)
        w = sum(1 for r in rs if r["user_result"] == 1)
        bl = sum(r["blunder"] for r in rs) / g
        acpl = sum(r["avg_cpl"] * r["user_move_count"] for r in rs) / max(1, sum(r["user_move_count"] for r in rs))
        L.append(f"- **{color}**: {g} games, {100*w/g:.0f}% wins, ACPL {acpl:.1f}, {bl:.2f} blunders/game")
    L.append("")

    # --- trend by month ---
    L.append("## Trend by month\n")
    L.append("| month | games | avg cpl | blunders/game | avg accuracy |")
    L.append("|---|---|---|---|---|")
    by_month = defaultdict(list)
    for r in recs:
        by_month[month_of(r)].append(r)
    for m in sorted(by_month):
        rs = by_month[m]
        g = len(rs)
        acpl = sum(r["avg_cpl"] * r["user_move_count"] for r in rs) / max(1, sum(r["user_move_count"] for r in rs))
        bl = sum(r["blunder"] for r in rs) / g
        a = [r["user_accuracy"] for r in rs if r.get("user_accuracy") is not None]
        L.append(f"| {m} | {g} | {acpl:.1f} | {bl:.2f} | {f'{sum(a)/len(a):.1f}' if a else '-'} |")
    L.append("")

    # --- worst blunders ---
    L.append("## Your 15 biggest blunders\n")
    L.append("| date | opponent | move | played | eval swing | game |")
    L.append("|---|---|---|---|---|---|")
    worst = []
    for r in recs:
        for m in r["worst_moves"]:
            worst.append((m["cpl"], r, m))
    worst.sort(key=lambda x: -x[0])
    for cpl, r, m in worst[:15]:
        url = r.get('url') or (GAME_URL[r['type']] + r['id'] if r['type'] in GAME_URL else None)
        replay = f'[replay]({url})' if url else '-'
        swing = f"{m['eval_before']:+d} -> {m['eval_before']-cpl:+d}"
        L.append(f"| {r['date']} | {r['opponent']} | {m['move_number']}. | {m['san']} "
                 f"| {swing} cp | {replay} |")
    L.append("")
    L.append("Eval swing is from your perspective before the move (positive = you were better).")

    path = Path(report_file) if report_file is not None else REPORT_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(L), encoding="utf-8")
    print(f"wrote {path}")
    print("\n".join(L[:40]))


if __name__ == "__main__":
    main()
