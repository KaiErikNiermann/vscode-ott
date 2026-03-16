set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

# List recipes
default:
    @just --list

# --- Development ---

# Install dependencies
install:
    pnpm install --frozen-lockfile

# Build the extension
build: install
    pnpm build

# Run lints
lint: install
    pnpm lint

# Run tests
test: install
    pnpm test

# Run all checks
check: lint test build

# Watch for changes and rebuild
watch: install
    pnpm watch

# --- Vendor ---

# --- Local install ---

# Package the VSIX and install it locally
install-local: build
    #!/usr/bin/env bash
    set -euo pipefail
    pnpm package
    vsix=$(ls -t *.vsix | head -1)
    code --install-extension "$vsix" --force
    echo "Installed $vsix"

# --- Versioning & Release ---

# Show current version
version:
    @node -p "require('./package.json').version"

# Bump version, commit, tag, push, create GitHub release
release bump="patch":
    #!/usr/bin/env bash
    set -euo pipefail
    current=$(node -p "require('./package.json').version")
    IFS='.' read -r major minor patch <<< "$current"
    case "{{bump}}" in
        major) major=$((major + 1)); minor=0; patch=0 ;;
        minor) minor=$((minor + 1)); patch=0 ;;
        patch) patch=$((patch + 1)) ;;
        *) echo "Invalid bump type: {{bump}} (use major, minor, or patch)"; exit 1 ;;
    esac
    version="$major.$minor.$patch"
    just _release "$version"

# Release with an explicit version
release-version version:
    @just _release "{{version}}"

# Re-tag HEAD and re-trigger the release workflow for an existing version
rerun version:
    #!/usr/bin/env bash
    set -euo pipefail
    version="{{version}}"
    git push
    git tag -d "v$version" 2>/dev/null || true
    git push --delete origin "v$version" 2>/dev/null || true
    git tag "v$version"
    git push origin "v$version"
    echo "Re-triggered release workflow for v$version"

# Delete and recreate the GitHub release + retag HEAD
rerelease version:
    #!/usr/bin/env bash
    set -euo pipefail
    version="{{version}}"
    gh release delete "v$version" -y 2>/dev/null || true
    just rerun "$version"
    gh release create "v$version" --title "v$version" --generate-notes

# Internal: bump package.json, commit, tag, push, create release
_release version:
    #!/usr/bin/env bash
    set -euo pipefail
    version="{{version}}"
    npm version "$version" --no-git-tag-version --allow-same-version
    cd packages/extension && npm version "$version" --no-git-tag-version --allow-same-version && cd ../..
    git add package.json packages/extension/package.json
    git commit -m "chore(release): v$version"
    git push
    git tag "v$version"
    git push origin "v$version"
    gh release create "v$version" --title "v$version" --generate-notes
    echo "Release v$version created — GitHub Actions will build and publish"

# --- Publishing (dry-run) ---

# Dry-run VSIX packaging (lists files that would be included)
publish-dry: build
    pnpm vsce ls --no-dependencies --allow-unused-files-pattern --allow-missing-repository

# --- Utilities ---

# Wait for the release workflow to finish
wait-release:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Waiting for Release workflow..."
    run_id=$(gh run list --workflow "Release" --limit 1 --json databaseId -q '.[0].databaseId')
    gh run watch "$run_id" --exit-status && \
        echo "Release workflow succeeded" || \
        { echo "Release workflow failed"; exit 1; }

# Clean build artifacts
clean:
    rm -rf dist node_modules *.vsix
