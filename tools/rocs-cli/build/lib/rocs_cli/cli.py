from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path
from typing import cast

from rich.console import Console

from rocs_cli import __version__
from rocs_cli.cache import cache_dir, clear_cache, list_cache_entries, prune_cache
from rocs_cli.graph import build_edges, collapse_nodes, compute_layout, write_graph
from rocs_cli.id_index import build_id_index
from rocs_cli.inverses import check_inverses
from rocs_cli.layers import dist_dir, parse_gitlab_ref, repo_root as _repo_root, resolve_layers
from rocs_cli.lint import lint_docs
from rocs_cli.model import collect_docs
from rocs_cli.normalize import normalize_tree
from rocs_cli.pack import build_pack, pack_config_from_profile
from rocs_cli.rules import Finding, RULES
from rocs_cli.errors import RocsCliError
from rocs_cli.rulesets import behavior_for_ruleset, effective_ruleset
from rocs_cli.validate import (
    enforce_budget,
    validate_layers_exist,
    validate_manifest_placeholders,
    validate_reference_schema,
    validate_repo_structure,
)
from rocs_cli.vendored import verify_vendored_hashes


console = Console()

_DEFAULT_ENV_REL = Path("holdingco/governance-kernel/.env")


def _filter_layers(layers, *, only: str | None, layer: str | None):
    out = layers
    if only:
        if only not in ("path", "ref"):
            raise SystemExit("--only must be path|ref")
        out = [layer_spec for layer_spec in out if layer_spec.kind == only]
    if layer:
        out = [layer_spec for layer_spec in out if layer_spec.name == layer]
    return out


def _discover_default_env_file(*, repo_root: Path | None) -> Path | None:
    env_from_var = os.environ.get("ROCS_ENV_FILE") or ""
    if env_from_var.strip():
        return Path(env_from_var).expanduser()
    if repo_root is None:
        return None

    repo_env = repo_root / ".env"
    if repo_env.exists():
        return repo_env

    for p in [repo_root, *repo_root.parents]:
        cand = p / _DEFAULT_ENV_REL
        if cand.exists():
            return cand

    return None


def _maybe_load_env_file(env_file: str | None, *, repo_root: Path | None) -> None:
    p = Path(env_file).expanduser() if env_file else _discover_default_env_file(repo_root=repo_root)
    if not p:
        return
    from rocs_cli.gitlab import load_env_file

    load_env_file(p)


def _findings_to_json(findings: list[Finding]) -> list[dict]:
    return [f.to_dict() for f in findings]


def _print_findings(findings: list[Finding]) -> None:
    for f in findings:
        loc = f.path or ""
        if loc:
            console.print(f"- {f.rule_id} {f.severity} {loc}: {f.message}")
        else:
            console.print(f"- {f.rule_id} {f.severity}: {f.message}")


def _write_resolve_artifact(repo: Path, *, layers, profile: str | None) -> Path:
    dist = dist_dir(repo)
    dist.mkdir(parents=True, exist_ok=True)
    entries = []
    for layer_spec in layers:
        cache_repo_root = None
        if layer_spec.kind == "ref":
            # <cache>/gitlab/<proj>/<ref>/ontology/src
            cache_repo_root = str(layer_spec.src_root.parent.parent)
        entries.append(
            {
                "name": layer_spec.name,
                "kind": layer_spec.kind,
                "origin": layer_spec.origin,
                "source": layer_spec.source,
                "src_root": str(layer_spec.src_root),
                "cache_repo_root": cache_repo_root,
            }
        )
    entries.sort(key=lambda e: str(e.get("name") or ""))
    payload = {
        "schema_version": 1,
        "version": __version__,
        "repo": str(repo),
        "profile": profile,
        "layers": entries,
    }
    out = dist / "resolve.json"
    out.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", "utf-8")
    return out


def cmd_version(_args: argparse.Namespace) -> int:
    console.print(f"rocs-cli {__version__}")
    return 0


def cmd_rules(args: argparse.Namespace) -> int:
    rules = sorted(RULES.values(), key=lambda r: r.rule_id)
    payload = {
        "rules": [
            {
                "rule_id": r.rule_id,
                "default_severity": r.default_severity,
                "summary": r.summary,
            }
            for r in rules
        ]
    }
    if args.json:
        console.print_json(json.dumps(payload))
        return 0
    for r in rules:
        console.print(f"{r.rule_id} {r.default_severity} {r.summary}")
    return 0


def cmd_explain(args: argparse.Namespace) -> int:
    rule_id = str(args.rule_id)
    r = RULES.get(rule_id)
    if r is None:
        raise SystemExit(f"unknown rule id: {rule_id}")
    payload = {
        "rule": {
            "rule_id": r.rule_id,
            "default_severity": r.default_severity,
            "summary": r.summary,
            "suppress": {"field": "ont.lint_ignore", "value": r.rule_id},
        }
    }
    if args.json:
        console.print_json(json.dumps(payload))
        return 0
    console.print(f"{r.rule_id} ({r.default_severity})")
    console.print(r.summary)
    console.print("")
    console.print("suppress:")
    console.print(f"- add to `ont.lint_ignore`: {r.rule_id!r}")
    return 0


