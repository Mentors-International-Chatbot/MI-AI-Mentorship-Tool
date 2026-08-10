export interface DeliveryChannel {
    sendMessage(recipientId: string, text: string): Promise<void>;
    getChannelType(): ChannelType;
}

export type ChannelType = 'whatsapp' | 'web' | 'canvas';
