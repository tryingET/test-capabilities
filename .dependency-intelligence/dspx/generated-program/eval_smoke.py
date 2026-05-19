from __future__ import annotations

from program import build_program, intent_summary, io_spec


def main() -> None:
    program = build_program()
    assert program is not None
    assert io_spec()['inputs'] == ['dependency_review_program_json', 'depmodel_json', 'target_context_json']
    assert io_spec()['outputs'] == ['review_findings_json', 'next_evidence_actions_json', 'authority_boundary_json']
    assert intent_summary()['objective']
    print('program smoke ok: TestCapabilitiesDependencyReviewProgram')


if __name__ == '__main__':
    main()

SAMPLE_INPUTS = {'dependency_review_program_json': 'sample_dependency_review_program_json', 'depmodel_json': 'sample_depmodel_json', 'target_context_json': 'sample_target_context_json'}