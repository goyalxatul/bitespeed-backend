import { Request, Response } from "express";
import prisma from "../models/prismaClient";

export const identifyContact = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, phoneNumber } = req.body;

    if (!email && !phoneNumber) {
      res.status(400).json({ error: "Provide email or phoneNumber" });
      return;
    }

    // Build dynamic OR conditions only for defined values
    const orConditions = [];
    if (email) orConditions.push({ email });
    if (phoneNumber) orConditions.push({ phoneNumber });

    // Find all matched contacts by email or phoneNumber
    const matchedContacts = await prisma.contact.findMany({
      where: { OR: orConditions },
      orderBy: { createdAt: "asc" },
    });

    // If no matched contacts, create a new primary contact and return
    if (matchedContacts.length === 0) {
      const newPrimary = await prisma.contact.create({
        data: { email, phoneNumber, linkPrecedence: "primary" },
      });

      res.json({
        contact: {
          primaryContactId: newPrimary.id,
          emails: [email].filter(Boolean),
          phoneNumbers: [phoneNumber].filter(Boolean),
          secondaryContactIds: [],
        },
      });
      return;
    }

    // Collect all IDs for matched contacts + linked contacts to fetch full contact group
    const contactIds = new Set<number>();
    matchedContacts.forEach(c => {
      contactIds.add(c.id);
      if (c.linkedId) contactIds.add(c.linkedId);
    });

    // Find all contacts linked to this group (primary + secondaries)
    const allContacts = await prisma.contact.findMany({
      where: {
        OR: [
          { id: { in: Array.from(contactIds) } },
          { linkedId: { in: Array.from(contactIds) } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });

    // Determine primary contact - prefer one with linkPrecedence "primary"
    let primaryContact = allContacts.find(c => c.linkPrecedence === "primary") || allContacts[0];

    // If primaryContact is actually secondary, fix primary contact to real primary
    if (primaryContact.linkPrecedence === "secondary" && primaryContact.linkedId) {
      const realPrimary = allContacts.find(c => c.id === primaryContact.linkedId);
      if (realPrimary) {
        primaryContact = realPrimary;
      }
    }

    // Update any other contacts wrongly marked as primary to secondary linked to the primaryContact
    for (const contact of allContacts) {
      if (contact.id !== primaryContact.id && contact.linkPrecedence === "primary") {
        await prisma.contact.update({
          where: { id: contact.id },
          data: {
            linkPrecedence: "secondary",
            linkedId: primaryContact.id,
          },
        });
      }
    }

    // Check if exact contact already exists
    const hasExact = allContacts.some(c => c.email === email && c.phoneNumber === phoneNumber);

    // Check if email or phone exists separately
    const hasEmail = allContacts.some(c => c.email === email);
    const hasPhone = allContacts.some(c => c.phoneNumber === phoneNumber);

    // If exact doesn't exist but email or phone exists, create a new secondary linked to primary
    if (!hasExact && (hasEmail || hasPhone)) {
      const newSecondary = await prisma.contact.create({
        data: {
          email,
          phoneNumber,
          linkPrecedence: "secondary",
          linkedId: primaryContact.id,
        },
      });
      allContacts.push(newSecondary);
    }

    // Deduplicate emails and phoneNumbers
    const emails = new Set<string>();
    const phoneNumbers = new Set<string>();
    const secondaryContactIds: number[] = [];

    for (const contact of allContacts) {
      if (contact.email) emails.add(contact.email);
      if (contact.phoneNumber) phoneNumbers.add(contact.phoneNumber);
      if (contact.id !== primaryContact.id) secondaryContactIds.push(contact.id);
    }

    res.json({
      contact: {
        primaryContactId: primaryContact.id,
        emails: Array.from(emails),
        phoneNumbers: Array.from(phoneNumbers),
        secondaryContactIds,
      },
    });
  } catch (error) {
    console.error("IdentifyContact error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
