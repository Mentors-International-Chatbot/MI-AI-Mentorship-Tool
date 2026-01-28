export type Role = "user" | "assistant" | "system";
export type SocioStatus = 'NEW' | 'AWAITING_CONSENT' | 'AWAITING_NAME' | 'ACTIVE';

export type Socio = {
    id: string;
    whatsappPhoneNumber: string;
    name?: string | null;
    businessName?: string | null;
    businessDescription?: string | null;
    status: SocioStatus;
    createdAt: Date;
    updatedAt: Date;
};

export type Message = {
    id: string;
    socioId: string;
    role: Role;
    content: string;
    createdAt: Date;
};

export interface Repo {
    // Socio methods
    getSocio(phone: string): Promise<Socio | null>;
    createSocio(phone: string): Promise<Socio>;
    updateSocio(socioId: string, data: Partial<Socio>): Promise<Socio>;

    // Message methods
    addMessage(data: Omit<Message, "id" | "createdAt">): Promise<Message>;
    getMessages(socioId: string, limit?: number): Promise<Message[]>;
}
