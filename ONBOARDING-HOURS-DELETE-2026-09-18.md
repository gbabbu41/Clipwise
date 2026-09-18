# Onboarding hours deletion failures

An actual-handler regression reproduced advancement after the database rejected deletion of existing hours. The handler could then insert overlapping replacements; an all-closed schedule could report success without clearing hours.

The handler now checks the deletion result and stops before insertion, later barber writes or advancement when it returns an error. The form remains available with an actionable review/retry message. Thrown failures also stop via the existing catch/finally path. Successful slot payloads and all-closed behavior are preserved.

Focused checks cover returned and thrown deletion failures with open/all-closed schedules, a later barber failure, busy-state cleanup and successful payloads. This does not make replacement atomic: prior barber writes can have succeeded, deletion can succeed before insertion fails, and an interrupted response can be uncertain. It does not promise saved hours are unchanged. No live data was used. Validation/commit evidence is in the engineering status and parent audit log.
