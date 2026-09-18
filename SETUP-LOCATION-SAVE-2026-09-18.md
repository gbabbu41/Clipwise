# Quick-setup location save confirmation

An actual-handler regression reproduced false success after a location update matched no shop row: the sheet refreshed and closed without confirming persistence. Thrown updates also left loading set, and concurrent submissions were not synchronously guarded.

Location updates now return and confirm the scoped shop ID before refreshing/closing. Failed, empty, mismatched or thrown results retain the form with honest confirmation guidance. A synchronous guard blocks overlapping location writes; loading remains active through refresh. Late results after shop/step changes or unmount do not refresh or close a newer sheet. The parent keys setup drafts to their shop/step. Close/backdrop dismissal and form editing are disabled while saving.

Tests cover zero-row/mismatched/error/offline results, held duplicate saves, shop/unmount changes, blank-address validation, unchanged normalized payload and pending dismissal. No schema, business rules or calendar layout changes. The shared fieldset/dismissal lock also applies while hours reports saving; synchronous hours request isolation remains a separate follow-up. No live data/browser test. Validation and push evidence are in the engineering handoff and parent audit log.
