#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

OUTPUT_RECEIPT = 'direct_run_receipt.json'

def _prediction_mapping(prediction: object, output_fields: list[str]) -> dict[str, object]:
    if isinstance(prediction, Mapping):
        return {str(key): value for key, value in prediction.items()}
    for method_name in ('toDict', 'to_dict', 'model_dump'):
        method = getattr(prediction, method_name, None)
        if callable(method):
            payload = method()
            if isinstance(payload, Mapping):
                return dict(payload)
    return {field: getattr(prediction, field) for field in output_fields if hasattr(prediction, field)}

def _load_inputs(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding='utf-8'))
    inputs = payload.get('inputs') if isinstance(payload, dict) else None
    if isinstance(inputs, dict):
        return dict(inputs)
    if isinstance(payload, dict):
        return dict(payload)
    raise SystemExit(f'input file must be a JSON object: {path}')

def _parse_json_output(value: object, *, field: str) -> Any:
    if not isinstance(value, str):
        return value
    text = value.strip()
    if text.startswith('```') and text.endswith('```'):
        text = '\n'.join(text.splitlines()[1:-1]).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise SystemExit(f'generated output {field} is not valid JSON: {exc}') from exc

def _configure_lm() -> dict[str, Any]:
    import dspy
    from dspx.provider_registry import create_from_env, ensure_default_providers

    ensure_default_providers()
    lm = create_from_env(default='dspy-lm-auth')
    dspy.configure(lm=lm)
    return {
        'provider': getattr(lm, 'model', type(lm).__name__),
        'kwargs': dict(getattr(lm, 'kwargs', {}) or {}),
    }

def _single_run(inputs_path: Path, outdir: Path) -> dict[str, Any]:
    program_dir = Path(__file__).resolve().parent
    sys.path.insert(0, str(program_dir))
    from program import build_program, io_spec  # noqa: PLC0415

    output_fields = list(io_spec().get('outputs', []))
    if not output_fields:
        raise SystemExit('generated program io_spec declares no outputs')
    outdir.mkdir(parents=True, exist_ok=True)
    inputs = _load_inputs(inputs_path)
    provider = _configure_lm()
    prediction = build_program()(**inputs)
    observed = _prediction_mapping(prediction, output_fields)

    for field in output_fields:
        if field not in observed:
            raise SystemExit(f'missing generated output: {field}')
        parsed = _parse_json_output(observed[field], field=field)
        (outdir / field).write_text(
            json.dumps(parsed, ensure_ascii=False, indent=2, sort_keys=True) + '\n',
            encoding='utf-8',
        )

    receipt = {
        'schema_version': 'generated-dspy-direct-run-v1',
        'status': 'ok',
        'program_dir': str(program_dir),
        'inputs_path': str(inputs_path.resolve()),
        'outdir': str(outdir.resolve()),
        'provider': provider,
        'output_files': output_fields,
        'canonical_notes_mutated': False,
        'dspx_program_run_wrapper_used': False,
    }
    (outdir / OUTPUT_RECEIPT).write_text(
        json.dumps(receipt, ensure_ascii=False, indent=2, sort_keys=True) + '\n',
        encoding='utf-8',
    )
    return receipt

def _target_name(input_file: Path, inputs_root: Path) -> str:
    parent = input_file.parent
    if parent.name == 'runtime' and parent.parent != inputs_root:
        return parent.parent.name
    if parent != inputs_root:
        return parent.name
    return input_file.stem

def _discover_input_files(inputs_root: Path) -> list[Path]:
    direct_children = sorted(inputs_root.glob('*/runtime_inputs.json'))
    if direct_children:
        return direct_children
    nested = sorted(inputs_root.glob('*/runtime/runtime_inputs.json'))
    if nested:
        return nested
    return sorted(inputs_root.glob('*.json'))