def cmd_resolve(args: argparse.Namespace) -> int:
    repo = _repo_root(args.repo)
    _maybe_load_env_file(getattr(args, "env_file", None), repo_root=repo)
    layers, meta = resolve_layers(
        repo,
        profile=args.profile,
        resolve_refs=args.resolve_refs,
        workspace_root=args.workspace_root,
        workspace_ref_mode=args.workspace_ref_mode,
        only=args.only,
        layer=args.layer,
    )
    layers = _filter_layers(layers, only=args.only, layer=args.layer)
    profile_name = meta.get("profile") if isinstance(meta, dict) and isinstance(meta.get("profile"), str) else None
    resolution_notes = meta.get("resolution_notes") if isinstance(meta, dict) else None
    layer_entries: list[dict[str, object]] = []
    for layer_spec in layers:
        entry: dict[str, object] = {
            "name": layer_spec.name,
            "origin": layer_spec.origin,
            "src_root": str(layer_spec.src_root),
            "kind": layer_spec.kind,
            "source": layer_spec.source,
        }
        if args.show_resolve_details:
            entry["details"] = (resolution_notes or {}).get(layer_spec.name)
        layer_entries.append(entry)
    for layer_entry in layer_entries:
        if layer_entry.get("details") is None:
            layer_entry.pop("details", None)

    payload: dict[str, object] = {"repo": str(repo), "profile": profile_name, "layers": layer_entries}
    if args.write_dist:
        _write_resolve_artifact(repo, layers=layers, profile=profile_name)
    if args.json:
        console.print_json(json.dumps(payload))
    else:
        console.print(f"repo: {repo}")
        console.print(f"profile: {profile_name}")
        for layer_entry in layer_entries:
            name = str(layer_entry.get("name") or "")
            origin = str(layer_entry.get("origin") or "")
            if args.show_resolve_sources or args.show_resolve_details:
                source = str(layer_entry.get("source") or "")
                extra = f"source={source}"
                details = layer_entry.get("details")
                if args.show_resolve_details and isinstance(details, dict):
                    details_map = cast(dict[str, object], details)
                    ws_obj = details_map.get("workspace")
                    if isinstance(ws_obj, dict):
                        ws = cast(dict[str, object], ws_obj)
                        if ws.get("present"):
                            if not ws.get("used") and ws.get("reason"):
                                extra += f"; workspace={ws.get('reason')}"
                console.print(f"- layer {name}: {origin} ({extra})")
            else:
                console.print(f"- layer {name}: {origin}")
    return 0


