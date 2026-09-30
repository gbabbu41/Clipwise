import { formatFriendlyTime, prettyDate, timeToMinutes } from "@/lib/utils";

export type AppointmentNotificationSummary = {
  clientName: string;
  event: string;
  current?: { date: string; time: string };
  previous?: { date: string; time: string };
  service?: string;
  barber?: string;
};

type NotificationText = { title: string; message: string; type: string };

function humanDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? prettyDate(value) : value;
}

function humanTime(value: string) {
  const input = value.trim();
  const valid = input.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s?(AM|PM)?$/i);
  if (!valid) return value;
  const hour = Number(valid[1]);
  const minute = Number(valid[2]);
  if (minute > 59 || (valid[3] ? hour < 1 || hour > 12 : hour > 23)) return value;
  const minutes = timeToMinutes(input);
  if (!Number.isFinite(minutes)) return value;
  const normalized = `${Math.floor((minutes % 1440) / 60)}:${String(minutes % 60).padStart(2, "0")}`;
  return formatFriendlyTime(normalized) || value;
}

function dateAndTime(value: string) {
  const splitAt = value.lastIndexOf(" at ");
  if (splitAt <= 0 || splitAt + 4 >= value.length) return null;
  return { date: humanDate(value.slice(0, splitAt)), time: humanTime(value.slice(splitAt + 4)) };
}

/** Parse only the two known appointment-change message formats; legacy or
 * unfamiliar messages stay on the original generic notification renderer. */
export function parseAppointmentNotification(n: NotificationText): AppointmentNotificationSummary | null {
  const title = n.title.replace(/^[^A-Za-z0-9]+/, "").trim();
  if (n.type === "cancellation" || n.type === "no-show") {
    const match = n.message.match(/^(.+?)'s (.+?) on (.+?) at (.+?) was (.+)\.$/);
    if (match) {
      return {
        clientName: match[1],
        event: `Appointment ${match[5]}`,
        current: { date: humanDate(match[3]), time: humanTime(match[4]) },
        service: match[2],
      };
    }
    const selfCancelled = n.message.match(/^(.+?) cancelled their appointment with (.+?) \(was (.+?) at (.+?)\)$/i);
    if (selfCancelled) {
      return {
        clientName: selfCancelled[1],
        event: "Appointment cancelled by customer",
        current: { date: humanDate(selfCancelled[3]), time: humanTime(selfCancelled[4]) },
        barber: selfCancelled[2],
      };
    }
    return null;
  }

  if (n.type !== "booking" || !/reschedul/i.test(title)) return null;

  const moved = n.message.match(/^(.+?):\s*(.+?)\s*→\s*(.+?)(?:\s·\swith\s+(.+))?$/);
  if (moved) {
    const previous = dateAndTime(moved[2]);
    const current = dateAndTime(moved[3]);
    if (!previous || !current) return null;
    return { clientName: moved[1], event: title, previous, current, barber: moved[4] };
  }

  const selfRescheduled = n.message.match(/^(.+?) rescheduled to (.+?) at (.+?) \(was (.+?) at (.+?)\)(?: · with (.+))?$/);
  if (selfRescheduled) {
    return {
      clientName: selfRescheduled[1],
      event: title,
      current: { date: humanDate(selfRescheduled[2]), time: humanTime(selfRescheduled[3]) },
      previous: { date: humanDate(selfRescheduled[4]), time: humanTime(selfRescheduled[5]) },
      barber: selfRescheduled[6],
    };
  }

  return null;
}
