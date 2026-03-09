import { DeliveryChannel, ChannelType } from './types';

export class WebChannel implements DeliveryChannel {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async sendMessage(recipientId: string, text: string): Promise<void> {
        // No-op: web chat returns the response directly via the API endpoint
    }

    getChannelType(): ChannelType {
        return 'web';
    }
}