def cmd_summary(args: argparse.Namespace) -> int:
    repo = _repo_root(args.repo)
    _maybe_load_env_file(getattr(args, "env_file", None), repo_root=repo)
    layers, meta = resolve_layers(
        repo,
        profile=args.profile,
        resolve_refs=args.resolve_refs,
        workspace_root=args.workspace_root,
        workspace_ref_mode=args.workspace_ref_mode,
        only=args.only,
        layer=args.layer,
    )
    layers = _filter_layers(layers, only=args.only, layer=args.layer)
    concepts, relations = collect_docs(layers)
    profile_name = meta.get("profile") if isinstance(meta, dict) and isinstance(meta.get("profile"), str) else None
    resolution_notes = meta.get("resolution_notes") if isinstance(meta, dict) else None
    layer_entries: list[dict[str, object]] = []
    for layer_spec in layers:
        entry: dict[str, object] = {
            "name": layer_spec.name,
            "origin": layer_spec.origin,
            "src_root": str(layer_spec.src_root),
            "kind": layer_spec.kind,
            "source": layer_spec.source,
        }
        if args.show_resolve_details:
            entry["details"] = (resolution_notes or {}).get(layer_spec.name)
        layer_entries.append(entry)
    for layer_entry in layer_entries:
        if layer_entry.get("details") is None:
            layer_entry.pop("details", None)
    payload: dict[str, object] = {
        "repo": str(repo),
        "profile": profile_name,
        "layers": layer_entries,
        "counts": {"concepts": len(concepts), "relations": len(relations)},
    }
    if not args.json:
        console.print(f"repo: {repo}")
        console.print(f"profile: {profile_name}")
        console.print(f"counts: concepts={len(concepts)} relations={len(relations)}")
        for layer_entry in layer_entries:
            name = str(layer_entry.get("name") or "")
            origin = str(layer_entry.get("origin") or "")
            if args.show_resolve_sources or args.show_resolve_details:
                source = str(layer_entry.get("source") or "")
                extra = f"source={source}"
                details = layer_entry.get("details")
                if args.show_resolve_details and isinstance(details, dict):
                    details_map = cast(dict[str, object], details)
                    ws_obj = details_map.get("workspace")
                    if isinstance(ws_obj, dict):
                        ws = cast(dict[str, object], ws_obj)
                        if ws.get("present"):
                            if not ws.get("used") and ws.get("reason"):
                                extra += f"; workspace={ws.get('reason')}"
                console.print(f"- layer {name}: {origin} ({extra})")
            else:
                console.print(f"- layer {name}: {origin}")
    else:
        console.print_json(json.dumps(payload))
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    repo = _repo_root(args.repo)
    _maybe_load_env_file(getattr(args, "env_file", None), repo_root=repo)
    findings: list[Finding] = []
    findings.extend(validate_repo_structure(repo))
    if findings:
        if args.json:
            console.print_json(json.dumps({"ok": False, "findings": _findings_to_json(findings), "budget": {"budget": None, "units": None}}))
        else:
            console.print("[red]rocs validate: FAIL[/red]")
            _print_findings(findings)
        return 1
    layers, meta = resolve_layers(
        repo,
        profile=args.profile,
        resolve_refs=args.resolve_refs,
        workspace_root=args.workspace_root,
        workspace_ref_mode=args.workspace_ref_mode,
        only=args.only,
        layer=args.layer,
    )
    profile_def = meta.get("profile_def") if isinstance(meta, dict) else None
    ruleset_name = effective_ruleset(cli_ruleset=getattr(args, "ruleset", None), profile_def=profile_def)
    ruleset_behavior = behavior_for_ruleset(ruleset_name)
    strict_placeholders = bool(args.strict_placeholders or ruleset_behavior.strict_placeholders)

    findings.extend(validate_manifest_placeholders(repo, strict_placeholders=strict_placeholders))
    layers = _filter_layers(layers, only=args.only, layer=args.layer)
    findings.extend(validate_layers_exist(layers))
    schema_findings, _meta2 = validate_reference_schema(
        layers, strict_placeholders=strict_placeholders, validate_deps=args.validate_deps
    )
    findings.extend(schema_findings)

    concepts, relations = collect_docs(layers)
    budget = None
    profile_def = meta.get("profile_def") or {}
    if isinstance(profile_def, dict) and profile_def.get("budget") is not None:
        budget_raw = profile_def.get("budget")
        if isinstance(budget_raw, (int, str)):
            try:
                budget = int(budget_raw)
            except Exception:
                findings.append(
                    Finding(
                        rule_id="BUD001",
                        severity="error",
                        message=f"invalid profile budget (expected int): {budget_raw!r}",
                    )
                )
        else:
            findings.append(
                Finding(
                    rule_id="BUD001",
                    severity="error",
                    message=f"invalid profile budget (expected int): {budget_raw!r}",
                )
            )
    ok_budget, budget_payload = enforce_budget(concepts, relations, budget=budget)
    if not ok_budget:
        findings.append(
            Finding(
                rule_id="BUD010",
                severity="error",
                message=f"budget exceeded: units={budget_payload['units']} budget={budget_payload['budget']}",
            )
        )

    if findings:
        if args.json:
            console.print_json(json.dumps({"ok": False, "findings": _findings_to_json(findings), "budget": budget_payload}))
        else:
            console.print("[red]rocs validate: FAIL[/red]")
            _print_findings(findings)
        return 1

    if args.json:
        console.print_json(json.dumps({"ok": True, "findings": [], "budget": budget_payload}))
    else:
        console.print("[green]rocs validate: OK[/green]")
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    repo = _repo_root(args.repo)
    _maybe_load_env_file(getattr(args, "env_file", None), repo_root=repo)
    dist = dist_dir(repo)
    if args.clean and dist.exists():
        shutil.rmtree(dist)
    dist.mkdir(parents=True, exist_ok=True)
    layers, meta = resolve_layers(
        repo,
        profile=args.profile,
        resolve_refs=args.resolve_refs,
        workspace_root=args.workspace_root,
        workspace_ref_mode=args.workspace_ref_mode,
        only=args.only,
        layer=args.layer,
    )
    layers = _filter_layers(layers, only=args.only, layer=args.layer)
    concepts, relations = collect_docs(layers)
    profile_name = meta.get("profile") if isinstance(meta, dict) and isinstance(meta.get("profile"), str) else None
    resolve_out = _write_resolve_artifact(repo, layers=layers, profile=profile_name)
    payload = {
        "schema_version": 1,
        "version": __version__,
        "repo": str(repo),
        "profile": profile_name,
        "layers": [{"name": layer_spec.name, "origin": layer_spec.origin} for layer_spec in layers],
        "counts": {"concepts": len(concepts), "relations": len(relations)},
        "concept_ids": sorted(concepts.keys()),
        "relation_ids": sorted(relations.keys()),
    }
    summary_out = dist / "summary.json"
    summary_out.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", "utf-8")
    id_index_out = dist / "id_index.json"
    id_index_out.write_text(
        json.dumps(build_id_index(concepts=concepts, relations=relations), indent=2, sort_keys=True) + "\n", "utf-8"
    )
    if args.json:
        console.print_json(
            json.dumps(
                {
                    "repo": str(repo),
                    "profile": profile_name,
                    "dist": {
                        "dir": str(dist),
                        "files": {
                            "resolve": str(resolve_out),
                            "summary": str(summary_out),
                            "id_index": str(id_index_out),
                        },
                    },
                    "counts": payload.get("counts"),
                }
            )
        )
    else:
        console.print(f"[green]wrote[/green] {summary_out}")
        console.print(f"[green]wrote[/green] {id_index_out}")
    return 0


