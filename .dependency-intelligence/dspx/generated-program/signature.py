import dspy

class TestCapabilitiesDependencyReviewProgramSignature(dspy.Signature):
    """Review a dep-diet dependency-review-program.v1 packet for the test-capabilities repository and emit source-owner review findings, next-evidence actions, and explicit non-authority boundaries without deciding dependency removal, replacement, merge, release, exploitability, disclosure, or trust state."""

    dependency_review_program_json: str = dspy.InputField(desc='JSON string conforming to depdiet.dependency-review-program.v1, including target scope, inputs, runtime scenario-set metadata, review signals, introducer summary, handoffs, non-authorizations, and diagnostics.')
    depmodel_json: str = dspy.InputField(desc='Valid depmodel.v1 JSON projection produced by dep-diet for dep-viz rendering, including packages, edges, introducerPaths, references, provenance, and optional staticRuntime evidence.')
    target_context_json: str = dspy.InputField(desc='Target-owned test-capabilities context such as accepted scenarios, dependency role annotations, source-owner review notes, validation gates, and known scope limitations.')
    review_findings_json: str = dspy.OutputField(desc='JSON array of review-only findings grouped by package or dependency role, preserving direct/transitive/introducer context and distinguishing evidence from accepted source-owner truth.')
    next_evidence_actions_json: str = dspy.OutputField(desc='JSON array of source-owner next evidence actions such as collect another runtime scenario, add a dependency role annotation, inspect an introducer path, render a dep-viz report, or request a dep-redteam security handoff.')
    authority_boundary_json: str = dspy.OutputField(desc='JSON object restating non-authorizations and any withheld decisions. All mutation, removal, replacement, merge, release, exploitability, disclosure, and trust-certification authority flags must remain false.')
