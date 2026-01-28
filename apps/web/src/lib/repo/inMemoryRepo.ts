import { Repo, Socio, Message } from "./types";

const sociosByPhone = new Map<string, Socio>();
const sociosById = new Map<string, Socio>();
const messagesBySocio = new Map<string, Message[]>();

export const inMemoryRepo: Repo = {
    async getSocio(phone) {
        return sociosByPhone.get(phone) || null;
    },

    async createSocio(phone) {
        const existing = sociosByPhone.get(phone);
        if (existing) return existing;

        const id = Math.random().toString(36).substring(7);
        const socio: Socio = {
            id,
            whatsappPhoneNumber: phone,
            name: null,
            status: "NEW",
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        sociosByPhone.set(phone, socio);
        sociosById.set(id, socio);
        messagesBySocio.set(id, []);

        return socio;
    },

    async updateSocio(socioId, data) {
        const socio = sociosById.get(socioId);
        if (!socio) throw new Error("Socio not found");

        const updatedSocio = { ...socio, ...data, updatedAt: new Date() };

        // Update both indices
        sociosById.set(socioId, updatedSocio);
        sociosByPhone.set(updatedSocio.whatsappPhoneNumber, updatedSocio);

        return updatedSocio;
    },

    async addMessage(data) {
        const msg: Message = {
            id: Math.random().toString(36).substring(7),
            createdAt: new Date(),
            ...data
        };
        const arr = messagesBySocio.get(data.socioId) ?? [];
        arr.push(msg);
        messagesBySocio.set(data.socioId, arr);
        return msg;
    },

    async getMessages(socioId, limit) {
        const arr = messagesBySocio.get(socioId) ?? [];
        if (limit) {
            return arr.slice(Math.max(0, arr.length - limit));
        }
        return arr;
    },
};
