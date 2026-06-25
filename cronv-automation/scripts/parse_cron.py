#!/usr/bin/env python3
"""Parse openshift/release periodics YAML into cronv-compatible crontab format.

Reads a generated Prow periodics YAML file and outputs
a crontab-format file grouped by OCP version, suitable for piping into cronv.
Optionally writes structured JSON for the web visualization.

Usage:
    python3 parse_cron.py /path/to/synced/release/repo > crontab.txt
    python3 parse_cron.py /path/to/repo --json-output crontab.json > crontab.txt
"""

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

try:
    import yaml
except ImportError:
    print("ERROR: PyYAML is required. Install with: pip install pyyaml", file=sys.stderr)
    sys.exit(1)

PERIODICS_RELPATH = (
    "ci-operator/jobs/openshift-eng/ocp-qe-perfscale-ci/"
    "openshift-eng-ocp-qe-perfscale-ci-main-periodics.yaml"
)

NAME_PREFIX = "periodic-ci-openshift-eng-ocp-qe-perfscale-ci-main-"


def extract_version(job):
    """Extract OCP version from the job-release label, falling back to name parsing."""
    labels = job.get("labels", {})
    if labels and "job-release" in labels:
        return labels["job-release"]

    variant = (labels or {}).get("ci-operator.openshift.io/variant", "")
    if variant:
        for part in variant.split("-"):
            if part and part[0].isdigit() and "." in part:
                return part

    name = job.get("name", "")
    stripped = name.replace(NAME_PREFIX, "")
    for part in stripped.split("-"):
        if part and part[0].isdigit() and "." in part:
            return part
    return "other"


def shorten_name(name):
    """Strip the common Prow job name prefix for readability."""
    if name.startswith(NAME_PREFIX):
        return name[len(NAME_PREFIX):]
    return name


def version_sort_key(version):
    """Sort version strings numerically (e.g., '4.22' -> (4, 22), '5.0' -> (5, 0))."""
    try:
        parts = version.split(".")
        return tuple(int(p) for p in parts)
    except (ValueError, AttributeError):
        return (0, 0)


def main():
    parser = argparse.ArgumentParser(
        description="Parse Prow periodics YAML into crontab format"
    )
    parser.add_argument("repo_root", help="Path to the synced openshift/release repo root")
    parser.add_argument(
        "--json-output",
        help="Write structured JSON to this file path (for the web UI)",
    )
    args = parser.parse_args()

    yaml_path = os.path.join(args.repo_root, PERIODICS_RELPATH)

    if not os.path.isfile(yaml_path):
        print(f"ERROR: Periodics file not found: {yaml_path}", file=sys.stderr)
        sys.exit(1)

    with open(yaml_path, "r") as f:
        data = yaml.safe_load(f)

    if not data or "periodics" not in data:
        print("ERROR: No 'periodics' key found in YAML", file=sys.stderr)
        sys.exit(1)

    jobs_by_version = defaultdict(list)
    all_jobs = []

    for job in data["periodics"]:
        cron = job.get("cron")
        name = job.get("name", "")

        if not cron:
            continue

        version = extract_version(job)
        short_name = shorten_name(name)
        jobs_by_version[version].append((cron, short_name))
        all_jobs.append({
            "name": name,
            "short_name": short_name,
            "cron": cron,
            "version": version,
        })

    if not jobs_by_version:
        print("WARNING: No cron jobs found in periodics file", file=sys.stderr)
        sys.exit(0)

    total = 0
    sorted_versions = sorted(jobs_by_version.keys(), key=version_sort_key, reverse=True)

    for version in sorted_versions:
        jobs = sorted(jobs_by_version[version], key=lambda j: j[1])
        label = f"OCP {version}" if version != "other" else "Other"
        print(f"\n# {label} Jobs")
        for cron_expr, job_name in jobs:
            print(f"{cron_expr} {job_name}")
            total += 1

    print(f"\nParsed {total} cron jobs", file=sys.stderr)

    if args.json_output:
        sorted_jobs = []
        for version in sorted_versions:
            version_jobs = sorted(
                [j for j in all_jobs if j["version"] == version],
                key=lambda j: j["short_name"],
            )
            sorted_jobs.extend(version_jobs)

        json_data = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total_jobs": total,
            "versions": sorted_versions,
            "jobs": sorted_jobs,
        }

        os.makedirs(os.path.dirname(os.path.abspath(args.json_output)), exist_ok=True)
        with open(args.json_output, "w") as f:
            json.dump(json_data, f, indent=2)

        print(f"JSON written to {args.json_output}", file=sys.stderr)


if __name__ == "__main__":
    main()
