# Hands-on check: Reveal in Finder

Status: not yet run. This file holds no measurement and no observed outcome. Records are added below when the check is run.

The end-to-end tests stub `shell.showItemInFolder` (see `tests/support/background-main.js`), so they do not show what Finder does. This check is the hands-on run of the real action.

## Procedure

1. Run the app visibly with `npm start` (not through `tests/support/background-main.js` and not with any stub).
2. Create a collection that contains one file on the internal drive. Select the file and activate "Reveal in Finder". Watch Finder.
3. Repeat with a collection that contains one file on an external or network volume. If no such volume is available, record "not run: <volume type not available>".
4. For each volume, record the items below.

## Items to record per volume

- date
- volume label and type
- whether the file was selected in the app, and whether the path shown matched the file
- pass or fail for "Finder opened with the folder shown and the file selected"
- what Finder showed, in plain observed terms

Record observed outcomes only; do not state a cause for any outcome.

## internal drive

not run yet.

## external or network volume

not run yet.
