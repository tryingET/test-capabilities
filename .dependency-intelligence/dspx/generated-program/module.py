import json

import dspy

class TestCapabilitiesDependencyReviewProgramSignature(dspy.Signature):
    """Review a dep-diet dependency-review-program.v1 packet for the test-capabilities repository and emit source-owner review findings, next-evidence actions, and explicit non-authority boundaries without deciding dependency removal, replacement, merge, release, exploitability, disclosure, or trust state. Use inline demos as binding examples; when inputs match a demo, reproduce that demo's declared outputs exactly."""

    dependency_review_program_json: str = dspy.InputField(desc='JSON string conforming to depdiet.dependency-review-program.v1, including target scope, inputs, runtime scenario-set metadata, review signals, introducer summary, handoffs, non-authorizations, and diagnostics.')
    depmodel_json: str = dspy.InputField(desc='Valid depmodel.v1 JSON projection produced by dep-diet for dep-viz rendering, including packages, edges, introducerPaths, references, provenance, and optional staticRuntime evidence.')
    target_context_json: str = dspy.InputField(desc='Target-owned test-capabilities context such as accepted scenarios, dependency role annotations, source-owner review notes, validation gates, and known scope limitations.')
    review_findings_json: str = dspy.OutputField(desc='JSON array of review-only findings grouped by package or dependency role, preserving direct/transitive/introducer context and distinguishing evidence from accepted source-owner truth.')
    next_evidence_actions_json: str = dspy.OutputField(desc='JSON array of source-owner next evidence actions such as collect another runtime scenario, add a dependency role annotation, inspect an introducer path, render a dep-viz report, or request a dep-redteam security handoff.')
    authority_boundary_json: str = dspy.OutputField(desc='JSON object restating non-authorizations and any withheld decisions. All mutation, removal, replacement, merge, release, exploitability, disclosure, and trust-certification authority flags must remain false.')

DEMO_EXAMPLES = [{'inputs': {'dependency_review_program_json': '{"schemaVersion":"depdiet.dependency-review-program.v1","programId":"example","review":{"classifications":["declared-unobserved"],"reviewSignals":[{"code":"declared-unobserved-review","packageId":"npm:example@1.0.0","posture":"collect-evidence"}],"sourceOwnerRoleAnnotations":[],"nextEvidenceActions":[]},"nonAuthorizations":{"mutationAuthority":false,"removalAuthority":false,"replacementAuthority":false,"mergeAuthority":false,"releaseAuthority":false,"exploitabilityAuthority":false,"disclosureAuthority":false,"trustCertificationAuthority":false}}', 'depmodel_json': '{"modelVersion":"depmodel.v1","modules":[],"packages":[],"edges":[],"introducerPaths":[],"vulnerabilities":[],"references":[],"provenance":{"producer":"dep-diet","backend":"native","tools":{}}}', 'target_context_json': '{"repository":"test-capabilities","scenarioCompleteness":"smoke-only","acceptedDependencyChanges":false}'}, 'outputs': {'review_findings_json': '[{"packageId":"npm:example@1.0.0","finding":"declared-unobserved under the supplied scenario set","authority":"review-only"}]', 'next_evidence_actions_json': '[{"action":"Ask the source owner whether the chosen scenario set should exercise npm:example@1.0.0 before interpreting it as unused.","ownerSurface":"test-capabilities"}]', 'authority_boundary_json': '{"mutationAuthority":false,"removalAuthority":false,"replacementAuthority":false,"mergeAuthority":false,"releaseAuthority":false,"exploitabilityAuthority":false,"disclosureAuthority":false,"trustCertificationAuthority":false,"decision":"withheld_pending_source_owner_review"}'}}]
DEMO_INPUT_FIELDS = ['dependency_review_program_json', 'depmodel_json', 'target_context_json']

def _mapping_for(example: dict[str, object], role: str) -> dict[str, object]:
    nested = example.get(role)
    if isinstance(nested, dict):
        return dict(nested)
    return example

def _build_demos() -> list[dspy.Example]:
    demos: list[dspy.Example] = []
    for example in DEMO_EXAMPLES:
        inputs_map = _mapping_for(example, 'inputs')
        outputs_map = _mapping_for(example, 'outputs')
        values = {**inputs_map, **outputs_map}
        demos.append(dspy.Example(**values).with_inputs(*DEMO_INPUT_FIELDS))
    return demos

def _build_focused_demos() -> list[dspy.Example]:
    demos: list[dspy.Example] = []
    for example in DEMO_EXAMPLES:
        inputs_map = _mapping_for(example, 'inputs')
        outputs_map = _mapping_for(example, 'outputs')
        values = {**inputs_map, 'note_bundle_json': json.dumps(outputs_map, ensure_ascii=False)}
        demos.append(dspy.Example(**values).with_inputs(*DEMO_INPUT_FIELDS))
    return demos


class TestCapabilitiesDependencyReviewProgramModule(dspy.Module):
    """Review a dep-diet dependency-review-program.v1 packet for the test-capabilities repository and emit source-owner review findings, next-evidence actions, and explicit non-authority boundaries without deciding dependency removal, replacement, merge, release, exploitability, disclosure, or trust state."""

    def __init__(self, use_cot: bool = False) -> None:
        super().__init__()
        self.predict = dspy.Predict(TestCapabilitiesDependencyReviewProgramSignature)
        self.predict.demos = _build_demos()

    def forward(self, dependency_review_program_json: str, depmodel_json: str, target_context_json: str) -> dspy.Prediction:
        pred = self.predict(dependency_review_program_json=dependency_review_program_json, depmodel_json=depmodel_json, target_context_json=target_context_json)
        return pred


def build_student(*, use_cot: bool = False) -> dspy.Module:
    """Construct the generated module for runtime selection."""
    return TestCapabilitiesDependencyReviewProgramModule(use_cot=use_cot)

def io_spec() -> dict[str, list[str]]:
    """Return the declared module IO contract."""
    return {'inputs': ['dependency_review_program_json', 'depmodel_json', 'target_context_json'], 'outputs': ['review_findings_json', 'next_evidence_actions_json', 'authority_boundary_json']}

def output_weights() -> dict[str, float]:
    """Provide deterministic output weighting for evaluation."""
    return {'review_findings_json': 1.0, 'next_evidence_actions_json': 1.0, 'authority_boundary_json': 1.0}

def _json_container_text(value: str) -> bool:
    text = value.strip()
    return (text.startswith('{') and text.endswith('}')) or (text.startswith('[') and text.endswith(']'))

def _normalize_json_text(value: str) -> str:
    parsed = json.loads(value.strip())
    return json.dumps(parsed, ensure_ascii=False, sort_keys=True, separators=(',', ':'))

def normalize_output(key: str, gold: str, pred: str, pred_name: str | None = None, pred_trace: object | None = None) -> tuple[str, str]:
    """Normalize gold/pred pairs for deterministic checks."""
    if _json_container_text(gold) and _json_container_text(pred):
        return _normalize_json_text(gold), _normalize_json_text(pred)
    return gold, pred
