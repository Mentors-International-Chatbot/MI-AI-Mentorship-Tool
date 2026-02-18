import { prisma } from "@/lib/db";
import { Repo, Socio, Message } from "./types";
import { Socio as PrismaSocio, Message as PrismaMessage } from "@prisma/client";

function toSocio(p: PrismaSocio): Socio {
    return {
        id: p.id,
        whatsappPhoneNumber: p.whatsappPhoneNumber,
        name: p.name,
        businessName: p.businessName,
        businessDescription: p.businessDescription,
        status: p.status,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
    };
}

function toMessage(p: PrismaMessage): Message {
    return {
        id: p.id,
        socioId: p.socioId,
        role: p.role as Message["role"],
        content: p.content,
        createdAt: p.createdAt,
    };
}

export const prismaRepo: Repo = {
    async getSocio(phone) {
        const socio = await prisma.socio.findUnique({
            where: { whatsappPhoneNumber: phone },
        });
        if (!socio) return null;
        return toSocio(socio);
    },

    async createSocio(phone) {
        const socio = await prisma.socio.create({
            data: { whatsappPhoneNumber: phone },
        });
        return toSocio(socio);
    },

    async updateSocio(socioId, data) {
        const socio = await prisma.socio.update({
            where: { id: socioId },
            data: {
                name: data.name,
                businessName: data.businessName,
                businessDescription: data.businessDescription,
                status: data.status,
            },
        });
        return toSocio(socio);
    },

    async addMessage(data) {
        const msg = await prisma.message.create({
            data: {
                socioId: data.socioId,
                role: data.role,
                content: data.content,
            },
        });
        return toMessage(msg);
    },

    async getMessages(socioId, limit) {
        const messages = await prisma.message.findMany({
            where: { socioId },
            orderBy: { createdAt: "desc" },
            ...(limit ? { take: limit } : {}),
        });
        return messages.reverse().map(toMessage);
    },
};
