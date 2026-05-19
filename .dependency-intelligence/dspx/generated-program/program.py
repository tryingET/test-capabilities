from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import dspy

from module import (
    build_student as build_module_student,
    io_spec,
    normalize_output,
    output_weights,
)

OBJECTIVE = 'Review a dep-diet dependency-review-program.v1 packet for the test-capabilities repository and emit source-owner review findings, next-evidence actions, and explicit non-authority boundaries without deciding dependency removal, replacement, merge, release, exploitability, disclosure, or trust state.'
CONSTRAINTS = ['Treat dep-diet as dependency review-program and evidence-fusion contract owner.', 'Treat runtime-trace-insights observations as bounded to the supplied scenario set.', 'Treat Gardener/static evidence as graph evidence, not runtime coverage.', 'Treat dep-viz as renderer/explainer only.', 'Treat dep-redteam as optional security/advisory escalation only when vulnerability, advisory, reachability, exploitability, or disclosure evidence exists.', 'Treat test-capabilities as the source owner for accepted scenarios, dependency role annotations, validation, and dependency-change decisions.', 'Do not infer that declared-unobserved or scenario-unobserved means unused.', 'Do not decide dependency removal, replacement, merge, release, exploitability, disclosure, or trust state.', 'Preserve all non-authority flags from the input packet; if any are missing or true, emit a blocking review finding.', 'Do not mutate package.json, lockfiles, source files, FCOS board state, AK state, governance state, or external systems.', 'External filesystem mutation is forbidden except for declared DSPx program-gen output artifacts.']
METRIC = 'exact_match'
DECLARED_TOPOLOGY = {}
TOPOLOGY_EXECUTION_STATUS = 'single_module_scaffold_materialized'
MATERIALIZATION_SCOPE = {'topology_declared': False, 'topology_materialized': True, 'current_renderer': 'single_module_scaffold'}
PROGRAM_TEMPLATE_VERSION = 'program-candidate-assembly-v1'


def assembly_manifest_path() -> Path:
    return Path(__file__).with_name('manifest.json')


def load_manifest() -> dict[str, Any]:
    path = assembly_manifest_path()
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return {}
    return dict(payload) if isinstance(payload, dict) else {}


def _current_manifest_hash() -> str:
    path = assembly_manifest_path()
    if not path.exists():
        return ''
    try:
        import hashlib

        return hashlib.sha256(path.read_bytes()).hexdigest()
    except Exception:
        return ''


def _receipt_manifest_hash() -> str:
    path = Path(str(assembly_manifest_path()) + '.meta.json')
    if not path.exists():
        return ''
    try:
        payload = json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return ''
    if not isinstance(payload, dict):
        return ''
    value = payload.get('hash') or payload.get('output_hash')
    return str(value) if value else ''


def _manifest_hash() -> str:
    return _receipt_manifest_hash() or _current_manifest_hash()


def program_observability_tags() -> dict[str, str]:
    manifest = load_manifest()
    assembly = manifest.get('candidate_assembly')
    if not isinstance(assembly, dict):
        assembly = {}
    tags = {
        'program.name': str(intent_summary().get('name') or ''),
        'program.assembly_id': str(assembly.get('assembly_id') or ''),
        'program.candidate_id': str(assembly.get('candidate_id') or ''),
    }
    manifest_hash = _manifest_hash()
    if manifest_hash:
        tags['program.manifest_hash'] = manifest_hash
    return {key: value for key, value in tags.items() if value}


def configure_observability(
    *,
    run_name: str = 'program-runtime',
    run_kind: str = 'program-runtime',
) -> bool:
    try:
        from dspx.tracing import enable_mlflow_from_env, ensure_run_with_standard_tags, get_mlflow

        enable_mlflow_from_env()
        if get_mlflow() is None:
            return False
        extra_tags = program_observability_tags()
        if run_kind in {'program-runtime', 'program-eval'} and not extra_tags.get('program.assembly_id'):
            return False
        return ensure_run_with_standard_tags(
            'program',
            template_version=PROGRAM_TEMPLATE_VERSION,
            run_name=run_name,
            run_kind=run_kind,
            output_basename='program.py',
            output_hash=_manifest_hash(),
            extra=extra_tags,
        )
    except Exception:
        return False


def _active_mlflow():
    try:
        from dspx.tracing import get_mlflow

        mlflow = get_mlflow()
        if mlflow is None or mlflow.active_run() is None:
            return None
        return mlflow
    except Exception:
        return None


def _set_observability_status(status: str, *, error: Exception | None = None) -> None:
    mlflow = _active_mlflow()
    if mlflow is None:
        return
    try:
        mlflow.set_tag('program.runtime.status', status)
    except Exception:
        pass
    try:
        mlflow.log_metric('program.runtime.error', 1.0 if error is not None else 0.0)
    except Exception:
        pass
    if error is not None:
        try:
            mlflow.set_tag('program.runtime.error_type', type(error).__name__)
        except Exception:
            pass


def end_observability_run(started: bool, *, status: str = 'FINISHED') -> None:
    if not started:
        return
    try:
        from dspx.tracing import get_mlflow

        mlflow = get_mlflow()
        if mlflow is not None:
            try:
                mlflow.end_run(status=status)
            except TypeError:
                mlflow.end_run()
    except Exception:
        pass


def run_with_observability(**inputs: object) -> dspy.Prediction:
    started = configure_observability(run_name='program-runtime', run_kind='program-runtime')
    end_status = 'FINISHED'
    try:
        program = build_program()
        prediction = program(**inputs)
        _set_observability_status('passed')
        return prediction
    except Exception as exc:
        end_status = 'FAILED'
        _set_observability_status('failed', error=exc)
        raise
    finally:
        end_observability_run(started, status=end_status)


def build_program() -> dspy.Module:
    return build_module_student()


def build_student(*, use_cot: bool = False) -> dspy.Module:
    return build_module_student(use_cot=use_cot)


def intent_summary() -> dict[str, object]:
    return {
        'name': 'TestCapabilitiesDependencyReviewProgram',
        'objective': OBJECTIVE,
        'constraints': list(CONSTRAINTS),
        'metric': METRIC,
        'io': io_spec(),
        'declared_topology': dict(DECLARED_TOPOLOGY),
        'topology_execution_status': TOPOLOGY_EXECUTION_STATUS,
        'materialization_scope': dict(MATERIALIZATION_SCOPE),
        'signature_class': 'TestCapabilitiesDependencyReviewProgramSignature',
        'module_class': 'TestCapabilitiesDependencyReviewProgramModule',
    }
