from __future__ import annotations

import json
from pathlib import Path


def _load(name: str) -> dict[str, object]:
    payload = json.loads(Path(name).read_text(encoding='utf-8'))
    assert isinstance(payload, dict), f'{name} must contain an object'
    return payload


def main() -> None:
    jury = _load('jury.json')
    selection = _load('jury_selection.json')
    rubric = _load('jury_rubric.json')
    assert jury['schema_version'] == 'program-jury-v1'
    assert selection['schema_version'] == 'program-jury-selection-v1'
    assert rubric['schema_version'] == 'program-jury-rubric-v1'
    selected = selection.get('selected_jurors')
    rubrics = rubric.get('juror_rubrics')
    assert isinstance(selected, list)
    assert isinstance(rubrics, list)
    assert len(selected) == len(rubrics)
    selected_ids = {item.get('id') for item in selected if isinstance(item, dict)}
    rubric_ids = {item.get('juror_id') for item in rubrics if isinstance(item, dict)}
    assert selected_ids == rubric_ids
    assert selection['authority'] == 'selection_contract_only_non_authoritative'
    assert rubric['authority'] == 'rubric_contract_only_non_authoritative'
    print(f'program jury artifacts ok: {len(selected_ids)} selected juror(s)')


if __name__ == '__main__':
    main()
