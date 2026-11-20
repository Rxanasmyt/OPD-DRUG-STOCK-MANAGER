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
