#!/bin/bash
#
# Reads and updates CHANGELOG.md, which follows Keep a Changelog: a cumulative
# file with an `## [Unreleased]` section on top that accumulates entries as work
# lands, followed by `## [X.Y.Z] - DATE` sections newest-first.
#
# A fresh `[Unreleased]` is opened with its `### Added` / `### Changed` /
# `### Fixed` headings already in place, even though they are empty. They are
# there to be merge anchors: two branches appending under headings they both
# had to invent land on the same line with the same context and always
# conflict, whereas two branches filling in headings that already exist merge
# cleanly as long as they are different headings. Empty headings are stripped
# back out on the way to any consumer, so nothing downstream ever sees one.
#
# Every consumer of the changelog goes through here so the format is known in
# exactly one place: deploy.sh (PR body, release cut) and release.yml (GitHub
# Release body, Google Play "what's new").
#
# Usage:
#   scripts/changelog.sh unreleased          Print the [Unreleased] body
#   scripts/changelog.sh latest              Print the newest released section's body
#   scripts/changelog.sh latest --plain      Same, rendered as plain text
#   scripts/changelog.sh release X.Y.Z       Stamp [Unreleased] as X.Y.Z, open a fresh one
#
set -euo pipefail

CHANGELOG="${CHANGELOG_FILE:-CHANGELOG.md}"

# Seeded into every fresh [Unreleased], in Keep a Changelog order.
SECTIONS="Added Changed Fixed"

# Print the body of one `## [...]` section, without its header.
# want=unreleased -> the [Unreleased] section; want=latest -> the first released one.
section() {
    local want="$1"
    awk -v want="$want" '
        /^## \[/ {
            if (capturing) exit
            is_unreleased = ($0 ~ /^## \[Unreleased\]/)
            if ((want == "unreleased") == is_unreleased) capturing = 1
            next
        }
        capturing { print }
    ' "$CHANGELOG" | trim
}

# Drop any `### X` heading with no `* ` bullet under it. The seeded headings
# exist for git's benefit, not the reader's — callers asking "is there anything
# to release?" must not see three empty headings and answer yes.
drop_empty_sections() {
    awk '
        function flush() {
            if (heading != "" && has) {
                print heading
                for (i = 1; i <= n; i++) print buf[i]
            }
        }
        /^### / { flush(); heading = $0; n = 0; has = 0; next }
        heading == "" { print; next }
        { buf[++n] = $0; if ($0 ~ /^\* /) has = 1 }
        END { flush() }
    '
}

# Strip leading and trailing blank lines.
trim() {
    awk 'NF {p = 1} p' | awk '
        { lines[NR] = $0 }
        END {
            last = NR
            while (last > 0 && lines[last] == "") last--
            for (i = 1; i <= last; i++) print lines[i]
        }
    '
}

# Render markdown as plain text for stores: drop heading markers, unify bullets.
plain() {
    sed -e 's/^#\{1,\} *//' -e 's/^\* /• /' | cat -s
}

case "${1:-}" in
    unreleased)
        section unreleased | drop_empty_sections | trim
        ;;

    latest)
        if [ "${2:-}" = "--plain" ]; then
            section latest | drop_empty_sections | trim | plain
        else
            section latest | drop_empty_sections | trim
        fi
        ;;

    release)
        version="${2:-}"
        if [ -z "$version" ]; then
            echo "Usage: $0 release X.Y.Z" >&2
            exit 1
        fi
        body=$(section unreleased | drop_empty_sections | trim)
        if [ -z "$body" ]; then
            echo "Nothing under [Unreleased] in $CHANGELOG — nothing to release." >&2
            exit 1
        fi

        # Retitle [Unreleased] as the new version and open a freshly seeded one
        # above it. The accumulated entries are rewritten rather than left in
        # place so the headings nobody filled in don't ship with the release.
        tmp=$(mktemp)
        {
            echo "## [Unreleased]"
            for s in $SECTIONS; do
                echo ""
                echo "### $s"
            done
            echo ""
            echo "## [$version] - $(date +%Y-%m-%d)"
            echo ""
            echo "$body"
            echo ""
            # Everything from the previous release header down, untouched.
            awk 'seen { print } !seen && /^## \[/ && !/^## \[Unreleased\]/ { seen = 1; print }' "$CHANGELOG"
        } > "$tmp"
        mv "$tmp" "$CHANGELOG"
        ;;

    *)
        sed -n '/^# Usage:/,/^#$/p' "$0" | sed 's/^# \{0,1\}//' >&2
        exit 1
        ;;
esac
