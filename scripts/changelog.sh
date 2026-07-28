#!/bin/bash
#
# Reads and updates CHANGELOG.md, which follows Keep a Changelog: a cumulative
# file with an `## [Unreleased]` section on top that accumulates entries as work
# lands, followed by `## [X.Y.Z] - DATE` sections newest-first.
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
        section unreleased
        ;;

    latest)
        if [ "${2:-}" = "--plain" ]; then
            section latest | plain
        else
            section latest
        fi
        ;;

    release)
        version="${2:-}"
        if [ -z "$version" ]; then
            echo "Usage: $0 release X.Y.Z" >&2
            exit 1
        fi
        if [ -z "$(section unreleased)" ]; then
            echo "Nothing under [Unreleased] in $CHANGELOG — nothing to release." >&2
            exit 1
        fi

        # Retitle [Unreleased] as the new version and open an empty one above it.
        # The accumulated entries stay put and fall under the new version header.
        tmp=$(mktemp)
        awk -v v="$version" -v d="$(date +%Y-%m-%d)" '
            !stamped && /^## \[Unreleased\]/ {
                print "## [Unreleased]"
                print ""
                print "## [" v "] - " d
                stamped = 1
                next
            }
            { print }
        ' "$CHANGELOG" > "$tmp"
        mv "$tmp" "$CHANGELOG"
        ;;

    *)
        sed -n '/^# Usage:/,/^#$/p' "$0" | sed 's/^# \{0,1\}//' >&2
        exit 1
        ;;
esac
