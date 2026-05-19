from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from program import build_program, intent_summary, io_spec, normalize_output

RESULT_PATH = Path('behavior_results.json')


def _mapping_for(example: dict[str, object], role: str) -> dict[str, object]:
    nested = example.get(role)
    if isinstance(nested, dict):
        return dict(nested)
    return example


def _jsonable(value: object) -> object:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return str(value)


def _prediction_mapping(prediction: object) -> dict[str, object]:
    if isinstance(prediction, dict):
        return dict(prediction)
    for method_name in ('toDict', 'to_dict', 'model_dump'):
        method = getattr(prediction, method_name, None)
        if callable(method):
            try:
                payload = method()
            except Exception:
                continue
            if isinstance(payload, dict):
                return dict(payload)
    return {}


def _observed_outputs(prediction: object, outputs: list[str]) -> tuple[dict[str, object], list[str]]:
    observed: dict[str, object] = {}
    notes: list[str] = []
    mapped = _prediction_mapping(prediction)
    for name in outputs:
        if name in mapped:
            observed[name] = mapped[name]
        elif hasattr(prediction, name):
            observed[name] = getattr(prediction, name)
    if not observed:
        notes.append('prediction exposed no declared output fields')
    return observed, notes


def _status_for(
    outputs: list[str],
    expected: dict[str, object],
    observed: dict[str, object],
    prediction: object,
) -> tuple[str, list[str]]:
    comparable = [name for name in outputs if name in observed]
    if not comparable:
        return 'degraded_no_comparable_output', ['no declared outputs were observable']
    failures: list[str] = []
    for name in comparable:
        try:
            gold, pred = normalize_output(
                name, str(expected.get(name, '')), str(observed.get(name, '')), pred_trace=prediction
            )
        except Exception as exc:
            failures.append(f'{name} normalization_error:{type(exc).__name__}')
            continue
        if gold != pred:
            failures.append(name)
    if failures:
        return 'failed', [f'output mismatch: {failures}']
    if len(comparable) != len(outputs):
        missing = [name for name in outputs if name not in observed]
        return 'executed', [f'missing non-compared outputs: {missing}']
    return 'passed', []


def _summary(records: list[dict[str, object]]) -> dict[str, object]:
    statuses = [str(record.get('status') or 'unknown') for record in records]
    counts = {status: statuses.count(status) for status in sorted(set(statuses))}
    error_count = sum(1 for status in statuses if status == 'error')
    failed_count = sum(1 for status in statuses if status == 'failed')
    degraded_count = sum(1 for status in statuses if status.startswith('degraded'))
    passed_count = sum(1 for status in statuses if status == 'passed')
    if records and passed_count == len(records):
        episode_status = 'passed'
    elif error_count == len(records):
        episode_status = 'error'
    elif failed_count:
        episode_status = 'failed'
    elif degraded_count:
        episode_status = 'degraded'
    else:
        episode_status = 'executed'
    return {
        'total': len(records),
        'passed': passed_count,
        'failed': failed_count,
        'error': error_count,
        'degraded': degraded_count,
        'status_counts': counts,
        'status': episode_status,
    }


def _configure_provider() -> dict[str, object]:
    try:
        import dspy
        from dspx.provider_registry import create_from_env, ensure_default_providers

        ensure_default_providers()
        lm = create_from_env(default='dspy-lm-auth')
        dspy.configure(lm=lm)
        return {'status': 'configured', 'provider': getattr(lm, 'model', type(lm).__name__)}
    except Exception as exc:
        return {'status': 'unavailable', 'error': {'type': type(exc).__name__, 'message': str(exc)}}


def main() -> None:
    examples = json.loads(Path('examples.json').read_text(encoding='utf-8'))
    assert isinstance(examples, list)
    spec = io_spec()
    inputs = list(spec['inputs'])
    outputs = list(spec['outputs'])
    provider = _configure_provider()
    program = build_program()
    records: list[dict[str, object]] = []
    for index, example in enumerate(examples):
        assert isinstance(example, dict), f'example {index} must be an object'
        input_values = _mapping_for(example, 'inputs')
        output_values = _mapping_for(example, 'outputs')
        missing_inputs = [name for name in inputs if name not in input_values]
        missing_outputs = [name for name in outputs if name not in output_values]
        assert not missing_inputs, f'example {index} missing inputs: {missing_inputs}'
        assert not missing_outputs, f'example {index} missing outputs: {missing_outputs}'
        record: dict[str, object] = {
            'index': index,
            'inputs': _jsonable(input_values),
            'expected_outputs': _jsonable(output_values),
        }
        try:
            prediction = program(**{name: input_values[name] for name in inputs})
            observed, notes = _observed_outputs(prediction, outputs)
            status, status_notes = _status_for(outputs, output_values, observed, prediction)
            record.update(
                {
                    'status': status,
                    'observed_outputs': _jsonable(observed),
                    'notes': notes + status_notes,
                }
            )
        except Exception as exc:
            record.update(
                {
                    'status': 'error',
                    'observed_outputs': {},
                    'error': {'type': type(exc).__name__, 'message': str(exc)},
                }
            )
        records.append(record)
    payload: dict[str, Any] = {
        'schema_version': 'program-behavior-results-v1',
        'intent': intent_summary(),
        'intent_name': intent_summary().get('name'),
        'input_fields': inputs,
        'output_fields': outputs,
        'provider': provider,
        'examples': records,
        'summary': _summary(records),
        'authority': 'behavior_evidence_only_non_authoritative',
        'non_authority': {'optimization_authority': False, 'promotion_authority': False, 'oracle_ranking': False, 'oracle_pruning': False, 'oracle_promotion': False, 'governance_authority': False, 'external_mutation': False, 'external_authority_mutated': False, 'winner_selection': False},
    }
    RESULT_PATH.write_text(json.dumps(payload, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print(f'program examples ok: {len(examples)} example(s); behavior status: {payload["summary"]["status"]}')


if __name__ == '__main__':
    main()
