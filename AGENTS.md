# AGENTS.md

This repository uses an approval-first workflow.

## Core Rules
- Do not make any filesystem, local-state, or remote side-effecting change until the user explicitly approves the proposed change after seeing a unified diff.
- For any requested change, inspect the relevant files first and then present a unified diff covering every intended edit.
- After presenting the diff, stop and wait for explicit user approval before calling `apply_patch`, creating files, deleting files, renaming files, formatting files, generating files, committing, or using any other write mechanism.
- Do not infer approval from the original task request, from prior approvals, or from the user asking for an outcome. Approval must be explicit after the diff is shown.

## Allowed Before Approval
- Read files
- Search the codebase
- Inspect config
- Propose changes in diff form
- Explain the impact of the proposed edits

## Not Allowed Before Approval
- Applying patches
- Writing, rewriting, creating, deleting, renaming, moving, or formatting files
- Running commands or tools that mutate tracked files, untracked files, generated files, or remote state
- Making "small", "safe", "mechanical", or "obvious" edits without approval
- Creating commits, branches, tags, pull requests, comments, or any other remote update

## Diff Requirements
- The proposed unified diff must include every file intended to change.
- If a change would create, delete, rename, move, or generate a file, the diff or accompanying explanation must say so explicitly.
- If a true unified diff is not meaningful for a proposed change, provide an exact file-level change summary instead and still wait for explicit approval before making any change.
- Do not apply partial diffs while planning to make additional unapproved edits afterward.

## Approval Standard
- The user must explicitly confirm that the proposed diff should be applied.
- Approval applies only to the exact diff shown.
- If there is any ambiguity, ask instead of writing.

## If A Diff Is Rejected
- If the user rejects the proposed diff, do not apply any part of it.
- Treat the rejection as applying to the entire diff unless the user explicitly approves a specific subset or clearly indicates that only certain parts should change.
- A rejected diff does not always require starting over from scratch; when the user's feedback clearly preserves part of the proposal and requests only limited adjustments, retain the unchanged portions, revise only the affected parts, and present a new exact unified diff for approval.
- If the user requests changes, produce a new unified diff and wait for explicit approval again.
- Do not treat feedback on a rejected diff as approval to implement revisions.
- If the rejection indicates misunderstanding, restate the intended change briefly before proposing a new diff.

## After Approval
- Apply only the approved diff.
- If implementation requires any additional change or deviation from the approved diff, stop and request approval again.

## Interpretation Rules
- Treat any command or tool that could write as a write, even if the write is indirect, automatic, generated, cached, or described as metadata.
- Treat edits to untracked files the same as edits to tracked files.
- Treat filesystem, local-state, and remote side effects the same as local writes.
- When in doubt, do not write; ask.
