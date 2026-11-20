# Project rules for Claude sessions

## Keep the user manual current (standing instruction from the owner)
Whenever you change a user-facing flow — a tab/menu name, the order of steps, a button label, a new/removed screen,
who is allowed to do what, how HOSxP import/receive/transfer/adjust works — **update the manual in the same PR**:

- `src/screens/UserManual.tsx` (the full manual, shown from the login page and "เพิ่มเติม")
- `src/screens/LoginGuide.tsx` (daily-steps card) and `src/screens/LoginFlow.tsx` (flow map) on the login page
- Tab/menu names live only in `src/navLabels.ts` (`TAB`, `MENU`); add a new screen to `SCREEN_MANUAL` there
  (TypeScript will not compile until you do) and make sure the section it points at describes the change.
- Add a line to `CHANGELOG.md` mentioning the manual update. `src/navLabels.test.tsx` guards the wiring, but it cannot
  check wording — re-read the affected manual section against the new behaviour.

## Manual screenshots
The manual's pictures are real screenshots of the app with invented demo data, kept in `public/manual/*.jpg`.
After changing the look or steps of any documented screen (HOSxP import, เติมหน้างาน, รับเข้า, ปรับยอด/คืนยา, นับสต็อก, ฯลฯ),
run `npm run manual:shots` (builds `vite.manual.config.ts` against fake Firebase modules, drives the UI with Playwright —
see `scripts/manual-shots.mjs` and `scripts/manual-shots/fixtures.mjs`) and commit the refreshed images together with the
manual captions in `UserManual.tsx`. If a step in the script stops finding its button, the UI changed: update the script.
