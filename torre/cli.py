"""Torre's command-line interface. Run `python -m torre --help`."""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys

import torre
from torre import paths

ROOT = paths.REPO


def positive(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError('must be at least 1')
    return number


def nonnegative(value):
    number = int(value)
    if number < 0:
        raise argparse.ArgumentTypeError('must be at least 0')
    return number


def port_number(value):
    number = positive(value)
    if number > 65535:
        raise argparse.ArgumentTypeError('must be between 1 and 65535')
    return number


def parser():
    common = argparse.ArgumentParser(add_help=False)
    # Suppressed defaults allow this option before OR after the subcommand.
    common.add_argument('--data-dir', default=argparse.SUPPRESS, type=Path,
                        help='shared data folder (default: CHESS_STUDIO_DATA or project data/)')
    top = argparse.ArgumentParser(prog='torre', parents=[common],
                                  description='Import, analyze and review your chess with Torre.')
    top.add_argument('--version', action='version', version=f'torre {torre.__version__}')
    commands = top.add_subparsers(dest='command', required=True)

    serve = commands.add_parser('serve', parents=[common], help='start the local web app')
    serve.add_argument('--host', default=argparse.SUPPRESS,
                       help='address to listen on (default: TORRE_HOST or 127.0.0.1)')
    serve.add_argument('--port', type=port_number, default=1886)
    serve.add_argument('--open-browser', action='store_true')
    serve.add_argument('--proxied', action='store_true', help='serve behind a same-origin proxy such as Vela')
    serve.add_argument('--allow-host', action='append', default=[], metavar='NAME',
                       help="also answer requests for this host name (a proxy's domain)")
    serve.add_argument('--until-stdin-closes', action='store_true',
                       help='stop when standard input closes (how the desktop app says it quit)')
    serve.set_defaults(handler=run_serve)

    imp = commands.add_parser('import', parents=[common], help='import a PGN file')
    imp.add_argument('file', type=Path)
    imp.add_argument('--username', action='append', default=[],
                     help='your player name; repeat for aliases (default: saved accounts/aliases)')
    imp.add_argument('--dry-run', action='store_true', help='show import counts without saving')
    imp.set_defaults(handler=run_import)

    analysis = commands.add_parser('analyze', parents=[common], help='analyze pending games with Stockfish')
    analysis.add_argument('--depth', type=positive, default=12)
    analysis.add_argument('--limit', type=nonnegative, default=0, help='maximum games; 0 means all')
    analysis.add_argument('--threads', type=positive, default=8)
    analysis.add_argument('--no-mine', action='store_true', help='skip mining puzzles from your games')
    analysis.set_defaults(handler=run_analyze)

    report = commands.add_parser('report', parents=[common], help='write a Markdown mistakes report')
    report.add_argument('--output', type=Path, help='output path (default: data folder/report.md)')
    report.set_defaults(handler=run_report)

    coach = commands.add_parser('coach', parents=[common], help='print your coaching brief as JSON')
    coach.add_argument('--ask', action='store_true', help='ask the configured AI model and cache its advice')
    coach.add_argument('--lang', choices=('en', 'es'), default='en')
    coach.add_argument('--model', help='Prompture model override; requires --ask')
    coach.add_argument('--force', action='store_true', help='refresh cached advice; requires --ask')
    coach.set_defaults(handler=run_coach)

    narrate = commands.add_parser('narrate', parents=[common], help="record the coach's voice packs with a local Kokoro server",
                                  description="Record the coach's voice packs with Kokoro, loudness-normalized with ffmpeg, "
                                              'into dist/voice (run from a source checkout).')
    narrate.add_argument('--lang', default='en', choices=('en', 'es'))
    narrate.add_argument('--gender', default='female', choices=('female', 'male'), help='the female or the male coach voice')
    narrate.add_argument('--voice', help='Kokoro voice (default: the coach voice for the language and gender)')
    narrate.add_argument('--base-url', help='Kokoro API (default: KOKORO_URL or http://127.0.0.1:8880/v1)')
    narrate.add_argument('--force', action='store_true', help='re-record lines that already exist')
    narrate.add_argument('--list', action='store_true', help='print the lines and exit')
    narrate.add_argument('--workers', type=positive, default=4)
    narrate.set_defaults(handler=run_narrate)

    doctor = commands.add_parser('doctor', parents=[common], help='check dependencies, engine and data paths')
    doctor.add_argument('--json', action='store_true', help='output machine-readable diagnostics')
    doctor.set_defaults(handler=run_doctor)
    return top


def run_serve(args):
    if not (paths.UI / 'index.html').is_file():
        raise ValueError('The web interface has not been built. Run .\\dev.ps1 build first '
                         '(or npm --prefix web run build).')
    from torre.server import studio
    argv = ['--data-dir', str(args.data_dir), '--port', str(args.port)]
    if 'host' in args:
        argv += ['--host', args.host]
    if args.open_browser:
        argv.append('--open-browser')
    if args.proxied:
        argv.append('--proxied')
    for name in args.allow_host:
        argv += ['--allow-host', name]
    if args.until_stdin_closes:
        argv.append('--until-stdin-closes')
    studio.main(argv)
    return 0


def run_import(args):
    from torre.games import importer
    settings_file = args.data_dir / 'settings.json'
    settings = json.loads(settings_file.read_text(encoding='utf-8')) if settings_file.exists() else {}
    if not isinstance(settings, dict):
        raise ValueError(f'Expected a JSON object in {settings_file}')
    accounts = settings.get('accounts') or {}
    if not isinstance(accounts, dict) or not isinstance(settings.get('aliases', []), list):
        raise ValueError(f'Invalid accounts or aliases in {settings_file}')
    names = args.username or [*accounts.values(), *(settings.get('aliases') or [])]
    names = {n.strip().lower() for n in names if isinstance(n, str) and n.strip()}
    if not names:
        raise ValueError('Specify --username with your player name, or save your accounts in Torre settings.')
    records, failed = importer.read_file(args.file.name, args.file.read_text(encoding='utf-8-sig'), names)
    games_file = args.data_dir / 'games.jsonl'
    if args.dry_run:
        have = importer.existing_ids(games_file)
        fresh = {r['id'] for r in records} - have
        added, duplicates = len(fresh), len(records) - len(fresh)
    else:
        added, duplicates = importer.append(records, games_file)
    verb = 'Would import' if args.dry_run else 'Imported'
    print(f'{verb} {added} games; {duplicates} duplicates; {len(failed)} failed -> {games_file}')
    for failure in failed:
        print(f"{failure['where']}: {failure['error']}", file=sys.stderr)
    if not records and not failed:
        raise ValueError('No games found in the file.')
    return 1 if failed else 0


def run_analyze(args):
    from torre.analysis import analyze
    games_file, analysis_file = args.data_dir / 'games.jsonl', args.data_dir / 'analysis.jsonl'
    if not games_file.exists():
        print('No games yet. Use torre import first.')
        return 0
    games, done, outdated = analyze.pending(games_file, analysis_file)
    if args.limit:
        games = games[:args.limit]
    print(f'{done} analyzed already, {outdated} outdated, {len(games)} to analyze (depth {args.depth})')
    if not games and (args.no_mine or not analysis_file.exists()):
        return 0
    engine_path = analyze.engines.resolve_engine('stockfish')
    if games and not engine_path.is_file():
        raise ValueError('Stockfish was not found. Set STOCKFISH_PATH or run torre doctor for details.')
    failures = []

    def progress(index, record, result, error):
        if error:
            failures.append(record['id'])
            print(f"[{index}/{len(games)}] game {record['id']} FAILED: {error}", file=sys.stderr)
        else:
            print(f"[{index}/{len(games)}] {record.get('date')} vs {record['opponent']}: "
                  f"accuracy={result['accuracy']} blunders={result['blunder']}", flush=True)

    def mining_progress(index, total, record, new, error):
        if error:
            failures.append(record['id'])
            print(f"Puzzle mining for game {record['id']} FAILED: {error}", file=sys.stderr)

    try:
        pack, mined = analyze.analyze_archive(games, engine_path, games_file, analysis_file, args.data_dir / 'my-puzzles.json',
                                              depth=args.depth, threads=args.threads, mine=not args.no_mine,
                                              progress=progress, mine_progress=mining_progress)
    except analyze.chess.engine.EngineError as exc:
        raise RuntimeError(f'Stockfish could not complete the analysis: {exc}') from exc
    if games:
        print(f'Analysis saved -> {analysis_file}')
    if pack is not None:
        print(f"Mined {mined} games; {len(pack['puzzles'])} puzzles in your data folder")
    return 1 if failures else 0


def run_report(args):
    from torre.analysis import report
    report.main(args.data_dir / 'analysis.jsonl', args.output or args.data_dir / 'report.md')
    return 0


def run_narrate(args):
    from torre.voice import narrate
    return narrate.run(args.lang, args.gender, args.voice, args.base_url, args.force, args.list, args.workers)


def run_coach(args):
    if (args.model or args.force) and not args.ask:
        raise ValueError('--model and --force require --ask.')
    from torre.ai import runtime
    from torre.coaching import coach
    runtime.use_data_dir(args.data_dir)
    result = (coach.generate(args.data_dir, args.lang, args.model, force=args.force)
              if args.ask else coach.brief(args.data_dir))
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


def run_doctor(args):
    checks = []

    def add(name, status, detail):
        checks.append({'name': name, 'status': status, 'detail': str(detail)})

    add('Python', 'ok' if sys.version_info >= (3, 11) else 'fail', f'{sys.version.split()[0]} ({sys.executable})')
    for module in ('chess', 'fsrs'):
        found = importlib.util.find_spec(module) is not None
        add(module, 'ok' if found else 'fail', 'installed' if found else 'missing; pip install torre (or requirements.txt in a source checkout)')
    from torre.ai import runtime
    version = runtime.prompture_version()
    add('prompture', 'ok' if version else 'warn', version or 'optional, for the AI features: pip install "torre[coach]"')
    if version and args.data_dir.is_dir():
        from torre.ai import catalogue, config
        ready = [p['name'] for p in catalogue.providers(args.data_dir) if p['ready']]
        model, source = config.choose_model(args.data_dir)
        add('AI', 'ok' if model else 'warn', f"{model} ({source}); ready: {', '.join(ready) or 'none'}" if model
            else f"no model chosen; ready: {', '.join(ready) or 'none'} (Settings > AI)")
    if importlib.util.find_spec('chess') is not None:
        from torre.analysis import engines
        engine = engines.resolve_engine('stockfish')
        add('Stockfish', 'ok' if engine.is_file() else 'warn',
            engine if engine.is_file() else 'not found; set STOCKFISH_PATH for engine play and analysis')
    else:
        add('Stockfish', 'warn', 'install python-chess before checking engine discovery')
    if args.data_dir.exists():
        add('Data folder', 'ok' if args.data_dir.is_dir() else 'fail', args.data_dir)
    else:
        add('Data folder', 'warn', f'{args.data_dir} (created when importing or serving)')
    for name in ('games.jsonl', 'analysis.jsonl', 'settings.json'):
        add(name, 'ok' if (args.data_dir / name).is_file() else 'warn',
            'present' if (args.data_dir / name).is_file() else 'not created yet')
    ui = paths.UI / 'index.html'
    add('Web interface', 'ok' if ui.is_file() else 'warn',
        ui if ui.is_file() else 'not built; run .\\dev.ps1 build or npm --prefix web run build')
    code = 1 if any(check['status'] == 'fail' for check in checks) else 0
    if args.json:
        print(json.dumps({'ok': code == 0, 'checks': checks}, indent=2))
    else:
        for check in checks:
            print(f"{check['status'].upper():4} {check['name']}: {check['detail']}")
        print('Engine discovery checks the path only; it does not launch Stockfish.')
    return code


def main(argv=None):
    # A Windows console's code page cannot show every name or Spanish line; print what it can rather than fail.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(errors='replace')
    args = parser().parse_args(argv)
    args.data_dir = Path(getattr(args, 'data_dir', paths.DATA)).expanduser().resolve()
    try:
        if args.command != 'doctor' and args.data_dir.exists() and not args.data_dir.is_dir():
            raise ValueError(f'Data folder is not a directory: {args.data_dir}')
        if args.command in ('import', 'analyze', 'report') and args.data_dir.is_dir():
            from torre.games import importer
            importer.migrate_ids(args.data_dir)
        return args.handler(args)
    except KeyboardInterrupt:
        print('Interrupted.', file=sys.stderr)
        return 130
    except ModuleNotFoundError as exc:
        print(f'torre: missing dependency {exc.name!r}. Run pip install torre (or install requirements.txt in a source checkout).', file=sys.stderr)
        return 1
    except (OSError, ValueError, RuntimeError) as exc:
        print(f'torre: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