def _run_child(input_file: Path, outdir: Path, timeout_seconds: int, retries: int) -> dict[str, Any]:
    attempts: list[dict[str, Any]] = []
    cmd = [
        sys.executable,
        str(Path(__file__).resolve()),
        '--inputs',
        str(input_file),
        '--outdir',
        str(outdir),
        '--json',
    ]
    for attempt in range(retries + 1):
        outdir.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(cmd, text=True, capture_output=True, timeout=timeout_seconds)
        attempts.append({
            'attempt': attempt + 1,
            'returncode': result.returncode,
            'stdout_tail': result.stdout[-2000:],
            'stderr_tail': result.stderr[-2000:],
        })
        if result.returncode == 0 and (outdir / OUTPUT_RECEIPT).exists():
            receipt = json.loads((outdir / OUTPUT_RECEIPT).read_text(encoding='utf-8'))
            return {
                'target': outdir.name,
                'status': 'ok',
                'inputs_path': str(input_file.resolve()),
                'outdir': str(outdir.resolve()),
                'attempts': attempts,
                'receipt': receipt,
            }
    return {
        'target': outdir.name,
        'status': 'failed',
        'inputs_path': str(input_file.resolve()),
        'outdir': str(outdir.resolve()),
        'attempts': attempts,
    }

def _batch_run(inputs_root: Path, out_root: Path, parallel: int, timeout_seconds: int, retries: int) -> dict[str, Any]:
    input_files = _discover_input_files(inputs_root)
    if not input_files:
        raise SystemExit(f'no batch inputs found under {inputs_root}')
    out_root.mkdir(parents=True, exist_ok=True)
    jobs = [(input_file, out_root / _target_name(input_file, inputs_root)) for input_file in input_files]
    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max(1, parallel)) as executor:
        futures = [executor.submit(_run_child, input_file, outdir, timeout_seconds, retries) for input_file, outdir in jobs]
        for future in as_completed(futures):
            results.append(future.result())
    results.sort(key=lambda item: str(item.get('target', '')))
    failed = [item for item in results if item.get('status') != 'ok']
    summary = {
        'schema_version': 'generated-dspy-direct-batch-run-v1',
        'status': 'ok' if not failed else 'failed',
        'inputs_root': str(inputs_root.resolve()),
        'out_root': str(out_root.resolve()),
        'parallel': parallel,
        'timeout_seconds': timeout_seconds,
        'retries': retries,
        'total': len(results),
        'ok': len(results) - len(failed),
        'failed': len(failed),
        'canonical_notes_mutated': False,
        'dspx_program_run_wrapper_used': False,
        'results': results,
    }
    (out_root / 'direct_batch_receipt.json').write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + '\n',
        encoding='utf-8',
    )
    return summary

def main() -> int:
    parser = argparse.ArgumentParser(description='Direct runner for this generated DSPy program.')
    single = parser.add_argument_group('single run')
    single.add_argument('--inputs', type=Path, help='JSON object or {inputs: {...}} payload.')
    single.add_argument('--outdir', type=Path, help='Directory for output JSON files and receipt.')
    batch = parser.add_argument_group('batch run')
    batch.add_argument('--inputs-root', type=Path, help='Root containing child runtime_inputs.json files.')
    batch.add_argument('--out-root', type=Path, help='Directory for per-target output folders and batch receipt.')
    batch.add_argument('--parallel', type=int, default=1, help='Batch parallelism. Default: 1.')
    batch.add_argument('--timeout-seconds', type=int, default=600, help='Per-target timeout for batch child runs. Default: 600.')
    batch.add_argument('--retries', type=int, default=0, help='Per-target retries after a failed child run. Default: 0.')
    parser.add_argument('--json', action='store_true', help='Print receipt JSON to stdout.')
    args = parser.parse_args()

    if args.inputs_root or args.out_root:
        if not args.inputs_root or not args.out_root:
            raise SystemExit('batch mode requires --inputs-root and --out-root')
        summary = _batch_run(args.inputs_root, args.out_root, args.parallel, args.timeout_seconds, args.retries)
        if args.json:
            print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
        return 0 if summary['status'] == 'ok' else 1

    if not args.inputs or not args.outdir:
        raise SystemExit('single mode requires --inputs and --outdir')
    receipt = _single_run(args.inputs, args.outdir)
    if args.json:
        print(json.dumps(receipt, ensure_ascii=False, indent=2, sort_keys=True))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
