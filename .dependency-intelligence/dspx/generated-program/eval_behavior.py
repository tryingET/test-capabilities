from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from program import configure_observability, end_observability_run

HARNESS_PLAN: list[dict[str, object]] = [{'kind': 'examples', 'source_kind': 'inline_examples', 'harness': 'eval_examples.py', 'result': 'behavior_results.json'}]
RESULT_PATH = Path('behavior_episode.json')


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _jsonable(value: object) -> object:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return str(value)


def _load_json(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding='utf-8'))
    assert isinstance(payload, dict), f'{path} must contain a JSON object'
    return payload


def _safe_summary(payload: dict[str, object]) -> dict[str, object]:
    summary = payload.get('summary')
    return dict(summary) if isinstance(summary, dict) else {}


def _run_source(source: dict[str, object]) -> dict[str, object]:
    harness_path = Path(str(source['harness']))
    result_path = Path(str(source['result']))
    record: dict[str, object] = {
        'kind': source.get('kind'),
        'source_kind': source.get('source_kind'),
        'split': source.get('split'),
        'harness_path': str(harness_path),
        'behavior_results_path': str(result_path),
    }
    if not harness_path.exists():
        record.update({'status': 'missing_harness', 'returncode': None, 'summary': {}})
        return record
    proc = subprocess.run([sys.executable, str(harness_path)], capture_output=True, text=True, check=False)
    record.update({
        'status': 'passed' if proc.returncode == 0 else 'failed',
        'returncode': proc.returncode,
        'command': [sys.executable, str(harness_path)],
        'stdout': (proc.stdout or '').strip(),
        'stderr': (proc.stderr or '').strip(),
    })
    if result_path.exists():
        payload = _load_json(result_path)
        summary = _safe_summary(payload)
        record.update({
            'behavior_results_hash': _sha256_file(result_path),
            'behavior_status': summary.get('status'),
            'count': summary.get('total'),
            'summary': _jsonable(summary),
            'provider': _jsonable(payload.get('provider') if isinstance(payload.get('provider'), dict) else {}),
        })
    else:
        record.update({'behavior_status': 'missing_results', 'summary': {}})
    return record


def _summary(sources: list[dict[str, object]]) -> dict[str, object]:
    totals = {'total': 0, 'passed': 0, 'failed': 0, 'error': 0, 'degraded': 0}
    status_counts: dict[str, int] = {}
    for source in sources:
        summary = source.get('summary') if isinstance(source.get('summary'), dict) else {}
        status = str(summary.get('status') or source.get('behavior_status') or 'unknown')
        status_counts[status] = status_counts.get(status, 0) + 1
        for key in totals:
            value = summary.get(key)
            if isinstance(value, int):
                totals[key] += value
    if not sources:
        aggregate_status = 'not_applicable'
    elif any(source.get('status') == 'failed' for source in sources):
        aggregate_status = 'failed'
    elif totals['total'] == 0:
        aggregate_status = 'no_examples'
    elif totals['error'] == totals['total']:
        aggregate_status = 'error'
    elif totals['failed']:
        aggregate_status = 'failed'
    elif totals['degraded']:
        aggregate_status = 'degraded'
    elif totals['passed'] == totals['total']:
        aggregate_status = 'passed'
    else:
        aggregate_status = 'executed'
    return {'status': aggregate_status, 'source_count': len(sources), **totals, 'status_counts': status_counts}


def _log_behavior_episode(payload: dict[str, Any], sources: list[dict[str, object]]) -> None:
    try:
        from dspx.tracing import get_mlflow

        mlflow = get_mlflow()
        if mlflow is None or mlflow.active_run() is None:
            return
        summary = payload.get('summary') if isinstance(payload.get('summary'), dict) else {}
        for key in ('total', 'passed', 'failed', 'error', 'degraded', 'source_count'):
            value = summary.get(key)
            if isinstance(value, int):
                try:
                    mlflow.log_metric(f'program.behavior.{key}', float(value))
                except Exception:
                    pass
        try:
            mlflow.set_tag('program.behavior.status', str(payload.get('status') or 'unknown'))
        except Exception:
            pass
        for path in [RESULT_PATH, *[Path(str(source.get('behavior_results_path'))) for source in sources]]:
            if path.exists() and path.is_file():
                try:
                    mlflow.log_artifact(str(path))
                except Exception:
                    pass
    except Exception:
        return


def main() -> None:
    started_run = configure_observability(run_name='program-eval', run_kind='program-eval')
    sources = [_run_source(dict(source)) for source in HARNESS_PLAN]
    payload: dict[str, Any] = {
        'schema_version': 'program-behavior-episode-v1',
        'status': _summary(sources)['status'],
        'sources': sources,
        'summary': _summary(sources),
        'authority': 'behavior_evidence_only_non_authoritative',
        'non_authority': {'optimization_authority': False, 'promotion_authority': False, 'oracle_ranking': False, 'oracle_pruning': False, 'oracle_promotion': False, 'governance_authority': False, 'external_mutation': False, 'external_authority_mutated': False, 'winner_selection': False},
    }
    RESULT_PATH.write_text(json.dumps(payload, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    try:
        _log_behavior_episode(payload, sources)
    finally:
        end_observability_run(started_run)
    print(f'program behavior episode ok: {len(sources)} source(s); status: {payload["status"]}')


if __name__ == '__main__':
    main()
