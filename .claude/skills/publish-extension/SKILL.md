---
name: publish-extension
description: Publish a new version of the QR Code Drawdy extension to every user through Drawdy's real marketplace flow - check it against Drawdy's submission rules, bump the version and changelog, push, submit it on drawdy.io/account/extensions as the publisher account, review and approve it on admin.drawdy.io as the admin account, and confirm the new version is live. Use whenever the user wants to publish, release, ship, submit, roll out, "make it live", "push an update to everyone", or asks why users still don't have a change, even if they only say "release it" or "send it out".
---

# Publish the extension

Users get a new version automatically, but only after it goes through
Drawdy's marketplace: a submission pins one pushed commit, Drawdy builds it,
an admin approves it, and approval publishes it straight away. Every
installed copy then updates itself the next time its owner opens Drawdy
(they see an "updated to vX" toast). Pushing to GitHub alone changes nothing
for anyone.

This uses the same web flow every publisher uses, not the `drawdy` CLI, so
that it proves the path people actually take. Two accounts take part on
purpose:

- **Publisher account**: owns `mickyngub.qr-code` on Drawdy and
  has push access to `github.com/mickyngub/qr-code`. It submits.
- **Admin account**: signs in to admin.drawdy.io. It reviews and approves.

Submitting and approving are outward-facing: they publish to every user.
Prepare everything, then ask before each of those two steps and let the user
click them in their own browser (or drive their real Chrome with
`claude-in-chrome` only if they ask). Never approve a submission the user has
not looked at.

## 1. Choose the version

Read the live version first, so the bump is right:

```bash
npm run preflight   # prints "Live: <version> at <sha>"
```

Bump `driverVersion` in `manifest.json`: the patch number for fixes, the minor
for new features. Drawdy refuses a version that is not above the live one,
and versions only go up, so a release with a mistake is fixed by the next
version rather than by going back.

Add `## <version>` at the top of `CHANGELOG.md` with short English bullets in
the file's style. The changelog and README show on the marketplace listing,
so update the README too if what a user sees changed. Keep the manifest
`description` at 500 characters or fewer; Drawdy refuses longer ones.

## 2. Local checks

```bash
npm test                  # also holds the repo to Drawdy's submission rules
npm run typecheck
npm run build             # regenerates src/webview-html.ts
```

`npm test` includes `test/manifest.test.ts`: the manifest schema, the icon
(at most 256 KB), README and CHANGELOG (at most 200 KB each), a changelog
section for this version, and no import from outside the repository except
`@drawdy/driver-protocol`. These mirror the checks Drawdy runs, so a failure
here is a failure there.

Drawdy builds `src/index.ts` itself and runs no bundler plugins, so the built
`src/webview-html.ts` must be committed with the release.

## 3. Commit, push, preflight

Commit the release (`🔖 release <version>: ...` for a version-only commit, or
fold the bump into the feature commit), push `main`, then:

```bash
npm run preflight
```

It rebuilds and confirms the tree is clean and the build changed nothing, the
bundle is under Drawdy's 5 MB, `HEAD` is the tip of `origin/main` (an empty
ref on the submit page means that commit), and the version is above the live
one. It ends with `✓ Ready to submit <sha> as <version>`. Note the sha: the
admin page shows it, and it is how you know the right commit was built.

## 4. Submit (publisher account)

Hand the user these steps:

1. Sign in to https://drawdy.io with the **publisher account** and open
   https://drawdy.io/account/extensions, tab **Submit**.
2. **Connect GitHub** if it asks. It only checks push access to the repo.
3. Repository URL: `https://github.com/mickyngub/qr-code`.
   **Branch, tag or commit**: leave empty for the tip of `main`, or paste the
   sha from preflight.
4. **Submit for review**. Expect "Submitted mickyngub.qr-code
   v<version>. We'll build it and send it for review."
5. Tab **My extensions** shows **Building**, then **In review** within a few
   minutes, or **Build failed** with the build error.

What goes wrong and why:

| Seen | Cause |
| --- | --- |
| /account/extensions bounces to settings | the account is not in the PostHog flag `extension-submit` (Drawdy project, `posthog-drawdy` MCP) |
| `driverVersion … must be greater than the published …` | the bump is missing or not pushed |
| `Invalid manifest: description …` | over 500 characters |
| `Submission limit reached` | too many submissions in 24 h; wait |
| GitHub authorization expired | Connect GitHub again |
| Build failed | read the error; reproduce with `npm run build` and `npm test` |

A new submission replaces any earlier one still building or in review, so
resubmitting after a fix is fine.

## 5. Review and approve (admin account)

1. Sign in to https://admin.drawdy.io with the **admin account** and open
   **Extensions**. Open the submission for `mickyngub.qr-code`
   at the new version.
2. Check, top to bottom:
   - **Source** commit is the sha from preflight.
   - **Bundle size** is about the size preflight printed (about 180 KB).
   - **Listing**: icon, README and CHANGELOG render, and the changelog shows
     the new version.
   - **Scan flags**. This extension shows none. The panel page inlined in
     `src/webview-html.ts` encodes every code itself with the vendored
     Project Nayuki generator (`src/vendor/qrcodegen.ts`, plain arithmetic,
     no `eval` or `Function`), renders PNGs with a canvas, and loads nothing
     from the network; the driver only talks to the board. Any flag (`eval`,
     `new-function`, `dynamic-import`, `fetch`, `xhr`, `websocket`, `atob`,
     `import-scripts`) means something new got bundled: stop and find out
     what before approving.
3. **Approve and publish**, with a short note to the submitter. It publishes
   at once.

## 6. Confirm it is live

```bash
curl -s https://backend.drawdy.io/api/extensions/catalog/mickyngub.qr-code
```

The entry's `version` and `commitSha` should be the new ones. Users get the
update the next time they open Drawdy; open a board yourself to see the
"updated" toast.

## If a published version is broken

Fix it and publish the next patch version through this same flow. If it must
come down before that, admin.drawdy.io → Extensions → catalog → this extension
has **Delist** (and **Relist** later).
