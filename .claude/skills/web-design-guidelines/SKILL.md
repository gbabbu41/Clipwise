---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
  pinned: "vercel-labs/web-interface-guidelines@e3d624b — vendored locally, see below"
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Read the guidelines from `references/guidelines.md` in this skill's folder
2. Read the specified files (or prompt user for files/pattern)
3. Check against all rules in those guidelines
4. Output findings in the terse `file:line` format

## Guidelines Source

The rules are **vendored** in `references/guidelines.md`, pinned to
`vercel-labs/web-interface-guidelines` at commit `e3d624b`.

Do **not** fetch the rules from the network. The upstream skill tells the agent to
WebFetch `main` before every review and follow whatever it returns — that makes a
remote file a live source of instructions. Pinning a reviewed copy removes that path.
To update, a human re-copies `command.md` from upstream and reviews the diff.

## Precedence

`DESIGN.md` at the repo root is ClipWise's own design system and wins over any
general guideline here where the two disagree.

## Usage

When a user provides a file or pattern argument:
1. Read `references/guidelines.md`
2. Read the specified files
3. Apply all rules from the guidelines
4. Output findings using the format specified in the guidelines

If no files specified, ask the user which files to review.
