/**
 * WhatsApp Router — tRPC endpoints
 * Frontend se WhatsApp bhejne ke liye
 */
import { z } from "zod";
import { createRouter, authedMutation } from "./middleware";
import {
  sendWhatsApp,
  sendInvoiceReminder,
  sendInvoiceCreatedNotification,
  sendPaymentReceivedNotification,
  sendLowStockAlert,
  sendEmployeeWelcome,
  sendSalaryNotification,
} from "./services/whatsappService";

export const whatsappRouter = createRouter({

  // Custom message bhejo
  send: authedMutation
    .input(z.object({
      to: z.string().min(7),
      message: z.string().min(1).max(1600),
      mediaUrl: z.string().url().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await sendWhatsApp({
        to: input.to,
        message: input.message,
        mediaUrl: input.mediaUrl,
      });
      return result;
    }),

  // Invoice reminder
  sendInvoiceReminder: authedMutation
    .input(z.object({
      customerPhone: z.string(),
      customerName: z.string(),
      invoiceNumber: z.string(),
      amount: z.number(),
      currency: z.string().default("SAR"),
      dueDate: z.string(),
      companyName: z.string(),
      language: z.enum(["ar", "en", "ur"]).default("ar"),
    }))
    .mutation(async ({ input }) => {
      return sendInvoiceReminder(input);
    }),

  // Invoice banane ke baad
  sendInvoiceCreated: authedMutation
    .input(z.object({
      customerPhone: z.string(),
      customerName: z.string(),
      invoiceNumber: z.string(),
      amount: z.number(),
      currency: z.string().default("SAR"),
      companyName: z.string(),
      language: z.enum(["ar", "en", "ur"]).default("ar"),
    }))
    .mutation(async ({ input }) => {
      return sendInvoiceCreatedNotification(input);
    }),

  // Payment receive hone ke baad
  sendPaymentReceived: authedMutation
    .input(z.object({
      customerPhone: z.string(),
      customerName: z.string(),
      amount: z.number(),
      currency: z.string().default("SAR"),
      receiptNumber: z.string(),
      companyName: z.string(),
      language: z.enum(["ar", "en", "ur"]).default("ar"),
    }))
    .mutation(async ({ input }) => {
      return sendPaymentReceivedNotification(input);
    }),

  // Low stock alert
  sendLowStock: authedMutation
    .input(z.object({
      managerPhone: z.string(),
      productName: z.string(),
      currentStock: z.number(),
      minStock: z.number(),
      unit: z.string().default("pcs"),
      companyName: z.string(),
    }))
    .mutation(async ({ input }) => {
      return sendLowStockAlert(input);
    }),

  // Employee welcome
  sendEmployeeWelcome: authedMutation
    .input(z.object({
      employeePhone: z.string(),
      employeeName: z.string(),
      position: z.string(),
      startDate: z.string(),
      companyName: z.string(),
      language: z.enum(["ar", "en", "ur"]).default("ar"),
    }))
    .mutation(async ({ input }) => {
      return sendEmployeeWelcome(input);
    }),

  // Salary notification
  sendSalary: authedMutation
    .input(z.object({
      employeePhone: z.string(),
      employeeName: z.string(),
      month: z.string(),
      netSalary: z.number(),
      currency: z.string().default("SAR"),
      companyName: z.string(),
      language: z.enum(["ar", "en", "ur"]).default("ar"),
    }))
    .mutation(async ({ input }) => {
      return sendSalaryNotification(input);
    }),

  // Check if WhatsApp is configured
  isConfigured: authedMutation
    .query(() => {
      return {
        configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
        sandbox: process.env.TWILIO_WHATSAPP_FROM === "whatsapp:+14155238886",
      };
    }),
});
