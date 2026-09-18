# Onboarding navigation during saves

Actual-handler regressions reproduced two navigation failures: Back changed steps while a save was pending, and two immediate Continue calls on the staff step advanced from Team past Hours to Services. That step has no awaited write, so a pending-request guard alone cannot prevent the latter.

Back now checks the synchronous step-save ref, pending staff requests and the resume-read gate. Its button is disabled while saving. Successful Continue targets the captured next step instead of incrementing whatever step happens to be current. Repeated calls from the same rendered step therefore request the same next step.

Tests invoke the actual Back handler and Continue handler, covering pending save/staff/read gates, normal Back and repeated staff-step advancement. Existing steps, saved payloads and scheduling rules remain unchanged. No browser/live testing. Full validation and push evidence recorded in the engineering handoff and parent audit log.
