#!/bin/bash
set -e

UPSTREAM_URL="https://github.com/earendil-works/pi.git"
UPSTREAM_REMOTE="upstream"

# Check if upstream remote exists, if not add it
if ! git remote | grep -q "^${UPSTREAM_REMOTE}$"; then
	echo "Adding upstream remote: ${UPSTREAM_URL}..."
	git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
else
	# Ensure the URL is correct
	git remote set-url "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
fi

echo "Fetching latest changes from upstream..."
git fetch "$UPSTREAM_REMOTE"

CURRENT_BRANCH=$(git branch --show-current)
echo "Merging upstream/main into current branch: ${CURRENT_BRANCH}..."
if git merge "$UPSTREAM_REMOTE/main"; then
	echo "Merge completed successfully."
else
	echo "Merge encountered conflicts. Please resolve conflicts, stage the changes, and commit."
	exit 1
fi

echo "Installing/updating dependencies..."
npm install --ignore-scripts

echo "Sync complete."
