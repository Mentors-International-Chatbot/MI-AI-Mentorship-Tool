import { DeliveryChannel, ChannelType } from './types';

export class WebChannel implements DeliveryChannel {
    private collectedMessages: string[] = [];

    async sendMessage(_recipientId: string, text: string): Promise<void> {
        this.collectedMessages.push(text);
    }

    getChannelType(): ChannelType {
        return 'web';
    }

    getMessages(): string[] {
        return this.collectedMessages;
    }
}
