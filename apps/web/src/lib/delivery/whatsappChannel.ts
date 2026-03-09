import { sendWhatsAppMessage } from '@/lib/whatsapp/client';
import { DeliveryChannel, ChannelType } from './types';

export class WhatsAppChannel implements DeliveryChannel {
    async sendMessage(recipientId: string, text: string): Promise<void> {
        await sendWhatsAppMessage(recipientId, text);
    }

    getChannelType(): ChannelType {
        return 'whatsapp';
    }
}