def cmd_pack(args: argparse.Namespace) -> int:
    repo = _repo_root(args.repo)
    _maybe_load_env_file(getattr(args, "env_file", None), repo_root=repo)
    layers, meta = resolve_layers(
        repo,
        profile=args.profile,
        resolve_refs=args.resolve_refs,
        workspace_root=args.workspace_root,
        workspace_ref_mode=args.workspace_ref_mode,
        only=args.only,
        layer=args.layer,
    )
    layers = _filter_layers(layers, only=args.only, layer=args.layer)
    concepts, relations = collect_docs(layers)
    cid = args.ont_id
    doc = concepts.get(cid) or relations.get(cid)
    if not doc:
        raise RocsCliError(kind="not_found", message=f"unknown ont_id: {cid}", exit_code=2, details={"ont_id": cid})

    rel_types: set[str] | None = None
    if args.rel_types:
        rel_types = {x.strip() for x in args.rel_types.split(",") if x.strip()}

    cfg = pack_config_from_profile(
        profile_def=meta.get("profile_def") if isinstance(meta, dict) else None,
        overrides={
            "max_depth": args.depth,
            "rel_types": rel_types,
            "include_relation_defs": True if args.include_relation_defs else None,
            "max_docs": args.max_docs,
            "max_bytes": args.max_bytes,
        },
    )

    packed, pack_meta = build_pack(concepts=concepts, relations=relations, root_id=cid, config=cfg)
    if args.json:
        console.print_json(
            json.dumps(
                {
                    "repo": str(repo),
                    "profile": meta.get("profile"),
                    "pack": pack_meta,
                    "docs": [{"ont_id": d.ont_id, "kind": d.kind, "path": d.path} for d in packed],
                }
            )
        )
        return 0

    first = True
    for d in packed:
        if not first:
            console.print("\n---\n")
        first = False
        console.print(d.path)
        console.print(d.text)
    return 0


def cmd_lint(args: argparse.Namespace) -> int:
    repo = _repo_root(args.repo)
    _maybe_load_env_file(getattr(args, "env_file", None), repo_root=repo)
    layers, meta = resolve_layers(
        repo,
        profile=args.profile,
        resolve_refs=args.resolve_refs,
        workspace_root=args.workspace_root,
        workspace_ref_mode=args.workspace_ref_mode,
        only=args.only,
        layer=args.layer,
    )
    layers = _filter_layers(layers, only=args.only, layer=args.layer)
    concepts, relations = collect_docs(layers)
    profile_def = meta.get("profile_def") if isinstance(meta, dict) else None
    ruleset_name = effective_ruleset(cli_ruleset=getattr(args, "ruleset", None), profile_def=profile_def)
    ruleset_behavior = behavior_for_ruleset(ruleset_name)
    strict_placeholders = bool(args.strict_placeholders or ruleset_behavior.strict_placeholders)
    fail_on_warn = bool(args.fail_on_warn or ruleset_behavior.fail_on_warn)

    findings = lint_docs(concepts, relations, strict_placeholders=strict_placeholders)
    rule_filter: set[str] | None = None
    if args.rules and args.rules != "all":
        rule_filter = {x.strip() for x in args.rules.split(",") if x.strip()}
        unknown = sorted([r for r in rule_filter if r not in RULES])
        if unknown:
            raise SystemExit(f"unknown lint rule ids: {unknown}")
    if rule_filter is not None:
        findings = [f for f in findings if f.rule_id in rule_filter]
    if args.json:
        console.print_json(json.dumps({"findings": _findings_to_json(findings)}))
    else:
        if findings:
            console.print("[yellow]rocs lint[/yellow]")
            _print_findings(findings)
        else:
            console.print("[green]rocs lint: OK[/green]")
    if findings and fail_on_warn:
        return 1
    return 0


def cmd_check_inverses(args: argparse.Namespace) -> int:
    repo = _repo_root(args.repo)
    _maybe_load_env_file(getattr(args, "env_file", None), repo_root=repo)
    layers, _meta = resolve_layers(
        repo,
        profile=args.profile,
        resolve_refs=args.resolve_refs,
        workspace_root=args.workspace_root,
        workspace_ref_mode=args.workspace_ref_mode,
        only=args.only,
        layer=args.layer,
    )
    layers = _filter_layers(layers, only=args.only, layer=args.layer)
    _concepts, relations = collect_docs(layers)
    findings = check_inverses(relations, fix=args.fix)
    if args.json:
        console.print_json(json.dumps({"findings": _findings_to_json(findings)}))
    else:
        if not findings:
            console.print("[green]rocs check-inverses: OK[/green]")
        else:
            console.print("[yellow]rocs check-inverses[/yellow]")
            _print_findings(findings)
    if any(f.severity == "error" for f in findings):
        return 1
    return 0


