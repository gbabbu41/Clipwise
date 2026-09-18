# Service visibility save confirmation

An actual-handler regression reproduced the Live/Hidden switch changing locally after a zero-row update. The previous handler also ignored returned errors and did not catch thrown requests.

Visibility updates now match both service and current shop, require a returned row with an authoritative boolean state, and preserve the displayed value on rejected, missing or thrown results. A per-service synchronous guard and disabled switch prevent overlapping submissions. Late responses after switching shops do not update the displayed list or report errors against the new shop. Pending state is always released.

The intended Live/Hidden behavior and all pricing, booking and service rules remain unchanged. This does not serialize edits from other sessions. Tests use mocked queries only and cover zero-row/error/offline/malformed results, authoritative success, shop isolation, duplicate submission and cleanup. No live service is toggled by testing. Validation/push status is in the parent audit log.
