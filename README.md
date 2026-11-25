# Skills

Agent skills: folders with a `SKILL.md` that Claude Code and other agents load on demand.

| Skill | What it does |
|---|---|
| [show-in-comics](skills/show-in-comics) | Turns a large change series (a git range, a branch, a Gerrit chain) into one clickable HTML page for review, zoomed like C4: systems, then containers, then components, with warning marks on risky and irreversible decisions. |
| [write-plan](skills/write-plan) | Writes an execution plan as a living document that an agent or a person can follow from start to finish. |

## Install

Download a skill from the [latest release](https://github.com/TrueNight/skills/releases/latest) and unzip it into your skills folder, `~/.claude/skills/` for Claude Code:

```bash
curl -fsSLO https://github.com/TrueNight/skills/releases/latest/download/show-in-comics.zip
unzip -o show-in-comics.zip -d ~/.claude/skills/
```

Or clone the repository and link the skills you want:

```bash
git clone https://github.com/TrueNight/skills.git
ln -s "$PWD/skills/skills/show-in-comics" ~/.claude/skills/show-in-comics
```

## Requirements

- show-in-comics: bash, git, jq and Node 22.18 or newer (on 23.x, 23.6 or newer). A release zip runs compiled JavaScript; a clone runs the TypeScript directly, with no build step. Screenshots need Chrome or Chromium.
- write-plan: bash.

## Build

Every push and pull request runs [build](.github/workflows/build.yml) on Node 22.18, the current LTS and the current release:
- it lints the shell scripts and type-checks the renderer;
- it renders the example from source and from the compiled build, and the two pages must be identical;
- it validates the plan template.

A `v*` tag publishes a release with one zip per skill.

## License

[MIT](LICENSE).