def cmd_graph(args: argparse.Namespace) -> int:
    repo = _repo_root(args.repo)
    _maybe_load_env_file(getattr(args, "env_file", None), repo_root=repo)
    layers, _meta = resolve_layers(
        repo,
        profile=args.profile,
        resolve_refs=args.resolve_refs,
        workspace_root=args.workspace_root,
        workspace_ref_mode=args.workspace_ref_mode,
        only=args.only,
        layer=args.layer,
    )
    layers = _filter_layers(layers, only=args.only, layer=args.layer)
    concepts, _relations = collect_docs(layers)
    rel_filter: set[str] | None = None
    if args.scope == "taxonomy":
        rel_filter = {"is_a"}
    if args.relation:
        rel_filter = {args.relation}
    edges = build_edges(concepts, rel_filter=rel_filter)
    nodes = sorted(concepts.keys())
    if args.collapse_prefix:
        nodes, edges = collapse_nodes(nodes, edges, prefixes=args.collapse_prefix.split(","))
    layout = compute_layout(nodes, edges, layout=args.layout)
    if args.out:
        out = Path(args.out)
    else:
        if args.json:
            out = dist_dir(repo) / "graph.json"
        elif args.format == "dot":
            out = dist_dir(repo) / "graph.dot"
        elif args.format == "excalidraw-cli-json":
            out = dist_dir(repo) / "graph.excalidraw-cli.json"
        else:
            out = dist_dir(repo) / "graph.excalidraw.json"
    direction = "LR" if args.layout == "dag" else "TB"
    fmt = "json" if args.json else args.format
    write_graph(out, fmt=fmt, nodes=nodes, edges=edges, layout=layout, direction=direction)
    if args.json:
        console.print_json(json.dumps({"ok": True, "out": str(out), "format": fmt}))
    else:
        console.print(f"[green]wrote[/green] {out}")
    return 0


def cmd_cache(args: argparse.Namespace) -> int:
    if args.subcmd == "dir":
        console.print(str(cache_dir()))
        return 0
    if args.subcmd == "ls":
        entries = list_cache_entries()
        for e in entries:
            console.print(f"{e.bytes:>12}  {e.path}")
        return 0
    if args.subcmd == "clear":
        clear_cache()
        console.print("[green]cache cleared[/green]")
        return 0
    if args.subcmd == "prune":
        removed = prune_cache(max_age_days=int(args.max_age_days))
        console.print(f"[green]pruned[/green] {removed}")
        return 0
    raise SystemExit(f"unknown cache subcmd: {args.subcmd}")


def cmd_vendored_check(args: argparse.Namespace) -> int:
    vendored_dir = Path(args.vendored_dir).resolve()
    ok, lines = verify_vendored_hashes(vendored_dir)
    if ok:
        console.print("[green]vendored-check: OK[/green]")
        return 0
    console.print("[red]vendored-check: FAIL[/red]")
    for ln in lines[:200]:
        console.print(f"- {ln}")
    if len(lines) > 200:
        console.print(f"... ({len(lines) - 200} more)")
    return 1


def cmd_normalize(args: argparse.Namespace) -> int:
    repo = _repo_root(args.repo)
    _maybe_load_env_file(getattr(args, "env_file", None), repo_root=repo)
    layers, _meta = resolve_layers(
        repo,
        profile=args.profile,
        resolve_refs=args.resolve_refs,
        workspace_root=args.workspace_root,
        workspace_ref_mode=args.workspace_ref_mode,
        only="path",
        layer=args.layer,
    )
    # normalize never touches ref layers
    layers = _filter_layers(layers, only="path", layer=args.layer)
    changed_paths: list[str] = []
    for layer_spec in layers:
        for c in normalize_tree(layer_spec.src_root, apply=args.apply):
            if c.changed:
                changed_paths.append(str(c.path))

    if changed_paths and not args.apply:
        console.print("[yellow]rocs normalize: changes needed (rerun with --apply)[/yellow]")
        for p in changed_paths[:50]:
            console.print(f"- {p}")
        if len(changed_paths) > 50:
            console.print(f"... ({len(changed_paths) - 50} more)")
        return 2

    if changed_paths and args.apply:
        console.print(f"[green]rocs normalize: applied[/green] ({len(changed_paths)} files)")
    else:
        console.print("[green]rocs normalize: OK[/green]")
    return 0


def _diff_sets(a: set[str], b: set[str]) -> tuple[list[str], list[str]]:
    removed = sorted(a - b)
    added = sorted(b - a)
    return removed, added


