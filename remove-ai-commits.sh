#!/usr/bin/env bash
#
# remove-ai-commits.sh
#
# Rewrites git history so that AI agents no longer appear as contributors,
# then force-pushes the cleaned history to GitHub.
#
# It does this for each repo it is given:
#   1. Clones a full mirror of the repo
#   2. Rewrites every commit so that AI/placeholder authors become YOU
#      (arena-ai-coding-agent[bot], arena-agent, "Student <student@university>")
#   3. Strips AI "Co-authored-by:" trailers (arena, copilot, openai, claude, gpt, bots)
#   4. Deletes the leftover "arena/*" branches and PR refs
#   5. Force-pushes the clean main branch (and tags) and removes the arena branches
#
# WARNING: This rewrites history and force-pushes. It changes every commit SHA.
# Anyone else who cloned these repos must re-clone. Only run on repos you own.
#
# Usage:
#   ./remove-ai-commits.sh <owner>/<repo> [<owner>/<repo> ...]
#
# Example:
#   ./remove-ai-commits.sh yathamsridharreddy/Cloud-Compare-ai_main \
#                          yathamsridharreddy/Unknown-Repo \
#                          yathamsridharreddy/CLOUD-COMPARE-AI
#
# Set these to whatever you want your commits to be re-authored as:
# (Use the email that is linked to your GitHub account.)
export USER_NAME="${USER_NAME:-yathamsridharreddy}"
export USER_EMAIL="${USER_EMAIL:-147792360+yathamsridharreddy@users.noreply.github.com}"
# Set DRY_RUN=1 to only rewrite locally and NOT push.
export DRY_RUN="${DRY_RUN:-0}"

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 owner/repo [owner/repo ...]" >&2
  exit 1
fi

CB_FILE="$(mktemp)"
cat > "$CB_FILE" <<EOF
USER_NAME = b"${USER_NAME}"
USER_EMAIL = b"${USER_EMAIL}"

def _memail(e):
    return {
        b"298482267+arena-ai-coding-agent[bot]@users.noreply.github.com": USER_EMAIL,
        b"297053741+arena-agent@users.noreply.github.com": USER_EMAIL,
        b"student@university": USER_EMAIL,
    }.get(e, e)

def _mname(n):
    return USER_NAME if n.lower() in (b"arena-ai-coding-agent[bot]", b"arena-agent", b"student") else n

commit.author_email = _memail(commit.author_email)
commit.committer_email = _memail(commit.committer_email)
commit.author_name = _mname(commit.author_name)
commit.committer_name = _mname(commit.committer_name)

lines = commit.message.split(b"\n")
keep = []
for l in lines:
    low = l.lower().lstrip()
    if low.startswith(b"co-authored-by:") and any(t in low for t in (b"arena", b"copilot", b"[bot]", b"openai", b"claude", b"gpt")):
        continue
    keep.append(l)
commit.message = b"\n".join(keep)
EOF

for spec in "$@"; do
  echo ""
  echo "######################## $spec ########################"
  repo_dir="$(mktemp -d)/$(basename "$spec")"
  if ! git clone --mirror "https://github.com/$spec.git" "$repo_dir" 2>&1; then
    echo "!! Could not clone $spec. Skipping." >&2
    continue
  fi
  cd "$repo_dir" || continue

  echo "--> Rewriting history (this can take a while)..."
  git filter-repo --force --commit-callback "$CB_FILE" 2>&1 | tail -2

  echo "--> Deleting leftover arena/* and pull refs..."
  git for-each-ref --format='%(refname)' refs/heads/arena refs/pull 2>/dev/null \
    | while read -r r; do git update-ref -d "$r"; done

  echo "--> Authors in cleaned history:"
  git log --all --pretty='%an <%ae>' | sort | uniq -c

  if [ "$DRY_RUN" != "1" ]; then
    echo "--> Pushing cleaned history..."
    # filter-repo removes the origin remote; re-add it
    git remote add origin "https://github.com/$spec.git"
    # Reset mirror config off so normal refspec push works
    git config remote.origin.mirror false
    git push --force origin --tags "refs/heads/main:refs/heads/main" 2>&1
    # Delete remote arena branches (best-effort)
    git for-each-ref --format='%(refname)' refs/remotes/origin/arena 2>/dev/null \
      | while read -r r; do git push origin ":$r" 2>/dev/null; done
    echo "--> Done with $spec"
  else
    echo "--> DRY_RUN: not pushing $spec. Clean history is ready in $repo_dir"
  fi
done

rm -f "$CB_FILE"
echo ""
echo "All done. Verify each repo's Contributors page (Insights > Contributors) —"
echo "the AI agents should no longer appear."
