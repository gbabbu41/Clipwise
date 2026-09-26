# ClipWise project guidance

Read `CLAUDE.md` for the shared project context and engineering constraints.
For UI work, read `DESIGN.md` first; its design system overrides generic skill
advice. Check `package.json` and the lockfile before applying framework examples.
The app currently uses Next.js 14 and React 18: skip newer APIs such as `after()`,
`Activity`, and `useEffectEvent`. Do not upgrade frameworks or add dependencies
just to follow a skill. Preserve existing architecture and the requested scope.

The four `.agents/skills/*/SKILL.md` entrypoints make the existing design skills
discoverable by Codex. Their maintained content remains in `.claude/skills/`;
resolve that content's relative references from its original directory. Read only
the skills and references relevant to the task. These entrypoints use ordinary
files so Git checkouts work on Windows without symlink support.

Start Codex in this repository (`verification`) or one of its subdirectories.
A chat rooted in its parent `clipwise` directory needs its own `.agents/skills`
entrypoints pointing into this repository; Codex does not scan child repositories
automatically. Local parent entrypoints are not shipped by this repository.
Open a new chat in the repository if the skills do not appear after pulling.
