from __future__ import annotations

import json
from pathlib import Path


def _load(name: str) -> dict[str, object]:
    payload = json.loads(Path(name).read_text(encoding='utf-8'))
    assert isinstance(payload, dict), f'{name} must contain an object'
    return payload


def main() -> None:
    review = _load('promotion_review.json')
    request = _load('promotion_adjudication_request.json')
    decision_template = _load('promotion_decision_template.json')
    assert review['schema_version'] == 'program-promotion-review-v1'
    assert request['schema_version'] == 'program-promotion-adjudication-request-v1'
    assert decision_template['schema_version'] == 'program-promotion-decision-v1'
    assert review['promotion_state'] == 'not_promoted'
    assert review['decision']['status'] == 'pending'
    assert request['adjudicator'] == review['adjudicator']
    assert request['external_authority'] == review['external_authority']
    assert request['decision_record_template'] == decision_template
    assert decision_template['status'] == 'pending'
    assert decision_template['decided_by'] is None
    assert request['authority'] == 'adjudication_request_only_non_authoritative'
    blockers = review.get('blocking_conditions')
    missing = request.get('missing_required_evidence')
    assert isinstance(blockers, list)
    assert isinstance(missing, list)
    assert missing == blockers
    if blockers:
        assert request['status'] == 'not_ready_blocked'
    assert review['non_authority']['automatic_promotion'] is False
    assert review['non_authority']['ranking_pruning_promotion'] is False
    assert review['non_authority']['external_authority_export'] is False
    print(f'program promotion artifacts ok: {request["status"]}')


if __name__ == '__main__':
    main()
