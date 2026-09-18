# Service editor save reliability

Failed edits/additions retain the form and report a generic error. Updates match the service and shop IDs and require a returned row before success. A synchronous in-flight guard prevents duplicate submissions; the form remains locked while saving. Responses from a previous active shop do not close/reset the current editor or reload the previous shop. Uncertain saves ask the operator to refresh the list before retrying.

All existing validation, prices, durations, categories, active flags and retired-deposit clearing behavior are preserved. No changes to service templates, deletion policy, booking calculations or schema. Tests execute the actual save handler with mocked responses. No services were created or changed in production for testing.
