// Builds + prints a travel ticket from a `travel.ticketGet` payload.
import { buildTravelDocModel, type TravelOutputFormat } from "./travelDocModel";
import { buildTravelA4Html, buildTravelThermalHtml, printTravelHtml } from "./travelInvoiceHtml";

export interface TravelTicketDetail {
  doc: any;
  items: any[];
  invoice: any;
  company: any;
  travelSettings: any;
  customer: any;
  zatcaStatus?: any;
}

/** Build the printable HTML for a ticket in the requested format. */
export async function buildTravelTicketHtml(
  detail: TravelTicketDetail,
  format: TravelOutputFormat = "a4",
): Promise<string> {
  const model = await buildTravelDocModel(detail);
  return format === "thermal" ? buildTravelThermalHtml(model) : buildTravelA4Html(model);
}

/**
 * Print a travel ticket.
 *   format "a4"      → full bilingual A4 tax invoice (default)
 *   format "thermal" → 80mm POS thermal receipt
 */
export async function printTravelTicket(
  detail: TravelTicketDetail,
  format: TravelOutputFormat = "a4",
): Promise<void> {
  const html = await buildTravelTicketHtml(detail, format);
  const opts = format === "thermal" ? { widthMm: 80, heightMm: 200 } : { widthMm: 210, heightMm: 297 };
  printTravelHtml(html, opts);
}
