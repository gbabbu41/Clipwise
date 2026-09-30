import { formatFriendlyTime, prettyDate, timeToMinutes } from "@/lib/utils";

export type AppointmentNotificationSummary = {
  clientName: string;
  event: string;
  current?: { date: string; time?: string };
  previous?: { date: string; time: string };
  service?: string;
  barber?: string;
  amount?: string;
  payment?: string;
};

type NotificationText = { title: string; message: string; type: string };

function humanDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? prettyDate(value) : value;
}

export function humanizeNotificationMessage(message: string) {
  return message.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, iso => prettyDate(iso));
}

function humanTime(value: string) {
  const input = value.trim();
  const valid = input.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s?(AM|PM)?$/i);
  if (!valid) return value;
  const hour = Number(valid[1]);
  const minute = Number(valid[2]);
  if (minute > 59 || (valid[3] ? hour < 1 || hour > 12 : hour > 23)) return value;
  const normalizedInput = `${valid[1]}:${valid[2]}${valid[3] ? ` ${valid[3].toUpperCase()}` : ""}`;
  const minutes = timeToMinutes(normalizedInput);
  if (!Number.isFinite(minutes)) return value;
  const normalized = `${Math.floor((minutes % 1440) / 60)}:${String(minutes % 60).padStart(2, "0")}`;
  return formatFriendlyTime(normalized) || value;
}

function dateAndTime(value: string) {
  const splitAt = value.lastIndexOf(" at ");
  if (splitAt <= 0 || splitAt + 4 >= value.length) return null;
  return { date: humanDate(value.slice(0, splitAt)), time: humanTime(value.slice(splitAt + 4)) };
}

/** Parse recognized customer-facing notification formats; unfamiliar messages
 * stay intact in the generic notification renderer. */
export function parseAppointmentNotification(n: NotificationText): AppointmentNotificationSummary | null {
  const title = n.title.replace(/^[^A-Za-z0-9]+/, "").trim();
  const waitlist = n.type === "booking" && title === "Waitlist request" && n.message.match(/^(.+?) is waiting for a spot on (.+)$/i);
  if (waitlist) return { clientName: waitlist[1], event: "Waiting for a spot", current: { date: humanDate(waitlist[2]) } };

  if (n.type === "booking" && /^Payment received$/i.test(title)) {
    const payment = n.message.match(/^Charged (.+?)'s card(?: (\$[\d,]+\.\d{2}))? on completion(?: \((.+)\))?\.$/i);
    if (payment) return {
      clientName: payment[1], event: "Payment received", amount: payment[2], payment: "Card charged on completion",
      current: payment[3] ? { date: humanDate(payment[3]) } : undefined,
    };
  }
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

  if (n.type !== "booking") return null;

  if (/reschedul/i.test(title)) {
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

  const bookingTitle = title.match(/^New booking(?:\s*[·—]\s*(.+))?$/i);
  if (!bookingTitle) return null;
  const suffix = bookingTitle[1]?.trim();
  const amount = suffix && /^[$€£]\s?[\d,]+(?:\.\d{1,2})?$/.test(suffix) ? suffix : undefined;
  const event = amount ? "New booking" : title;

  const finalizeMessage = n.message.match(/^(.+?) booked (.+?) with (.+?) (& paid|\((?:pay at shop · card on file|card saved|card on hold)\)) for (.+?) at (.+)$/i);
  if (finalizeMessage) {
    const current = dateAndTime(`${finalizeMessage[5]} at ${finalizeMessage[6]}`);
    if (!current) return null;
    const payment = finalizeMessage[4].toLowerCase() === "& paid" ? "Paid" : finalizeMessage[4].slice(1, -1);
    return { clientName: finalizeMessage[1], event, amount, service: finalizeMessage[2], barber: finalizeMessage[3], payment, current };
  }

  const simplePaidMessage = n.message.match(/^(.+?) booked & paid for (.+?) at (.+)$/i);
  if (simplePaidMessage) {
    const current = dateAndTime(`${simplePaidMessage[2]} at ${simplePaidMessage[3]}`);
    if (!current) return null;
    return { clientName: simplePaidMessage[1], event, amount, payment: "Paid", current };
  }

  const withBarberMessage = n.message.match(/^(.+?) — (.+?) with (.+?) on (.+?) at (.+?)(?: · tap to approve)?$/i);
  if (withBarberMessage) {
    const current = dateAndTime(`${withBarberMessage[4]} at ${withBarberMessage[5]}`);
    if (!current) return null;
    return { clientName: withBarberMessage[1], event, amount, service: withBarberMessage[2], barber: withBarberMessage[3], current };
  }

  const noBarberMessage = n.message.match(/^(.+?) — (.+?) on (.+?) at (.+?)(?: · tap to approve)?$/i);
  if (noBarberMessage) {
    const current = dateAndTime(`${noBarberMessage[3]} at ${noBarberMessage[4]}`);
    if (!current) return null;
    return { clientName: noBarberMessage[1], event, amount, service: noBarberMessage[2], current };
  }

  return null;
}