def cmd_diff(args: argparse.Namespace) -> int:
    repo = _repo_root(args.repo)
    _maybe_load_env_file(getattr(args, "env_file", None), repo_root=repo)
    baseline = args.baseline.strip()
    if not args.resolve_refs:
        raise SystemExit("rocs diff requires --resolve-refs to fetch a <gitlab:...@...> baseline (offline-first default)")
    parsed = parse_gitlab_ref(baseline)
    if parsed is None:
        raise SystemExit("--baseline must be a <gitlab:...@...> locator for now")
    # Treat baseline as repo archive root; then diff its resolved view against current.
    from rocs_cli.gitlab import fetch_repo_archive, gitlab_base_url, gitlab_headers

    project_path, ref = parsed
    base_repo = fetch_repo_archive(project_path, ref, base_url=gitlab_base_url(), headers=gitlab_headers())

    cur_layers, cur_meta = resolve_layers(
        repo,
        profile=args.profile,
        resolve_refs=args.resolve_refs,
        workspace_root=args.workspace_root,
        workspace_ref_mode=args.workspace_ref_mode,
        only=args.only,
        layer=args.layer,
    )
    base_layers, base_meta = resolve_layers(
        base_repo,
        profile=args.profile,
        resolve_refs=args.resolve_refs,
        workspace_root=args.workspace_root,
        workspace_ref_mode=args.workspace_ref_mode,
        only=args.only,
        layer=args.layer,
    )
    cur_layers = _filter_layers(cur_layers, only=args.only, layer=args.layer)
    base_layers = _filter_layers(base_layers, only=args.only, layer=args.layer)

    cur_concepts, cur_relations = collect_docs(cur_layers)
    base_concepts, base_relations = collect_docs(base_layers)

    cur_edges = {f"{e.src}|{e.rel}|{e.dst}" for e in build_edges(cur_concepts, rel_filter=None)}
    base_edges = {f"{e.src}|{e.rel}|{e.dst}" for e in build_edges(base_concepts, rel_filter=None)}

    removed_concepts, added_concepts = _diff_sets(set(base_concepts.keys()), set(cur_concepts.keys()))
    removed_relations, added_relations = _diff_sets(set(base_relations.keys()), set(cur_relations.keys()))
    removed_edges, added_edges = _diff_sets(base_edges, cur_edges)

    breaking = {
        "removed_concepts": removed_concepts,
        "removed_relations": removed_relations,
        "removed_edges": removed_edges,
    }

    payload = {
        "schema_version": 1,
        "version": __version__,
        "repo": str(repo),
        "profile": cur_meta.get("profile") if isinstance(cur_meta, dict) and isinstance(cur_meta.get("profile"), str) else None,
        "baseline": baseline,
        "baseline_repo": str(base_repo),
        "diff": {
            "concepts": {"removed": removed_concepts, "added": added_concepts},
            "relations": {"removed": removed_relations, "added": added_relations},
            "edges": {"removed": removed_edges, "added": added_edges},
        },
        "breaking": breaking,
    }

    dist = dist_dir(repo)
    dist.mkdir(parents=True, exist_ok=True)
    out = dist / "diff.json"
    out.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", "utf-8")

    if args.json:
        console.print_json(json.dumps(payload))
        return 0 if not (removed_concepts or removed_relations or removed_edges) else 2

    console.print(f"baseline: {baseline}")
    console.print(f"profile: {payload['profile']}")
    console.print(f"wrote: {out}")
    console.print(f"concepts: -{len(removed_concepts)} +{len(added_concepts)}")
    console.print(f"relations: -{len(removed_relations)} +{len(added_relations)}")
    console.print(f"edges: -{len(removed_edges)} +{len(added_edges)}")
    if removed_concepts or removed_relations or removed_edges:
        console.print("[yellow]breaking removals detected[/yellow]")
        return 2
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="rocs")
    parser.add_argument("--version", action="version", version=f"rocs-cli {__version__}")
    parser.add_argument("--debug", action="store_true", help="show full tracebacks on error")
    parser.add_argument("--no-index-cache", action="store_true", help="disable incremental doc/index cache (debugging)")
    parser.add_argument("--index-cache-debug", action="store_true", help="emit index-cache hit/miss stats to stderr")

    p_resolve_common = argparse.ArgumentParser(add_help=False)
    p_resolve_common.add_argument(
        "--workspace-root",
        help="workspace root used to satisfy <gitlab:...@ref> from local clones (or ROCS_WORKSPACE_ROOT)",
    )
    p_resolve_common.add_argument(
        "--workspace-ref-mode",
        choices=["strict", "loose"],
        help="workspace ref mode for local clones: strict requires HEAD matches requested ref (or ROCS_WORKSPACE_REF_MODE)",
    )
    p_resolve_common.add_argument(
        "--show-resolve-sources",
        action="store_true",
        help="show workspace/cache/gitlab source per layer in text output",
    )
    p_resolve_common.add_argument(
        "--show-resolve-details",
        action="store_true",
        help="show workspace skip reasons (and include per-layer details in JSON output)",
    )

    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("version")
    p.set_defaults(fn=cmd_version)

    p = sub.add_parser("rules")
    p.add_argument("--json", action="store_true", help="emit JSON output")
    p.set_defaults(fn=cmd_rules)

    p = sub.add_parser("explain")
    p.add_argument("rule_id")
    p.add_argument("--json", action="store_true", help="emit JSON output")
    p.set_defaults(fn=cmd_explain)

    p = sub.add_parser("resolve", parents=[p_resolve_common])
    p.add_argument("--repo", default=".", help="repo root path")
    p.add_argument("--profile", help="manifest profile name (defaults to rocs.profiles.default)")
    p.add_argument("--resolve-refs", action="store_true", help="allow fetching <gitlab:...> layers into cache")
    p.add_argument("--env-file", help="dotenv file to load into environment (for GitLab base url/token)")
    p.add_argument("--only", help="filter layers: path|ref")
    p.add_argument("--layer", help="filter a specific layer name")
    p.add_argument("--json", action="store_true", help="emit JSON output")
    p.add_argument("--write-dist", action="store_true", help="write ontology/dist/resolve.json")
    p.set_defaults(fn=cmd_resolve)

    p = sub.add_parser("summary", parents=[p_resolve_common])
    p.add_argument("--repo", default=".", help="repo root path")
    p.add_argument("--profile", help="manifest profile name (defaults to rocs.profiles.default)")
    p.add_argument("--resolve-refs", action="store_true", help="allow fetching <gitlab:...> layers into cache")
    p.add_argument("--env-file", help="dotenv file to load into environment (for GitLab base url/token)")
    p.add_argument("--only", help="filter layers: path|ref")
    p.add_argument("--layer", help="filter a specific layer name")
    p.add_argument("--json", action="store_true", help="emit JSON output")
    p.set_defaults(fn=cmd_summary)

    p = sub.add_parser("validate", parents=[p_resolve_common])
    p.add_argument("--repo", default=".", help="repo root path")
    p.add_argument("--strict-placeholders", action="store_true", help="fail if any <...> placeholders exist")
    p.add_argument("--ruleset", choices=["dev", "strict"], help="ruleset defaults (or rocs.profiles.<name>.ruleset)")
    p.add_argument("--profile", help="manifest profile name (defaults to rocs.profiles.default)")
    p.add_argument("--resolve-refs", action="store_true", help="allow fetching <gitlab:...> layers into cache")
    p.add_argument("--env-file", help="dotenv file to load into environment (for GitLab base url/token)")
    p.add_argument("--only", help="filter layers: path|ref")
    p.add_argument("--layer", help="filter a specific layer name")
    p.add_argument(
        "--validate-deps",
        action="store_true",
        help="also enforce strict schema rules on dependency layers (ref layers); default: validate path layers only",
    )
    p.add_argument("--json", action="store_true", help="emit JSON result")
    p.set_defaults(fn=cmd_validate)

    p = sub.add_parser("diff", parents=[p_resolve_common])
    p.add_argument("--repo", default=".", help="repo root path")
    p.add_argument("--baseline", required=True, help="baseline <gitlab:...@ref> to diff against")
    p.add_argument("--profile", help="manifest profile name (defaults to rocs.profiles.default)")
    p.add_argument("--resolve-refs", action="store_true", help="allow fetching <gitlab:...> layers into cache")
    p.add_argument("--env-file", help="dotenv file to load into environment (for GitLab base url/token)")
    p.add_argument("--only", help="filter layers: path|ref")
    p.add_argument("--layer", help="filter a specific layer name")
    p.add_argument("--json", action="store_true", help="emit JSON diff")
    p.set_defaults(fn=cmd_diff)

    p = sub.add_parser("lint", parents=[p_resolve_common])
    p.add_argument("--repo", default=".", help="repo root path")
    p.add_argument("--profile", help="manifest profile name (defaults to rocs.profiles.default)")
    p.add_argument("--resolve-refs", action="store_true", help="allow fetching <gitlab:...> layers into cache")
    p.add_argument("--env-file", help="dotenv file to load into environment (for GitLab base url/token)")
    p.add_argument("--only", help="filter layers: path|ref")
    p.add_argument("--layer", help="filter a specific layer name")
    p.add_argument("--strict-placeholders", action="store_true", help="treat placeholders in bodies as lint warnings")
    p.add_argument("--rules", default="all", help="comma-separated rule ids (or 'all')")
    p.add_argument("--json", action="store_true", help="emit JSON result")
    p.add_argument("--fail-on-warn", action="store_true", help="exit non-zero if warnings exist")
    p.add_argument("--ruleset", choices=["dev", "strict"], help="ruleset defaults (or rocs.profiles.<name>.ruleset)")
    p.set_defaults(fn=cmd_lint)

    p = sub.add_parser("check-inverses", parents=[p_resolve_common])
    p.add_argument("--repo", default=".", help="repo root path")
    p.add_argument("--profile", help="manifest profile name (defaults to rocs.profiles.default)")
    p.add_argument("--resolve-refs", action="store_true", help="allow fetching <gitlab:...> layers into cache")
    p.add_argument("--env-file", help="dotenv file to load into environment (for GitLab base url/token)")
    p.add_argument("--only", help="filter layers: path|ref")
    p.add_argument("--layer", help="filter a specific layer name")
    p.add_argument("--fix", action="store_true", help="apply safe fixes to local/path layer relation docs")
    p.add_argument("--json", action="store_true", help="emit JSON result")
    p.set_defaults(fn=cmd_check_inverses)

    p = sub.add_parser("graph", parents=[p_resolve_common])
    p.add_argument("--repo", default=".", help="repo root path")
    p.add_argument("--profile", help="manifest profile name (defaults to rocs.profiles.default)")
    p.add_argument("--resolve-refs", action="store_true", help="allow fetching <gitlab:...> layers into cache")
    p.add_argument("--env-file", help="dotenv file to load into environment (for GitLab base url/token)")
    p.add_argument("--only", help="filter layers: path|ref")
    p.add_argument("--layer", help="filter a specific layer name")
    p.add_argument("--scope", choices=["all", "taxonomy"], default="all")
    p.add_argument("--relation", help="only include this relation label (e.g. is_a)")
    p.add_argument("--collapse-prefix", help="comma-separated prefixes to collapse (e.g. co.software)")
    p.add_argument("--layout", choices=["grid", "dag"], default="grid")
    p.add_argument("--format", choices=["excalidraw", "excalidraw-cli-json", "dot"], default="excalidraw")
    p.add_argument("--json", action="store_true", help="emit JSON output (writes graph.json by default)")
    p.add_argument("--out", help="output path (default: ontology/dist/graph.<fmt>.*)")
    p.set_defaults(fn=cmd_graph)

    p = sub.add_parser("build", parents=[p_resolve_common])
    p.add_argument("--repo", default=".", help="repo root path")
    p.add_argument("--profile", help="manifest profile name (defaults to rocs.profiles.default)")
    p.add_argument("--resolve-refs", action="store_true", help="allow fetching <gitlab:...> layers into cache")
    p.add_argument("--env-file", help="dotenv file to load into environment (for GitLab base url/token)")
    p.add_argument("--only", help="filter layers: path|ref")
    p.add_argument("--layer", help="filter a specific layer name")
    p.add_argument("--clean", action="store_true", help="remove ontology/dist before building")
    p.add_argument("--json", action="store_true", help="emit JSON output")
    p.set_defaults(fn=cmd_build)

    p = sub.add_parser("pack", parents=[p_resolve_common])
    p.add_argument("ont_id")
    p.add_argument("--repo", default=".", help="repo root path")
    p.add_argument("--profile", help="manifest profile name (defaults to rocs.profiles.default)")
    p.add_argument("--resolve-refs", action="store_true", help="allow fetching <gitlab:...> layers into cache")
    p.add_argument("--env-file", help="dotenv file to load into environment (for GitLab base url/token)")
    p.add_argument("--only", help="filter layers: path|ref")
    p.add_argument("--layer", help="filter a specific layer name")
    p.add_argument("--depth", type=int, help="relation expansion depth (default: profile pack.max_depth or 0)")
    p.add_argument("--rel-types", help="comma-separated relation labels to follow (default: profile pack.rel_types or all)")
    p.add_argument("--include-relation-defs", action="store_true", help="include relation definition docs used")
    p.add_argument("--max-docs", type=int, help="max docs in pack (default: profile pack.max_docs)")
    p.add_argument("--max-bytes", type=int, help="max UTF-8 bytes in pack (default: profile pack.max_bytes)")
    p.add_argument("--json", action="store_true", help="emit JSON output")
    p.set_defaults(fn=cmd_pack)

    p = sub.add_parser("vendored-check")
    p.add_argument("--vendored-dir", required=True, help="path to vendored rocs-cli dir (contains VENDORED_HASHES.json)")
    p.set_defaults(fn=cmd_vendored_check)

    p = sub.add_parser("cache")
    sub2 = p.add_subparsers(dest="subcmd", required=True)
    p2 = sub2.add_parser("dir")
    p2.set_defaults(fn=cmd_cache)
    p2 = sub2.add_parser("ls")
    p2.set_defaults(fn=cmd_cache)
    p2 = sub2.add_parser("clear")
    p2.set_defaults(fn=cmd_cache)
    p2 = sub2.add_parser("prune")
    p2.add_argument("--max-age-days", default="30")
    p2.set_defaults(fn=cmd_cache)

    p = sub.add_parser("normalize", parents=[p_resolve_common])
    p.add_argument("--repo", default=".", help="repo root path")
    p.add_argument("--profile", help="manifest profile name (defaults to rocs.profiles.default)")
    p.add_argument("--resolve-refs", action="store_true", help="allow fetching <gitlab:...> layers into cache")
    p.add_argument("--env-file", help="dotenv file to load into environment (for GitLab base url/token)")
    p.add_argument("--layer", help="only normalize a specific layer name (path layers only)")
    p.add_argument("--apply", action="store_true", help="apply changes (default: check only)")
    p.set_defaults(fn=cmd_normalize)

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    debug = bool(getattr(args, "debug", False))
    if bool(getattr(args, "no_index_cache", False)):
        os.environ["ROCS_INDEX_CACHE"] = "0"
    if bool(getattr(args, "index_cache_debug", False)):
        os.environ["ROCS_INDEX_CACHE_DEBUG"] = "1"

    def _wants_json() -> bool:
        return bool(getattr(args, "json", False))

    def _emit_error(kind: str, message: str, *, details: dict | None = None) -> None:
        if _wants_json():
            payload: dict = {"ok": False, "error": {"kind": kind, "message": message}}
            if details:
                payload["error"]["details"] = details
            console.print_json(json.dumps(payload))
        else:
            console.print(f"[red]error[/red]: {message}")

    try:
        code = int(args.fn(args))
    except RocsCliError as e:
        if debug:
            raise
        _emit_error(e.kind, e.message, details=e.details)
        raise SystemExit(int(e.exit_code)) from None
    except SystemExit as e:
        if debug:
            raise
        # Normalize our "raise SystemExit('message')" cases into clean CLI output.
        if isinstance(e.code, str) and e.code.strip():
            _emit_error("error", e.code)
            raise SystemExit(1) from None
        raise
    except Exception as e:  # noqa: BLE001
        if debug:
            raise
        _emit_error("internal", str(e))
        raise SystemExit(1) from None
    raise SystemExit(code)
